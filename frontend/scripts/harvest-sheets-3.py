"""Harvest wave 3 — the 54 sheets in C:\\Users\\user\\Desktop\\assets.

Same shape as harvest-sheets.py (RGBA sheets, no checkerboard), with the
source directory moved and the dedupe tightened: by now the catalogue holds
177 items, and these sheets are regenerations of the same concept prompts, so
most boxes on them ARE already in the game. Anything that matches an existing
master on shape+colour is dropped here rather than eyeballed later.

Outputs:
  out3/items/<idx>.png   unique items, trimmed, transparent
  qa3/harvest-<n>.png    indexed montages for classification
  items3.json            index -> source sheet + size
"""
import json
import os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

SRC = r"C:\Users\user\Desktop\assets"
CH = r"C:\Users\user\Desktop\run\frontend\assets\character"
SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRATCH, "out3", "items")
QA = os.path.join(SCRATCH, "qa3")
os.makedirs(OUT, exist_ok=True)
os.makedirs(QA, exist_ok=True)


def sheets():
    return sorted(
        [os.path.join(SRC, f) for f in os.listdir(SRC) if f.lower().endswith(".png")],
        key=lambda p: (os.path.getmtime(p), p),
    )


def to_rgba(path):
    """Use the sheet's own alpha, but bleed opaque colour into the transparent
    side first — transparent pixels carry undefined RGB and a later resize
    would pull that fringe into the item's edges."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.uint8).copy()
    solid = a[..., 3] > 128
    if not solid.any():
        return a
    idx = ndimage.distance_transform_edt(~solid, return_distances=False,
                                         return_indices=True)
    for c in range(3):
        ch = a[..., c]
        a[..., c] = np.where(solid, ch, ch[tuple(idx)])
    return a


def components(alpha, min_area=4000):
    solid = alpha > 40
    solid = ndimage.binary_closing(solid, structure=np.ones((5, 5)))
    lab, n = ndimage.label(solid)
    boxes = []
    for sl in ndimage.find_objects(lab):
        if sl is None:
            continue
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        if h * w < min_area or h < 40 or w < 40:
            continue
        boxes.append([xs.start, ys.start, xs.stop, ys.stop])
    return boxes


def merge_close(boxes, gap=14):
    changed = True
    while changed:
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                if (a[0] - gap < b[2] and b[0] - gap < a[2]
                        and a[1] - gap < b[3] and b[1] - gap < a[3]):
                    boxes[i] = [min(a[0], b[0]), min(a[1], b[1]),
                                max(a[2], b[2]), max(a[3], b[3])]
                    del boxes[j]
                    changed = True
                    break
            if changed:
                break
    return boxes


def trim(arr):
    a = arr[..., 3]
    ys, xs = np.where(a > 16)
    if len(ys) == 0:
        return None
    return arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def ahash(arr, n=12):
    im = Image.fromarray(arr.astype(np.uint8), "RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    g = Image.alpha_composite(bg, im).convert("L").resize((n, n), Image.LANCZOS)
    v = np.asarray(g).astype(float)
    return (v > v.mean()).flatten()


def chash(arr, n=6):
    im = Image.fromarray(arr.astype(np.uint8), "RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    c = Image.alpha_composite(bg, im).convert("RGB").resize((n, n), Image.LANCZOS)
    return np.asarray(c).astype(float).flatten() / 255.0


def existing_hashes():
    out = []
    for folder in ["headwear", "glasses", "outfit", "accessory", "hair", "face"]:
        d = os.path.join(CH, folder)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            stem = os.path.splitext(f)[0]
            if "_" in stem and stem.rsplit("_", 1)[1].isdigit():
                continue  # colour variants: the master is enough
            a = np.asarray(Image.open(os.path.join(d, f)).convert("RGBA"))
            t = trim(a)
            if t is not None:
                out.append((ahash(t), chash(t)))
    return out


def main():
    files = sheets()
    print(f"{len(files)} sheets")
    seen = existing_hashes()
    n_existing = len(seen)
    print(f"{n_existing} existing catalogue masters to dedupe against")

    kept, meta, dropped = [], [], 0
    for si, path in enumerate(files):
        arr = to_rgba(path)
        boxes = merge_close(components(arr[..., 3]))
        boxes.sort(key=lambda b: (round(b[1] / 120), b[0]))  # reading order
        before = len(kept)
        for b in boxes:
            sub = trim(arr[b[1]:b[3], b[0]:b[2]].copy())
            if sub is None:
                continue
            h, w = sub.shape[:2]
            if max(h, w) < 90 or (sub[..., 3] > 16).sum() < 3000:
                continue
            ah, ch_ = ahash(sub), chash(sub)
            if any((ah == oa).mean() > 0.90 and np.abs(ch_ - oc).mean() < 0.055
                   for (oa, oc) in seen):
                dropped += 1
                continue
            seen.append((ah, ch_))
            idx = len(kept)
            Image.fromarray(sub.astype(np.uint8), "RGBA").save(
                os.path.join(OUT, f"{idx:03d}.png"), optimize=True)
            kept.append(sub)
            meta.append({"idx": idx, "sheet": os.path.basename(path),
                         "w": int(w), "h": int(h)})
        print(f"  sheet {si+1}/{len(files)}: {len(boxes)} boxes, "
              f"+{len(kept)-before} kept ({len(kept)} total)")

    json.dump(meta, open(os.path.join(SCRATCH, "items3.json"), "w"), indent=1)

    per, cols, cell = 40, 8, 230
    for m in range((len(kept) + per - 1) // per):
        chunk = kept[m * per:(m + 1) * per]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell, rows * cell), (38, 40, 46))
        d = ImageDraw.Draw(sheet)
        for i, sub in enumerate(chunk):
            im = Image.fromarray(sub.astype(np.uint8), "RGBA")
            im.thumbnail((cell - 26, cell - 40), Image.LANCZOS)
            x = (i % cols) * cell + (cell - im.width) // 2
            y = (i // cols) * cell + (cell - 20 - im.height) // 2 + 16
            sheet.paste(im, (x, y), im)
            d.text(((i % cols) * cell + 6, (i // cols) * cell + 4),
                   str(m * per + i), fill=(255, 210, 90))
        sheet.save(os.path.join(QA, f"harvest-{m}.png"))
    print(f"DONE: {len(kept)} unique, {dropped} dropped as already-in-game, "
          f"{(len(kept)+per-1)//per} montages")


if __name__ == "__main__":
    main()
