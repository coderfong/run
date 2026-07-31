"""PASER asset pipeline — integrate the 30 ChatGPT-generated cosmetic PNGs.

Stages:
  1. Remove the baked-in checkerboard background (RGB → RGBA).
  2. Slice the 4 sprite sheets (glasses/tops/bottoms/hair) into items.
  3. Trim + resize each item onto its slot's canvas convention.
  4. Generate the 10 palette color variants for colorable items
     (out = palette_color * (pixel_luma / dominant_luma), clipped —
     replicates the existing hairM1/top1 variant transform exactly).
  5. Emit QA contact sheets.

Outputs to  <scratch>/out/character/<slot>/  (copied into the app after QA).
"""

import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

SRC = r"C:\Users\user\Desktop\run\new"
SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRATCH, "out", "character")
QA = os.path.join(SCRATCH, "qa")

HAIR_COLORS = ["#26282B", "#4A2F1F", "#7B4B2A", "#C9922B", "#E8D06B",
               "#C6482C", "#9EA3AB", "#E85D9E", "#8B5CF6", "#3B82F6"]
CLOTH_COLORS = ["#F4F4F5", "#26272B", "#EF4444", "#F97316", "#EAB308",
                "#22C55E", "#2DD4BF", "#3B82F6", "#8B5CF6", "#EC4899"]

def hex2rgb(h):
    return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))

# ---------------------------------------------------------------------------
# Stage 1 — checkerboard removal
# ---------------------------------------------------------------------------

def _runs(line):
    """Run lengths + change positions of a 1-D boolean array."""
    change = np.flatnonzero(np.diff(line.astype(np.int8)))
    lengths = np.diff(np.concatenate([[-1], change, [len(line) - 1]]))
    return lengths, change + 1

def _grid(shade_hi, outer):
    """Estimate checker tile size + phase offsets from the border region.
    Returns (s, ox, oy) or None when there's no periodic pattern."""
    sizes, xb, yb = [], [], []
    h, w = shade_hi.shape
    for y in (3, 7, 11):
        row = outer[y]
        if row.sum() < w * 0.8:
            continue
        lengths, change = _runs(shade_hi[y])
        if len(lengths) >= 4:
            sizes.extend(lengths[1:-1]); xb.extend(change)
    for x in (3, 7, 11):
        col = outer[:, x]
        if col.sum() < h * 0.8:
            continue
        lengths, change = _runs(shade_hi[:, x])
        if len(lengths) >= 4:
            sizes.extend(lengths[1:-1]); yb.extend(change)
    if not sizes or not xb or not yb:
        return None
    s = int(np.median(sizes))
    if s < 8 or s > 200:
        return None
    ox = int(np.median(np.array(xb) % s))
    oy = int(np.median(np.array(yb) % s))
    return s, ox, oy

