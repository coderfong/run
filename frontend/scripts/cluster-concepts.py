"""Cluster harvested items by concept, pick one representative each, and
montage representatives grouped by shape bucket so classification is fast."""
import json
import os
import numpy as np
from PIL import Image, ImageDraw

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRATCH, "out", "items")
QA = os.path.join(SCRATCH, "qa")

files = sorted(os.listdir(OUT))
S = np.load(os.path.join(SCRATCH, "sim.npy"))
THR = 0.82

# greedy clustering, largest-degree first so hubs become representatives
deg = (S > THR).sum(axis=1)
order = np.argsort(-deg)
used = np.zeros(len(files), bool)
clusters = []
for i in order:
    if used[i]:
        continue
    members = np.flatnonzero((S[i] > THR) & (~used))
    members = np.append(members, i)
    used[members] = True
    clusters.append((int(i), [int(m) for m in members]))
print(f"{len(clusters)} concept clusters from {len(files)} items")


def load(i):
    return Image.open(os.path.join(OUT, files[i])).convert("RGBA")


# pick the crispest member (most opaque pixels) as representative
reps = []
for _, members in clusters:
    best, bestpx = members[0], -1
    for m in members:
        im = load(m)
        px = int((np.asarray(im)[..., 3] > 128).sum())
        if px > bestpx:
            best, bestpx = m, px
    reps.append(best)

# shape buckets so like-with-like appears together
def bucket(i):
    im = load(i)
    w, h = im.size
    ar = w / h
    if ar > 2.4:
        return 0          # glasses / bands / wings-ish wide
    if ar > 1.35:
        return 1          # hats, wide accessories
    if ar > 0.85:
        return 2          # tops, jackets, square-ish
    return 3              # bottoms, tall items

reps.sort(key=lambda i: (bucket(i), -load(i).size[0] * load(i).size[1]))
json.dump(reps, open(os.path.join(SCRATCH, "reps.json"), "w"))

per, cols, cell = 48, 8, 250
n_m = (len(reps) + per - 1) // per
for m in range(n_m):
    chunk = reps[m * per:(m + 1) * per]
    rows = (len(chunk) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), (38, 40, 46))
    d = ImageDraw.Draw(sheet)
    for k, i in enumerate(chunk):
        im = load(i)
        im.thumbnail((cell - 26, cell - 42), Image.LANCZOS)
        x = (k % cols) * cell + (cell - im.width) // 2
        y = (k // cols) * cell + (cell - 22 - im.height) // 2 + 18
        sheet.paste(im, (x, y), im)
        d.text(((k % cols) * cell + 6, (k // cols) * cell + 4), str(i),
               fill=(255, 210, 90))
    sheet.save(os.path.join(QA, f"reps-{m}.png"))
print(f"{len(reps)} representatives -> {n_m} montages")
