"""Install the second UI art batch (lane plates, stage, badges, burst, banner).

Run from frontend/:  python scripts/install-ui-art-2.py
"""
import datetime
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"D:\downloads"
FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUT = datetime.datetime(2026, 7, 29, 17, 50)

files = sorted(
    [os.path.join(SRC, f) for f in os.listdir(SRC)
     if f.lower().endswith(".png")
     and datetime.datetime.fromtimestamp(os.path.getmtime(os.path.join(SRC, f))) > CUT],
    key=lambda p: os.path.getmtime(p))

# index (in mtime order) -> (dest, mode, size)
JOBS = {
    0: ("assets/art/ui/profile-banner.png",  "panel",  (1400, 600)),
    1: ("assets/art/ui/burst-rays.png",      "cutout", (800, 800)),
    2: ("assets/art/ui/badge-1st.png",       "cutout", (320, 320)),
    3: ("assets/art/ui/badge-2nd.png",       "cutout", (320, 320)),
    4: ("assets/art/ui/badge-3rd.png",       "cutout", (320, 320)),
    5: ("assets/art/pass/lane-free.png",     "cutout", (512, 192)),
    6: ("assets/art/pass/lane-pro.png",      "cutout", (512, 192)),
    7: ("assets/art/onboarding/stage.png",   "panel",  (1170, 1400)),
}


def strip_white(im):
    im = im.convert("RGBA")
    a = np.asarray(im).astype(int)
    if a[..., 3].min() < 250:
        return im                     # already has real alpha
    rgb = a[..., :3]
    lum = rgb @ [0.299, 0.587, 0.114]
    neutral = (rgb.max(axis=2) - rgb.min(axis=2)) <= 14
    bg = (lum >= 238) & neutral
    lab, n = ndimage.label(bg)
    ids = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    ids = ids[ids != 0]
    alpha = np.where(np.isin(lab, ids), 0, 255).astype(np.uint8)
    alpha = ndimage.grey_erosion(alpha, size=(3, 3))
    return Image.fromarray(np.dstack([rgb.astype(np.uint8), alpha]), "RGBA")


def trim(im):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 16)
    if len(ys) == 0:
        return im
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


for idx, (dest, mode, size) in JOBS.items():
    im = Image.open(files[idx])
    out = os.path.join(FE, dest.replace("/", os.sep))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if mode == "panel":
        im = im.convert("RGB")
        tw, th = size
        sw, sh = im.size
        s = max(tw / sw, th / sh)
        im = im.resize((round(sw * s), round(sh * s)), Image.LANCZOS)
        l, t = (im.width - tw) // 2, (im.height - th) // 2
        im = im.crop((l, t, l + tw, t + th))
    else:
        im = trim(strip_white(im))
        im.thumbnail(size, Image.LANCZOS)
    im.save(out, optimize=True)
    print(f"{dest:42s} {im.size}")

print(f"\n{len(JOBS)} assets installed")
