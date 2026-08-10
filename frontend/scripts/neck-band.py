"""Give the band between the jaw and a top's collar back to the skin.

THE PROBLEM
The body has no neck: the head's jaw outline sits straight on the shoulder
line. A top whose own collar is drawn a little below that jaw therefore fills
the band between the two with garment colour, and its collar reads as a ring
lying on the chest instead of a collar going round a neck.

THE FIX
Paint that band skin. The collar then encircles something, which is what it was
drawn to do, and every top keeps the neckline its artist gave it.

WHERE THE BAND IS
Flooded from just under the jaw through everything that is NOT one of the
garment's own lines, so it stops exactly at the collar that was drawn and
nowhere else. Two guards keep it honest: the flood has to START on garment
colour under the jaw, and it has to stay small. A turtleneck or a hoodie collar
covers the neck properly, so the flood runs on into the whole garment and the
size guard drops it — which is the answer we want for those.

Run from frontend/:  python scripts/neck-band.py [--dry] [id ...]
"""
import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
FE = os.path.dirname(HERE)
BACKUP = os.path.join(HERE, "backups", "neck-band")
SHEET = os.path.join(HERE, "fit-studio", "neck-band.png")

W = 420                  # the body size the geometry is worked out at
DARK = 110               # a garment's own lines are darker than this
DROP = 3                 # rows below the jaw to start the flood
GROW = 1                 # px, so no rim of garment colour is left behind
MAX_SHARE = 0.25         # a flood bigger than this is not a neck band
# A neck is about this big. Past it the flood has escaped into a chest panel or
# an open front, and repainting THAT is redrawing the garment, not fixing a
# collar — both bounds are fractions of the body box, measured from the jaw.
MAX_DROP = 0.085
MAX_WIDE = 0.34


def manifest():
    js = ("import('./scripts/fit-studio/manifest.mjs').then(async m => {"
          "const M = await m.buildManifest();"
          "console.log(JSON.stringify({ body: M.body, head: M.head, rig: M.rig, tops: M.items.top }));"
          "});")
    out = subprocess.run(["node", "-e", js], cwd=FE, capture_output=True, text=True)
    if not out.stdout.strip():
        raise SystemExit("could not read the catalogue: " + out.stderr.strip()[-400:])
    return json.loads(out.stdout)


def frame(spec, art, bodyW, bodyH):
    w = spec["w"] * bodyW
    h = w * (art.height / art.width)
    if spec.get("maxH") is not None and h > spec["maxH"] * bodyH:
        h = spec["maxH"] * bodyH
        w = h * (art.width / art.height)
    top = spec["cy"] * bodyH - h / 2 if spec.get("cy") is not None else spec["top"] * bodyH
    left = bodyW / 2 - w / 2 + spec.get("dx", 0) * bodyW
    return left, top, w, h


def files_of(item):
    """Every image of this garment: the picker's, the worn cut, each colour."""
    out = [item.get("img"), item.get("wornImg")] + list(item.get("art") or [])
    seen, keep = set(), []
    for f in out:
        if f and f not in seen and os.path.exists(os.path.join(FE, f)):
            seen.add(f)
            keep.append(f)
    return keep


def band_of(art, jaw_row, centre_col, bounds=None):
    """The neck band in the art's OWN pixels, or None if there isn't one."""
    a = np.asarray(art)
    ink = a[..., 3] > 8
    lum = a[..., :3].astype(np.float32) @ [0.299, 0.587, 0.114]
    lines = ink & (lum < DARK)
    y, x = int(round(jaw_row)), int(round(centre_col))
    if not (0 <= y < a.shape[0] and 0 <= x < a.shape[1]):
        return None, "the jaw falls outside the art"
    if not ink[y, x]:
        return None, "bare skin under the jaw already"
    if lines[y, x]:
        return None, "a line runs under the jaw"
    lab, _ = ndi.label(ink & ~lines)
    band = lab == lab[y, x]
    if band.sum() > MAX_SHARE * ink.sum():
        return None, "the garment covers the neck (collar, hood or high neck)"
    if bounds is not None:
        ys, xs = np.where(band)
        deep, wide = bounds
        if ys.max() > deep:
            return None, "the flood runs down the chest, not round a neck"
        if xs.max() - xs.min() > wide:
            return None, "the flood spreads across the front, not round a neck"
    if GROW:
        band = ndi.binary_dilation(band, np.ones((GROW * 2 + 1,) * 2)) & ink & ~lines
    return band, None


