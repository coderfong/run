"""Split every wave-6 shoe pair into a LEFT and a RIGHT image.

The art is drawn as two shoes side by side in one file. That is the right
picture for a picker thumbnail and the wrong one for a body: a pair placed as a
single rectangle can only ever be moved and scaled together, so the two shoes
can never be angled onto two feet that point slightly outward.

Splitting is by connected component with a generous closing (a lace or a heel
tab is drawn a pixel clear of the shoe), then left/right by centroid. Anything
that does not fall out as exactly two blobs is left as a pair and reported —
the rig keeps drawing those the old way.

Writes <stem>L.png / <stem>R.png beside the pair in assets/character/footwear/.
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SHOES = r"C:\Users\user\Desktop\run\frontend\assets\character\footwear"


def split_one(path):
    a = np.asarray(Image.open(path).convert("RGBA")).copy()
    m = a[..., 3] > 24
    lab, n = ndimage.label(ndimage.binary_closing(m, np.ones((11, 11))))
    if n < 2:
        return None
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    order = np.argsort(-sizes) + 1
    big = [i for i in order if sizes[i - 1] > 0.12 * sizes.max()]
    if len(big) != 2:
        return None
    out = []
    for i in big:
        comp = lab == i
        ys, xs = np.where(comp)
        piece = a.copy()
        piece[..., 3] = np.where(comp, piece[..., 3], 0)
        piece = piece[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
        out.append((float(xs.mean()), Image.fromarray(piece, "RGBA")))
    out.sort()                      # leftmost first
    return out[0][1], out[1][1]


def main():
    manifest = json.load(open(os.path.join(HERE, "installed-wardrobe6.json")))
    stems = [m["stem"] for m in manifest if m["slot"] == "footwear"]
    done, failed = [], []
    for stem in stems:
        path = os.path.join(SHOES, f"{stem}.png")
        res = split_one(path)
        if res is None:
            failed.append(stem)
            continue
        left, right = res
        left.save(os.path.join(SHOES, f"{stem}L.png"), optimize=True)
        right.save(os.path.join(SHOES, f"{stem}R.png"), optimize=True)
        done.append(stem)
    json.dump({"split": done, "pairs_only": failed},
              open(os.path.join(HERE, "shoes6-split.json"), "w"), indent=1)
    print(f"split {len(done)} pairs, {len(failed)} left whole")
    for s in failed:
        print("   whole:", s)


if __name__ == "__main__":
    main()
