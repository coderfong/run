"""Downscale UI art to the resolution it is actually drawn at.

WHY. The art was exported at generation resolution (512px stickers, 1024px
border rings, 1254px illustrations) and shipped that way, while the app draws
most of it at 20-60pt. Two things follow on device:

  * DECODE COST scales with source pixels, not with the view. A 1254x1254
    illustration costs ~8x the work of the 444px it is drawn at.
  * React Native's iOS image cache refuses to keep any image over 2 MB decoded
    (1024x1024 RGBA = 4 MB) and holds only 20 MB in total, so the oversized
    families evicted each other and every screen re-decoded its art from disk
    on every visit.

Rendering moved to expo-image (src/ui/image.js), which caches sanely, but the
decode itself is still real work — so the sources are brought down to 3x their
largest on-screen size, which is the most any display can show.

RULES
  * Aspect ratio is preserved exactly. CharacterRig, SceneBackdrop and the pit
    stop cloud band all derive layout from `Image.resolveAssetSource`'s
    width/height ratio, so changing it would move art on screen.
  * Never upscales. Re-running after a partial run is a no-op, which is what
    makes this safe to run again after new art lands.
  * assets/character/** is NOT touched. Those are already authored at roughly
    their rig size (the largest is 552x560) and the rig's layout maths was
    measured against them.
  * assets/art/panel/** is NOT touched either — `cut-header-art.py` generates
    those and caps them itself. Two owners for one file is how a regen quietly
    undoes a resize.

Targets are 3 x the largest render found in the code, listed per family below.
Run from frontend/:  python scripts/downscale-art.py [--dry-run]
"""

import argparse
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# (glob, max side in px, why that number)
#
# ORDER MATTERS: the first pattern to match a file wins, so the full-bleed
# exceptions are listed above the family globs they sit inside. FULLBLEED is
# 430pt (the widest iPhone) x 3 — art that spans the window gets no less.
FULLBLEED = 1290

TARGETS = [
    ("icons/*.png", 192, "AppIcon draws at 14-64pt; 64 x 3 = 192"),
    ("borders/*.png", 640, "PortraitBorder lays the ring out at up to 213pt before its scale transform"),

    # Full-screen onboarding slides and the welcome hero. Several of these are
    # already under FULLBLEED and so are no-ops — they are listed anyway so a
    # future export at generation size gets trimmed to the right number rather
    # than falling through to the 640 card rule and turning to mush.
    ("art/claim-explainer.png", FULLBLEED, "onboarding slide, absoluteFill at window width"),
    ("art/onboarding-clans.png", FULLBLEED, "onboarding slide, absoluteFill at window width"),
    ("art/onboarding-safety.png", FULLBLEED, "onboarding slide, absoluteFill at window width"),
    ("art/auth-hero.png", FULLBLEED, "welcome hero, 100% of the screen"),
    ("art/hero-welcome.png", FULLBLEED, "unreferenced today; sized as a hero"),
    ("art/onboarding-loop.png", FULLBLEED, "unreferenced today; sized as a hero"),
    ("art/*.png", 640, "HeroCard art is 190pt tall, EmptyState art 148pt square"),

    ("art/season/*.png", 1024, "full-bleed board header, cropped from a square"),

    # The cap is on the LONGEST side, and stage.png is portrait (1170x1400) —
    # capping it at FULLBLEED would trim its height to 1290 and take its WIDTH
    # down to 1078, under the 1290 the full-window backdrop needs. It is left
    # at source size; expo-image decodes it to the view's size anyway.
    ("art/onboarding/stage.png", 1400, "portrait backdrop — already at width; do not trim"),
    ("art/onboarding/thumb-*.png", 400, "StepThumb defaults to 132pt"),
    ("art/onboarding/*.png", FULLBLEED, "full-width onboarding panel"),

    # art/ui/pro-banner.png is deliberately absent: `install-pro-art.py`
    # generates it at its card size, same one-owner rule as art/panel/**.
    ("art/ui/header-pasers.png", 1024, "full-bleed page header, cropped from a square"),
    ("art/ui/header-rivals.png", 1024, "full-bleed page header, cropped from a square"),
    ("art/ui/header-crossroads.png", 1024, "full-bleed page header, cropped from a square"),

    # The CROSSED PATHS stage, drawn `cover` at the whole window — a portrait
    # backdrop, so FULLBLEED caps its HEIGHT and the width follows.
    ("art/paserby/plaza.png", FULLBLEED, "PlazaScene backdrop, absoluteFill at window size"),
    ("art/ui/burst-rays.png", 512, "reward burst behind a 156pt badge"),
    ("art/ui/pass-banner.png", FULLBLEED, "full window width"),
    ("art/ui/profile-banner.png", FULLBLEED, "full window width"),
    ("art/ui/profile-banner-dark.png", FULLBLEED, "full window width"),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    seen: set[pathlib.Path] = set()
    saved = 0
    changed = 0

    for pattern, max_side, why in TARGETS:
        for path in sorted(ASSETS.glob(pattern)):
            # An earlier, tighter pattern wins — thumb-*.png before *.png.
            if path in seen:
                continue
            seen.add(path)

            with Image.open(path) as im:
                w, h = im.size
                if max(w, h) <= max_side:
                    continue
                scale = max_side / max(w, h)
                # round() rather than int(): floor drifts the ratio on the
                # short side, and the rig reads that ratio back.
                size = (max(1, round(w * scale)), max(1, round(h * scale)))
                out = im.convert("RGBA").resize(size, Image.LANCZOS)

            before = path.stat().st_size
            print(f"{path.relative_to(ROOT)}  {w}x{h} -> {size[0]}x{size[1]}   ({why})")
            if not args.dry_run:
                out.save(path, optimize=True)
                saved += before - path.stat().st_size
            changed += 1

    print(f"\n{changed} file(s)" + ("" if args.dry_run else f", {saved / 1e6:.1f} MB saved"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
