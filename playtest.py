#!/usr/bin/env python3
"""SOLMAR full playtest: drive all three missions end-to-end in headless
Chromium with real key input, then check wanted / bust / wasted.

Missions (against the current redo build, commit c2a5edf+):
  1. The Pickup ($500): meet Rico (20,26), fetch the package at the
     marina pier end (234,182), return to Rico.
  2. Hot Wheels ($900): meet Dee (-26,-26), steal the marked parked car
     with a real E keypress, deliver it to the chop shop (-182,182).
  3. The Exchange ($1,500): meet Sal (78,-130), grab the briefcase at
     the north docks (130,-182, +25 heat), deliver to (234,78).

Technique: the harness teleports the player on foot to ~12 units from
each on-foot target (a test-harness state poke, as in earlier chunks),
then walks the last stretch with real W key input and camera steering
via player.camYaw. Driving uses real W/A/D input with yaw steering
along the road grid. All waits poll game state, never wall clocks:
headless SwiftShader runs ~0.5-3.5 fps, so the suite takes ~10 min.

Memory note: a single headless Chromium renderer OOM-crashes after
~10-14 min of continuous SwiftShader rendering on this VM (seen twice),
so the suite runs as three short phases, each in its own browser
launch. State between phases travels through the game's own save: a
persistent browser profile keeps localStorage, and each phase verifies
its entry conditions (money + jobs done) before playing on.

Usage:  python3 playtest.py [--port 8902] [--phase m1|m2|m3|all]
Exits 0 only when all checks pass; prints a PASS/FAIL line per check.
"""

import argparse
import json
import math
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent
PROFILE = REPO / "shots-tmp" / "playtest-profile"
CHROMIUM_ARGS = [
    "--disable-frame-rate-limit",
    "--disable-dev-shm-usage",  # /dev/shm is small here; a full Chromium
    "--no-sandbox",              # renderer can OOM-crash the tab without it
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
]
POLL_MS = 400
ARRIVE = 4.0  # stop walking this close to a target (mission radius is 4.5)
ROAD_LINES = [-234, -182, -130, -78, -26, 26, 78, 130, 182, 234]


def grid_route(start, target):
    """Axis-aligned waypoints from `start` to `target` that stay on the
    road grid: first a short move onto the nearest road line, then along
    that line to the target's road, then along it to the target. Driving
    diagonally across blocks wedges the car on buildings."""
    sx = min(ROAD_LINES, key=lambda v: abs(v - start[0]))
    tz = min(ROAD_LINES, key=lambda v: abs(v - target[1]))
    tx = min(ROAD_LINES, key=lambda v: abs(v - target[0]))
    points = [(sx, start[1]), (sx, tz)]
    if tx != sx:
        points.append((tx, tz))
    # Final approach on the target's own road line.
    if abs(target[0] - tx) > 1 or abs(target[1] - tz) > 1:
        points.append(target)
    return points

RESULTS: list[tuple[str, bool, str]] = []
ERRORS: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}", flush=True)


def wait_for(fn, timeout_s, what, page):
    deadline = time.monotonic() + timeout_s
    last = None
    while time.monotonic() < deadline:
        try:
            last = fn(page)
        except Exception as exc:
            last = f"error: {exc}"
        if last:
            return last
        page.wait_for_timeout(POLL_MS)
    raise TimeoutError(f"timed out waiting for {what}; last: {last!r}")


def snap(page):
    """One small read of the live game state."""
    return page.evaluate("""() => {
        const s = window.__solmar;
        const m = s.missions;
        const job = m.activeJob();
        const step = m.currentStep();
        return {
            state: s.world.state,
            money: s.world.money,
            health: s.player.health,
            wanted: s.world.wanted,
            heat: s.wanted.heat,
            onFoot: s.player.onFoot,
            px: s.player.pos.x, pz: s.player.pos.z,
            driven: !!s.vehicles.driven,
            job: job ? job.id : null,
            step: m.stepIndex,
            stepKind: step ? step.kind : null,
            done: { ...m.done },
            cruisers: s.wanted.cruisers.length,
            ammo: s.combat.ammo,
        };
    }""")


def boot(page, url):
    """Load the page, clear or keep the save as asked, start the game."""
    page.goto(url, wait_until="load", timeout=60_000)
    wait_for(lambda p: p.evaluate("!!window.__solmar"),
             90, "__solmar handle", page)
    page.click("#start-button")
    wait_for(lambda p: p.evaluate(
        "window.__solmar.world.state") == "playing",
        90, "state 'playing'", page)


