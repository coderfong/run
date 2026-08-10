"""Open the mouth of every piece of open footwear so the FOOT is inside it.

THE PROBLEM
The footwear art is drawn as a shoe on its own, complete with its lining, and
the rig draws it over the body's feet. For a sneaker that is right — the shoe
is closed, and there is nothing to see inside it. For a slide, a sandal, a
ballet flat, a clog or a rain boot it is wrong twice over: the open area shows
the shoe's own footbed instead of the foot standing in it, and the mouth shows
its inner backing instead of wrapping around the leg. The runner reads as
standing next to a shoe rather than wearing one.

THE FIX
Cut the lining out of the WORN art. Everything inside the mouth becomes
transparent, so the body's own leg and foot show through it, and the rim —
which the rig already draws above the body — closes around them. Nothing is
painted in, which is the whole point: the foot inside a shoe is then the real
foot, in the wearer's own skin tone, on all eight bodies. Only the backing
goes.

The picker keeps the untouched pair image (`itemPreviewImage` -> `item.img`),
because a shoe with a see-through middle is only correct on a leg. Items that
ship split art are punched in `<stem>L.png` / `<stem>R.png`, which only the
rig loads; the ones that would not split (scripts/split-shoes-6.py) get
`<stem>_worn.png` instead, and each of those needs a `wornImg` beside its
`img` in src/config/outfitItems.js — `itemWornImage` is what the rig asks for
and the picker does not, so without that line the cut never reaches the app.

WHICH PIXELS GO
`open-footwear.json` names, per item, a point inside each part of the lining,
in fractions of the art's width and height so the file survives a re-cut. The
script resolves each point to the flat-colour region under it — the line art
is what bounds a region, so this is the same shape a paint-bucket would fill —
and clears that region plus the anti-aliased fringe the cut would otherwise
leave as a halo of lining colour around the rim.

Only the LEFT art is authored. The right shoe of a pair is the same drawing,
used twice, so the seed that names a region on the left names the same region
on the right once the mirror is undone — which way round the pair was drawn is
decided per item, from whichever way transfers the seeds better.

Originals are copied to scripts/backups/footwear-mouths/ on the first run and
every later run cuts from those, so this is re-runnable and re-tunable rather
than a one-way pass over the assets.

Check the result on a leg with scripts/open-footwear-qa.py — the art file and
the picker both show a shoe on its own, which is the one view where a cut
mouth cannot be judged. Read the line it prints under the sheet too: a seed
that lands on a sole rather than a footbed, or on a patterned upper rather
than the lining behind it, still looks like a shoe on the sheet while cutting
a hole clean through to the background.

Run from frontend/:  python scripts/open-footwear-mouths.py [--dry]
"""
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
FE = os.path.dirname(HERE)
SHOES = os.path.join(FE, "assets", "character", "footwear")
BACKUP = os.path.join(HERE, "backups", "footwear-mouths")
MAP = os.path.join(HERE, "open-footwear.json")

# Radius of the disk that decides whether a dark area is line work or a black
# FILL. The outlines in this art are a handful of pixels wide; a black lining
# or a black upper is far wider than that. Without the split, a black lining
# is indistinguishable from the outline it touches and cannot be cut on its
# own.
INK_R = 5
DARK = 90               # a pixel this dark is either line work or a black fill
FRINGE_TOL = 70         # colour distance that still counts as the cut region's
                        # own anti-aliasing rather than the rim beside it
COLOUR_TOL = 90         # how far the right shoe's lining may drift from the
                        # left's and still be the same part of the drawing
SEARCH_R = 12           # how far a transferred seed may be walked to find it


