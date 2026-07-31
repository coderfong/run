"""Slice the battle-pass UI kit sheet into individual transparent assets.

The sheet sits on a dark gradient with coloured glow, so colour keying fails.
Items are high-local-variance (hard ink outlines, facets); the background and
its glow are smooth. Local variance separates them cleanly.
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"D:\downloads\ChatGPT Image Jul 29, 2026, 05_47_41 PM.png"
OUT = r"C:\Users\user\Desktop\run\frontend\assets\art\pass"
QA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qa")
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC).convert("RGB")
a = np.asarray(im).astype(np.float32) / 255.0
gray = a @ [0.299, 0.587, 0.114]

# local variance
mean = ndimage.uniform_filter(gray, 9)
sq = ndimage.uniform_filter(gray * gray, 9)
var = np.clip(sq - mean * mean, 0, None)
mask = var > 0.0016

mask = ndimage.binary_closing(mask, structure=np.ones((9, 9)))
mask = ndimage.binary_fill_holes(mask)
mask = ndimage.binary_opening(mask, structure=np.ones((5, 5)))

lab, n = ndimage.label(mask)
boxes = []
for i, sl in enumerate(ndimage.find_objects(lab), start=1):
    ys, xs = sl
    h, w = ys.stop - ys.start, xs.stop - xs.start
    if h * w < 6000 or h < 40 or w < 40:
        continue
    boxes.append((xs.start, ys.start, xs.stop, ys.stop, i))

# reading order: rows then columns
boxes.sort(key=lambda b: (round(b[1] / 120), b[0]))
print(f"{len(boxes)} components")

NAMES = [
    "diamond-locked", "diamond-reached", "diamond-current", "diamond-pro",
    "btn-claim", "btn-claim-pressed", "btn-pro",
    "chip-locked", "chip-locked-pro", "chip-claimed", "_dup-check",
    "lane-free", "lane-pro", "tile-free", "tile-pro",
    "crest-pro",
]

rgba = np.dstack([np.asarray(im).astype(np.uint8),
                  np.zeros(gray.shape, np.uint8)])
for k, (x0, y0, x1, y1, lid) in enumerate(boxes):
    if k >= len(NAMES):
        print("extra component at", (x0, y0, x1, y1))
        continue
    name = NAMES[k]
    comp = (lab[y0:y1, x0:x1] == lid)
    # feather 1px so the ink edge doesn't alias hard
    soft = np.clip(ndimage.gaussian_filter(comp.astype(np.float32), 0.6), 0, 1)
    sub = rgba[y0:y1, x0:x1].copy()
    sub[..., 3] = (soft * 255).astype(np.uint8)
    if name.startswith("_"):
        continue
    Image.fromarray(sub, "RGBA").save(os.path.join(OUT, name + ".png"),
                                      optimize=True)
    print(f"  {name:20s} {x1-x0}x{y1-y0}")

# QA contact sheet on a mid grey so alpha edges show
items = sorted(os.listdir(OUT))
cols, cell = 5, 260
rows = (len(items) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell, rows * cell), (120, 122, 128))
for i, f in enumerate(items):
    t = Image.open(os.path.join(OUT, f)).convert("RGBA")
    t.thumbnail((cell - 30, cell - 30), Image.LANCZOS)
    x = (i % cols) * cell + (cell - t.width) // 2
    y = (i // cols) * cell + (cell - t.height) // 2
    sheet.paste(t, (x, y), t)
sheet.save(os.path.join(QA, "pass-ui.png"))
print("wrote qa/pass-ui.png")
