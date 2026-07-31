"""Install the generated UI / story art into the app at its exact paths."""
import datetime
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"D:\downloads"
FE = r"C:\Users\user\Desktop\run\frontend"
CUT = datetime.datetime(2026, 7, 29, 3, 5)

files = sorted(
    [os.path.join(SRC, f) for f in os.listdir(SRC)
     if f.lower().endswith(".png")
     and datetime.datetime.fromtimestamp(os.path.getmtime(os.path.join(SRC, f))) > CUT],
    key=lambda p: os.path.getmtime(p))

# idx -> (dest relative to frontend/, mode, target size)
#   mode 'panel'  = opaque, keep background, fit to size
#   mode 'cutout' = strip white background, trim, fit inside size
JOBS = {
    5:  ("assets/art/onboarding/thumb-name.png",      "panel",  (520, 520)),
    6:  ("assets/art/onboarding/thumb-birthday.png",  "panel",  (520, 520)),
    7:  ("assets/art/onboarding/thumb-ready.png",     "panel",  (520, 520)),
    8:  ("assets/art/onboarding/energy.png",          "panel",  (1536, 1152)),
    9:  ("assets/art/onboarding/pasers.png",          "panel",  (1536, 1152)),
    10: ("assets/art/onboarding/rewards.png",         "panel",  (1536, 1152)),
    11: ("assets/art/onboarding/leaderboard.png",     "panel",  (1536, 1152)),
    12: ("assets/art/ui/paper-grain.png",             "grain",  (512, 512)),
    14: ("assets/art/ui/header-pasers.png",           "cutout", (640, 500)),
    15: ("assets/icons/lootbox-common.png",           "cutout", (512, 512)),
    17: ("assets/icons/lootbox-rare.png",             "cutout", (512, 512)),
    18: ("assets/icons/lootbox-epic.png",             "cutout", (512, 512)),
    19: ("assets/icons/lootbox-legendary.png",        "cutout", (512, 512)),
    20: ("assets/art/ui/rail-pass.png",               "cutout", (256, 256)),
    21: ("assets/art/ui/rail-boxes.png",              "cutout", (256, 256)),
    22: ("assets/art/ui/rail-shop.png",               "cutout", (256, 256)),
    23: ("assets/art/ui/rail-season.png",             "cutout", (256, 256)),
    24: ("assets/art/ui/pass-banner.png",             "panel",  (1536, 640)),
    25: ("assets/art/ui/stamp-claimed.png",           "cutout", (512, 512)),
    26: ("assets/art/ui/getstarted-left.png",         "cutout", (300, 360)),
    27: ("assets/art/ui/getstarted-right.png",        "cutout", (300, 360)),
}


def strip_white(im):
    """White page background -> transparent; keeps enclosed whites (paper,
    highlights) because only border-connected white is removed."""
    im = im.convert("RGBA")
    a = np.asarray(im).astype(int)
    if a[..., 3].min() < 250:          # already has real alpha
        return im
    rgb = a[..., :3]
    lum = rgb @ [0.299, 0.587, 0.114]
    neutral = (rgb.max(axis=2) - rgb.min(axis=2)) <= 14
    bg = (lum >= 238) & neutral
    lab, n = ndimage.label(bg)
    ids = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    ids = ids[ids != 0]
    outside = np.isin(lab, ids)
    alpha = np.where(outside, 0, 255).astype(np.uint8)
    alpha = ndimage.grey_erosion(alpha, size=(3, 3))
    out = np.dstack([rgb.astype(np.uint8), alpha])
    return Image.fromarray(out, "RGBA")


def trim(im):
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 16)
    if len(ys) == 0:
        return im
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


for idx, (dest, mode, size) in JOBS.items():
    src = files[idx]
    im = Image.open(src)
    out_path = os.path.join(FE, dest.replace("/", os.sep))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    if mode == "panel":
        im = im.convert("RGB")
        # cover-crop to the target aspect, then resize
        tw, th = size
        sw, sh = im.size
        scale = max(tw / sw, th / sh)
        nw, nh = round(sw * scale), round(sh * scale)
        im = im.resize((nw, nh), Image.LANCZOS)
        left, top = (nw - tw) // 2, (nh - th) // 2
        im = im.crop((left, top, left + tw, top + th))
        im.save(out_path, optimize=True)
    elif mode == "grain":
        g = im.convert("L").resize(size, Image.LANCZOS)
        v = np.asarray(g).astype(np.uint8)
        # dark specks -> alpha, mid grey ink, so it overlays at low opacity
        alpha = (255 - v)
        rgb = np.full((*size[::-1], 3), 90, np.uint8)
        Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(out_path, optimize=True)
    else:
        im = trim(strip_white(im))
        im.thumbnail(size, Image.LANCZOS)
        im.save(out_path, optimize=True)
    print(f"{dest:44s} {im.size}")

print(f"\n{len(JOBS)} assets installed")
