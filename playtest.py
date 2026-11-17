"""Scripted playtest of SOLMAR: open the menu, click START, take a job with T,
walk and drive with keys, and confirm no console/page errors and the HUD
updates. Saves a gameplay screenshot."""
import time
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    errors = []
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url}"))
    page.goto("http://127.0.0.1:8080/", wait_until="load")
    time.sleep(2)
    page.screenshot(path="/home/hatch/workspace/makefun/gta6-openworld-01/shots-tmp/playtest-menu.png")
    print("menu visible:", page.is_visible("#menu"))
    page.click("#btn-start")
    time.sleep(2)
    print("hud visible:", page.is_visible("#hud"))
    print("objective:", page.text_content("#objective"))
    page.keyboard.press("KeyT")
    time.sleep(1)
    print("after T, objective:", page.text_content("#objective"))
    print("toast:", page.text_content("#toast"))
    # Walk forward for 3 seconds.
    page.keyboard.down("KeyW")
    time.sleep(3)
    page.keyboard.up("KeyW")
    print("after walk, objective:", page.text_content("#objective"))
    page.screenshot(path="/home/hatch/workspace/makefun/gta6-openworld-01/shots-tmp/playtest-walk.png")
    # Pause and resume.
    page.keyboard.press("KeyP")
    time.sleep(0.5)
    print("paused overlay:", page.is_visible("#pause"))
    page.click("#btn-resume")
    time.sleep(0.5)
    print("resumed, pause hidden:", not page.is_visible("#pause"))
    time.sleep(2)
    page.screenshot(path="/home/hatch/workspace/makefun/gta6-openworld-01/shots-tmp/playtest-play.png")
    browser.close()

print("---- errors ----")
for e in errors:
    print(e)
print(f"total: {len(errors)}")
