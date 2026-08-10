"""Cut, dedupe and classify the wave-6 wardrobe (C:\\Users\\user\\Desktop\\bottom).

230 files, one garment per file, already on transparency. Two things have to be
worked out rather than assumed:

  SLOT      the folder is bottoms AND shoes mixed together. Canvas orientation
            separates them cleanly: a garment is drawn on the 1024x1536
            portrait canvas, a pair of shoes on the 1536x1024 landscape one.

  FAMILY    what KIND of bottom, because that is what sets the placement.
            The tell is the crotch: shorts and trousers are drawn with a gap
            between the legs, so the bottom-centre of the art is transparent;
            a skirt's hem is solid all the way across. Height over width then
            splits shorts from trousers. Nothing here is eyeballed per item —
            230 pieces is far too many to hand-classify, and a rule that can be
            re-run survives the next batch.

Several sheets were exported twice (and one file is a contact sheet of the
whole set, not a garment). Duplicates are dropped by content hash, and anything
holding more than a handful of separate ink blobs is not one garment.

Writes trimmed PNGs + a classification json to scripts/out6/.
"""
import hashlib
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"C:\Users\user\Desktop\bottom"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out6")
MAX_DIM = 420

# Colour naming — the catalogue wants a colourway per piece and 200 of them
# cannot be typed by hand. Nearest of these in RGB to the garment's dominant
# opaque colour, ignoring the black outline.
COLOURS = [
    ("Black", (34, 34, 38)), ("Charcoal", (74, 78, 84)), ("Grey", (150, 154, 160)),
    ("White", (242, 242, 240)), ("Cream", (238, 228, 200)), ("Sand", (214, 186, 138)),
    ("Tan", (186, 146, 100)), ("Brown", (120, 82, 52)), ("Maroon", (128, 36, 48)),
    ("Red", (214, 52, 46)), ("Coral", (240, 128, 112)), ("Orange", (238, 126, 34)),
    ("Yellow", (240, 200, 48)), ("Olive", (124, 132, 70)), ("Green", (68, 140, 84)),
    ("Mint", (168, 220, 190)), ("Teal", (44, 140, 140)), ("Sky", (150, 196, 232)),
    ("Blue", (52, 104, 186)), ("Navy", (38, 52, 92)), ("Lilac", (196, 176, 230)),
    ("Purple", (126, 74, 178)), ("Pink", (238, 150, 180)), ("Blush", (242, 196, 196)),
]


