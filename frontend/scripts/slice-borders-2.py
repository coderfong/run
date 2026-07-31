"""Install the regenerated (thin) border rings + the text-free lane plates.

Each border source holds TWO rings stacked vertically, so they're split by the
horizontal gap between them rather than assumed to be at fixed offsets.

Re-measures every ring's inner hole and rewrites src/config/borderArt.js. The
target is hole >= 0.78 — the old set measured 0.49-0.65, which is what made the
frames read as thick and the portrait as small.

Run from frontend/:  python scripts/slice-borders-2.py
"""

import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"D:\downloads"
FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(FE, "assets", "borders")
os.makedirs(OUT, exist_ok=True)

# (filename suffix, [top key, bottom key]) in the order they were generated
PAIRS = [
    ("(1).png", ["wood", "bronze"]),
    ("(2).png", ["silver", "gold"]),
    ("(3).png", ["platinum", "diamond"]),
    ("(4).png", ["onyx", "ember"]),
    ("(5).png", ["prismatic", "mythic"]),
]
LANES = [("(6).png", "lane-free"), ("(7).png", "lane-pro")]
KEYS = ["wood", "bronze", "silver", "gold", "platinum",
        "diamond", "onyx", "ember", "prismatic", "mythic"]


def newest(suffix):
    cands = [os.path.join(SRC, f) for f in os.listdir(SRC) if f.endswith(suffix)]
    return max(cands, key=os.path.getmtime)


def alpha_from_white(im):
    """These arrive opaque on white; border-connected white becomes the
    background, enclosed white (the ring's own opening) is handled later."""
    im = im.convert("RGBA")
    a = np.asarray(im).astype(int)
    if a[..., 3].min() < 250:
        return np.asarray(im).copy()
    rgb = a[..., :3]
    lum = rgb @ [0.299, 0.587, 0.114]
    neutral = (rgb.max(axis=2) - rgb.min(axis=2)) <= 16
    white = (lum >= 238) & neutral
    lab, _ = ndimage.label(white)
    ids = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    outside = np.isin(lab, ids[ids != 0])
    alpha = np.where(outside, 0, 255).astype(np.uint8)
    alpha = ndimage.grey_erosion(alpha, size=(3, 3))
    return np.dstack([rgb.astype(np.uint8), alpha])


def split_rows(arr, n):
    """Split into n vertical bands on the gaps between opaque row-runs."""
    rows = (arr[..., 3] > 40).sum(axis=1)
    solid = rows > 3
    runs, cur = [], None
    for i, v in enumerate(solid):
        if v and cur is None:
            cur = i
        elif not v and cur is not None:
            runs.append((cur, i)); cur = None
    if cur is not None:
        runs.append((cur, len(solid)))
    runs = [r for r in runs if rows[r[0]:r[1]].sum() > 2000]
    while len(runs) > n:                       # merge the closest pair
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        j = int(np.argmin(gaps))
        runs[j] = (runs[j][0], runs[j + 1][1]); del runs[j + 1]
    return [arr[a:b] for a, b in runs]


def carve_hole(sub):
    """Enclosed white inside the ring becomes the opening; small specks stay."""
    h, w = sub.shape[:2]
    rgb = sub[..., :3].astype(int)
    lum = rgb @ [0.299, 0.587, 0.114]
    neutral = (rgb.max(axis=2) - rgb.min(axis=2)) <= 16
    white = (lum >= 234) & neutral
    lab, n = ndimage.label(white)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    out = sub.copy()
    hole = np.zeros((h, w), bool)
    for i in range(1, n + 1):
        if i in edge:
            continue
        blob = lab == i
        if blob.sum() > 0.04 * h * w:
            hole |= blob
    out[..., 3] = np.where(hole, 0, out[..., 3])
    return out, hole


def square(arr, size):
    m = arr[..., 3] > 16
    ys, xs = np.where(m)
    arr = arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    h, w = arr.shape[:2]
    s = max(h, w)
    canvas = np.zeros((s, s, 4), np.uint8)
    canvas[(s - h) // 2:(s - h) // 2 + h, (s - w) // 2:(s - w) // 2 + w] = arr
    im = Image.fromarray(canvas, "RGBA").resize((size, size), Image.LANCZOS)
    return im


ratios = {}
for suffix, keys in PAIRS:
    arr = alpha_from_white(Image.open(newest(suffix)))
    bands = split_rows(arr, len(keys))
    if len(bands) != len(keys):
        print(f"!! {suffix}: expected {len(keys)} rings, found {len(bands)}")
        continue
    for key, band in zip(keys, bands):
        carved, hole = carve_hole(band)
        im = square(carved, 1024)
        im.save(os.path.join(OUT, f"{key}.png"), optimize=True)
        a = np.asarray(im)
        holes, hn = ndimage.label(a[..., 3] == 0)
        cid = holes[512, 512]
        if cid == 0:
            ratio = 0.78
        else:
            hy, hx = np.where(holes == cid)
            ratio = min(hx.max() - hx.min(), hy.max() - hy.min()) / 1024
        ratios[key] = round(float(ratio), 4)
        flag = "" if ratio >= 0.78 else "   <-- still thick"
        print(f"  {key:11s} hole {ratio:.3f}{flag}")

for suffix, name in LANES:
    arr = alpha_from_white(Image.open(newest(suffix)))
    m = arr[..., 3] > 16
    ys, xs = np.where(m)
    sub = arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    im = Image.fromarray(sub, "RGBA")
    im.thumbnail((1024, 256), Image.LANCZOS)
    im.save(os.path.join(FE, "assets", "art", "pass", f"{name}.png"), optimize=True)
    print(f"  {name:11s} {im.size}")

cfg = os.path.join(FE, "src", "config", "borderArt.js")
with open(cfg, "w", encoding="utf-8", newline="\n") as f:
    f.write(
        "// GENERATED by scripts/slice-borders-2.py — do not hand-edit.\n"
        "// Ring art per tier + the measured HOLE RATIO: the inner opening as a\n"
        "// fraction of the square art. PortraitBorder scales by 1/hole so the\n"
        "// portrait fills the opening exactly at any frame thickness.\n\n"
        "export const BORDER_ART = {\n")
    for key in KEYS:
        if key in ratios:
            f.write(f"  {key}: {{ src: require('../../assets/borders/{key}.png'), "
                    f"hole: {ratios[key]} }},\n")
    f.write("};\n\nexport default BORDER_ART;\n")
print(f"\nwrote borderArt.js ({len(ratios)} tiers)")
