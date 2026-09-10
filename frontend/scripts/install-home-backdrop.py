"""Ship the painted street the Home feed stands on, and measure its bands.

SAME FRAME METHOD AS THE RIVALS PARK, DIFFERENT PICTURE. The master is one
painting with three parts: an open sky across the TOP, a flat cream field down
the MIDDLE, and the skyline and hedgerow across the BOTTOM. The middle is a
single flat colour by construction — it is where the hero card, the rail and
the feed go — so the picture can be drawn with its two painted bands pinned to
the top and bottom of the window and the field simply continuing between them,
at any screen height, with no crop and no letterbox. Home is a SCROLL, so this
matters more here than anywhere: the sky sits behind the header and the hedge
sits above the tab bar on every phone, and the feed scrolls through the field
between them.

MEASURED, NOT DECLARED. The band edges are found by scanning for the first and
last row that is the field colour all the way across, rather than typed in from
a look at the file. A repaint that moves the horizon then moves the numbers
with it, and the only thing to do about it is paste the `HOME_STREET` block
this prints into src/config/onboardingArt.js.

ONE FILE, AND THE FIELD IS NOT IN IT. The two bands ship STACKED in a single
asset and the page draws them through two clipping windows, one pinned to each
edge (components/home/HomeBackdrop.js). Dropping the flat cream rows between
them is most of the file, and it keeps the whole backdrop to one slot against
the OTA asset budget.

Usage (from frontend/):

    python scripts/install-home-backdrop.py [master.png]

Writes assets/art/home/backdrop.png. Like the rivals park and the pit stop
plates this file is sized HERE and is therefore not listed in
scripts/downscale-art.py — one owner per asset, or a later regen silently
re-resizes what this already sized.
"""

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets" / "art"
MASTER = ASSETS / "src" / "home-backdrop.png"
OUT = ASSETS / "home"

# The master as delivered. Not fatal if it changes — everything below is
# measured or proportional — but a different delivery is usually a different
# composition, so it is worth saying out loud.
SRC_W, SRC_H = 941, 1672

# What it ships at: 430pt (the widest iPhone) x 3, the same FULLBLEED number
# every other full-window backdrop is capped to. The plate is only ever drawn
# at the window's WIDTH, so past 3x there is nothing left for a display to show
# and only pixels for the decoder to chew on.
SHIP_W = 1290

# Flat cartoon fills plus one soft sky gradient: a 256-colour palette holds that
# to within a rounding error. The dither is for the gradient, which is the only
# part that bands.
PALETTE = 256

# How far a row may drift from the field colour and still count as field. Wide
# enough for the paper texture over the cream and for the last breath of the
# sky gradient, tight enough that the first hedge leaf stops the scan.
TOL = 12


def measure(im):
    """First and last row that is the field colour all the way across."""
    px = im.load()
    w, h = im.size
    field = px[w // 2, h // 2]
    rows = []
    for y in range(h):
        # Every third column: the bands reach the edges, so anything that is
        # not field is hit long before a two-pixel stem could slip between the
        # samples.
        if all(
            all(abs(px[x, y][i] - field[i]) <= TOL for i in range(3))
            for x in range(0, w, 3)
        ):
            rows.append(y)
    if not rows:
        raise SystemExit("no flat field found — is this the right master?")
    return field, rows[0], rows[-1]


def main():
    master = Path(sys.argv[1]) if len(sys.argv) > 1 else MASTER
    if not master.exists():
        raise SystemExit(f"no master at {master}")

    src = Image.open(master).convert("RGB")
    if src.size != (SRC_W, SRC_H):
        print(f"warning: expected {SRC_W}x{SRC_H}, got {src.width}x{src.height}")

    field, first, last = measure(src)
    # The bands are what is OUTSIDE the flat field, as fractions of the
    # master's WIDTH — the plate is always drawn at the window width, so
    # `height = width x fraction` is the whole of the page's sizing maths.
    top = first / src.width
    bottom = (src.height - 1 - last) / src.width

    # The two bands, stacked with the flat field taken out from between them.
    # The seam is invisible because both sides of it ARE the field colour: the
    # sky band ends in cream and the hedgerow band starts in it.
    top_rows, bottom_rows = first, src.height - 1 - last
    stacked = Image.new("RGB", (src.width, top_rows + bottom_rows))
    stacked.paste(src.crop((0, 0, src.width, top_rows)), (0, 0))
    stacked.paste(src.crop((0, last + 1, src.width, src.height)), (0, top_rows))

    OUT.mkdir(parents=True, exist_ok=True)
    ship_h = round(stacked.height * SHIP_W / stacked.width)
    plate = stacked.resize((SHIP_W, ship_h), Image.Resampling.LANCZOS).quantize(
        colors=PALETTE, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG
    )
    path = OUT / "backdrop.png"
    plate.save(path, optimize=True)

    # The colour the sky band OPENS on, for the strip above it: a window taller
    # than the picture pushes the sky band down off the top edge, and what it
    # leaves has to be the sky's own colour rather than the field's.
    sky = src.getpixel((src.width // 2, 0))

    print(f"wrote {path} {Image.open(path).size} {path.stat().st_size // 1024}KB")
    print(f"field {field}  flat rows {first}..{last} of {src.height}")
    print(f"bands: sky {top_rows}px, street {bottom_rows}px")
    print("\npaste into src/config/onboardingArt.js:\n")
    print("export const HOME_STREET = {")
    print(f"  ground: '#{field[0]:02X}{field[1]:02X}{field[2]:02X}',")
    print(f"  sky: '#{sky[0]:02X}{sky[1]:02X}{sky[2]:02X}',")
    print(f"  top: {top:.4f},")
    print(f"  bottom: {bottom:.4f},")
    print("};")


if __name__ == "__main__":
    main()
