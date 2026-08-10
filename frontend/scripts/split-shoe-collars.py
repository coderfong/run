"""Split every shoe's collar so the ANKLE passes through it.

THE PROBLEM
Each shoe is drawn as a standalone shoe, complete collar ring and all, and the
rig draws the whole thing in front of the body. So the leg stops dead at the
shoe's top edge and the collar reads as an empty ring standing beside the ankle
instead of around it. Cutting the lining does not touch this, and neither does
re-fitting: on a real foot the layering is three deep — front rim in front of
the ankle, ANKLE in front of the rear rim, rear rim behind — and the middle term
cannot exist while footwear draws as one layer.

THE FIX
Give footwear a back layer, the same idiom `backImg` already gives scarves and
capes, and cut each shoe in two along its collar. The rear rim goes behind the
body, everything else stays in front, and the leg passes between them.

WHERE THE CUT GOES
A horizontal line, because these shoes are drawn in three-quarter view: the far
rim of the collar sits HIGHER than the near rim, so one line separates them. It
is placed a fraction of the way down the ink, not the canvas, and the collar is
the topmost feature on every shoe in the catalogue — the cuff of a boot, the
heel collar of a sneaker, the strap of a slide — so one fraction travels
surprisingly well. `collars.json` overrides it per shoe where it does not.

The two pieces tile exactly, so nothing is lost: where the leg does not cover
the back piece the shoe looks untouched, which is what makes a generous cut
safe. Only where the leg overlaps does anything change.

Run from frontend/:  python scripts/split-shoe-collars.py [--dry] [stem ...]
"""
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FE = os.path.dirname(HERE)
SHOES = os.path.join(FE, "assets", "character", "footwear")
BACKUP = os.path.join(HERE, "backups", "shoe-collars")
CONFIG = os.path.join(FE, "src", "config", "outfitItems.js")
MAP = os.path.join(HERE, "collars.json")

# How far down the ink the collar's near rim sits. The far rim is above it.
CUT = 0.13
FEATHER = 1     # rows the two pieces share, so no seam shows where the leg is
                # absent and both halves draw


def source(name):
    """The art before any collar cut: kept aside on the first run.

    This reads whatever `open-footwear-mouths.py` left behind, so that pass has
    to run FIRST. Re-running it means deleting backups/shoe-collars/ and
    re-running this, or the mouth cut is silently dropped from the pieces.
    """
    live = os.path.join(SHOES, name)
    keep = os.path.join(BACKUP, name)
    if not os.path.exists(keep):
        os.makedirs(BACKUP, exist_ok=True)
        shutil.copy2(live, keep)
    return Image.open(keep).convert("RGBA")


def pieces(im, cut):
    """(front, back) — below the line and above it, on the original canvas."""
    a = np.asarray(im)
    ink = a[..., 3] > 8
    ys = np.where(ink.any(axis=1))[0]
    y = ys.min() + cut * (ys.max() - ys.min() + 1)

    rows = np.arange(a.shape[0])[:, None]
    front = a.copy()
    front[..., 3] = np.where(rows >= y - FEATHER, front[..., 3], 0)
    back = a.copy()
    back[..., 3] = np.where(rows < y + FEATHER, back[..., 3], 0)
    return (Image.fromarray(front, "RGBA"), Image.fromarray(back, "RGBA"),
            int(round(y)))


def art_names():
    """Every image the rig actually WEARS, split halves and pair images alike."""
    src = open(CONFIG, encoding="utf-8").read()
    out = []
    for stem in sorted(set(__import__("re").findall(r"footwear/(shoe\d+)\.png", src))):
        halves = [f"{stem}{s}.png" for s in "LR"]
        if all(f"footwear/{h}" in src for h in halves):
            out += halves
        else:
            # worn as one pair image; the mouth pass may have cut a worn copy
            worn = f"{stem}_worn.png"
            out.append(worn if os.path.exists(os.path.join(SHOES, worn)) else f"{stem}.png")
    return out


def main():
    dry = "--dry" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    over = json.load(open(MAP, encoding="utf-8"))["cut"] if os.path.exists(MAP) else {}

    names = art_names()
    if only:
        names = [n for n in names if any(n.startswith(s) for s in only)]
    done = 0
    for name in names:
        stem = name.split(".")[0]
        cut = over.get(stem, over.get(stem.rstrip("LR"), CUT))
        if cut is None:                     # explicitly opted out
            print(f"  {stem:14s} no collar, left whole")
            continue
        im = source(name)
        front, back, y = pieces(im, cut)
        if not np.asarray(back)[..., 3].any():
            print(f"  {stem:14s} nothing above the line, left whole")
            continue
        done += 1
        print(f"  {stem:14s} cut {cut:.2f} -> y={y} of {im.height}")
        if dry:
            continue
        front.save(os.path.join(SHOES, name), optimize=True)
        back.save(os.path.join(SHOES, f"{stem}-back.png"), optimize=True)

    print(f"\n{done} of {len(names)} shoe images split at the collar"
          + (" (dry run)" if dry else ""))


if __name__ == "__main__":
    main()
