"""Install the final UI panels: header-club, header-leaderboard, pro-hero.

pro-hero only exists inside a 3-panel composite, so it is cropped out by
finding the large dark-brown band (its baked background colour).
"""
import datetime
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"D:\downloads"
FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUT = datetime.datetime(2026, 7, 30, 16, 25)

files = sorted(
    [os.path.join(SRC, f) for f in os.listdir(SRC)
     if f.lower().endswith(".png")
     and datetime.datetime.fromtimestamp(os.path.getmtime(os.path.join(SRC, f))) > CUT],
    key=lambda p: os.path.getmtime(p))


def strip_white(im):
    im = im.convert("RGBA")
    a = np.asarray(im).astype(int)
    if a[..., 3].min() < 250:
        return im
    rgb = a[..., :3]
    lum = rgb @ [0.299, 0.587, 0.114]
    neutral = (rgb.max(axis=2) - rgb.min(axis=2)) <= 14
    bg = (lum >= 238) & neutral
    lab, n = ndimage.label(bg)
    ids = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    alpha = np.where(np.isin(lab, ids[ids != 0]), 0, 255).astype(np.uint8)
    alpha = ndimage.grey_erosion(alpha, size=(3, 3))
    return Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha]), "RGBA")


def trim(im):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 16)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)) if len(ys) else im


def fit_cutout(im, size):
    im = trim(strip_white(im))
    im.thumbnail(size, Image.LANCZOS)
    return im


# --- header-club (index 6) and header-leaderboard (index 2) -----------------
for idx, dest, size in [
    (6, "assets/art/ui/header-club.png", (640, 500)),
    (2, "assets/art/ui/header-leaderboard.png", (640, 500)),
]:
    out = os.path.join(FE, dest.replace("/", os.sep))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im = fit_cutout(Image.open(files[idx]), size)
    im.save(out, optimize=True)
    print(f"{dest:42s} {im.size}")

# --- pro-hero: crop the dark-brown band out of composite index 3 ------------
comp = Image.open(files[3]).convert("RGB")
a = np.asarray(comp).astype(int)
# its background is a deep warm brown (~#2A1B06): dark, red-dominant
dark_brown = (a[..., 0] > a[..., 2] + 12) & (a @ [0.299, 0.587, 0.114] < 90)
rowfrac = dark_brown.mean(axis=1)
rows = np.flatnonzero(rowfrac > 0.5)
y0, y1 = int(rows.min()), int(rows.max()) + 1
colfrac = dark_brown[y0:y1].mean(axis=0)
cols = np.flatnonzero(colfrac > 0.5)
x0, x1 = int(cols.min()), int(cols.max()) + 1
panel = comp.crop((x0, y0, x1, y1))
print(f"pro-hero panel found at {(x0, y0, x1, y1)} -> {panel.size}")

tw, th = 1536, 1152
sw, sh = panel.size
s = max(tw / sw, th / sh)
panel = panel.resize((round(sw * s), round(sh * s)), Image.LANCZOS)
l, t = (panel.width - tw) // 2, (panel.height - th) // 2
panel = panel.crop((l, t, l + tw, t + th))
out = os.path.join(FE, "assets", "art", "onboarding", "pro-hero.png")
panel.save(out, optimize=True)
print(f"{'assets/art/onboarding/pro-hero.png':42s} {panel.size}")
