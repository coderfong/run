"""Fill the punched neck opening back in on every garment.

Earlier waves cut an elliptical hole through each top's collar so the body
showed through it — a fake neck, from back when the body art had none. The
rebuilt body has a real neck, so those holes now read as a white disc floating
on the chest.

WHICH HOLES GET FILLED
Only ENCLOSED ones: transparent regions completely surrounded by garment. A
real collar opening reaches the garment's top edge and is therefore not
enclosed, so it survives — that is the opening the neck genuinely pokes out
of. This test is what makes the pass safe to run over every outfit asset
regardless of which wave cut it.

The fill is nearest-neighbour inpainting from the hole's rim, so it picks up
whatever that garment's collar colour is with no per-item tuning.

Run from frontend/:  python scripts/fill-neck-holes.py [--dry]
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTFIT = os.path.join(FE, "assets", "character", "outfit")
MIN_HOLE = 60          # px; below this it's an artefact of the line art, not a cut


def fill(path):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).copy()
    solid = a[..., 3] > 60
    holes = ndimage.binary_fill_holes(solid) & ~solid
    lab, n = ndimage.label(holes)
    if n == 0:
        return 0

    target = np.zeros(holes.shape, bool)
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() >= MIN_HOLE:
            target |= comp
    if not target.any():
        return 0

    # nearest opaque pixel supplies the colour
    idx = ndimage.distance_transform_edt(~solid, return_distances=False,
                                         return_indices=True)
    for c in range(3):
        ch = a[..., c]
        a[..., c] = np.where(target, ch[tuple(idx)], ch)
    a[..., 3] = np.where(target, 255, a[..., 3])
    Image.fromarray(a, "RGBA").save(path, optimize=True)
    return int(target.sum())


def main():
    dry = "--dry" in sys.argv
    files = sorted(f for f in os.listdir(OUTFIT) if f.endswith(".png"))
    hit = 0
    for f in files:
        p = os.path.join(OUTFIT, f)
        if dry:
            im = np.asarray(Image.open(p).convert("RGBA"))
            solid = im[..., 3] > 60
            holes = ndimage.binary_fill_holes(solid) & ~solid
            lab, n = ndimage.label(holes)
            px = sum(int((lab == i).sum()) for i in range(1, n + 1)
                     if (lab == i).sum() >= MIN_HOLE)
        else:
            px = fill(p)
        if px:
            hit += 1
            print(f"  {f:18s} filled {px}px")
    print(f"\n{hit} of {len(files)} garments had an enclosed neck hole"
          + (" (dry run)" if dry else ""))


if __name__ == "__main__":
    main()
