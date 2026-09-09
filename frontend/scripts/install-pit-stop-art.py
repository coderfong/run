"""Cut the painted Water Point plates from the delivered master.

The shop scene used to draw its own environment as vector art. It is painted
now — one illustration of the whole stall — and this pass turns that single
file into the two plates the scene actually needs.

TWO PLATES, BECAUSE THE SCENE HAS TWO DEPTHS. The crew stands between them:

  * `pitstop-backdrop.png` — everything BEHIND the volunteers: sky, sun,
    bunting, trees, the canopy, the back wall, both shelves, and the counter's
    top surface. Opaque, full scene.
  * `pitstop-counter.png` — the counter from its BACK EDGE down, on a
    transparent canvas. Drawn after the crew, so it cuts them off at the hip
    the way a real counter would.

The counter band is not re-cropped out of the source separately: both plates
come from ONE resize of the same crop, and the front plate is simply rows
`CUT_Y` and below of it. Resizing twice would land the two on subtly different
pixel grids and leave a hairline seam across the counter's top edge at some
widths — the plates overlap exactly because they are literally the same
pixels.

THE CUT SITS TWO SOURCE ROWS ABOVE THE INK. The counter's top outline starts
at row 730; cutting at 728 means the front plate carries the whole outline and
the crew is hidden from just above it. Cutting ON the line would leave a
1px window of body showing through the stroke's anti-aliasing.

The bottom of the source is ~760px of empty sand — the stall stops at row 906.
`CROP_H` keeps a few rows past the counter's lower outline and drops the rest,
which is what takes the scene from a 0.56 portrait to a ~1.03 hero.

Usage (from frontend/):

    python scripts/install-pit-stop-art.py [master.png]

Writes assets/art/shop/pitstop-backdrop.png and pitstop-counter.png. Keep the
numbers here in step with `SCENE` in src/config/pitStop.js — they describe the
same picture, and the layout frames there are measured off this crop.
"""

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets" / "art"
MASTER = ASSETS / "src" / "pitstop-water-point.png"
OUT = ASSETS / "shop"

# The master as delivered.
SRC_W, SRC_H = 941, 1672

# What we keep of it: full width, top of the sky down to a few rows past the
# counter's bottom outline (row 906).
CROP_H = 913

# Where the front plate starts, in SOURCE rows. Two above the counter's top
# outline at row 730.
CUT_Y = 728

# The scene's reference width. Every frame in config/pitStop.js is authored
# against this, and the plates are cut on this grid so the two register
# exactly — but they SHIP smaller (see below). The scene scales whatever it is
# given to the container, so the file's pixel size is a decode-cost decision,
# not a layout one.
SCENE_W = 1536

# What the plates ship at: 430pt (the widest iPhone) x 3, the same FULLBLEED
# number scripts/downscale-art.py caps every other full-window backdrop to.
# Past 3x there is no more detail any display can show, only pixels to decode
# on the shop tab.
#
# These two files are therefore NOT listed in downscale-art.py's targets — the
# same one-owner rule that keeps `art/ui/pro-banner.png` and `art/panel/**` out
# of it. A second pass resizing what this already sized is how a regen quietly
# undoes a resize.
SHIP_W = 1290

# The backdrop is flat cartoon fills plus one sky gradient, which a 256-colour
# palette holds to within a rounding error — and takes it from 1.3 MB to under
# 400 KB. The gradient is the only part that needs the dither.
PALETTE = 256


def main():
    master = Path(sys.argv[1]) if len(sys.argv) > 1 else MASTER
    if not master.exists():
        raise SystemExit(f"no master at {master}")

    src = Image.open(master).convert("RGBA")
    if src.size != (SRC_W, SRC_H):
        # Not fatal — the crop is proportional — but a different delivery is
        # almost always a different composition, and the frames in
        # config/pitStop.js are measured in the numbers above.
        print(f"warning: expected {SRC_W}x{SRC_H}, got {src.width}x{src.height}")

    scale = SCENE_W / src.width
    crop_h = round(CROP_H * src.height / SRC_H)
    scene_h = round(crop_h * scale)
    cut = round(CUT_Y * src.height / SRC_H * scale)

    scene = src.crop((0, 0, src.width, crop_h)).resize(
        (SCENE_W, scene_h), Image.Resampling.LANCZOS
    )

    OUT.mkdir(parents=True, exist_ok=True)
    ship_h = round(scene_h * SHIP_W / SCENE_W)
    ship = lambda im: im.resize((SHIP_W, ship_h), Image.Resampling.LANCZOS)

    # The backdrop is opaque by construction — nothing in the scene shows
    # through it — so it ships as RGB. An alpha channel here would be a
    # megabyte of 255s and one more thing for the decoder to blend.
    backdrop = ship(scene.convert("RGB")).quantize(
        colors=PALETTE, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG
    )
    backdrop.save(OUT / "pitstop-backdrop.png", optimize=True)

    # The front plate keeps its transparent top: the scene pins it to the full
    # scene box, so the empty rows above the cut are what hold it in register.
    # It stays true-colour — it is mostly transparent, so it compresses to less
    # than the backdrop's palette anyway, and quantising RGBA is the one thing
    # that would harden its anti-aliased top edge into a jagged line.
    counter = Image.new("RGBA", (SCENE_W, scene_h), (0, 0, 0, 0))
    counter.paste(scene.crop((0, cut, SCENE_W, scene_h)), (0, cut))
    ship(counter).save(OUT / "pitstop-counter.png", optimize=True)

    for name in ("pitstop-backdrop.png", "pitstop-counter.png"):
        path = OUT / name
        print(f"wrote {path} {Image.open(path).size} {path.stat().st_size // 1024}KB")
    print(f"scene box {SCENE_W}x{scene_h}  counter cut at y={cut}")


if __name__ == "__main__":
    main()
