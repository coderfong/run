"""Strip the leftover ears (and any face remnant) from the wave-3 wigs.

install-items-3.py turns a drawn head into a wig by flood-filling the FACE
away, but the ears sit outside that fill — they are their own little skin
blobs either side — so they survived, and every one of those styles wore a
pair of disembodied ears with the rig's real ears behind them.

WHY THIS IS A STANDALONE REPAIR, NOT A CHANGE TO THE INSTALLER
Re-running install-items-3.py would rebuild the tops too, and that would
re-punch the neck openings scripts/fill-neck-holes.py just filled in. This
edits the installed hair art in place instead.

THE TEST
An ear is a LIGHT, LOW-CHROMA region that is (a) small, (b) not running off
the edge of the art, and (c) TOUCHING THE FACE OPENING.

(c) is the one that matters. Without it this also ate the highlights inside
blonde and silver hair — they are light and small too — punching holes through
the middle of those styles. A highlight is landlocked in hair and touches no
transparency; an ear sits on the rim of the hole where the face was.

The mask is grown a little before erasing so the ear's own ink outline goes
with it.

Run from frontend/:  python scripts/fix-hair-ears.py [--dry]
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HAIR = os.path.join(FE, "assets", "character", "hair")

MAX_FRAC = 0.06      # an ear is small relative to the whole wig
GROW = 3             # eat the ear's outline too


def strip(path, dry=False):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).copy()
    h, w = a.shape[:2]
    rgb = a[..., :3].astype(int)
    opaque = a[..., 3] > 100

    mx, mn = rgb.max(2), rgb.min(2)
    light = (mx > 170) & ((mx - mn) < 60) & opaque
    light = ndimage.binary_opening(light, np.ones((3, 3)))

    clear = a[..., 3] < 40                 # the cut-away face, and outside
    lab, n = ndimage.label(light)
    if n == 0:
        return 0
    kill = np.zeros(light.shape, bool)
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() > MAX_FRAC * h * w:
            continue                       # a big pale mass is the hair itself
        ys, xs = np.where(comp)
        if ys.min() == 0 or ys.max() == h - 1 or xs.min() == 0 or xs.max() == w - 1:
            continue                       # runs off the edge: part of the hair
        near = ndimage.binary_dilation(comp, np.ones((3, 3)), iterations=4)
        if not (near & clear).any():
            continue                       # landlocked: a highlight, not an ear
        kill |= comp
    if not kill.any():
        return 0

    grown = ndimage.binary_dilation(kill, np.ones((3, 3)), iterations=GROW)
    if not dry:
        soft = np.clip(ndimage.gaussian_filter(grown.astype(float), 0.6), 0, 1)
        a[..., 3] = (a[..., 3] * (1 - soft)).astype(np.uint8)
        Image.fromarray(a, "RGBA").save(path, optimize=True)
    return int(grown.sum())


def main():
    dry = "--dry" in sys.argv
    files = sorted(f for f in os.listdir(HAIR) if f.startswith("hairX"))
    hit = 0
    for f in files:
        px = strip(os.path.join(HAIR, f), dry)
        if px:
            hit += 1
            print(f"  {f:14s} stripped {px}px")
    print(f"\n{hit} of {len(files)} wigs had leftover ears"
          + (" (dry run)" if dry else ""))


if __name__ == "__main__":
    main()
