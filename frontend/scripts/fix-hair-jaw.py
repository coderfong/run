"""Open the bottom of each wig — delete the leftover jaw/chin arc.

The source art draws a whole head: a face oval with an outline, hair on top.
install-items-3.py cuts the face FILL away and grows the cut a few pixels to
take the outline with it, but the stroke is thicker than that grow, so a thin
arc survives across the bottom of the opening. The wig then reads as hair glued
to an invisible face — the reference art leaves the inner edge following the
HAIR, open at the bottom between the side locks.

HOW THE ARC IS FOUND — a TOPOLOGICAL test, not colour or thickness.
Colour cannot work: black hair is the same ink as the outline. Thickness alone
cannot work either: the hair's OWN outline is just as thin, and stripping every
thin thing severed the braids and skinned the silhouette.

What is actually unique about the arc is what it separates. The transparent
pixels form two regions — the face opening, and the outside world — and the
only thing keeping them apart at the bottom is that stroke. So: dilate each
region by R and take the overlap. Two regions can only meet if what divides
them is thinner than 2R, which is true of the arc and false of every part of
the hair mass. Erase the opaque pixels there and the opening joins the outside,
exactly as in the reference.

Run from frontend/:  python scripts/fix-hair-jaw.py [--dry]
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HAIR = os.path.join(FE, "assets", "character", "hair")

R = 9              # half the widest bridge to break; hair is far thicker


def strip(path, dry=False):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).copy()
    opaque = a[..., 3] > 100
    clear = ~opaque

    lab, n = ndimage.label(clear)
    if n < 2:
        return 0
    # the exterior is whatever touches the border; the face opening is the
    # largest clear region that does not
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    border.discard(0)
    exterior = np.isin(lab, list(border))
    hole = None
    for i in range(1, n + 1):
        if i in border:
            continue
        comp = lab == i
        if comp.sum() < 0.02 * comp.size:
            continue
        if hole is None or comp.sum() > hole.sum():
            hole = comp
    if hole is None:
        return 0

    st = np.ones((3, 3))
    bridge = (ndimage.binary_dilation(hole, st, iterations=R)
              & ndimage.binary_dilation(exterior, st, iterations=R)
              & opaque)
    # Confine it to the bottom of the opening AND to the opening's own column.
    # Braids and side locks attach through a narrow waist that is a thin bridge
    # by exactly the same test, so without this the plaits were cut loose and
    # floated free of the wig. The jaw arc is the one that sits directly under
    # the face, so restricting to that box leaves every dangling lock attached.
    hy, hx = np.where(hole)
    box = np.zeros_like(bridge)
    m = round(0.04 * bridge.shape[1])
    box[int(hy.min() + 0.5 * (hy.max() - hy.min())):,
        max(0, hx.min() - m):hx.max() + m] = True
    bridge &= box
    if not bridge.any():
        return 0

    # The stroke is anti-aliased, so its soft edge sits below the opacity
    # threshold used above and survives the cut as a faint grey ghost of the
    # arc. Sweep the half-transparent pixels around the bridge as well; solid
    # hair (alpha near 255) is left alone.
    halo = ndimage.binary_dilation(bridge, st, iterations=2) & (a[..., 3] < 200)
    erase = bridge | halo

    if not dry:
        soft = np.clip(ndimage.gaussian_filter(erase.astype(float), 0.6), 0, 1)
        a[..., 3] = (a[..., 3] * (1 - soft)).astype(np.uint8)
        Image.fromarray(a, "RGBA").save(path, optimize=True)
    return int(erase.sum())


def main():
    dry = "--dry" in sys.argv
    files = sorted(f for f in os.listdir(HAIR) if f.startswith("hairX"))
    hit = 0
    for f in files:
        px = strip(os.path.join(HAIR, f), dry)
        if px:
            hit += 1
            print(f"  {f:14s} opened {px}px")
    print(f"\n{hit} of {len(files)} wigs had a jaw arc"
          + (" (dry run)" if dry else ""))


if __name__ == "__main__":
    main()
