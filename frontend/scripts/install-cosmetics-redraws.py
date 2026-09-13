"""Install the September 2026 hair and accessory redraw sheets.

The supplied hair file is a labelled contact sheet rather than 36 separately
named files.  Hair is isolated from the repeated white head by its brown fill,
then expanded just far enough to retain the black outline and interior strokes.
The catalogue's ten swatches are generated from that common drawing.

The first ten accessory redraws are transparent standalone drawings.  Items
that wrap around the neck/body are split into registered front/back canvases
so the avatar can occlude the far side while PartThumb can recombine both.
"""
from pathlib import Path
import os
import re
import time

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
REDRAWS = Path(r"C:\Users\user\Desktop\paser-cosmetics-regen\after")
HAIR_SHEET = REDRAWS / "hair" / "ChatGPT Image Sep 13, 2026, 11_26_41 PM.png"
HAIR_DIR = ROOT / "assets" / "character" / "hair"
ACC_DIR = ROOT / "assets" / "character" / "accessory"

HAIR_COLORS = [
    "#26282B", "#4A2F1F", "#7B4B2A", "#C9922B", "#E8D06B",
    "#C6482C", "#9EA3AB", "#E85D9E", "#8B5CF6", "#3B82F6",
]

# Sheet order is the catalogue order.  X24/X25 are single-colour legacy
# entries; all other styles have ten generated palette variants.
HAIR_BASES = [
    "hairM1", "hairM4", "hairM3", "hairM5", "hairW10",
    "hairW4", "hairW2", "hairW5", "hairM10", "hairW1",
    "hairM6", "hairW6", "hairW11", "hairM8", "hairW12",
    "hairM2", "hairW9", "hairM7", "hairW7", "hairM9",
    "hairW8", "hairW14", "hairW17", "hairM11", "hairM12",
    "hairW15", "hairW16", "hairM13", "hairM14", "hairX24",
    "hairX25", "hairS11", "hairS15", "hairS22", "hairS25", "hairS26",
]

# Bounds deliberately exclude the labels.  The first 29 items occupy the
# regular 10-column grid; row three has nine.  The last seven use the lower
# strip's irregular spacing.
CELLS = []
for row, (top, bottom, count) in enumerate(((35, 205, 10), (255, 435, 10), (475, 675, 9))):
    for col in range(count):
        CELLS.append((round(col * 153.6), top, round((col + 1) * 153.6), bottom))
CELLS += [
    (0, 750, 175, 955), (175, 750, 355, 955),
    (625, 750, 790, 955), (790, 750, 955, 955),
    (955, 750, 1125, 955), (1125, 750, 1305, 955), (1305, 750, 1536, 955),
]

ACCESSORIES = {
    1: "acc5",   # scarf
    2: "acc7",   # gold medal
    3: "acc2",   # hydration vest
    4: "acc6",   # cape
    5: "acc3",   # angel wings
    6: "acc4",   # neon wings
    7: "acc9",   # jetpack
    8: "acc11",  # dragon wings
    9: "acc13",  # red cape
    10: "acc15", # star necklace
}


def tight(im, padding=4):
    box = im.getchannel("A").getbbox()
    if not box:
        raise ValueError("image has no visible pixels")
    left, top, right, bottom = box
    return im.crop((max(0, left-padding), max(0, top-padding),
                    min(im.width, right+padding), min(im.height, bottom+padding)))


def save_png(im, path):
    """Write atomically; Windows thumbnail/indexing can briefly hold targets."""
    temp = path.with_name(path.stem + ".installing.png")
    im.save(temp, optimize=True)
    for attempt in range(8):
        try:
            os.replace(temp, path)
            return
        except OSError:
            if attempt == 7:
                raise
            time.sleep(0.05 * (attempt + 1))


