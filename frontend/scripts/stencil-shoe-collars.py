"""Cut every shoe's collar the way the hand-painted ones were cut.

WHY NOT THE STRAIGHT LINE
`split-shoe-collars.py` puts one horizontal line through each shoe and gives
everything above it to the back piece. That is too much: above the line sits the
NEAR rim of the collar as well as the far one, and the near rim belongs in front
of the ankle. Hand-painted in the Fit Studio, the same shoes come out with a
crescent instead — the far rim only, the rear of the collar's opening.

WHAT THIS DOES
Those hand cuts are all the same shape, because the shoes are all drawn from one
template in one three-quarter view. Normalise each painted back piece to its
shoe's ink box and they land on top of each other: x 0.65..0.88, y 0.00..0.20 of
the ink, mirrored on the right foot. So this averages the shoes the hand has
already done into a stencil and stamps it on the ones it has not, clipped to
each shoe's own ink and scaled so it covers the same share of it.

It is a first pass, not a verdict. Every shoe it cuts is worth a look on the
contact sheet it writes, and anything it gets wrong is a minute in the studio:

    node scripts/fit-studio/server.mjs     then Draw the cut on that shoe

WHAT IT LEAVES ALONE
Anything under `painted` in collars.json, which is the hand's own work and the
stencil's source material. Shoes worn as one pair image, too: the stencil is the
shape of ONE shoe and a pair image holds two.

Run from frontend/:  python scripts/stencil-shoe-collars.py [--dry] [stem ...]
"""
import json
import os
import re
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
FE = os.path.dirname(HERE)
SHOES = os.path.join(FE, "assets", "character", "footwear")
BACKUP = os.path.join(HERE, "backups", "shoe-collars")
CONFIG = os.path.join(FE, "src", "config", "outfitItems.js")
MAP = os.path.join(HERE, "collars.json")
SHEET = os.path.join(HERE, "fit-studio", "collar-stencil.png")

GRID = 128       # the stencil's own resolution
FEATHER = 1      # rows the two pieces share, so no seam shows where the leg is
                 # absent and both halves draw
AREA = None      # share of the shoe's ink the back piece takes; the hand's mean

# The slip-on has no laces and a collar twice the size of a trainer's, so its
# cut is its own shape and averaging it in blurs everyone else's.
ODD = {"shoe304"}


def ink_of(a):
    return a[..., 3] > 8


def box_of(m):
    ys, xs = np.where(m)
    return ys.min(), ys.max(), xs.min(), xs.max()


def to_grid(mask, box):
    y0, y1, x0, x1 = box
    im = Image.fromarray((mask[y0:y1 + 1, x0:x1 + 1] * 255).astype(np.uint8))
    return np.asarray(im.resize((GRID, GRID), Image.BILINEAR)).astype(np.float32) / 255


def from_grid(grid, box, shape):
    """The stencil as a probability over the shoe, not a decision."""
    y0, y1, x0, x1 = box
    im = Image.fromarray((grid * 255).astype(np.uint8))
    im = im.resize((x1 - x0 + 1, y1 - y0 + 1), Image.BILINEAR)
    out = np.zeros(shape, np.float32)
    out[y0:y1 + 1, x0:x1 + 1] = np.asarray(im).astype(np.float32) / 255
    return out


def source(name):
    """The shoe before any cut, kept aside on the first pass that cuts it."""
    live = os.path.join(SHOES, name)
    keep = os.path.join(BACKUP, name)
    if not os.path.exists(keep):
        os.makedirs(BACKUP, exist_ok=True)
        shutil.copy2(live, keep)
    return Image.open(keep).convert("RGBA")


def learn(painted):
    """One stencil, averaged over every hand-painted back piece there is.

    Right shoes are the left one mirrored, so they are folded into the left's
    orientation first; averaging them as they lie cancels the two out.
    """
    grids, areas, used = [], [], []
    for stem in sorted(painted):
        if stem in ODD:
            continue
        for side in "LR":
            name = f"{stem}{side}.png"
            back = os.path.join(SHOES, f"{stem}{side}-back.png")
            if not os.path.exists(back) or not os.path.exists(os.path.join(SHOES, name)):
                continue
            ink = ink_of(np.asarray(source(name)))
            hand = ink_of(np.asarray(Image.open(back).convert("RGBA")))
            if not hand.any():
                continue
            g = to_grid(hand, box_of(ink))
            grids.append(g[:, ::-1] if side == "R" else g)
            areas.append(hand.sum() / ink.sum())
            used.append(f"{stem}{side}")
    if not grids:
        raise SystemExit(
            "no hand-painted back pieces to learn from. Draw the cut on a shoe "
            "or two in the Fit Studio first — this pass copies the hand, it "
            "does not invent a shape."
        )
    return np.mean(grids, axis=0), float(np.mean(areas)), used


