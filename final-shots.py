#!/usr/bin/env python3
"""SOLMAR screenshot regeneration: retake the four dossier screenshots
from the current build using the deterministic ?shot= states in shots.js,
and write them as JPEGs into screenshots/.

  1-cover.jpg   ?shot=cover    driving south toward the beach and sea
  2-chase.jpg   ?shot=chase    same drive at 3 stars with cruisers
  3-mission.jpg ?shot=mission  on foot at the marina pier, package beacon
  4-city.jpg    ?shot=city     aerial view of downtown and Solmar Tower

Each shot is 1280x720 and at most 256 KiB (the gate's limits: long side
at most 1280, short side at least 480). Retakes land in shots-tmp/ first
as final-<name>.jpg; the operator inspects them and only then copies the
good ones over screenshots/ — a retake that fails or renders wrong never
replaces a good existing shot. Run with --apply to copy the inspected
retakes into screenshots/ after eyeballing them.

Usage:  python3 final-shots.py [--port 8903] [--apply]
"""

import argparse
import io
import shutil
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent
TMP = REPO / "shots-tmp"
SHOTS = REPO / "screenshots"
CHROMIUM_ARGS = [
    "--disable-frame-rate-limit",
    "--disable-dev-shm-usage",  # /dev/shm is small here; a full Chromium
    "--no-sandbox",              # renderer can OOM-crash the tab without it
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
]
MAX_BYTES = 262144  # 256 KiB, the gate's screenshot cap
TARGET = (1280, 720)

# (shot name, destination file) in dossier order; the first is the cover.
ORDER = [
    ("cover", "1-cover.jpg"),
    ("chase", "2-chase.jpg"),
    ("mission", "3-mission.jpg"),
    ("city", "4-city.jpg"),
]


def to_jpeg(png_bytes: bytes) -> bytes:
    """Resize to 1280x720 and encode as JPEG under the 256 KiB cap."""
    from PIL import Image

    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    img = img.resize(TARGET, Image.LANCZOS)
    for quality in (90, 85, 80, 72, 65, 58):
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality, optimize=True)
        if len(buf.getvalue()) <= MAX_BYTES:
            return buf.getvalue()
    # Still too big: shrink a step and try once more at quality 80.
    img = img.resize((1152, 648), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80, optimize=True)
    return buf.getvalue()


def take_shot(page, url, name):
    """Load one ?shot= state, wait for __shotReady, screenshot it."""
    page.goto(url, wait_until="load", timeout=60_000)
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if page.evaluate("!!window.__shotReady"):
            break
        page.wait_for_timeout(500)
    else:
        raise TimeoutError(f"__shotReady never flipped for {name}")
    for attempt in range(3):
        try:
            return page.screenshot(timeout=90_000)
        except Exception as exc:
            print(f"  screenshot attempt {attempt + 1} failed: {exc}")
            page.wait_for_timeout(2000)
    raise RuntimeError(f"screenshot failed 3 times for {name}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8903)
    ap.add_argument("--apply", action="store_true",
                    help="copy inspected retakes into screenshots/")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    TMP.mkdir(exist_ok=True)
    server = subprocess.Popen(
        ["node", "serve.ts", str(args.port)],
        cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    results = {}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(args=CHROMIUM_ARGS)
            for name, dest in ORDER:
                errors: list[str] = []
                ctx = browser.new_context(
                    viewport={"width": 1280, "height": 720})
                page = ctx.new_page()
                page.on("console", lambda m: errors.append(m.text)
                          if m.type == "error" else None)
                page.on("pageerror", lambda e: errors.append(str(e)))
                out = TMP / f"final-{name}.jpg"
                try:
                    png = take_shot(
                        page,
                        f"http://localhost:{args.port}/?shot={name}",
                        name)
                    jpeg = to_jpeg(png)
                    out.write_bytes(jpeg)
                    from PIL import Image
                    with Image.open(out) as im:
                        size = f"{im.width}x{im.height}"
                    results[name] = (len(jpeg), size, len(errors))
                    print(f"{name}: {out.name} {len(jpeg)} bytes, "
                          f"{size}, {len(errors)} console/page errors")
                    for e in errors[:3]:
                        print(f"  error: {e}")
                except Exception as exc:
                    results[name] = None
                    print(f"{name}: RETAKE FAILED ({exc}); "
                          f"keeping existing {dest}")
                finally:
                    ctx.close()
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)

    ok = True
    for name, dest in ORDER:
        retake = TMP / f"final-{name}.jpg"
        existing = SHOTS / dest
        if results.get(name) is None or not retake.exists():
            print(f"{dest}: KEPT existing "
                  f"({existing.stat().st_size if existing.exists() else 'missing'} bytes)")
            if not existing.exists():
                ok = False
            continue
        nbytes, size, nerr = results[name]
        if nbytes > MAX_BYTES:
            print(f"{dest}: retake {nbytes} bytes exceeds 256 KiB — KEPT existing")
            ok = False
            continue
        if nerr > 0:
            print(f"{dest}: retake loaded with {nerr} console/page errors "
                  f"— KEPT existing; investigate before applying")
            ok = False
            continue
        if args.apply:
            shutil.copyfile(retake, existing)
            print(f"{dest}: APPLIED retake ({nbytes} bytes, {size})")
        else:
            print(f"{dest}: retake ready in shots-tmp/ — inspect it, "
                  f"then re-run with --apply")
    if not args.apply:
        print("\nNo files in screenshots/ changed. Inspect the retakes in "
              "shots-tmp/ and re-run with --apply.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
