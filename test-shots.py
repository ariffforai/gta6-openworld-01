"""Playtest SOLMAR in headless Chromium: load each ?shot= state, collect console
errors and page errors, wait for __shotReady, and save a screenshot. Also
loads the plain menu page to check the title screen.

Usage: python3 test-shots.py [cover drive chase mission city] [--port 8080]
"""
import argparse, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

REPO = "/home/hatch/workspace/makefun/gta6-openworld-01"
OUT = os.path.join(REPO, "shots-tmp")
os.makedirs(OUT, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument("shots", nargs="*", default=["cover", "drive", "chase", "mission", "city"])
ap.add_argument("--port", type=int, default=8080)
args = ap.parse_args()
BASE = f"http://127.0.0.1:{args.port}"

server = subprocess.Popen(["node", "serve.ts", "--port", str(args.port)],
                          cwd=REPO, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
try:
    time.sleep(1.5)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url} {r.failure}"))
        for shot in args.shots:
            page.goto(f"{BASE}/?shot={shot}&seed=7", wait_until="load")
            try:
                page.wait_for_function("window.__shotReady === true", timeout=180000)
            except Exception as ex:
                errors.append(f"{shot}: __shotReady timeout: {ex}")
            time.sleep(0.4)
            page.screenshot(path=f"{OUT}/shot-{shot}.png")
            print(f"{shot}: done, errors so far: {len(errors)}", flush=True)
        # Also load the plain menu page (no shot param) to check the title screen.
        page.goto(f"{BASE}/", wait_until="load")
        time.sleep(2.0)
        page.screenshot(path=f"{OUT}/shot-menu.png")
        print("menu: done", flush=True)
        browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()

print("---- errors ----")
for e in errors:
    print(e)
print(f"total errors: {len(errors)}")
sys.exit(0 if not errors else 1)
