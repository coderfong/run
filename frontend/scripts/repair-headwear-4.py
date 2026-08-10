"""Fill the bites the wave-4 cut took out of the hats themselves.

cut-headwear-4.py removes two things that are drawn ON the head: the head
outline (`sep`) and the ears. Both are erased as whole strokes, and wherever
one of them crossed the HAT the erase went through the hat too — so a cap's
brim tips, a top hat's brim, the bottom of a trapper's ear flaps and the veil's
sides all ended up with transparent notches, which read as faded patches
against the face.

The repair is morphological rather than a re-cut, on purpose: re-running the
installer would rewrite every hat's `layout`, and those have since been fitted
by hand in Fit Studio. Working in place on the installed PNG at its existing
size changes no geometry at all — same canvas, same bounding box, same numbers.

  hole   = two kinds, and both have to be narrow or enclosed or the repair
           starts inventing material. A SMALL closing catches a bite taken
           across an outline (the radius is barely wider than the erased
           stroke). An ENCLOSED hole — one `binary_fill_holes` finds, capped by
           area — catches the ear-shaped patch punched clean through a veil,
           and is allowed ONLY where the cut's ear mask actually reached.
           Neither can bridge a real gap: a first pass at 9% of the piece's
           size welded the mortarboard to its tassel and filled the space
           between a samurai helm's cheek flaps, and filling every enclosed
           hole welded the love boppers' coils shut and darkened the gaps
           between a flower crown's petals. A plain closing has no idea which
           side of a gap is background, so the only safe licence to fill a big
           hole is knowing this pipeline punched it.
  colour = nearest INTERIOR pixel — one eroded clear of the shape's own edge.
           Sampling the nearest opaque pixel instead picks an anti-aliased edge
           as often as not, and smears that half-tone grey across the whole
           patch; every large fill came out looking like a smudge. These are
           flat-fill drawings, so a notch through an outline fills with
           outline and a notch through a panel fills with panel.
  finish = snap to the piece's own palette, then a 3x3 majority vote over the
           patch. Nearest-interior is decided per pixel, so along the seam where
           a fill spans both an outline and the panel behind it the nearest core
           pixel flips back and forth and leaves a few dark specks stranded in
           the flat colour. The vote is run only on filled pixels and the strokes
           being continued are ten-odd pixels thick, so it clears the specks
           without eating the outline it just rebuilt.

Originals are copied to scripts/headwear4-prerepair/ before anything is written.
"""
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
HATS = r"C:\Users\user\Desktop\run\frontend\assets\character\headwear"
BACKUP = os.path.join(HERE, "headwear4-prerepair")
PREVIEW = os.path.join(HERE, "qa-headwear4", "preview")

# Closing radius, as a fraction of the piece's longest side. The erased head
# outline is ~15px on a 512 canvas, so this only has to be a little wider than
# that — anything more starts joining things that were never joined.
RADIUS_FRAC = 0.03
MIN_RADIUS = 9
# An enclosed hole bigger than this is part of the design (a halo IS a ring),
# not a bite. The ear patches are well under 1%.
MAX_ENCLOSED = 0.02
# A closing may not add more than this share of the piece's own solid area. The
# damage this repair exists for is a few hundred pixels; when a radius starts
# filling THOUSANDS it has stopped patching a bite and started welding a shape
# shut — the love boppers' coils, a halo's ring, the gaps between a flower
# crown's petals. Rather than keep a hand-written list of filigree pieces, the
# radius is stepped down per piece until the fill is small enough, and pieces
# that never get there are patched from their enclosed holes alone.
FILL_BUDGET = 0.010
# How far from a measured ear centre an enclosed hole may sit and still be
# treated as ear damage, as a fraction of the head's width in the source art.
EAR_REACH = 0.22
# A colour has to hold this share of the piece's interior to count as one of its
# flat fills; anything rarer is an anti-aliased in-between and is not a target
# to snap to.
PALETTE_MIN = 0.004
# Majority-vote passes over the patch. Two is enough to clear a 2px speck; more
# starts rounding the corner where a rebuilt outline meets its panel.
VOTE_PASSES = 2
# Second stage: the erased strokes' own footprint. Stage one's whole-piece
# budget is what keeps it from welding a filigree piece shut, and on those very
# pieces it clamps the radius to nothing — so a band tip that the head outline
# chewed stays chewed. Here the licence comes from geometry instead of area:
# cut-headwear-4 erased `sep`, which hugs the head-outline ellipse, and the two
# ear slits, and it recorded where that head was. Reconstruct that ring and
# those slits and a generous radius is safe anywhere along them, because the
# things a hat is legitimately open through — a halo's ring, the boppers' coils,
# the gaps between a crown's petals — are nowhere near the ring.
RING_RADIUS_FRAC = 0.045
# Half-width of the erased ring, in SOURCE pixels: the head outline's stroke
# plus the two dilations cut-headwear-4 erased it by, and a little slack for
# where the ellipse and the drawn line disagree.
RING_HALF = 26
# A ring fill is still capped, as a share of the piece's solid area — the ring
# crosses the open bottom of a hat that sits ON the head, and there a closing
# can start bridging tails that were drawn apart.
RING_BUDGET = 0.012