def rim(stencil, ink, right_shoe, area):
    """Where the stencil sits on THIS shoe, taking its usual share of the ink.

    Thresholding the stencil at a fixed level would cut a big collar short and
    let a small one run; taking the top `area` of it keeps every back piece the
    size the hand drew.
    """
    g = stencil[:, ::-1] if right_shoe else stencil
    p = from_grid(g, box_of(ink), ink.shape)
    want = max(1, int(round(area * ink.sum())))
    vals = np.sort(p[ink])[::-1]
    thresh = max(float(vals[min(want, len(vals) - 1)]), 0.02)
    return (p >= thresh) & ink


# --- following the art's own lines ------------------------------------------
# A stencil's edge is a stencil's edge: left as it lands it runs straight
# through the black line round the collar, so half a stroke stays in the front
# piece and reads as a stray black arc lying over the leg. Nothing should ever
# be cut through — not a line, not a fill. So the mask is pushed out to the
# nearest edges the artist drew before the shoe is split on it.

DARK = 90        # a line is darker than this
THICK = 3        # dark this deep in every direction is a black SHOE, not a line
REACH = 3        # how far a line can be from the colour that owns it
COVER = 0.45     # take a colour area whole from this much overlap
BIGGEST = 2.0    # ... but only areas about the collar's own size


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return (x * x + y * y) <= r * r


def strokes_of(a):
    """Dark pixels that are LINES, not dark parts of the shoe itself."""
    ink = a[..., 3] > 8
    lum = a[..., :3].astype(np.float32) @ [0.299, 0.587, 0.114]
    dark = ink & (lum < DARK)
    thick = ndi.binary_dilation(ndi.binary_erosion(dark, disk(THICK)), disk(THICK))
    return dark & ~thick, dark


def lift(ink, mask):
    """Everything over the opening goes behind the leg too.

    The leg leaves the shoe upwards, so ink left in the front piece above the
    collar is ink lying across the ankle — the shoe's own top outline included,
    which is exactly what reads as a black bar over the leg.
    """
    out = mask.copy()
    for x in np.where(mask.any(axis=0))[0]:
        out[:np.where(mask[:, x])[0].min(), x] = ink[:np.where(mask[:, x])[0].min(), x]
    return out


def whole_areas(a, mask, stroke):
    """Take a colour area whole or not at all, so no cut runs through a fill.

    Only areas the collar's own size: a long band that merely clips the mask
    stays where it is, or half an upper would go behind the leg with it.
    """
    ink = a[..., 3] > 8
    q = a[..., :3].astype(np.int32) // 10
    key = np.where(ink & ~stroke, q[..., 0] * 65536 + q[..., 1] * 256 + q[..., 2] + 1, 0)
    out = mask.copy()
    room = BIGGEST * mask.sum()
    for v in np.unique(key):
        if v == 0:
            continue
        lab, n = ndi.label(key == v)
        for i, area in enumerate(ndi.sum(np.ones_like(lab), lab, range(1, n + 1)), start=1):
            if area > room:
                continue
            m = lab == i
            share = (m & mask).sum() / area
            if share >= COVER:
                out |= m
            elif share > 0:
                out &= ~m
    return out


def snap(a, mask):
    """The mask, pushed out to the edges the artist drew.

    A line between the opening and the NEAR rim belongs in front — the ankle
    passes behind it, and that is what makes the collar read as a ring round the
    leg. A line with the far rim on both sides belongs behind. Either way it
    goes whole to one side.
    """
    ink = a[..., 3] > 8
    stroke, dark = strokes_of(a)
    grown = whole_areas(a, lift(ink, mask), stroke)
    if not grown.any():
        return mask
    front_colour = ink & ~dark & ~grown
    owned_by_front = ndi.binary_dilation(front_colour, disk(REACH))
    take = ndi.binary_dilation(grown, disk(REACH)) & stroke & ~owned_by_front & ink
    give = grown & stroke & owned_by_front
    out = (grown | take) & ~give
    # a snap that runs away has misread the art; the stencil alone is safer
    return out if out.any() and out.sum() <= 3 * max(1, mask.sum()) else mask


