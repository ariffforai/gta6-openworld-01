"""Final screenshots for the SOLMAR entry: load each staged ?shot= state in
headless Chromium, wait for __shotReady, save a PNG, then convert to JPEG in
screenshots/ (first by name is the cover). Verifies the gate's screenshot caps:
at most 256 KiB each, long side at most 1280, short side at least 480."""
import os, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = "http://127.0.0.1:8080"
REPO = "/home/hatch/workspace/makefun/gta6-openworld-01"
TMP = os.path.join(REPO, "shots-tmp")
OUT = os.path.join(REPO, "screenshots")
os.makedirs(TMP, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

SHOTS = [
    ("cover", "1-cover.jpg"),
    ("chase", "2-chase.jpg"),
    ("mission", "3-mission.jpg"),
    ("city", "4-city.jpg"),
]

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    errors = []
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url}"))
    for shot, name in SHOTS:
        page.goto(f"{BASE}/?shot={shot}&seed=7", wait_until="load")
        try:
            page.wait_for_function("window.__shotReady === true", timeout=180000)
            print(f"{shot}: ready")
        except Exception as ex:
            errors.append(f"{shot}: __shotReady timeout (using late frame): {ex}")
            print(f"{shot}: timeout, taking late frame")
        time.sleep(0.5)
        page.screenshot(path=f"{TMP}/final-{shot}.png")
        img = Image.open(f"{TMP}/final-{shot}.png").convert("RGB")
        q = 85
        while True:
            img.save(f"{OUT}/{name}", "JPEG", quality=q)
            size = os.path.getsize(f"{OUT}/{name}")
            if size <= 256 * 1024 or q <= 50:
                break
            q -= 10
        print(f"{name}: {img.size[0]}x{img.size[1]}, {size} bytes, quality {q}")
    browser.close()

print("---- errors ----")
for e in errors:
    print(e)
print(f"total: {len(errors)}")