def regions(im, ink_r=INK_R):
    """Label the flat-colour regions of a piece of art, bounded by line work.

    Returns (rgb, labels, count). Light fills are separated by every dark
    pixel — the line work does the separating, which is how the art is drawn.
    Black fills are labelled from the opening of the dark mask, which keeps
    the blobs and drops the strokes attached to them.

    The opening is intersected back with the dark mask because its dilation
    step does not stop at the ink: left alone it rounds the blob outwards over
    whatever the blob happens to sit against, so a black lining next to a
    checkerboard upper comes back holding a bite of the checkers.

    A bigger `ink_r` demands a bigger blob. That is the knob for art where a
    black lining shares its black with a pattern beside it — a checkerboard
    upper, say — and the two only come apart once the pattern's squares are
    too small to survive the opening.
    """
    a = np.asarray(im).astype(np.int16)
    op = a[..., 3] > 128
    dark = op & (a[..., :3].max(axis=2) < DARK)
    y, x = np.ogrid[-ink_r:ink_r + 1, -ink_r:ink_r + 1]
    disk = x * x + y * y <= ink_r * ink_r
    light, nl = ndimage.label(op & ~dark)
    black, nb = ndimage.label(ndimage.binary_opening(dark, disk) & dark)
    lab = np.where(black > 0, black + nl, light)
    return a, lab, nl + nb


def region_at(lab, w, h, seed):
    """The region under a seed given in fractions of the art's size."""
    x = min(w - 1, max(0, int(round(seed[0] * w))))
    y = min(h - 1, max(0, int(round(seed[1] * h))))
    return int(lab[y, x])


def palette(a, lab, n):
    """Mean colour of every region, indexed by label. Row 0 is the line work.

    Labels that ended up empty — a light region wholly overwritten by a black
    one — are parked far out of range so nothing ever matches them.
    """
    idx = np.arange(1, n + 1)
    rgb = np.stack([ndimage.mean(a[..., c], lab, idx) for c in range(3)], axis=1)
    return np.vstack([np.zeros(3), np.nan_to_num(rgb, nan=1e6)])


def ring_offsets(r):
    """Offsets out to `r`, ordered by how far they are from the centre."""
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    off = np.stack([y.ravel(), x.ravel()], axis=1)
    return off[np.argsort(np.abs(off).max(axis=1) * 1000 + (off ** 2).sum(axis=1))]


OFFSETS = ring_offsets(SEARCH_R)


def transfer(lab_r, rgb_r, want, seed, mirror):
    """The right shoe's copy of a left region, found from the left seed.

    The pair is one drawing used twice, so the seed lands on the same region on
    both shoes once the mirror is undone. The two are redrawn rather than
    copied, though, so the transferred point can miss the region by a few
    pixels or land on the line art: walk outwards from it and take the nearest
    region that is still the lining's colour.

    Returns (label, colour distance, pixels walked); label 0 means no match.
    """
    h, w = lab_r.shape
    fx, fy = seed
    if mirror:
        fx = 1 - fx
    y = min(h - 1, max(0, int(round(fy * h)))) + OFFSETS[:, 0]
    x = min(w - 1, max(0, int(round(fx * w)))) + OFFSETS[:, 1]
    ok = (y >= 0) & (y < h) & (x >= 0) & (x < w)
    labs = lab_r[y[ok], x[ok]]
    dist = np.abs(rgb_r[labs] - want).sum(axis=1)
    hit = np.flatnonzero((labs > 0) & (dist <= COLOUR_TOL))
    if not hit.size:
        return 0, None, None
    # OFFSETS is ordered by distance, so the first hit is the nearest one
    i = hit[0]
    return int(labs[i]), float(dist[i]), int(np.abs(OFFSETS[ok][i]).max())


