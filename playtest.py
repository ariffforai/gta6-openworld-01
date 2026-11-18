#!/usr/bin/env python3
"""SOLMAR full playtest — 23 checks in three short browser phases.

Phase 1: boot + The Pickup (Mission 1) + save/load round-trip.
Phase 2: Hot Wheels (Mission 2) — real E-key steal + road-grid drive.
Phase 3: The Exchange (Mission 3) + wanted level, BUSTED, WASTED, retries.

The three phases share one persistent Chromium profile; the game's own save
(localStorage key solmar-save-v1) carries state between phases, so each phase
opens a fresh browser (a single long headless session OOM-crashes the
SwiftShader renderer after ~10-14 minutes). On-foot mission steps are reached
by placing the player at the mission marker; the car steal uses a real E
keypress and the chop-shop delivery is a real keyboard drive along the road
grid. Headless SwiftShader runs ~0.5-3.5 fps, so every wait polls game state,
never wall clocks.

Usage: python3 playtest.py [--phase 1|2|3|all] [--port 8901]
Requires the game served on localhost (node serve.ts, default port 8901).
Phase 1 wipes the profile for a fresh start; phases 2/3 reuse it.
"""
import argparse
import json
import math
import os
import shutil
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
PROFILE = os.path.join(ROOT, "shots-tmp", "playtest-profile")
CHROME_ARGS = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-frame-rate-limit",
]

# Mission markers (from the game's own design): Rico (20,26), marina package
# (234,182), Dee (-26,-26), chop shop (-182,182), Sal (78,-130), north-docks
# briefcase (130,-182), exchange (234,78).
RICO = (20, 26)
PACKAGE = (234, 182)
DEE = (-26, -26)
CHOP_SHOP = (-182, 182)
SAL = (78, -130)
BRIEFCASE = (130, -182)
EXCHANGE = (234, 78)


class Phase:
    """One short browser phase: fresh browser, shared profile, error capture."""

    def __init__(self, pw, base_url, name):
        self.name = name
        self.console_errors = []
        self.page_errors = []
        self.ctx = pw.chromium.launch_persistent_context(
            PROFILE,
            headless=True,
            args=CHROME_ARGS,
            viewport={"width": 960, "height": 540},
        )
        self.pg = self.ctx.new_page()
        self.pg.on("console", lambda m: self.console_errors.append(m.text)
                   if m.type == "error" else None)
        self.pg.on("pageerror", lambda e: self.page_errors.append(str(e)))
        self.pg.goto(base_url)
        self.pg.wait_for_function("window.__solmar !== undefined", timeout=60000)

    def close(self):
        self.ctx.close()

    def start_game(self):
        self.pg.click("#start-button")
        self.pg.wait_for_function(
            "window.__solmar.world.state === 'playing'",
            polling=500, timeout=60000)

    def ev(self, expr):
        return self.pg.evaluate(expr)

    def wait(self, expr, timeout=120000, label=""):
        self.pg.wait_for_function(expr, polling=500, timeout=timeout)

    def snap(self):
        return self.pg.evaluate("""() => {
            const s = window.__solmar;
            return {
                state: s.world.state,
                money: s.world.money,
                wanted: s.world.wanted,
                level: s.wanted.level,
                heat: s.wanted.heat,
                cruisers: s.wanted.cruisers.length,
                health: s.player.health,
                onFoot: s.player.onFoot,
                pos: {x: s.player.pos.x, z: s.player.pos.z},
                jobIndex: s.missions.jobIndex,
                stepIndex: s.missions.stepIndex,
                done: {pickup: s.missions.done.pickup,
                       wheels: s.missions.done.wheels,
                       exchange: s.missions.done.exchange},
                cars: s.vehicles.cars.length,
                parked: s.vehicles.cars.filter(c => c.isParked).length,
                traffic: s.vehicles.cars.filter(c => c.isTraffic).length,
                peds: s.pedestrians.list.length,
                colliders: s.city.colliders.length,
                driven: !!s.vehicles.driven,
            };
        }""")

    def teleport(self, x, z):
        self.pg.evaluate(
            f"window.__solmar.player.pos.set({x}, 0, {z})")


class Results:
    def __init__(self):
        self.checks = []

    def check(self, name, ok, detail=""):
        self.checks.append((name, bool(ok)))
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""),
              flush=True)
        return ok

    def summary(self):
        n = sum(1 for _, ok in self.checks if ok)
        print(f"\nPLAYTEST: {n}/{len(self.checks)} checks passed", flush=True)
        return n == len(self.checks)


