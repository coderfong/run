"""Install the coin-shop art.

Four pack tiles + the rail tile come straight from the generated files. The
single `coin.png` used beside every price is DERIVED here: it's cut from the
pouch art's standing coin, because a 12 px price chip needs one clean coin
rather than a pile that turns to mush at that size.

Run from frontend/:  python scripts/install-coin-art.py
"""

import datetime
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"D:\downloads"
FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CUT = datetime.datetime(2026, 7, 30, 17, 50)

files = sorted(
    [os.path.join(SRC, f) for f in os.listdir(SRC)
     if f.lower().endswith(".png")
     and datetime.datetime.fromtimestamp(os.path.getmtime(os.path.join(SRC, f))) > CUT],
    key=lambda p: os.path.getmtime(p))

JOBS = {
    0: ("assets/icons/coin-pouch.png", 512),
    1: ("assets/icons/coin-sack.png", 512),
    2: ("assets/icons/coin-chest.png", 512),
    3: ("assets/icons/coin-vault.png", 512),
    4: ("assets/art/ui/rail-shop.png", 256),
}


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


def square(im, size):
    im = trim(im)
    w, h = im.size
    s = max(w, h)
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    canvas.paste(im, ((s - w) // 2, (s - h) // 2), im)
    return canvas.resize((size, size), Image.LANCZOS)


for idx, (dest, size) in JOBS.items():
    out = os.path.join(FE, dest.replace("/", os.sep))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im = square(strip_white(Image.open(files[idx])), size)
    im.save(out, optimize=True)
    print(f"{dest:36s} {im.size}")

# ---- the single coin --------------------------------------------------------
# Its own generated file (index 5): one face-on coin with the star. Cutting one
# out of the pouch art doesn't work — those coins overlap, so they're a single
# connected blob, and a tight crop drags in slivers of its neighbours.
if len(files) > 5:
    coin = square(strip_white(Image.open(files[5])), 512)
    coin.save(os.path.join(FE, "assets", "icons", "coin.png"), optimize=True)
    print(f"{'assets/icons/coin.png':36s} {coin.size}")
else:
    print("!! coin.png source missing — the price chips will keep using sparkles")
