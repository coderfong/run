"""Clean the seam specks left inside the wave-4 repair patches.

repair-headwear-4.py picks each patch pixel's colour from the nearest interior
pixel, which is decided per pixel — so along the seam where one patch spans both
an erased outline and the panel behind it, the nearest core pixel flips back and
forth and stranded dark pixels are left in the flat colour. This is the tidy-up
half of that script (palette snap, then a majority vote), run on its own so the
patches can be cleaned WITHOUT re-running the fill: the installed art already
carries the final patches, and the pixels to clean are exactly the ones that are
opaque now and were not in scripts/headwear4-prerepair/.

    python despeckle-headwear-4.py            preview only -> qa-headwear4/despeckle/
    python despeckle-headwear-4.py --apply    write the installed art in place
"""
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
HATS = r"C:\Users\user\Desktop\run\frontend\assets\character\headwear"
BACKUP = os.path.join(HERE, "headwear4-prerepair")
PREVIEW = os.path.join(HERE, "qa-headwear4", "despeckle")

_spec = importlib.util.spec_from_file_location("repair4", os.path.join(HERE, "repair-headwear-4.py"))
repair4 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(repair4)


def main():
    apply = "--apply" in sys.argv
    manifest = json.load(open(os.path.join(HERE, "installed-headwear4.json")))
    os.makedirs(PREVIEW, exist_ok=True)
    from scipy import ndimage
    touched = []
    for m in manifest:
        stem = m["stem"]
        cur, bak = os.path.join(HATS, f"{stem}.png"), os.path.join(BACKUP, f"{stem}.png")
        if not (os.path.exists(cur) and os.path.exists(bak)):
            continue
        a = np.asarray(Image.open(cur).convert("RGBA")).copy()
        b = np.asarray(Image.open(bak).convert("RGBA"))
        if a.shape != b.shape:
            continue
        patch = (a[..., 3] > 200) & (b[..., 3] <= 200)
        if not patch.any():
            continue
        before = a[..., :3].copy()
        # The vote reads the neighbourhood, so it needs the piece's own interior
        # as context — the same core the fill sampled from, minus the patch.
        core = ndimage.binary_erosion(b[..., 3] > 200, np.ones((7, 7)))
        repair4.tidy(a, patch, core)
        n = int((a[..., :3] != before).any(-1).sum())
        if not n:
            continue
        Image.fromarray(a, "RGBA").save(cur if apply else os.path.join(PREVIEW, f"{stem}.png"),
                                        optimize=True)
        touched.append((stem, m["label"], n, int(patch.sum())))
    touched.sort(key=lambda t: -t[2])
    print(f"{'wrote' if apply else 'previewed'} {len(touched)} hats")
    for stem, label, n, p in touched[:14]:
        print(f"   {stem:8s} {label:18s} {n:5d}px cleaned of {p:5d}px patched")


if __name__ == "__main__":
    main()