def drive_route(pg, waypoints, timeout=900):
    """Drive the driven car through waypoints with real keyboard input.

    Steers with A/D, W for throttle, S to reverse out of a wedge. Waypoints
    are road-grid points; the final one has a tight acceptance radius so the
    delivery marker is reached. Returns True on arrival at the last waypoint.
    """
    down = set()

    def set_key(key, held):
        if held and key not in down:
            pg.keyboard.down(key)
            down.add(key)
        elif not held and key in down:
            pg.keyboard.up(key)
            down.discard(key)

    def release_all():
        for k in list(down):
            set_key(k, False)

    start = time.time()
    last_progress = start
    last_pos = None
    last_log = 0.0
    reversing_until = 0.0
    reverse_turn = "KeyA"
    wp = 0
    try:
        while time.time() - start < timeout:
            st = pg.evaluate("""() => {
                const s = window.__solmar;
                if (!s.vehicles.driven) return null;
                const c = s.vehicles.driven;
                return {x: c.group.position.x, z: c.group.position.z,
                        yaw: c.yaw, speed: c.speed,
                        wheels: s.missions.done.wheels};
            }""")
            if st is None:
                print("    drive: no driven car", flush=True)
                return False
            if st["wheels"]:
                print("    drive: chop-shop delivery registered", flush=True)
                release_all()
                return True
            tx, tz = waypoints[wp]
            dx, dz = tx - st["x"], tz - st["z"]
            dist = math.hypot(dx, dz)
            last = wp == len(waypoints) - 1
            accept = 4 if last else 7
            if dist < accept:
                if last:
                    release_all()
                    return True
                wp += 1
                continue
            now = time.time()
            if last_pos is not None:
                if math.hypot(st["x"] - last_pos[0],
                              st["z"] - last_pos[1]) > 0.5:
                    last_progress = now
            last_pos = (st["x"], st["z"])
            if now - last_log > 20:
                print(f"    drive: wp {wp + 1}/{len(waypoints)} "
                      f"({tx},{tz}) dist {dist:.1f} speed {st['speed']:.1f} "
                      f"yaw {st['yaw']:.2f} pos "
                      f"({st['x']:.1f},{st['z']:.1f})", flush=True)
                last_log = now
            if now < reversing_until:
                # Back out at an angle so the car swings off the wall
                # instead of reversing straight back into the same wedge.
                set_key("KeyW", False)
                set_key("KeyA", reverse_turn == "KeyA")
                set_key("KeyD", reverse_turn == "KeyD")
                set_key("KeyS", True)
                pg.wait_for_timeout(1000)
                continue
            if now - last_progress > 20:
                print("    drive: stalled — reversing out at an angle",
                      flush=True)
                reversing_until = now + 4
                reverse_turn = ("KeyD" if reverse_turn == "KeyA"
                                else "KeyA")
                last_progress = now
                continue
            desired = math.atan2(dx, dz)
            err = (desired - st["yaw"] + math.pi) % (2 * math.pi) - math.pi
            set_key("KeyS", False)
            # Speed cap by distance: crawl into corners so the turn arc
            # stays tight and the car never leaves the road. A fast car
            # swings wide off the road and wedges against the buildings.
            if dist < 12:
                cap = 4
            elif dist < 30:
                cap = 6
            elif dist < 60 and not last:
                cap = 10
            else:
                cap = 26
            if abs(err) > 0.5:
                # Still turning onto the new leg: stay slow until aligned,
                # or the arc carries the car off the road.
                cap = min(cap, 5)
            if abs(err) > 0.3:
                set_key("KeyW", abs(st["speed"]) < cap)
                set_key("KeyA", err > 0)
                set_key("KeyD", err < 0)
            else:
                set_key("KeyW", abs(st["speed"]) < cap)
                set_key("KeyA", False)
                set_key("KeyD", False)
            pg.wait_for_timeout(1000)
        print("    drive: timed out", flush=True)
        return False
    finally:
        release_all()