def remove_checker(img):
    """RGB PIL image -> RGBA with the checkerboard turned transparent.

    Background = border-connected light pixels + enclosed light regions whose
    light/dark alternation MATCHES the global checker tile grid (phase test).
    Flat garment whites can't match the grid, so they survive — the two
    checker shades are only ~8 gray levels apart, so color alone can't
    separate them from white cloth.
    """
    rgb = np.asarray(img.convert("RGB")).astype(int)
    lum = rgb @ [0.299, 0.587, 0.114]
    neutral = (rgb.max(axis=2) - rgb.min(axis=2)) <= 14
    cand = (lum >= 236) & neutral
    labels, n = ndimage.label(cand)
    border_ids = np.unique(np.concatenate([
        labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    border_ids = border_ids[border_ids != 0]
    outer = np.isin(labels, border_ids)
    bg = outer.copy()

    shade_hi = lum >= 248  # bright checker tile vs dim checker tile
    grid = _grid(shade_hi, outer)
    if grid is not None:
        s, ox, oy = grid
        yy, xx = np.mgrid[0:rgb.shape[0], 0:rgb.shape[1]]
        parity = ((yy - oy) // s + (xx - ox) // s) % 2 == 0
        # which parity is the bright tile? vote using the outer region
        agree = (shade_hi == parity)[outer].mean()
        pred_hi = parity if agree >= 0.5 else ~parity
        comp_ids = np.unique(labels[cand & ~outer])
        comp_ids = comp_ids[comp_ids != 0]
        for i in comp_ids:
            comp = labels == i
            size = comp.sum()
            if size < 60:  # specks: leave them; erosion/downscale eats them
                continue
            pv = pred_hi[comp]
            if pv.all() or (~pv).all():
                continue  # fits inside one tile: ambiguous — keep as art
            match = (shade_hi[comp] == pv).mean()
            if max(match, 1 - match) > 0.80:
                bg |= comp
    alpha = np.where(bg, 0, 255).astype(np.uint8)
    # 1px erode on the art side to cut halo fringe, then let downscale feather.
    alpha = ndimage.grey_erosion(alpha, size=(3, 3))
    # Despeckle: drop stray opaque crumbs (dashed dividers, fringe dots).
    lab, n = ndimage.label(alpha > 0)
    if n:
        sizes = ndimage.sum_labels(np.ones_like(lab), lab, index=np.arange(1, n + 1))
        kill = np.isin(lab, np.flatnonzero(sizes < 50) + 1)
        alpha[kill] = 0
    out = np.dstack([np.asarray(img.convert("RGB")), alpha])
    return Image.fromarray(out.astype(np.uint8), "RGBA")

def extract_face(img, ink=(16, 16, 16)):
    """Faces are black ink on light bg: alpha straight from darkness."""
    rgb = np.asarray(img.convert("RGB")).astype(float)
    lum = rgb @ [0.299, 0.587, 0.114]
    alpha = np.clip((235.0 - lum) / (235.0 - 40.0), 0, 1)
    out = np.zeros((*lum.shape, 4), np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = ink
    out[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")

# ---------------------------------------------------------------------------
# Stage 2 — sheet slicing (projection bands, merged down to expected counts)
# ---------------------------------------------------------------------------

def bands(mask, axis, n_expected):
    counts = mask.sum(axis=axis)
    proj = counts > 2
    runs, cur = [], None
    for i, v in enumerate(proj):
        if v and cur is None:
            cur = i
        elif not v and cur is not None:
            runs.append([cur, i]); cur = None
    if cur is not None:
        runs.append([cur, len(proj)])
    # Drop ghost runs (dashed dividers, leftover fringe) by pixel mass.
    masses = [counts[a:b].sum() for a, b in runs]
    if masses:
        floor = max(80, 0.015 * max(masses))
        keep = [r for r, m in zip(runs, masses) if m >= floor]
        runs = keep or runs
    while len(runs) > n_expected:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        j = int(np.argmin(gaps))
        runs[j] = [runs[j][0], runs[j + 1][1]]
        del runs[j + 1]
    return runs

def slice_sheet(rgba, rows, cols):
    m = np.asarray(rgba)[..., 3] > 16
    cells = []
    for r0, r1 in bands(m, axis=1, n_expected=rows):
        row_m = m[r0:r1]
        for c0, c1 in bands(row_m, axis=0, n_expected=cols):
            cells.append(rgba.crop((c0, r0, c1, r1)))
    return cells

# ---------------------------------------------------------------------------
# Stage 3 — trim + resize
# ---------------------------------------------------------------------------

def trim(img, thresh=16):
    a = np.asarray(img)[..., 3]
    ys, xs = np.where(a > thresh)
    if len(ys) == 0:
        return img
    return img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def fit(img, max_dim=None, width=None):
    w, h = img.size
    if width is not None:
        s = width / w
    else:
        s = max_dim / max(w, h)
    if s < 1:
        img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    return img

# ---------------------------------------------------------------------------
# Stage 4 — palette variants (replicates the existing luminance-colorize)
# ---------------------------------------------------------------------------

def dominant_luma(arr):
    """Mode of luminance; prefer clearly-saturated pixels (two-tone designs
    keep their colored part as the exact palette target)."""
    rgb = arr[..., :3].astype(float) / 255.0
    a = arr[..., 3] > 128
    lum = rgb @ [0.299, 0.587, 0.114]
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 0.05, (mx - mn) / np.maximum(mx, 1e-6), 0)
    pick = a & (lum > 0.06)
    sat_pick = pick & (sat > 0.25)
    if sat_pick.sum() > 0.10 * a.sum():
        pick = sat_pick
    if pick.sum() == 0:
        return 0.5
    hist, edges = np.histogram(lum[pick], bins=48, range=(0.06, 1.0))
    i = int(np.argmax(hist))
    return (edges[i] + edges[i + 1]) / 2

def colorize(img, target_rgb):
    arr = np.asarray(img).astype(float)
    lum = (arr[..., :3] / 255.0) @ [0.299, 0.587, 0.114]
    g0 = dominant_luma(np.asarray(img))
    scale = lum / max(g0, 1e-4)
    out = arr.copy()
    for c in range(3):
        out[..., c] = np.clip(target_rgb[c] * scale, 0, 255)
    return Image.fromarray(out.astype(np.uint8), "RGBA")

# ---------------------------------------------------------------------------
# Specs
# ---------------------------------------------------------------------------

T = os.path.join(SRC, "ChatGPT Image Jul 17, 2026, ")

SINGLES = [
    # (file, slot, id, colorable, palette)
    (T + "05_28_42 PM (1).png",  "headwear", "hat1",  True,  CLOTH_COLORS),   # cap
    (T + "05_28_43 PM (2).png",  "headwear", "hat2",  True,  CLOTH_COLORS),   # snapback (backwards)
    (T + "05_28_43 PM (3).png",  "headwear", "hat3",  True,  CLOTH_COLORS),   # beanie
    (T + "05_28_44 PM (4).png",  "headwear", "hat4",  True,  CLOTH_COLORS),   # pom beanie
    (T + "05_28_45 PM (5).png",  "headwear", "hat5",  True,  CLOTH_COLORS),   # sweatband
    (T + "05_28_45 PM (6).png",  "headwear", "hat6",  True,  CLOTH_COLORS),   # bandana
    (T + "05_28_45 PM (7).png",  "headwear", "hat7",  False, None),           # crown
    (T + "05_28_46 PM (8).png",  "headwear", "hat8",  False, None),           # bike helmet
    (T + "05_28_46 PM (9).png",  "headwear", "hat9",  False, None),           # skate helmet
    (T + "05_28_47 PM (10).png", "headwear", "hat10", True,  CLOTH_COLORS),   # bucket hat
    (T + "05_33_37 PM (1).png",  "headwear", "hat11", True,  CLOTH_COLORS),   # visor
    (T + "05_33_38 PM (2).png",  "headwear", "hat12", False, None),           # hard hat
    (T + "06_37_14 PM (1).png",  "accessory", "acc1", False, None),           # hydration backpack
    (T + "06_37_14 PM (2).png",  "accessory", "acc2", False, None),           # hydration vest
    (T + "06_37_14 PM (3).png",  "accessory", "acc3", False, None),           # angel wings
    (T + "06_37_14 PM (4).png",  "accessory", "acc4", False, None),           # neon wings
    (T + "06_37_14 PM (5).png",  "accessory", "acc5", False, None),           # scarf
    (T + "06_37_14 PM (6).png",  "accessory", "acc6", False, None),           # cape
    (T + "06_37_15 PM (7).png",  "accessory", "acc7", False, None),           # gold medal
    (T + "06_37_15 PM (8).png",  "accessory", "acc8", False, None),           # champion medal
]

FACES = [
    (T + "07_27_10 PM (1).png", "face10"),  # determined
    (T + "07_27_11 PM (2).png", "face11"),  # star-eyes
    (T + "07_27_11 PM (3).png", "face12"),  # heart-eyes
    (T + "07_27_12 PM (4).png", "face13"),  # exhausted
    (T + "07_27_13 PM (5).png", "face14"),  # tongue-out wink
    (T + "07_27_13 PM (6).png", "face15"),  # content
]

SHEETS = [
    # (file, slot, rows, cols, [(id, colorable, palette), ... reading order])
    (T + "06_42_23 PM.png", "glasses", 2, 4, [
        ("specs3", False, None),          # sport shield (rainbow, fixed)
        ("specs4", True,  CLOTH_COLORS),  # wayfarer
        ("specs5", True,  CLOTH_COLORS),  # shield visor
        ("specs6", False, None),          # ski goggles (mirror, fixed)
        ("specs7", True,  CLOTH_COLORS),  # heart
        ("specs8", True,  CLOTH_COLORS),  # half-frame sport
        ("specs9", True,  CLOTH_COLORS),  # round gold
        ("specs10", True, CLOTH_COLORS),  # clear goggles
    ]),
    (T + "07_09_44 PM.png", "outfit", 3, 2, [
        ("top12", True, CLOTH_COLORS),  # running singlet
        ("top13", True, CLOTH_COLORS),  # school PE polo
        ("top14", True, CLOTH_COLORS),  # windbreaker
        ("top15", True, CLOTH_COLORS),  # crop tee
        ("top16", True, CLOTH_COLORS),  # camisole
        ("top17", True, CLOTH_COLORS),  # oversized tee
    ]),
    (T + "07_15_36 PM.png", "outfit", 1, 5, [
        ("bottom5", True, CLOTH_COLORS),  # FBT running shorts
        ("bottom6", True, CLOTH_COLORS),  # leggings
        ("bottom7", True, CLOTH_COLORS),  # bike shorts
        ("bottom8", True, CLOTH_COLORS),  # tennis skirt
        ("bottom9", True, CLOTH_COLORS),  # track pants
    ]),
    (T + "07_37_19 PM.png", "hair", 2, 4, [
        ("hairW14", True, HAIR_COLORS),  # sports hijab
        ("hairW15", True, HAIR_COLORS),  # braided pigtails
        ("hairW16", True, HAIR_COLORS),  # bun with strands
        ("hairW17", True, HAIR_COLORS),  # long straight, curtain bangs
        ("hairM11", True, HAIR_COLORS),  # two-block
        ("hairM12", True, HAIR_COLORS),  # buzz cut
        ("hairM13", True, HAIR_COLORS),  # comma fringe
        ("hairM14", True, HAIR_COLORS),  # textured crop
    ]),
]

SLOT_FIT = {  # canvas convention per slot (match existing art)
    "face": dict(width=360),
    "glasses": dict(width=420),
    "hair": dict(max_dim=512),
    "outfit": dict(max_dim=512),
    "headwear": dict(max_dim=512),
    "accessory": dict(max_dim=560),
}

# ---------------------------------------------------------------------------

def save(img, slot, name):
    d = os.path.join(OUT, slot)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".png")
    img.save(p, optimize=True)
    return p

def process_item(rgba, slot, iid, colorable, palette):
    art = fit(trim(rgba), **SLOT_FIT[slot])
    save(art, slot, iid)
    if colorable:
        for i, hexc in enumerate(palette):
            save(colorize(art, hex2rgb(hexc)), slot, f"{iid}_{i}")
    return art

def contact_sheet(images, path, cols=8, cell=180, bg=(34, 36, 40)):
    rows = (len(images) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), bg)
    for i, (label, im) in enumerate(images):
        t = im.copy()
        t.thumbnail((cell - 12, cell - 30), Image.LANCZOS)
        x = (i % cols) * cell + (cell - t.width) // 2
        y = (i // cols) * cell + (cell - 24 - t.height) // 2
        sheet.paste(t, (x, y), t)
    sheet.save(path)

def main():
    os.makedirs(QA, exist_ok=True)
    done = []

    for f, slot, iid, colorable, palette in SINGLES:
        rgba = remove_checker(Image.open(f))
        art = process_item(rgba, slot, iid, colorable, palette)
        done.append((iid, art))
        print("single", iid, art.size)

    for f, iid in FACES:
        rgba = extract_face(Image.open(f))
        art = fit(trim(rgba), **SLOT_FIT["face"])
        save(art, "face", iid)
        done.append((iid, art))
        print("face", iid, art.size)

    for f, slot, rows, cols, items in SHEETS:
        rgba = remove_checker(Image.open(f))
        cells = slice_sheet(rgba, rows, cols)
        if len(cells) != len(items):
            print(f"!! {os.path.basename(f)}: expected {len(items)} cells, got {len(cells)}")
        for cell, (iid, colorable, palette) in zip(cells, items):
            art = process_item(cell, slot, iid, colorable, palette)
            done.append((iid, art))
            print("sheet", iid, art.size)

    contact_sheet(done, os.path.join(QA, "all-items.png"))
    # variant QA: one colorable item per slot across its palette
    for iid, palette in [("hat1", CLOTH_COLORS), ("hairW14", HAIR_COLORS),
                         ("top12", CLOTH_COLORS), ("bottom8", CLOTH_COLORS),
                         ("specs7", CLOTH_COLORS)]:
        slot = {"hat1": "headwear", "hairW14": "hair", "top12": "outfit",
                "bottom8": "outfit", "specs7": "glasses"}[iid]
        imgs = [(f"{iid}_{i}", Image.open(os.path.join(OUT, slot, f"{iid}_{i}.png")))
                for i in range(10)]
        contact_sheet(imgs, os.path.join(QA, f"variants-{iid}.png"), cols=10)
    print("DONE", len(done), "items")

if __name__ == "__main__":
    main()