def pieces(im, mask):
    """(front, back), overlapping by a hair — but only ever on the BACK's side.

    Something has to overlap or a pale seam shows along the join: both edges are
    part transparent once the rig scales them, and two half-covered pixels do
    not add up to one covered one. So the BACK is grown a pixel under the front,
    where the leg hides it. Growing the front instead would put the mask's edge
    back in the front piece, which on this cut is the collar's black outline,
    drawn as a stray line straight across the ankle.
    """
    a = np.asarray(im)
    ring = np.zeros_like(mask)
    pad = np.pad(mask, FEATHER, constant_values=False)
    h, w = mask.shape
    for dy in range(-FEATHER, FEATHER + 1):
        for dx in range(-FEATHER, FEATHER + 1):
            # padded, not rolled: rolling wraps the far side of the image in
            ring |= pad[FEATHER + dy:FEATHER + dy + h, FEATHER + dx:FEATHER + dx + w]
    front = a.copy()
    front[..., 3] = np.where(mask, 0, front[..., 3])
    back = a.copy()
    back[..., 3] = np.where(ring, back[..., 3], 0)
    return Image.fromarray(front, "RGBA"), Image.fromarray(back, "RGBA")


def art_names():
    """Every image the rig WEARS, and whether it is one shoe or a pair."""
    src = open(CONFIG, encoding="utf-8").read()
    out = []
    for stem in sorted(set(re.findall(r"footwear/(shoe\d+)\.png", src))):
        halves = [f"{stem}{s}.png" for s in "LR"]
        if all(f"footwear/{h}" in src for h in halves):
            out += [(stem, h) for h in halves]
    return out


def sheet_only():
    """Every shoe as it stands on disk, whoever cut it. Nothing is written."""
    tiles = []
    for stem, name in art_names():
        back = os.path.join(SHOES, f"{stem}{name[-5]}-back.png")
        if not os.path.exists(back):
            continue
        tiles.append((name, source(name),
                      ink_of(np.asarray(Image.open(back).convert("RGBA")))))
    contact(tiles)
    print(f"{len(tiles)} cut shoe images\ncontact sheet: {os.path.relpath(SHEET, FE)}")


def main():
    if "--sheet" in sys.argv:
        return sheet_only()
    dry = "--dry" in sys.argv
    # `--tidy` leaves WHERE the hand cut alone and only makes its edge follow
    # the art's lines, for the shoes it drew.
    tidy = "--tidy" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    conf = json.load(open(MAP, encoding="utf-8")) if os.path.exists(MAP) else {}
    painted = conf.get("painted", {})

    stencil, area, used = learn(painted)
    print(f"stencil learnt from {len(used)} hand-painted images: {' '.join(used)}")
    print(f"back piece takes {area * 100:.1f}% of a shoe's ink\n")

    todo = [(stem, name) for stem, name in art_names()
            if (stem in painted) == tidy and (not only or stem in only)]
    tiles, done = [], []
    for stem, name in todo:
        im = source(name)
        a = np.asarray(im)
        ink = ink_of(a)
        if tidy:
            drawn = os.path.join(SHOES, f"{stem}{name[-5]}-back.png")
            if not os.path.exists(drawn):
                continue
            mask = ink_of(np.asarray(Image.open(drawn).convert("RGBA")))
        else:
            mask = rim(stencil, ink, name.endswith("R.png"), area)
        if not mask.any():
            print(f"  {name:16s} nothing to cut, left whole")
            continue
        mask = snap(a, mask)
        front, back = pieces(im, mask)
        done.append(stem)
        print(f"  {name:16s} back piece {int(mask.sum()):5d}px")
        tiles.append((name, im, mask))
        if dry:
            continue
        front.save(os.path.join(SHOES, name), optimize=True)
        back.save(os.path.join(SHOES, f"{stem}{name[-5]}-back.png"), optimize=True)

    contact(tiles)
    print(f"\n{len(tiles)} shoe images cut" + (" (dry run)" if dry else ""))
    print(f"contact sheet: {os.path.relpath(SHEET, FE)}")
    if dry:
        return

    conf.setdefault("cut", {})
    conf.setdefault("stencil", {})
    for stem in sorted(set(done)):
        conf["cut"][stem] = None        # hands off: the straight line would undo this
        if not tidy:                    # a tidied shoe is still the hand's own
            conf["stencil"][stem] = True
    json.dump(conf, open(MAP, "w", encoding="utf-8"), indent=1)
    print("\nnow:  python scripts/wire-shoe-collars.py")


def contact(tiles, cols=8, cell=190):
    """Every cut on one sheet, so a bad one is spotted without opening it."""
    if not tiles:
        return
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (243, 239, 231, 255))
    for i, (name, im, mask) in enumerate(tiles):
        a = np.asarray(im).astype(np.float32).copy()
        a[mask, :3] = (a[mask, :3] + np.array([236, 72, 153], np.float32)) / 2
        t = Image.fromarray(a.astype(np.uint8), "RGBA")
        t.thumbnail((cell - 10, cell - 10))
        sheet.paste(t, ((i % cols) * cell + 5, (i // cols) * cell + 5), t)
    os.makedirs(os.path.dirname(SHEET), exist_ok=True)
    sheet.save(SHEET)


if __name__ == "__main__":
    main()
