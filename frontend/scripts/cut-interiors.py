"""Remove garment/hat interior regions so items read as worn, not product shots.

Two mechanisms:
  1. Beanies: the far-side bottom rim (the center dip below the side edges)
     splits into a back layer rendered behind the head — same trick as the
     sweatband band.
  2. Garments: the interior visible through the neck/strap opening (singlet
     back panel, polo inner collar, windbreaker hood lining, tee necklines,
     vest back mesh) is masked to transparent so the neck/chest/shirt shows
     through. The mask is computed ONCE on the master art (geometry region +
     darkness test) and the identical pixel mask is applied to every color
     variant — variant geometry is identical.
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

CH = r"C:\Users\user\Desktop\run\frontend\assets\character"
FEATHER = 5

# ---- 1. beanie far-rim splits (same mechanism as split_layers.py) ----------

def split(path, back_path, seam_frac, back_is="below"):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).copy()
    h = a.shape[0]
    seam = int(h * seam_frac)
    yy = np.arange(h)
    ramp = np.clip((seam + FEATHER / 2 - yy) / FEATHER, 0, 1)  # 1 above seam
    if back_is == "below":
        ramp = 1 - ramp
    back = a.copy()
    back[..., 3] = (a[..., 3] * ramp[:, None]).astype(np.uint8)
    front = a.copy()
    front[..., 3] = (a[..., 3] * (1 - ramp[:, None])).astype(np.uint8)
    Image.fromarray(back, "RGBA").save(back_path, optimize=True)
    Image.fromarray(front, "RGBA").save(path, optimize=True)

for base, seam in [("hat3", 0.85), ("hat4", 0.90)]:
    for suf in [""] + [f"_{i}" for i in range(10)]:
        p = os.path.join(CH, "headwear", f"{base}{suf}.png")
        bp = os.path.join(CH, "headwear", f"{base}b{suf}.png" if not suf
                          else f"{base}b{suf}.png")
        split(p, bp, seam)
    print("split", base)

# ---- 2. interior masks ------------------------------------------------------

def luma_sat(arr):
    rgb = arr[..., :3].astype(float) / 255.0
    lum = rgb @ [0.299, 0.587, 0.114]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 0.05, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return lum, sat

def ellipse_region(shape, cx, cy, rx, ry):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    return ((xx / w - cx) / rx) ** 2 + ((yy / h - cy) / ry) ** 2 <= 1.0

# (folder, base, n_variants, region_fn, cond_fn) — cond runs on the MASTER.
SPECS = [
    ("outfit", "top12", 10,
     lambda s: ellipse_region(s, 0.50, 0.02, 0.30, 0.42),
     lambda l, s: (l < 0.30) & (s < 0.35)),
    ("outfit", "top13", 10,
     lambda s: ellipse_region(s, 0.50, 0.02, 0.155, 0.15),
     lambda l, s: (l > 0.12) & (l < 0.80)),
    ("outfit", "top14", 10,
     lambda s: ellipse_region(s, 0.50, 0.03, 0.17, 0.17),
     lambda l, s: l < 0.25),
    ("outfit", "top15", 10,
     lambda s: ellipse_region(s, 0.50, 0.00, 0.20, 0.14),
     lambda l, s: l < 0.62),
    ("outfit", "top17", 10,
     lambda s: ellipse_region(s, 0.50, 0.00, 0.18, 0.11),
     lambda l, s: (l > 0.25) & (l < 0.88)),
]

def vest_region(shape):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    xf, yf = xx / w, yy / h
    reg = (xf > 0.32) & (xf < 0.68) & (yf > 0.04) & (yf < 0.95)
    keep = ((yf > 0.42) & (yf < 0.56)) | ((yf > 0.74) & (yf < 0.92))
    return reg & ~keep

SPECS.append(("accessory", "acc2", 0, vest_region, lambda l, s: l < 0.50))

for folder, base, nvar, region_fn, cond_fn in SPECS:
    master = os.path.join(CH, folder, f"{base}.png")
    arr = np.asarray(Image.open(master).convert("RGBA"))
    lum, sat = luma_sat(arr)
    mask = region_fn(arr.shape[:2]) & cond_fn(lum, sat) & (arr[..., 3] > 32)
    # close small gaps (mesh dots, texture), then feather
    mask = ndimage.binary_closing(mask, structure=np.ones((5, 5)))
    soft = ndimage.gaussian_filter(mask.astype(float), 1.2)
    for suf in [""] + [f"_{i}" for i in range(nvar)]:
        p = os.path.join(CH, folder, f"{base}{suf}.png")
        a = np.asarray(Image.open(p).convert("RGBA")).copy()
        a[..., 3] = (a[..., 3] * (1 - np.clip(soft, 0, 1))).astype(np.uint8)
        Image.fromarray(a, "RGBA").save(p, optimize=True)
    print("interior cut", base, f"({mask.sum()} px)")

print("done")
