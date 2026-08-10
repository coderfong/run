"""Concept-cluster the wave-3 harvest and drop anything the game already has.

The sheets are regenerations of the same prompt set, so pixel/ahash dedupe
(harvest-sheets-3.py) leaves hundreds of near-twins: same hat, slightly
different fold. Two passes fix that:

  1. cluster the harvest against ITSELF (cosine on a 32x32 alpha-composited
     grey vector + a coarse colour signature), keep the crispest member;
  2. compare every representative against the concept vectors of the EXISTING
     catalogue masters and drop the ones that are just another take on an
     item already in the game.

Outputs reps3.json + qa3/reps-<n>.png montages grouped by shape bucket.
"""
import json
import os
import numpy as np
from PIL import Image, ImageDraw

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRATCH, "out3", "items")
QA = os.path.join(SCRATCH, "qa3")
CH = r"C:\Users\user\Desktop\run\frontend\assets\character"

# Calibrated on the centred vectors: median off-diagonal similarity is 0.28
# and the 99th percentile 0.77, so 0.82 is comfortably inside the "same
# concept, different take" tail rather than merging unrelated items.
SELF_THR = 0.82
EXIST_THR = 0.80     # drop re-draws of items already in the game

files = sorted(os.listdir(OUT))


def vec(im, n=32):
    """Shape+colour concept vector: greyscale silhouette over white, plus a
    small colour signature so a red cape and a blue cape stay distinct.

    MEAN-CENTRED before normalising. Composited over white, every item is
    mostly background, so raw cosine sits near 1.0 for any two items and no
    threshold separates concepts — centring throws that shared baseline away
    and leaves the part that actually differs.
    """
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    flat = Image.alpha_composite(bg, im)
    g = np.asarray(flat.convert("L").resize((n, n), Image.LANCZOS), float) / 255.0
    a = np.asarray(im.split()[3].resize((n, n), Image.LANCZOS), float) / 255.0
    c = np.asarray(flat.convert("RGB").resize((6, 6), Image.LANCZOS), float) / 255.0
    v = np.concatenate([g.ravel() - g.mean(), (a.ravel() - a.mean()) * 1.5,
                        (c.ravel() - c.mean()) * 2.0])
    return v / (np.linalg.norm(v) + 1e-8)


def load(i):
    return Image.open(os.path.join(OUT, files[i])).convert("RGBA")


print(f"vectorising {len(files)} harvested items")
V = np.stack([vec(load(i)) for i in range(len(files))])
S = V @ V.T

# greedy clustering, largest-degree first so hubs become representatives
deg = (S > SELF_THR).sum(axis=1)
used = np.zeros(len(files), bool)
clusters = []
for i in np.argsort(-deg):
    if used[i]:
        continue
    members = np.append(np.flatnonzero((S[i] > SELF_THR) & (~used)), i)
    used[members] = True
    clusters.append([int(m) for m in members])
print(f"{len(clusters)} concept clusters from {len(files)} items")

# crispest member (most opaque pixels) represents its cluster
reps = []
for members in clusters:
    best, bestpx = members[0], -1
    for m in members:
        px = int((np.asarray(load(m))[..., 3] > 128).sum())
        if px > bestpx:
            best, bestpx = m, px
    reps.append(best)

# ---- pass 2: drop representatives that re-draw an existing catalogue item
E = []
for folder in ["headwear", "glasses", "outfit", "accessory", "hair", "face"]:
    d = os.path.join(CH, folder)
    if not os.path.isdir(d):
        continue
    for f in os.listdir(d):
        stem = os.path.splitext(f)[0]
        if "_" in stem and stem.rsplit("_", 1)[1].isdigit():
            continue
        im = Image.open(os.path.join(d, f)).convert("RGBA")
        a = np.asarray(im)
        ys, xs = np.where(a[..., 3] > 16)
        if len(ys) == 0:
            continue
        E.append(vec(Image.fromarray(a[ys.min():ys.max() + 1,
                                       xs.min():xs.max() + 1], "RGBA")))
E = np.stack(E)
sim_e = (np.stack([V[i] for i in reps]) @ E.T).max(axis=1)
fresh = [r for r, s in zip(reps, sim_e) if s < EXIST_THR]
print(f"{len(reps) - len(fresh)} representatives dropped as re-draws of "
      f"catalogue items; {len(fresh)} fresh concepts")

reps = fresh


def bucket(i):
    w, h = load(i).size
    ar = w / h
    if ar > 2.4:
        return 0          # glasses / bands / wide wings
    if ar > 1.35:
        return 1          # hats, wide accessories
    if ar > 0.85:
        return 2          # tops, jackets, square-ish
    return 3              # bottoms, tall items


reps.sort(key=lambda i: (bucket(i), -load(i).size[0] * load(i).size[1]))
json.dump(reps, open(os.path.join(SCRATCH, "reps3.json"), "w"))

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