def cut(im, a, lab, idxs):
    """Clear the given regions, and the fringe the line art blends into them.

    Takes the labels the caller resolved rather than relabelling: the two must
    agree, and an item may have asked for an ink radius of its own.
    """
    px = np.asarray(im).copy()
    kill = np.isin(lab, [i for i in idxs if i > 0])
    if not kill.any():
        return im, 0
    # The rim's outline is anti-aliased INTO the lining, so a straight cut
    # leaves a rind of lining colour hugging the inside of the rim. Take the
    # ring just outside the cut as well, but only where it is still the
    # lining's own colour — never the rim itself.
    mean = np.array([a[..., c][kill].mean() for c in range(3)])
    ring = ndimage.binary_dilation(kill, np.ones((3, 3), bool), iterations=2) & ~kill
    close = np.sqrt(((a[..., :3] - mean) ** 2).sum(axis=2)) < FRINGE_TOL
    px[..., 3] = np.where(kill | (ring & close), 0, px[..., 3])
    return Image.fromarray(px, "RGBA"), int((kill | (ring & close)).sum())


def match(rgb_l, idxs_l, seeds, im_r, ink_r):
    """Find the right shoe's copy of each region chosen on the left shoe.

    The pair is drawn mirrored about as often as not, and nothing in the art
    says which. So transfer every seed both ways and keep the reading that
    places the most of them, breaking ties on how well the colours agree and
    how far the seeds had to be walked. Deciding once for the whole shoe stops
    a single awkward seed from flipping the pair on its own.

    Two left regions can land on one region on the right, where that shoe was
    drawn without a dividing line its partner has. That is a real answer, not a
    collision — the cut takes the set of regions, so it comes out the same.
    """
    a_r, lab_r, n_r = regions(im_r, ink_r)
    rgb_r = palette(a_r, lab_r, n_r)
    reads = {}
    for mirror in (False, True):
        got = [transfer(lab_r, rgb_r, rgb_l[i], s, mirror)
               for i, s in zip(idxs_l, seeds)]
        reads[(-sum(1 for j, _, _ in got if j),
               sum(d for _, d, _ in got if d is not None),
               sum(r for _, _, r in got if r is not None))] = got
    return [j for j, _, _ in reads[min(reads)]], a_r, lab_r


def source(name):
    """The pristine art: kept aside on the first run, cut from ever after."""
    live = os.path.join(SHOES, name)
    keep = os.path.join(BACKUP, name)
    if not os.path.exists(keep):
        os.makedirs(BACKUP, exist_ok=True)
        shutil.copy2(live, keep)
    return Image.open(keep).convert("RGBA")


def main():
    dry = "--dry" in sys.argv
    items = json.load(open(MAP, encoding="utf-8"))["items"]
    done = 0
    for stem, spec in sorted(items.items()):
        seeds = spec["mouth"]
        pair = spec.get("pair", False)
        ink = spec.get("ink", INK_R)
        # `pair` items have no split art, so the mouth is authored on the pair
        # image and the cut is written beside it as the worn-only art.
        left_name = f"{stem}.png" if pair else f"{stem}L.png"
        im_l = source(left_name)
        a_l, lab_l, n_l = regions(im_l, ink)
        h, w = lab_l.shape
        idxs_l = [region_at(lab_l, w, h, s) for s in seeds]
        if 0 in idxs_l:
            print(f"  {stem}: a seed fell on the line art, skipped")
            continue
        out_l, px_l = cut(im_l, a_l, lab_l, idxs_l)
        jobs = [(f"{stem}_worn.png" if pair else left_name, out_l, px_l)]

        if not pair:
            im_r = source(f"{stem}R.png")
            idxs_r, a_r, lab_r = match(
                palette(a_l, lab_l, n_l), idxs_l, seeds, im_r, ink)
            if 0 in idxs_r:
                print(f"  {stem}: no match on the right shoe, skipped")
                continue
            out_r, px_r = cut(im_r, a_r, lab_r, idxs_r)
            jobs.append((f"{stem}R.png", out_r, px_r))

        done += 1
        print(f"  {stem:10s} " + "  ".join(f"{n} -{p}px" for n, _, p in jobs))
        if dry:
            continue
        for name, img, _ in jobs:
            img.save(os.path.join(SHOES, name), optimize=True)

    print(f"\n{done} of {len(items)} open footwear items opened"
          + (" (dry run)" if dry else ""))


if __name__ == "__main__":
    main()