def repair(path, radius, ears, band=None, out=None):
    a = np.asarray(Image.open(path).convert("RGBA")).copy()
    al = a[..., 3]
    opaque = al > 200
    if not opaque.any():
        return 0
    budget = FILL_BUDGET * opaque.sum()
    hole = np.zeros_like(opaque)
    r = radius
    while r >= 3:
        k = np.ones((r * 2 + 1, r * 2 + 1), bool)
        cand = ndimage.binary_closing(opaque, k) & ~opaque
        if cand.sum() <= budget:
            hole = cand
            break
        r -= 2

    # Enclosed holes, judged one at a time, and only in the two places the cut
    # punched an ear out. The ear is closed over FIRST: on a hat that covers the
    # ear — a flight cap's flap, a veil, a samurai's cheek plate — the ear was
    # drawn on top of the piece and its erasure left a punch-out that reaches
    # the piece's edge, so it is not an enclosed hole at all and fill_holes
    # walks straight past it. Sealing the ear's own opening turns it into one.
    if ears:
        seal = max(MIN_RADIUS, int(0.30 * min(e[2] for e in ears)))
        enclosed = ndimage.binary_fill_holes(
            ndimage.binary_closing(opaque, np.ones((seal * 2 + 1,) * 2))) & ~opaque
        yy, xx = np.mgrid[0:opaque.shape[0], 0:opaque.shape[1]]
        disks = np.zeros_like(opaque)
        for ex, ey, er in ears:
            disks |= (xx - ex) ** 2 + (yy - ey) ** 2 <= er * er
        lab, n = ndimage.label(enclosed)
        cap = MAX_ENCLOSED * opaque.size
        for i in range(1, n + 1):
            comp = lab == i
            # Sealing the ear can also seal the mouth of something much larger —
            # the whole space under a brim, say. An ear punch-out lies inside the
            # ear's own disk; that is the test, not where its centre happens to be.
            if comp.sum() > cap or (comp & disks).sum() < 0.75 * comp.sum():
                continue
            hole |= comp

    # Along the erased strokes themselves.
    if band is not None:
        lr = max(MIN_RADIUS, int(RING_RADIUS_FRAC * max(a.shape[:2])))
        ring_budget = RING_BUDGET * opaque.sum()
        while lr >= 3:
            k = np.ones((lr * 2 + 1, lr * 2 + 1), bool)
            cand = ndimage.binary_closing(opaque, k) & ~opaque & band
            if cand.sum() <= ring_budget:
                hole |= cand
                break
            lr -= 2

    # Half-erased pixels around the edge of a patch being filled, but only
    # there — the anti-aliased rim of the piece itself must stay soft.
    hole |= ndimage.binary_dilation(hole, np.ones((5, 5))) & (al > 0) & (al < 200)
    if not hole.any():
        return 0
    # Nearest INTERIOR pixel, for both colour and a clean 255 alpha.
    core = ndimage.binary_erosion(opaque, np.ones((7, 7)))
    if not core.any():
        core = opaque
    _, idx = ndimage.distance_transform_edt(~core, return_indices=True)
    ys, xs = np.where(hole)
    a[ys, xs, :3] = a[idx[0][ys, xs], idx[1][ys, xs], :3]
    a[ys, xs, 3] = 255
    tidy(a, hole, core)
    Image.fromarray(a, "RGBA").save(out or path, optimize=True)
    return int(hole.sum())


def tidy(a, hole, core):
    """Snap the patch to the piece's flat colours and vote away the specks."""
    pal = palette(a[..., :3][core])
    if len(pal) < 2:
        return
    lab = nearest(a[..., :3], pal)
    a[hole] = np.concatenate([pal[lab[hole]], np.full((int(hole.sum()), 1), 255, np.uint8)], 1)
    solid = (a[..., 3] > 200)
    for _ in range(VOTE_PASSES):
        votes = np.stack([ndimage.uniform_filter(((lab == i) & solid).astype(np.float32), 3)
                          for i in range(len(pal))])
        win = votes.argmax(0)
        lab = np.where(hole, win, lab)
        a[hole] = np.concatenate([pal[win[hole]], np.full((int(hole.sum()), 1), 255, np.uint8)], 1)


