"""Ship the painted park the Rivals page stands in, and measure its bands.

THE ART IS A FRAME, NOT A SCENE. The master is one picture with three parts:
a canopy of trees across the TOP, a flat cream field down the MIDDLE, and the
skyline, hedges, grass and the two dogs across the BOTTOM. The middle is a
single flat colour by construction — it is where the rivalry cards go — so the
picture can be drawn with its two painted bands pinned to the top and bottom of
the window and the flat field simply continuing between them, at any screen
height, with no crop and no letterbox. That is what components/rivals/
RivalsBackdrop.js does, and the numbers it needs are the ones measured here.

MEASURED, NOT DECLARED. The band edges are found by scanning for the first and
last row that is the field colour ALL the way across, rather than typed in from
a look at the file. A repaint that moves the treeline by forty pixels then
moves the numbers with it, and the only thing to do about it is paste the
`RIVALS_PARK` block this prints into src/config/onboardingArt.js. Typed-in
numbers would keep the old treeline and quietly slice the canopy.

ONE FILE, AND THE FIELD IS NOT IN IT. The pit stop is cut into two files
because the shop crew stands BETWEEN them; nothing stands inside this picture,
so the two bands ship STACKED in a single asset and the page draws them through
two clipping windows, one pinned to each edge. Dropping the 774 rows of flat
cream between them takes the file from 883KB to under 500 — those rows are a
colour, and the page paints it. It also keeps the whole backdrop to one slot
against the OTA asset budget, which is what currently blocks JS-only updates
(1252 referenced assets against a 1000 cap).

Usage (from frontend/):

    python scripts/install-rivals-backdrop.py [master.png]

Writes assets/art/rivals/park.png. Like the pit stop plates this file is sized
HERE and is therefore not listed in scripts/downscale-art.py — one owner per
asset, or a later regen silently re-resizes what this already sized.
"""

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets" / "art"
MASTER = ASSETS / "src" / "rivals-park.png"
OUT = ASSETS / "rivals"

# The master as delivered. Not fatal if it changes — everything below is
# measured or proportional — but a different delivery is usually a different
# composition, so it is worth saying out loud.
SRC_W, SRC_H = 941, 1672

# What it ships at: 430pt (the widest iPhone) x 3, the same FULLBLEED number
# scripts/downscale-art.py caps every other full-window backdrop to. The plate
# is only ever drawn at the window's WIDTH, so past 3x there is nothing left for
# a display to show and only pixels for the decoder to chew on.
SHIP_W = 1290

# Flat cartoon fills plus two soft sky gradients: a 256-colour palette holds
# that to within a rounding error and takes the file from ~1.3MB to under half
# of it. The dither is for the gradients, which are the only part that bands.
PALETTE = 256

# How far a row may drift from the field colour and still count as field. Wide
# enough for the paper texture over the cream, tight enough that the first
# hedge leaf stops the scan.
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
    # canopy band ends in cream and the skyline band starts in it.
    top_rows, bottom_rows = first, src.height - 1 - last
    stacked = Image.new("RGB", (src.width, top_rows + bottom_rows))
    stacked.paste(src.crop((0, 0, src.width, top_rows)), (0, 0))
    stacked.paste(src.crop((0, last + 1, src.width, src.height)), (0, top_rows))

    OUT.mkdir(parents=True, exist_ok=True)
    ship_h = round(stacked.height * SHIP_W / stacked.width)
    plate = stacked.resize((SHIP_W, ship_h), Image.Resampling.LANCZOS).quantize(
        colors=PALETTE, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG
    )
    path = OUT / "park.png"
    plate.save(path, optimize=True)

    print(f"wrote {path} {Image.open(path).size} {path.stat().st_size // 1024}KB")
    print(f"field {field}  flat rows {first}..{last} of {src.height}")
    print(f"bands: canopy {top_rows}px, park {bottom_rows}px")
    print("\npaste into src/config/onboardingArt.js:\n")
    # The sky the canopy hangs in, read off the master's very top edge. The
    # page fills the gap above the canopy with it whenever a tall header pushes
    # the treeline down, so a wrong value here shows up as a stripe.
    sky = src.crop((0, 0, src.width, 1)).resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))

    print("export const RIVALS_PARK = {")
    print(f"  ground: '#{field[0]:02X}{field[1]:02X}{field[2]:02X}',")
    print(f"  sky: '#{sky[0]:02X}{sky[1]:02X}{sky[2]:02X}',")
    print(f"  top: {top:.4f},")
    print(f"  bottom: {bottom:.4f},")
    print("};")


if __name__ == "__main__":
    main()
