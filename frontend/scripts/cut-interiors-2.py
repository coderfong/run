"""Round 2 of worn-look art edits:
  - snapback (hat2): punch out the strap-hole so head/hair shows through
  - crown (hat7): cut the darker inner-wall visible between the spikes
  - leggings (bottom6) / bike shorts (bottom7): widen progressively toward
    the hem (they tapered too skinny at the ankle/leg opening)
  - hydration pack (acc1): split the blue shoulder-wing tops into a FRONT
    strap layer; the rest becomes the back layer behind the body
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

CH = r"C:\Users\user\Desktop\run\frontend\assets\character"

def load(p):
    return np.asarray(Image.open(p).convert("RGBA")).copy()

def save(a, p):
    Image.fromarray(a.astype(np.uint8), "RGBA").save(p, optimize=True)

def luma(a):
    return (a[..., :3].astype(float) / 255.0) @ [0.299, 0.587, 0.114]

def norm_grid(shape):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    return xx / w, yy / h

def cut(a, mask, sigma=1.4):
    soft = ndimage.gaussian_filter(mask.astype(float), sigma)
    a[..., 3] = (a[..., 3] * (1 - np.clip(soft, 0, 1))).astype(np.uint8)
    return a

# --- snapback hole (all 11 files, mask from master) --------------------------
m = load(os.path.join(CH, "headwear", "hat2.png"))
xf, yf = norm_grid(m.shape[:2])
arch = ((xf - 0.5) / 0.23) ** 2 + ((yf - 0.87) / 0.35) ** 2 <= 1.0
region = arch & (yf < 0.86)
mask = region & (luma(m) > 0.85) & (m[..., 3] > 32)
mask = ndimage.binary_closing(mask, structure=np.ones((5, 5)))
for suf in [""] + [f"_{i}" for i in range(10)]:
    p = os.path.join(CH, "headwear", f"hat2{suf}.png")
    save(cut(load(p), mask), p)
print("snapback hole cut", mask.sum(), "px")

# --- crown inner wall (single file) -----------------------------------------
p = os.path.join(CH, "headwear", "hat7.png")
a = load(p)
xf, yf = norm_grid(a.shape[:2])
l = luma(a)
rgb = a[..., :3].astype(float)
yellowish = (rgb[..., 1] - rgb[..., 2]) > 40
gaps = np.zeros_like(l, bool)
for cx, cy, rx, ry in [(0.19, 0.55, 0.07, 0.13), (0.385, 0.51, 0.08, 0.14),
                       (0.615, 0.51, 0.08, 0.14), (0.81, 0.55, 0.07, 0.13),
                       (0.055, 0.70, 0.05, 0.09), (0.945, 0.70, 0.05, 0.09)]:
    gaps |= ((xf - cx) / rx) ** 2 + ((yf - cy) / ry) ** 2 <= 1.0
mask = gaps & (l > 0.28) & (l < 0.68) & yellowish & (a[..., 3] > 32)
mask = ndimage.binary_closing(mask, structure=np.ones((4, 4)))
save(cut(a, mask), p)
print("crown inner wall cut", mask.sum(), "px")

# --- widen hems --------------------------------------------------------------
def widen(base, k, start, p_exp=1.3):
    for suf in [""] + [f"_{i}" for i in range(10)]:
        path = os.path.join(CH, "outfit", f"{base}{suf}.png")
        a = load(path)
        h, w = a.shape[:2]
        out = np.zeros_like(a)
        for y in range(h):
            t = max(0.0, (y / h - start) / (1 - start))
            s = 1 + k * (t ** p_exp)
            xs = (np.arange(w) - w / 2) / s + w / 2
            x0 = np.clip(np.floor(xs).astype(int), 0, w - 1)
            x1 = np.clip(x0 + 1, 0, w - 1)
            f = (xs - np.floor(xs))[:, None]
            out[y] = (a[y, x0] * (1 - f) + a[y, x1] * f).astype(np.uint8)
        save(out, path)
    print("widened", base)

widen("bottom6", k=0.22, start=0.35)
widen("bottom7", k=0.15, start=0.30)

# --- hydration pack front straps --------------------------------------------
p = os.path.join(CH, "accessory", "acc1.png")
a = load(p)
xf, yf = norm_grid(a.shape[:2])
strap = ((xf < 0.32) | (xf > 0.68)) & (yf < 0.28)
soft = np.clip(ndimage.gaussian_filter(strap.astype(float), 4), 0, 1)
front = a.copy()
front[..., 3] = (a[..., 3] * soft).astype(np.uint8)
back = a.copy()
back[..., 3] = (a[..., 3] * (1 - soft)).astype(np.uint8)
save(front, p)
save(back, os.path.join(CH, "accessory", "acc1b.png"))
print("hydropack split into straps + back")
print("done")