def phase1(pw, base_url, res):
    print("\n== Phase 1: boot + The Pickup + save/load ==", flush=True)
    ph = Phase(pw, base_url, "phase1")
    try:
        ph.start_game()
        s = ph.snap()
        res.check("boot: 23 cars (14 traffic + 9 parked)", s["cars"] == 23
                  and s["traffic"] == 14 and s["parked"] == 9,
                  f"cars={s['cars']} traffic={s['traffic']} "
                  f"parked={s['parked']}")
        res.check("boot: 26 pedestrians", s["peds"] == 26,
                  f"peds={s['peds']}")
        res.check("boot: 163 colliders", s["colliders"] == 163,
                  f"colliders={s['colliders']}")
        res.check("boot: state reaches 'playing'", s["state"] == "playing",
                  f"state={s['state']}")
        res.check("boot: starts with $250", s["money"] == 250,
                  f"money=${s['money']}")

        # Real on-foot movement: hold W and confirm the player moves.
        before = ph.snap()["pos"]
        ph.pg.keyboard.down("KeyW")
        ph.pg.wait_for_timeout(10000)
        ph.pg.keyboard.up("KeyW")
        after = ph.snap()["pos"]
        moved = math.hypot(after["x"] - before["x"],
                           after["z"] - before["z"])
        res.check("walk: holding W moves the player on foot", moved > 0.5,
                  f"moved {moved:.1f} units")

        # Mission 1: meet Rico, fetch the marina package, return to Rico.
        ph.teleport(*RICO)
        ph.wait("window.__solmar.missions.stepIndex === 1", label="meet Rico")
        ph.teleport(*PACKAGE)
        ph.wait("window.__solmar.missions.stepIndex === 2",
                label="collect package")
        ph.teleport(*RICO)
        ph.wait("window.__solmar.missions.done.pickup === true",
                label="deliver to Rico")
        s = ph.snap()
        res.check("mission 1: The Pickup end-to-end ($250 -> $750)",
                  s["money"] == 750 and s["done"]["pickup"]
                  and s["jobIndex"] == 1,
                  f"money=${s['money']} jobIndex={s['jobIndex']}")

        # Save/load round-trip: the save is written on mission completion;
        # reload the page and the save must restore money + job state.
        saved = json.loads(ph.ev("localStorage.getItem('solmar-save-v1')"))
        assert saved["money"] == 750 and saved["done"]["pickup"] is True, (
            f"save not written on mission completion: {saved}")
        ph.pg.reload()
        ph.pg.wait_for_function("window.__solmar !== undefined",
                                timeout=60000)
        ph.start_game()
        s = ph.snap()
        res.check("save/load: reload restores $750 + Hot Wheels available",
                  s["money"] == 750 and s["done"]["pickup"]
                  and s["jobIndex"] == 1,
                  f"money=${s['money']} jobIndex={s['jobIndex']}")
    finally:
        res.check("phase 1: zero console errors",
                  not ph.console_errors, "; ".join(ph.console_errors[:3]))
        res.check("phase 1: zero page errors",
                  not ph.page_errors, "; ".join(ph.page_errors[:3]))
        ph.close()


def phase2(pw, base_url, res):
    print("\n== Phase 2: Hot Wheels ==", flush=True)
    ph = Phase(pw, base_url, "phase2")
    try:
        ph.start_game()
        s = ph.snap()
        assert s["money"] == 750 and s["jobIndex"] == 1, (
            f"phase 2 entry state wrong: money=${s['money']} "
            f"jobIndex={s['jobIndex']}")

        # Meet Dee: the steal step activates and picks the marked parked car.
        ph.teleport(*DEE)
        ph.wait("window.__solmar.missions.stepIndex === 1", label="meet Dee")
        target = ph.ev("""() => {
            const t = window.__solmar.missions.targetCar;
            return t ? {x: t.group.position.x, z: t.group.position.z} : null;
        }""")
        parked = ph.ev("""() => window.__solmar.vehicles.cars
            .filter(c => c.isParked)
            .map(c => ({x: c.group.position.x, z: c.group.position.z}))""")
        nearest = min(parked, key=lambda c: math.hypot(
            c["x"] - DEE[0], c["z"] - DEE[1])) if parked else None
        res.check("mission 2: meet Dee picks the nearest parked car",
                  target is not None and nearest is not None
                  and abs(target["x"] - nearest["x"]) < 0.1
                  and abs(target["z"] - nearest["z"]) < 0.1,
                  f"target={target} nearest={nearest}")

        # Real E-key steal: stand by the marked car and press E.
        ph.teleport(target["x"] + 2, target["z"])
        ph.pg.wait_for_timeout(3000)
        ph.pg.keyboard.press("KeyE")
        ph.pg.wait_for_timeout(3000)
        s = ph.snap()
        res.check("mission 2: real E-key steal of the marked car",
                  s["driven"] and not s["onFoot"] and s["stepIndex"] == 2,
                  f"driven={s['driven']} onFoot={s['onFoot']} "
                  f"stepIndex={s['stepIndex']}")

        # Real keyboard drive along the road grid to the chop shop:
        # north on road x=26 to z=182, then west to (-182,182).
        arrived = drive_route(ph.pg, [(26, 182), CHOP_SHOP], timeout=900)
        if arrived:
            ph.wait("window.__solmar.missions.done.wheels === true",
                    timeout=120000, label="chop-shop delivery")
        s = ph.snap()
        saved = json.loads(ph.ev("localStorage.getItem('solmar-save-v1')"))
        res.check("mission 2: Hot Wheels delivered ($750 -> $1,650)",
                  s["money"] == 1650 and s["done"]["wheels"]
                  and s["jobIndex"] == 2 and saved["money"] == 1650,
                  f"money=${s['money']} jobIndex={s['jobIndex']} "
                  f"saved=${saved['money']}")
    finally:
        res.check("phase 2: zero console errors",
                  not ph.console_errors, "; ".join(ph.console_errors[:3]))
        res.check("phase 2: zero page errors",
                  not ph.page_errors, "; ".join(ph.page_errors[:3]))
        ph.close()


