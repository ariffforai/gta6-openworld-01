#!/usr/bin/env python3
"""SOLMAR boot check: load the game in headless Chromium, start it, and
report any console or page errors. Serves game/ with serve.ts itself, so
this also proves the dev server works.

Usage:  python3 test-shots.py [--port 8901] [--url http://localhost:8901/]

Exits 0 only when the game reaches the 'playing' state with zero console
errors and zero page errors. Headless SwiftShader runs at ~0.5-3.5 fps,
so waits poll on game state, never on wall clocks.
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent
CHROMIUM_ARGS = [
    "--disable-frame-rate-limit",
    "--disable-dev-shm-usage",  # /dev/shm is small here; a full Chromium
    "--no-sandbox",              # renderer can OOM-crash the tab without it
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
]

POLL_MS = 500
BOOT_TIMEOUT_S = 90


def wait_for(fn, timeout_s, what, page):
    """Poll fn(page) until truthy; raise on timeout with the last state."""
    deadline = time.monotonic() + timeout_s
    last = None
    while time.monotonic() < deadline:
        try:
            last = fn(page)
        except Exception as exc:  # page may still be loading
            last = f"error: {exc}"
        if last:
            return last
        page.wait_for_timeout(POLL_MS)
    raise TimeoutError(f"timed out waiting for {what}; last: {last!r}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8901)
    ap.add_argument("--url", default=None)
    ap.add_argument("--shot", default=None,
                    help="optional ?shot= state to boot into (cover/chase/mission/city)")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    url = args.url or f"http://localhost:{args.port}/"
    if args.shot:
        url += f"?shot={args.shot}"

    server = subprocess.Popen(
        ["node", "serve.ts", str(args.port)],
        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    errors: list[str] = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=CHROMIUM_ARGS)
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            warnings: list[str] = []

            def on_console(msg):
                if msg.type == "error":
                    errors.append(f"console.error: {msg.text}")
                elif msg.type == "warning":
                    warnings.append(f"console.warning: {msg.text}")

            page.on("console", on_console)
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.goto(url, wait_until="load", timeout=60_000)

            wait_for(
                lambda p: p.evaluate("!!window.__solmar"),
                BOOT_TIMEOUT_S, "__solmar handle", page)
            info = page.evaluate("""() => {
                const s = window.__solmar;
                return {
                    cars: s.vehicles.cars.length,
                    peds: s.pedestrians.list.length,
                    colliders: s.city.colliders.length,
                    state: s.world.state,
                    webgl: !!s.renderer.getContext(),
                };
            }""")
            print(f"boot: {info}")

            page.click("#start-button")
            state = wait_for(
                lambda p: p.evaluate("window.__solmar.world.state") == "playing",
                BOOT_TIMEOUT_S, "state 'playing'", page)
            print("state: playing")

            if args.shot:
                ready = wait_for(
                    lambda p: p.evaluate("!!window.__shotReady"),
                    BOOT_TIMEOUT_S, "__shotReady", page)
                print(f"shot {args.shot}: ready")

            money = page.evaluate("window.__solmar.world.money")
            print(f"money: {money}")
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)

    print(f"console errors: {len(errors)}, warnings: {len(warnings)}")
    for e in errors:
        print(f"  {e}")
    for w in warnings[:5]:
        print(f"  {w}")
    if errors:
        print("FAIL: errors seen during boot")
        return 1
    print("PASS: boot clean, game playing, zero errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