def wait_save(page, money, job, timeout_s=90):
    """True when localStorage holds a save with this money and job done."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        raw = page.evaluate(
            "localStorage.getItem('solmar-save-v1')")
        if raw:
            try:
                data = json.loads(raw)
                if (data.get("money", 0) >= money
                        and data.get("done", {}).get(job)):
                    return True
            except (ValueError, TypeError):
                pass
        page.wait_for_timeout(1000)
    return False


def teleport(page, x, z):
    """Put the player on foot at (x, z). Exits any car first (retrying
    past the 0.4 s enter cooldown)."""
    for _ in range(5):
        still_driving = page.evaluate("""([x, z]) => {
            const s = window.__solmar;
            if (s.vehicles.driven) { s.vehicles.tryEnter(s.player); return true; }
            s.player.pos.set(x, 0, z);
            return false;
        }""", [x, z])
        if not still_driving:
            break
        page.wait_for_timeout(600)
    page.wait_for_timeout(300)


def walk_to(page, x, z, timeout_s=240):
    """Walk to (x, z) with real W input, steering by camYaw. Returns True
    when the player gets within ARRIVE units, False on timeout or death."""
    page.keyboard.down("Shift")
    page.keyboard.down("KeyW")
    deadline = time.monotonic() + timeout_s
    best = math.inf
    stuck_since = time.monotonic()
    try:
        while time.monotonic() < deadline:
            s = snap(page)
            if s["state"] in ("wasted", "busted"):
                return False
            dx, dz = x - s["px"], z - s["pz"]
            dist = math.hypot(dx, dz)
            if dist < ARRIVE:
                return True
            if dist < best - 0.5:
                best = dist
                stuck_since = time.monotonic()
            elif time.monotonic() - stuck_since > 25:
                # Blocked by a wall: sidestep right for a moment.
                page.keyboard.down("KeyD")
                page.wait_for_timeout(1200)
                page.keyboard.up("KeyD")
                stuck_since = time.monotonic()
            page.evaluate(
                "([yaw]) => { window.__solmar.player.camYaw = yaw; }",
                [math.atan2(dx, dz)])
            page.wait_for_timeout(POLL_MS)
        return False
    finally:
        page.keyboard.up("KeyW")
        page.keyboard.up("Shift")


def wait_step_advance(page, job, from_step, timeout_s=180):
    """True when job `job` moves past step `from_step` (or finishes)."""
    try:
        wait_for(
            lambda p: (lambda s: s["done"].get(job) or s["job"] != job
                       or s["step"] > from_step)(snap(p)),
            timeout_s, f"job {job} past step {from_step}", page)
        return True
    except TimeoutError:
        return False


def wait_done(page, job, timeout_s=300):
    try:
        wait_for(lambda p: snap(p)["done"].get(job),
                 timeout_s, f"job {job} done", page)
        return True
    except TimeoutError:
        return False


def wait_money(page, amount, timeout_s=120):
    try:
        wait_for(lambda p: snap(p)["money"] >= amount,
                 timeout_s, f"money >= {amount}", page)
        return True
    except TimeoutError:
        return False


def drive_waypoints(page, points, timeout_s=600):
    """Drive the stolen car through road-grid waypoints with real W/A/D.
    Returns True when the final point is reached."""
    page.keyboard.down("KeyW")
    deadline = time.monotonic() + timeout_s
    idx = 0
    best = math.inf
    stuck_since = time.monotonic()
    polls = 0
    try:
        while time.monotonic() < deadline:
            polls += 1
            car = page.evaluate("""() => {
                const c = window.__solmar.vehicles.driven;
                if (!c) return null;
                return { x: c.group.position.x, z: c.group.position.z,
                         yaw: c.yaw, speed: c.speed };
            }""")
            if car is None:
                return False
            s = snap(page)
            if s["state"] in ("wasted", "busted"):
                return False
            tx, tz = points[idx]
            dx, dz = tx - car["x"], tz - car["z"]
            dist = math.hypot(dx, dz)
            if polls % 25 == 1:
                print(f"  drive: wp {idx + 1}/{len(points)} "
                      f"car=({car['x']:.0f},{car['z']:.0f}) "
                      f"speed={car['speed']:.1f} dist={dist:.0f} "
                      f"wanted={s['wanted']}", flush=True)
            if dist < (6 if idx == len(points) - 1 else 9):
                idx += 1
                if idx >= len(points):
                    return True
                continue
            if dist < best - 1.0:
                best = dist
                stuck_since = time.monotonic()
            elif time.monotonic() - stuck_since > 30:
                # Reversing out of a jam: back up, then carry on.
                page.keyboard.up("KeyW")
                page.keyboard.down("KeyS")
                page.wait_for_timeout(1500)
                page.keyboard.up("KeyS")
                page.keyboard.down("KeyW")
                stuck_since = time.monotonic()
                best = math.inf
            desired = math.atan2(dx, dz)
            err = (desired - car["yaw"] + math.pi) % (2 * math.pi) - math.pi
            if err > 0.12:
                page.keyboard.down("KeyA")
                page.keyboard.up("KeyD")
            elif err < -0.12:
                page.keyboard.down("KeyD")
                page.keyboard.up("KeyA")
            else:
                page.keyboard.up("KeyA")
                page.keyboard.up("KeyD")
            page.wait_for_timeout(POLL_MS)
        return False
    finally:
        for k in ("KeyW", "KeyA", "KeyD", "KeyS"):
            page.keyboard.up(k)


def mission_leg(page, x, z, job, from_step, timeout_s=300):
    """Teleport near a target, walk in, wait for the step to advance
    past `from_step` (the step index the player is on when arriving)."""
    # Approach from the south-west so the walk stays on open ground.
    teleport(page, x - 9, z + 9)
    ok = walk_to(page, x, z, timeout_s=timeout_s)
    if not ok:
        return False
    return wait_step_advance(page, job, from_step)


def phase_m1(page):
    """Mission 1 + save/load round-trip. Starts from a cleared save."""
    page.evaluate("localStorage.clear()")
    boot(page, page.url)
    s = snap(page)
    check("boot", s["state"] == "playing" and s["money"] == 250,
          f"money={s['money']}")
    check("m1 meet Rico",
          mission_leg(page, 20, 26, "pickup", 0),
          "walked to Rico, step advanced")
    check("m1 fetch package",
          mission_leg(page, 234, 182, "pickup", 1),
          "walked the pier, step advanced")
    check("m1 deliver + payout",
          mission_leg(page, 20, 26, "pickup", 2, timeout_s=300)
          and wait_done(page, "pickup") and wait_money(page, 750),
          f"money={snap(page)['money']}")
    check("m1 save written",
          wait_save(page, 750, "pickup"),
          "localStorage holds $750 + pickup done")
    # Save/load round-trip inside this phase.
    page.reload(wait_until="load", timeout=60_000)
    boot(page, page.url)
    s = snap(page)
    check("save/load after m1",
          s["money"] == 750 and s["done"]["pickup"]
          and s["job"] == "wheels",
          f"money={s['money']} done={s['done']} job={s['job']}")


def phase_m2(page):
    """Mission 2, starting from the mission-1 save."""
    boot(page, page.url)
    s = snap(page)
    check("m2 entry state",
          s["money"] == 750 and s["done"]["pickup"]
          and s["job"] == "wheels",
          f"money={s['money']} done={s['done']} job={s['job']}")
    if not (s["money"] == 750 and s["done"]["pickup"]):
        return
    check("m2 meet Dee",
          mission_leg(page, -26, -26, "wheels", 0),
          "walked to Dee, steal step active")
    car_pos = page.evaluate("""() => {
        const c = window.__solmar.missions.targetCar;
        if (!c) return null;
        return { x: c.group.position.x, z: c.group.position.z };
    }""")
    check("m2 target car picked", car_pos is not None, f"{car_pos}")
    stolen = False
    if car_pos:
        teleport(page, car_pos["x"] - 6, car_pos["z"] + 6)
        if walk_to(page, car_pos["x"], car_pos["z"], timeout_s=180):
            page.keyboard.press("KeyE")
            try:
                wait_for(lambda p: snap(p)["driven"], 60,
                         "driven car", page)
                stolen = True
            except TimeoutError:
                stolen = False
    check("m2 steal with E key", stolen, "driving the marked car")
    drove = False
    if stolen:
        # Route on the road grid from wherever the parked car actually
        # is (it need not be near Dee) to the chop shop.
        start = page.evaluate("""() => {
            const c = window.__solmar.vehicles.driven;
            return [c.group.position.x, c.group.position.z];
        }""")
        route = grid_route(start, (-182, 182))
        print(f"  drive route: {[(round(a), round(b)) for a, b in route]}",
              flush=True)
        drove = drive_waypoints(page, route, timeout_s=900)
    check("m2 deliver to chop shop",
          drove and wait_done(page, "wheels")
          and wait_money(page, 1650),
          f"money={snap(page)['money']}")
    check("m2 save written",
          wait_save(page, 1650, "wheels"),
          "localStorage holds $1650 + wheels done")


def phase_m3(page):
    """Mission 3 + wanted / bust / wasted, from the mission-2 save."""
    boot(page, page.url)
    s = snap(page)
    check("m3 entry state",
          s["money"] == 1650 and s["done"]["wheels"]
          and s["job"] == "exchange",
          f"money={s['money']} done={s['done']} job={s['job']}")
    if not (s["money"] == 1650 and s["done"]["wheels"]):
        return
    check("m3 meet Sal",
          mission_leg(page, 78, -130, "exchange", 0),
          "walked to Sal, fetch step active")
    check("m3 fetch briefcase (+1 star)",
          mission_leg(page, 130, -182, "exchange", 1)
          and snap(page)["wanted"] >= 1,
          f"wanted={snap(page)['wanted']}")
    check("m3 deliver + payout",
          mission_leg(page, 234, 78, "exchange", 2, timeout_s=300)
          and wait_done(page, "exchange")
          and wait_money(page, 3150),
          f"money={snap(page)['money']}")
    s = snap(page)
    check("all three jobs done",
          all(s["done"].values()),
          f"done={s['done']} money={s['money']}")

    # ---- Wanted / bust / wasted --------------------------------------
    page.evaluate("window.__solmar.wanted.addHeat(60)")
    page.wait_for_timeout(1000)
    s = snap(page)
    check("wanted level 3 + cruisers",
          s["wanted"] >= 3 and s["cruisers"] >= 1,
          f"wanted={s['wanted']} cruisers={s['cruisers']}")
    # Stand still: a cruiser pinning the player at 3+ stars busts.
    try:
        wait_for(lambda p: snap(p)["state"] == "busted",
                 300, "state 'busted'", page)
        check("busted when pinned at 3 stars", True, "BUSTED screen shown")
    except TimeoutError:
        check("busted when pinned at 3 stars", False,
              f"state={snap(page)['state']}")
    # Retry resets the wanted level; then wasted at 0 health.
    page.click("#retry-busted-button")
    wait_for(lambda p: p.evaluate(
        "window.__solmar.world.state") == "playing",
        90, "state 'playing' after retry", page)
    s = snap(page)
    check("retry resets wanted", s["wanted"] == 0,
          f"wanted={s['wanted']}")
    page.evaluate("""() => {
        window.__solmar.player.health = 5;
        window.__solmar.wanted.addHeat(60);
    }""")
    try:
        wait_for(lambda p: snap(p)["state"] == "wasted",
                 300, "state 'wasted'", page)
        check("wasted at 0 health", True, "WASTED screen shown")
    except TimeoutError:
        check("wasted at 0 health", False,
              f"state={snap(page)['state']} health={snap(page)['health']}")
    page.click("#retry-button")
    wait_for(lambda p: p.evaluate(
        "window.__solmar.world.state") == "playing",
        90, "state 'playing' after wasted retry", page)


PHASES = {"m1": phase_m1, "m2": phase_m2, "m3": phase_m3}


def run_phase(pw, url, name):
    """One short browser session for a single phase."""
    ctx = pw.chromium.launch_persistent_context(
        str(PROFILE), headless=True, args=CHROMIUM_ARGS,
        viewport={"width": 960, "height": 540})
    try:
        page = ctx.new_page()
        page.on("console", lambda m: ERRORS.append(f"console.error: {m.text}")
                  if m.type == "error" else None)
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        print(f"--- phase {name} ---", flush=True)
        page.goto(url, wait_until="load", timeout=60_000)
        wait_for(lambda p: p.evaluate("!!window.__solmar"),
                 90, "__solmar handle", page)
        PHASES[name](page)
    finally:
        ctx.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8902)
    ap.add_argument("--phase", choices=["m1", "m2", "m3", "all"],
                    default="all")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    names = ["m1", "m2", "m3"] if args.phase == "all" else [args.phase]
    server = subprocess.Popen(
        ["node", "serve.ts", str(args.port)],
        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        with sync_playwright() as pw:
            for name in names:
                try:
                    run_phase(pw, f"http://localhost:{args.port}/", name)
                except Exception as exc:
                    check(f"phase {name} crashed", False, repr(exc))
                    if name == "m1":
                        break  # later phases need the m1 save
    finally:
        server.terminate()
        server.wait(timeout=10)

    check("zero console/page errors", len(ERRORS) == 0, f"{ERRORS[:3]}")
    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    if failed:
        print("FAILURES:")
        for name, _, detail in failed:
            print(f"  - {name}: {detail}")
        return 1
    print("PASS: full playtest clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
