"""Contact sheets for the wave-4 headwear repair: before | after | what was filled.

Every tile is cropped to the piece's own bounds and drawn over a light grey so a
transparent notch reads as a hole rather than as white paint. The third tile
tints the pixels the repair turned opaque, which is the only reliable way to see
whether a fill stayed inside a bite or started welding a shape shut.

    python repair-qa-4.py            top 24 pieces by fill
    python repair-qa-4.py hat100 ... named pieces, in the order given
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
HATS = r"C:\Users\user\Desktop\run\frontend\assets\character\headwear"
BACKUP = os.path.join(HERE, "headwear4-prerepair")
OUT = os.path.join(HERE, "qa-headwear4")

CELL = 190
COLS = 4          # pieces per row; each piece is three tiles wide
PAD = 8
BG = (232, 232, 236)
LIT = (255, 64, 96)


def load(path):
    return np.asarray(Image.open(path).convert("RGBA")).astype(np.uint8)


def tile(arr, box, mark=None):
    im = Image.new("RGBA", (arr.shape[1], arr.shape[0]), BG + (255,))
    im.alpha_composite(Image.fromarray(arr, "RGBA"))
    if mark is not None and mark.any():
        ov = np.zeros(arr.shape, np.uint8)
        ov[mark] = LIT + (190,)
        im.alpha_composite(Image.fromarray(ov, "RGBA"))
    im = im.crop(box)
    im.thumbnail((CELL, CELL), Image.LANCZOS)
    out = Image.new("RGBA", (CELL, CELL), BG + (255,))
    out.paste(im, ((CELL - im.width) // 2, (CELL - im.height) // 2))
    return out


def main():
    manifest = json.load(open(os.path.join(HERE, "installed-headwear4.json")))
    labels = {m["stem"]: m["label"] for m in manifest}
    want = sys.argv[1:]
    stems = []
    for m in manifest:
        stem = m["stem"]
        if not os.path.exists(os.path.join(BACKUP, f"{stem}.png")):
            continue
        before, after = load(os.path.join(BACKUP, f"{stem}.png")), load(os.path.join(HATS, f"{stem}.png"))
        if before.shape != after.shape:
            continue
        filled = (after[..., 3] > 200) & (before[..., 3] <= 200)
        stems.append((stem, before, after, filled, int(filled.sum())))
    if want:
        order = {s: i for i, s in enumerate(want)}
        stems = sorted([s for s in stems if s[0] in order], key=lambda s: order[s[0]])
        name = "repair-picked.png"
    else:
        stems = sorted(stems, key=lambda s: -s[4])[:24]
        name = "repair-top.png"

    cols, rows = COLS * 3, -(-len(stems) // COLS)
    sheet = Image.new("RGBA", (cols * (CELL + PAD) + PAD, rows * (CELL + PAD + 16) + PAD), (255, 255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for i, (stem, before, after, filled, n) in enumerate(stems):
        ys, xs = np.where((before[..., 3] > 0) | (after[..., 3] > 0))
        pad = 6
        box = (max(xs.min() - pad, 0), max(ys.min() - pad, 0),
               min(xs.max() + pad, before.shape[1]), min(ys.max() + pad, before.shape[0]))
        r, c = divmod(i, COLS)
        y = PAD + r * (CELL + PAD + 16)
        for j, im in enumerate((tile(before, box), tile(after, box), tile(after, box, filled))):
            x = PAD + (c * 3 + j) * (CELL + PAD)
            sheet.paste(im, (x, y))
        d.text((PAD + c * 3 * (CELL + PAD), y + CELL + 3),
               f"{stem} {labels.get(stem, '')} - before | after | filled {n}px", fill=(20, 20, 20))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    sheet.convert("RGB").save(path, quality=94)
    print(path, sheet.size, len(stems), "pieces")


if __name__ == "__main__":
    main()
