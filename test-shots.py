"""Playtest SOLMAR in headless Chromium: load each ?shot= state, collect console
errors and page errors, wait for __shotReady, and save a screenshot."""
import sys, time, os
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8080"
OUT = "/home/hatch/workspace/makefun/gta6-openworld-01/shots-tmp"
os.makedirs(OUT, exist_ok=True)
SHOTS = sys.argv[1:] or ["cover", "drive", "chase", "mission", "city"]

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    errors = []
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url} {r.failure}"))
    for shot in SHOTS:
        page.goto(f"{BASE}/?shot={shot}&seed=7", wait_until="load")
        try:
            page.wait_for_function("window.__shotReady === true", timeout=120000)
        except Exception as ex:
            errors.append(f"{shot}: __shotReady timeout: {ex}")
        time.sleep(0.4)
        page.screenshot(path=f"{OUT}/shot-{shot}.png")
        print(f"{shot}: done, errors so far: {len(errors)}")
    # Also load the plain menu page (no shot param) to check the title screen.
    page.goto(f"{BASE}/", wait_until="load")
    time.sleep(2.0)
    page.screenshot(path=f"{OUT}/shot-menu.png")
    print("menu: done")
    browser.close()

print("---- errors ----")
for e in errors:
    print(e)
print(f"total errors: {len(errors)}")