def colour_name(a):
    m = a[..., 3] > 200
    rgb = a[..., :3][m].astype(int)
    if not len(rgb):
        return "Grey"
    # Drop the ink outline AND the big white highlight this style paints down
    # the front of every garment — leaving it in made two thirds of the
    # wardrobe "White". Only fall back to the light pixels when nothing else
    # is left, which is how a genuinely white piece still gets named.
    body = rgb[(rgb.mean(1) > 55) & (rgb.mean(1) < 232)]
    if len(body) > 60:
        rgb = body
    else:
        keep = rgb.mean(1) > 55
        if keep.sum() > 40:
            rgb = rgb[keep]
    # the modal colour, not the mean: a mean smears a two-tone piece into mud
    q = (rgb // 24) * 24
    keys, counts = np.unique(q, axis=0, return_counts=True)
    dom = keys[counts.argmax()] + 12
    d = [(float(np.abs(dom - np.array(c)).sum()), n) for n, c in COLOURS]
    return min(d)[1]


def row_gap(m, ys, xs, frac):
    """Widest hole across the garment at `frac` of the way down, 0..1 of width."""
    y = min(ys.max(), ys.min() + int((ys.max() - ys.min()) * frac))
    on = np.where(m[y])[0]
    if len(on) < 2:
        return 0.0
    d = np.diff(on)
    return float((d.max() - 1) / max(1, xs.max() - xs.min() + 1)) if d.size else 0.0


def has_legs(m):
    """True when the piece splits into two legs somewhere down its length.

    Sampling a band of the bottom rows and asking "is the middle empty?" does
    not work on this art: the crotch is a shallow V, so at the very hem the
    middle third is still mostly opaque and every pair of shorts read as a
    skirt. Counting horizontal RUNS per row is the real test — a skirt is one
    run all the way down, legs are two.
    """
    ys, xs = np.where(m)
    h = ys.max() - ys.min() + 1
    w = xs.max() - xs.min() + 1
    lo = ys.min() + int(h * 0.45)
    min_gap = max(4, int(w * 0.08))       # a crotch is wide; a pleat notch is not
    split = 0
    for y in range(lo, ys.max() + 1):
        on = np.where(m[y])[0]
        if len(on) < 2:
            continue
        # widest hole between opaque pixels on this row
        d = np.diff(on)
        if d.size and d.max() - 1 >= min_gap:
            split += 1
    # A pleated skirt has a zigzag hem, which splits a few rows near the very
    # bottom. Legs split a long stretch of the piece, so require depth too.
    return split >= max(6, int(h * 0.10))


def classify(a):
    """shorts | trousers | skirt, from the shape of the art itself.

    Length splits trousers from everything short. Skirt vs shorts is decided
    THREE QUARTERS of the way down, where a skirt is still one solid sweep of
    cloth and a pair of shorts has separated into two legs. Reading the gap at
    the hem instead does not work: a pleated skirt's zigzag hem breaks into
    runs and reads exactly like a crotch.
    """
    m = a[..., 3] > 40
    ys, xs = np.where(m)
    h = ys.max() - ys.min() + 1
    w = xs.max() - xs.min() + 1
    ratio = h / w
    solid = row_gap(m, ys, xs, 0.74) < 0.04
    if solid and ratio < 1.30:
        return "skirt", ratio
    if ratio < 1.18:
        return "shorts", ratio
    return "trousers", ratio


def main():
    os.makedirs(OUT, exist_ok=True)
    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith(".png"))
    seen = {}
    rows = []
    skipped = []
    for f in files:
        im = Image.open(os.path.join(SRC, f)).convert("RGBA")
        slot = "bottom" if im.height > im.width else "footwear"
        a = np.asarray(im).copy()
        box = Image.fromarray(a, "RGBA").getbbox()
        if box is None:
            skipped.append((f, "empty"))
            continue
        a = a[box[1]:box[3], box[0]:box[2]]

        # a contact sheet of the whole wardrobe is not a garment
        lab, n = ndimage.label(ndimage.binary_closing(a[..., 3] > 40, np.ones((9, 9))))
        if n:
            sizes = ndimage.sum(a[..., 3] > 40, lab, range(1, n + 1))
            big = int((sizes > 0.02 * sizes.max()).sum())
            if big > (4 if slot == "footwear" else 3):
                skipped.append((f, f"{big} separate blobs"))
                continue

        digest = hashlib.md5(a.tobytes()).hexdigest()
        if digest in seen:
            skipped.append((f, f"duplicate of {seen[digest]}"))
            continue
        seen[digest] = f

        fam, ratio = classify(a) if slot == "bottom" else ("shoes", a.shape[0] / a.shape[1])
        im2 = Image.fromarray(a, "RGBA")
        if max(im2.size) > MAX_DIM:
            s = MAX_DIM / max(im2.size)
            im2 = im2.resize((max(1, round(im2.width * s)), max(1, round(im2.height * s))),
                             Image.LANCZOS)
        key = f"{slot[0]}{len([r for r in rows if r['slot'] == slot]):03d}"
        im2.save(os.path.join(OUT, f"{key}.png"), optimize=True)
        rows.append(dict(key=key, src=f, slot=slot, family=fam,
                         colour=colour_name(a), ratio=round(float(ratio), 3),
                         w=im2.width, h=im2.height))

    json.dump(rows, open(os.path.join(HERE, "wardrobe6.json"), "w"), indent=1)
    from collections import Counter
    print(f"{len(files)} files -> {len(rows)} pieces, {len(skipped)} skipped")
    print("  by slot  :", dict(Counter(r["slot"] for r in rows)))
    print("  by family:", dict(Counter(r["family"] for r in rows)))
    print("  colours  :", dict(Counter(r["colour"] for r in rows).most_common()))
    for f, why in skipped[:8]:
        print(f"   skip {f[-18:]}: {why}")
    if len(skipped) > 8:
        print(f"   ... and {len(skipped) - 8} more")


if __name__ == "__main__":
    main()