def isolate_hair(cell):
    arr = np.asarray(cell.convert("RGB"))
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    # Brown fill, including its lightly shaded pixels; skin and white paper do
    # not satisfy both the red lead and saturation tests.
    core = (r > 45) & (r > g * 1.08) & (g > b * 1.08) & ((r.astype(int)-b) > 22)
    grown = Image.fromarray((core * 255).astype("uint8")).filter(ImageFilter.MaxFilter(17))
    near_hair = np.asarray(grown) > 0
    # Only the brown fill and genuinely dark ink belong to the hairstyle.
    # A broader "not white" test also picked up peach anti-aliasing from the
    # face outline wherever it touched a fringe.
    dark_ink = np.max(arr, axis=2) < 105
    alpha = (near_hair & (core | dark_ink)).astype("uint8") * 255
    rgba = np.dstack((arr, alpha))
    return tight(Image.fromarray(rgba, "RGBA"), padding=3)


def recolor_hair(im, hex_color):
    arr = np.asarray(im).copy()
    rgb = arr[..., :3]
    alpha = arr[..., 3] > 0
    # Keep near-black outlines/strokes; tint colored fill while retaining the
    # source's restrained light/dark variation.
    colored = alpha & (np.max(rgb, axis=2) - np.min(rgb, axis=2) > 12) & (np.max(rgb, axis=2) > 45)
    target = np.array(tuple(int(hex_color[i:i+2], 16) for i in (1, 3, 5)), dtype=float)
    lum = np.mean(rgb.astype(float), axis=2)
    source_mid = np.median(lum[colored]) if np.any(colored) else 100.0
    scale = np.clip(lum / max(source_mid, 1), 0.72, 1.22)[..., None]
    arr[..., :3][colored] = np.clip(target * scale[colored], 0, 255).astype("uint8")
    return Image.fromarray(arr, "RGBA")


def split_registered(im, seam_frac, back_below=False):
    arr = np.asarray(im).copy()
    seam = int(im.height * seam_frac)
    y = np.arange(im.height)
    weight = np.clip((seam + 2.5 - y) / 5, 0, 1)
    if back_below:
        weight = 1 - weight
    back = arr.copy()
    front = arr.copy()
    back[..., 3] = (arr[..., 3] * weight[:, None]).astype("uint8")
    front[..., 3] = (arr[..., 3] * (1 - weight[:, None])).astype("uint8")
    return Image.fromarray(front, "RGBA"), Image.fromarray(back, "RGBA")


def install_hair():
    sheet = Image.open(HAIR_SHEET).convert("RGBA")
    if sheet.size != (1536, 1024) or len(CELLS) != len(HAIR_BASES):
        raise ValueError(f"unexpected hair sheet geometry: {sheet.size}")
    for base, bounds in zip(HAIR_BASES, CELLS):
        art = isolate_hair(sheet.crop(bounds))
        if base in ("hairX24", "hairX25"):
            save_png(recolor_hair(art, HAIR_COLORS[1]), HAIR_DIR / f"{base}.png")
        else:
            for index, color in enumerate(HAIR_COLORS):
                save_png(recolor_hair(art, color), HAIR_DIR / f"{base}_{index}.png")
    print(f"installed {len(HAIR_BASES)} hairstyles")


def install_accessories():
    sources = {}
    for path in (REDRAWS / "accessory").glob("*.png"):
        match = re.search(r"\((\d+)\)\.png$", path.name)
        if match:
            sources[int(match.group(1))] = path
    if set(sources) != set(ACCESSORIES):
        raise ValueError(f"unexpected accessory files: {sorted(sources)}")
    for number, base in ACCESSORIES.items():
        art = tight(Image.open(sources[number]).convert("RGBA"), padding=4)
        if base == "acc5":
            front, back = split_registered(art, 0.18)
        elif base == "acc7":
            front, back = split_registered(art, 0.39)
        elif base == "acc6":
            front, back = split_registered(art, 0.16, back_below=True)
        elif base == "acc15":
            front, back = split_registered(art, 0.36)
        else:
            save_png(art, ACC_DIR / f"{base}.png")
            # acc13 is wholly behind the body now; its old split layer must not
            # remain available as a stale fragment.
            if base == "acc13":
                stale = ACC_DIR / "acc13b.png"
                if stale.exists():
                    stale.unlink()
            continue
        save_png(front, ACC_DIR / f"{base}.png")
        save_png(back, ACC_DIR / f"{base}b.png")
    print(f"installed {len(ACCESSORIES)} accessories")


if __name__ == "__main__":
    install_hair()
    install_accessories()