def main():
    dry = "--dry" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    M = manifest()
    H = int(round(W * M["rig"]["BODY_RATIO"]))
    head = np.asarray(Image.open(os.path.join(FE, M["head"])).convert("RGBA")
                      .resize((W, H), Image.LANCZOS))[..., 3] > 128
    body = np.asarray(Image.open(os.path.join(FE, M["body"])).convert("RGBA")
                      .resize((W, H), Image.LANCZOS))
    cx = W // 2
    jaw = int(np.where(head[:, cx])[0].max())
    skin = tuple(int(v) for v in body[jaw + 6, cx][:3])
    print(f"jaw at y={jaw} of {H}; skin {skin}\n")

    done, skipped, tiles = [], [], []
    seen_files = set()
    for item in M["tops"]:
        if only and item["id"] not in only:
            continue
        srcs = files_of(item)
        if not srcs:
            continue
        art0 = Image.open(os.path.join(FE, srcs[0])).convert("RGBA")
        spec = {**M["rig"]["LAYOUT"][item.get("fit") or "top"], **(item.get("layout") or {})}
        left, top, w, h = frame(spec, art0, W, H)
        # the jaw and the centre line, in the art's own pixels
        jaw_row = (jaw + DROP - top) * art0.height / h
        centre_col = (cx - left) * art0.width / w

        # the same limits, in this garment's own pixels
        bounds = ((jaw + MAX_DROP * H - top) * art0.height / h,
                  MAX_WIDE * W * art0.width / w)
        band, why = band_of(art0, jaw_row, centre_col, bounds)
        if band is None:
            skipped.append((item["id"], why))
            continue
        print(f"  {item['id']:14s} {int(band.sum()):6d}px over {len(srcs)} image(s)")
        done.append(item["id"])
        for i, src in enumerate(srcs):
            if src in seen_files:
                continue
            seen_files.add(src)
            art = Image.open(os.path.join(FE, src)).convert("RGBA")
            if art.size != art0.size:
                skipped.append((src, "colour variant is a different size"))
                continue
            a = np.asarray(art).copy()
            a[band, 0], a[band, 1], a[band, 2] = skin
            out = Image.fromarray(a, "RGBA")
            if i == 0:
                tiles.append((item["id"], art, out))
            if dry:
                continue
            keep = os.path.join(BACKUP, os.path.basename(src))
            if not os.path.exists(keep):
                os.makedirs(BACKUP, exist_ok=True)
                shutil.copy2(os.path.join(FE, src), keep)
            out.save(os.path.join(FE, src), optimize=True)

    contact(tiles, M, W, H)
    print(f"\n{len(done)} tops given a neck, {len(skipped)} left alone"
          + (" (dry run)" if dry else ""))
    for sid, why in skipped[:12]:
        print(f"  {sid:14s} {why}")
    if len(skipped) > 12:
        print(f"  … and {len(skipped) - 12} more")
    print(f"contact sheet: {os.path.relpath(SHEET, FE)}")


def contact(tiles, M, W, H, cols=6, cell=190):
    """Before and after at the neck, so a bad one is spotted without opening it."""
    if not tiles:
        return
    body = Image.open(os.path.join(FE, M["body"])).convert("RGBA").resize((W, H), Image.LANCZOS)
    head = Image.open(os.path.join(FE, M["head"])).convert("RGBA").resize((W, H), Image.LANCZOS)
    shots = []
    for tid, before, after in tiles:
        for art in (before, after):
            item = next(t for t in M["tops"] if t["id"] == tid)
            spec = {**M["rig"]["LAYOUT"][item.get("fit") or "top"], **(item.get("layout") or {})}
            left, top, w, h = frame(spec, art, W, H)
            st = Image.new("RGBA", (W, H), (243, 239, 231, 255))
            st.alpha_composite(body)
            st.alpha_composite(art.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS),
                               (int(left), int(top)))
            st.alpha_composite(head)
            shots.append(st.crop((int(W * 0.26), int(H * 0.28), int(W * 0.74), int(H * 0.40))))
    rows = (len(shots) + cols - 1) // cols
    cw, ch = shots[0].size
    scale = (cell - 8) / cw
    cw, ch = int(cw * scale), int(ch * scale)
    sheet = Image.new("RGBA", (cols * cw, rows * ch), (243, 239, 231, 255))
    for i, s in enumerate(shots):
        sheet.paste(s.resize((cw, ch), Image.LANCZOS), ((i % cols) * cw, (i // cols) * ch))
    os.makedirs(os.path.dirname(SHEET), exist_ok=True)
    sheet.save(SHEET)


if __name__ == "__main__":
    main()