def phase3(pw, base_url, res):
    print("\n== Phase 3: The Exchange + wanted / BUSTED / WASTED ==",
          flush=True)
    ph = Phase(pw, base_url, "phase3")
    try:
        ph.start_game()
        s = ph.snap()
        assert s["money"] == 1650 and s["jobIndex"] == 2, (
            f"phase 3 entry state wrong: money=${s['money']} "
            f"jobIndex={s['jobIndex']}")

        # Mission 3: meet Sal, grab the briefcase at the north docks.
        ph.teleport(*SAL)
        ph.wait("window.__solmar.missions.stepIndex === 1", label="meet Sal")
        ph.teleport(*BRIEFCASE)
        ph.wait("window.__solmar.missions.stepIndex === 2",
                label="grab briefcase")
        s = ph.snap()
        res.check("mission 3: briefcase grab raises wanted to 1 star",
                  s["level"] == 1 and s["heat"] >= 20,
                  f"level={s['level']} heat={s['heat']}")
        ph.teleport(*EXCHANGE)
        ph.wait("window.__solmar.missions.done.exchange === true",
                label="deliver to exchange")
        s = ph.snap()
        res.check("mission 3: The Exchange end-to-end ($1,650 -> $3,150)",
                  s["money"] == 3150 and s["done"]["pickup"]
                  and s["done"]["wheels"] and s["done"]["exchange"],
                  f"money=${s['money']} done={s['done']}")

        # Wanted: push heat to level 4 and wait for the cruisers.
        ph.ev("window.__solmar.wanted.addHeat(60)")
        ph.wait("window.__solmar.wanted.level === 4", timeout=60000,
                label="wanted level 4")
        ph.wait("window.__solmar.wanted.cruisers.length >= 4",
                timeout=240000, label="4 cruisers")
        s = ph.snap()
        res.check("wanted: level 4 with cruisers responding",
                  s["level"] == 4 and s["cruisers"] >= 4,
                  f"level={s['level']} cruisers={s['cruisers']}")

        # BUSTED: stand still and let a cruiser pin the player.
        ph.ev("window.__solmar.player.health = 100")
        ph.wait("window.__solmar.world.state === 'busted'",
                timeout=600000, label="busted")
        s = ph.snap()
        res.check("busted: pinned at 3+ stars shows BUSTED",
                  s["state"] == "busted", f"state={s['state']}")
        ph.pg.click("#retry-busted-button")
        ph.wait("window.__solmar.world.state === 'playing'",
                timeout=60000, label="retry after busted")
        s = ph.snap()
        res.check("retry: wanted resets to 0 after BUSTED",
                  s["state"] == "playing" and s["level"] == 0
                  and s["wanted"] == 0,
                  f"state={s['state']} level={s['level']}")

        # WASTED: drop health to 0, then retry back into the game.
        ph.ev("window.__solmar.player.health = 0")
        ph.wait("window.__solmar.world.state === 'wasted'",
                timeout=120000, label="wasted")
        s = ph.snap()
        wasted_ok = s["state"] == "wasted"
        ph.pg.click("#retry-button")
        ph.wait("window.__solmar.world.state === 'playing'",
                timeout=60000, label="retry after wasted")
        s = ph.snap()
        res.check("wasted: 0 health shows WASTED, retry returns to play",
                  wasted_ok and s["state"] == "playing"
                  and s["level"] == 0,
                  f"state={s['state']} level={s['level']}")
    finally:
        res.check("phase 3: zero console errors",
                  not ph.console_errors, "; ".join(ph.console_errors[:3]))
        res.check("phase 3: zero page errors",
                  not ph.page_errors, "; ".join(ph.page_errors[:3]))
        ph.close()


def main():
    ap = argparse.ArgumentParser(description="SOLMAR full playtest (23 checks)")
    ap.add_argument("--phase", choices=["1", "2", "3", "all"], default="all")
    ap.add_argument("--port", type=int, default=8901)
    args = ap.parse_args()
    base_url = f"http://localhost:{args.port}/index.html"

    if args.phase in ("1", "all"):
        shutil.rmtree(PROFILE, ignore_errors=True)
    res = Results()
    with sync_playwright() as pw:
        if args.phase in ("1", "all"):
            phase1(pw, base_url, res)
        if args.phase in ("2", "all"):
            phase2(pw, base_url, res)
        if args.phase in ("3", "all"):
            phase3(pw, base_url, res)
    ok = res.summary()
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
