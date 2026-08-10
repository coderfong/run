"""Cut the wave-5 outfit sheets into single garments.

Source: three 1024x1536 RGBA sheets in D:\\downloads (ChatGPT Image Aug 7,
2026, 07_40_*.png), each a 3x4 grid of clothing drawn in the body's own flat
line-art style. Unlike every earlier wave these arrive already cut out — the
background is real transparency, not white — so there is nothing to key and no
head to lift the piece off. The whole job is splitting the grid.

Splitting is by connected component rather than by slicing the sheet into
twelve equal boxes: the garments are not on a strict pitch (a wide jacket
crowds its neighbour, a skirt sits high in its cell), so fixed boxes clip
sleeves. Components are then sorted into rows by their centroid.

Writes trimmed PNGs + a measurement json to scripts/out5/.
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"D:\downloads"
SHEETS = [
    "ChatGPT Image Aug 7, 2026, 07_40_31 PM.png",
    "ChatGPT Image Aug 7, 2026, 07_40_37 PM.png",
    "ChatGPT Image Aug 7, 2026, 07_40_41 PM.png",
]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out5")

COLS, ROWS = 3, 4
MIN_AREA = 4000          # anything smaller is a stray speck, not a garment


def split(path):
    a = np.asarray(Image.open(path).convert("RGBA")).copy()
    solid = a[..., 3] > 24
    # close first: a drawstring or a dangling toggle is drawn a pixel or two
    # clear of the garment and would otherwise fall out as its own "item".
    joined = ndimage.binary_closing(solid, np.ones((9, 9)))
    lab, n = ndimage.label(joined)
    pieces = []
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() < MIN_AREA:
            continue
        ys, xs = np.where(comp)
        pieces.append(dict(
            y0=int(ys.min()), y1=int(ys.max()) + 1,
            x0=int(xs.min()), x1=int(xs.max()) + 1,
            cy=float(ys.mean()), cx=float(xs.mean()),
        ))
    # row-major: band by centroid y, then left to right inside each band
    pieces.sort(key=lambda p: p["cy"])
    ordered = []
    for r in range(0, len(pieces), COLS):
        ordered += sorted(pieces[r:r + COLS], key=lambda p: p["cx"])
    return a, ordered


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = []
    for si, name in enumerate(SHEETS):
        a, pieces = split(os.path.join(SRC, name))
        print(f"sheet {si}: {len(pieces)} pieces (expected {COLS * ROWS})")
        for pi, p in enumerate(pieces):
            crop = a[p["y0"]:p["y1"], p["x0"]:p["x1"]]
            stem = f"{si}-{pi:02d}"
            Image.fromarray(crop, "RGBA").save(os.path.join(OUT, f"{stem}.png"),
                                               optimize=True)
            meta.append(dict(sheet=si, idx=pi, key=stem,
                             w=int(p["x1"] - p["x0"]), h=int(p["y1"] - p["y0"]),
                             row=pi // COLS, col=pi % COLS))
            print(f"   {stem}  {p['x1'] - p['x0']:4d}x{p['y1'] - p['y0']:4d}"
                  f"  row {pi // COLS} col {pi % COLS}")
    json.dump(meta, open(os.path.join(HERE, "outfit5.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
