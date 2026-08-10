"""Fit the footwear that is still worn as a PAIR image onto the body's feet.

Four shoes never split into halves (scripts/split-shoes-6.py), so the rig draws
their pair image as one block through `layout`. For every other shoe `layout` is
vestigial — the rig uses the per-foot `feet` placement and never reads it — so
those numbers were never fitted for WEARING, only inherited. Worn, they land
about a fifth too small and too high: the character's bare foot sticks out below
the shoe, the ankle never enters it, and the shoe reads as sitting beside the
foot rather than on it.

The numbers are derived, not eyeballed. A pair image carries ~90px of empty
canvas under the shoes where a split half is cropped tight, so `layout` has to
be solved from where the INK sits, not the canvas:

  w    so the two shoes span the same width as the split pair would
  top  so the ink's bottom edge lands on the body's sole line

Run from frontend/:  python scripts/fit-pair-footwear.py [--dry]
"""
import os
import re
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FE = os.path.dirname(HERE)
SHOES = os.path.join(FE, "assets", "character", "footwear")
BODY = os.path.join(FE, "assets", "character", "body", "body.png")
CONFIG = os.path.join(FE, "src", "config", "outfitItems.js")

# The split shoes' own placement, which is what "fitted" looks like here: the
# standard left/right `feet` spec every wave-6 shoe carries.
FEET_L = {"w": 0.3613, "dx": -0.2198}
FEET_R = {"w": 0.3658, "dx": 0.2137}


def ink_span():
    """How wide the two shoes reach, as a fraction of the body, when split."""
    left = 0.5 - FEET_L["w"] / 2 + FEET_L["dx"]
    right = 0.5 + FEET_R["w"] / 2 + FEET_R["dx"]
    return right - left


def bbox(path):
    a = np.asarray(Image.open(path).convert("RGBA"))[..., 3] > 8
    ys, xs = np.where(a)
    return a.shape[1], a.shape[0], xs.min(), xs.max(), ys.min(), ys.max()


def main():
    dry = "--dry" in sys.argv
    body = Image.open(BODY).convert("RGBA")
    bw, bh = body.size
    sole = int(np.where(np.asarray(body)[..., 3] > 8)[0].max()) + 1
    span = ink_span()

    src = open(CONFIG, encoding="utf-8").read()
    lines = src.split("\n")
    stems = [s for s in re.findall(r"footwear/(shoe\d+)\.png", src)
             if f"footwear/{s}L.png" not in src]
    # A layout string is not unique — plenty of split shoes carry the same three
    # numbers — so every rewrite is done on the item's own line, never on the
    # file. Getting this wrong would silently refit a shoe that is already right.
    if not stems:
        print("every shoe has split art now; nothing is worn as a pair")
        return

    print(f"body {bw}x{bh}, sole line y={sole}, split pair spans {span:.4f} of the width\n")
    for stem in stems:
        w_art, h_art, x0, x1, y0, y1 = bbox(os.path.join(SHOES, f"{stem}.png"))
        w = span * w_art / (x1 - x0 + 1)
        scale = w * bw / w_art               # body pixels per pixel of art
        top = (sole - (y1 + 1) * scale) / bh

        k = next(i for i, l in enumerate(lines) if f"footwear/{stem}.png" in l)
        was = re.search(r"layout: \{ ([^}]*) \}", lines[k]).group(1)
        now = f"w: {round(w, 4)}, top: {round(top, 4)}"
        print(f"  {stem:9s} ink {x1 - x0 + 1}x{y1 - y0 + 1} of {w_art}x{h_art}, "
              f"{h_art - 1 - y1}px of empty canvas below")
        print(f"            {{{was}}}  ->  {{{now}}}")
        lines[k] = lines[k].replace(f"layout: {{ {was} }}", f"layout: {{ {now} }}")

    if dry:
        print("\n(dry run)")
        return
    open(CONFIG, "w", encoding="utf-8").write("\n".join(lines))
    print(f"\nfitted {len(stems)} pair-worn shoes in src/config/outfitItems.js")


if __name__ == "__main__":
    main()