def palette(rgb):
    """The piece's flat fills, coarsely binned so anti-aliasing doesn't split one."""
    if not len(rgb):
        return np.zeros((0, 3), np.uint8)
    binned = (rgb.astype(int) // 16)
    keys, counts = np.unique(binned[:, 0] * 4096 + binned[:, 1] * 64 + binned[:, 2], return_counts=True)
    keep = counts >= max(PALETTE_MIN * len(rgb), 24)
    out = []
    for key in keys[keep]:
        sel = (binned[:, 0] * 4096 + binned[:, 1] * 64 + binned[:, 2]) == key
        out.append(rgb[sel].mean(0).round())
    return np.asarray(out, np.uint8)


def nearest(rgb, pal):
    d = ((rgb[..., None, :].astype(np.int32) - pal[None, None, :, :].astype(np.int32)) ** 2).sum(-1)
    return d.argmin(-1)


def ear_zones(cut, inst):
    """The two ear centres, in the INSTALLED art's pixels.

    cut-headwear-4 measured the head off each sheet and recorded both that and
    the crop box it used, so the ears can be put back on the map even though
    the piece has since been cropped, recoloured and resized.
    """
    head, box = cut["head"], cut["box"]
    bw, bh = box["x1"] - box["x0"], box["y1"] - box["y0"]
    if bw <= 0 or bh <= 0:
        return []
    sx, sy = inst["w"] / bw, inst["h"] / bh
    out = []
    for sign in (-1, 1):
        ex = head["cx"] + sign * 0.55 * head["w"]
        ey = head["top"] + 0.50 * head["h"]
        out.append(((ex - box["x0"]) * sx, (ey - box["y0"]) * sy,
                    EAR_REACH * head["w"] * sx))
    return out


def erase_band(cut, inst, shape, ears):
    """Where the cut's two erased strokes ran, in the INSTALLED art's pixels.

    `sep` is the ink along the head outline, so its footprint is a ring hugging
    the head ellipse — the same ellipse cut-headwear-4 built from the feature
    block. RING_HALF is that stroke's own half-width, and the ellipse is in
    source pixels, so it is scaled by the crop before the ring is measured.
    """
    head, box = cut["head"], cut["box"]
    bw, bh = box["x1"] - box["x0"], box["y1"] - box["y0"]
    if bw <= 0 or bh <= 0:
        return None
    sx, sy = inst["w"] / bw, inst["h"] / bh
    rx, ry = head["w"] / 2 * sx, head["h"] / 2 * sy
    cx = (head["cx"] - box["x0"]) * sx
    cy = (head["top"] + head["h"] / 2 - box["y0"]) * sy
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    rho = np.sqrt(((xx - cx) / max(rx, 1)) ** 2 + ((yy - cy) / max(ry, 1)) ** 2)
    band = np.abs(rho - 1.0) * min(rx, ry) <= RING_HALF * sx
    for ex, ey, r in ears:
        band |= (xx - ex) ** 2 + (yy - ey) ** 2 <= r * r
    return band


def main():
    """--preview writes to qa-headwear4/preview/ instead of the installed art.

    Re-running on art this script has already repaired is safe: it fills what is
    still transparent, and after a clean pass that is nothing.
    """
    preview = "--preview" in sys.argv
    manifest = json.load(open(os.path.join(HERE, "installed-headwear4.json")))
    cuts = {c["i"]: c for c in json.load(open(os.path.join(HERE, "headwear4.json")))
            if c.get("ok")}
    os.makedirs(BACKUP, exist_ok=True)
    if preview:
        os.makedirs(PREVIEW, exist_ok=True)
    total = 0
    touched = []
    for m in manifest:
        stem = m["stem"]
        path = os.path.join(HATS, f"{stem}.png")
        if not os.path.exists(path):
            continue                      # retired from the catalogue since
        bak = os.path.join(BACKUP, f"{stem}.png")
        if not os.path.exists(bak):
            shutil.copyfile(path, bak)
        im = Image.open(path)
        radius = max(MIN_RADIUS, int(RADIUS_FRAC * max(im.size)))
        im.close()
        cut = cuts.get(m["idx"])
        ears = ear_zones(cut, m) if cut else []
        band = erase_band(cut, m, (m["h"], m["w"]), ears) if cut else None
        out = os.path.join(PREVIEW, f"{stem}.png") if preview else path
        n = repair(path, radius, ears, band, out)
        if n:
            total += n
            touched.append((stem, m["label"], n))
    touched.sort(key=lambda t: -t[2])
    print(f"{'previewed' if preview else 'repaired'} {len(touched)} hats, {total}px filled")
    for stem, label, n in touched[:14]:
        print(f"   {stem:8s} {label:18s} {n:6d}px")


if __name__ == "__main__":
    main()
