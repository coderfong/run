"""Probe the wave-4 headwear source art (C:\\Users\\user\\Desktop\\headwear).

79 sheets, each 1448x1086 RGB on white, each showing the SAME line-art head
twice wearing one hat. Only the left copy is used.

What this checks:
  * the face features (2 brows, 2 eyes, nose, mouth) are drawn identically in
    every sheet and fall out as small ink components inside the head — so they
    register the head without any template matching on the outline itself;
  * how much the head drifts sheet to sheet (it does — the bboxes move by up
    to ~40px), which is why the cut has to be aligned per sheet.
"""
import glob
import os

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"C:\Users\user\Desktop\headwear"
HALF = 724


def load_left(path):
    """Left head, as a luminance array."""
    return np.asarray(Image.open(path).convert("L")).astype(np.int16)[:, :HALF]


def features(L):
    """Small ink islands floating inside the head = the face features."""
    ink = L < 110
    lab, n = ndimage.label(ink)
    sizes = ndimage.sum(ink, lab, range(1, n + 1))
    out = []
    for i, s in enumerate(sizes, 1):
        if 60 < s < 4000:
            ys, xs = np.where(lab == i)
            out.append((xs.mean(), ys.mean(), int(s)))
    return out


def main():
    fs = sorted(glob.glob(os.path.join(SRC, "*.png")))
    print(len(fs), "sheets")
    counts = {}
    for f in fs:
        L = load_left(f)
        ft = features(L)
        counts[len(ft)] = counts.get(len(ft), 0) + 1
        if len(ft) != 6:
            print(f"  {os.path.basename(f)[-12:]:14s} {len(ft)} islands "
                  + " ".join(f"({x:.0f},{y:.0f},{s})" for x, y, s in ft[:9]))
    print("island-count histogram:", dict(sorted(counts.items())))


if __name__ == "__main__":
    main()
