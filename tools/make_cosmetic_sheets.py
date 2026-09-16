from __future__ import annotations

import math
import re
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
OUT = ROOT / "artifacts" / "cosmetic-sheets"
OUT.mkdir(parents=True, exist_ok=True)

CATALOGS = [
    (FRONTEND / "src/config/cosmetics.js", "main"),
    (FRONTEND / "src/config/outfitItems.js", "outfit"),
    (FRONTEND / "src/config/hairSheetItems.js", "hair"),
]

CATEGORY_NAMES = {
    "face": "Faces",
    "hair": "Hair",
    "headwear": "Hats & Headwear",
    "glasses": "Glasses & Eyewear",
    "top": "Tops & Outfits",
    "bottom": "Bottoms",
    "footwear": "Shoes & Footwear",
    "accessory": "Accessories & Extras",
}

RARITY_COLOR = {
    "common": "#8B98A8",
    "rare": "#3488E8",
    "epic": "#A45BE7",
    "legendary": "#E7A629",
}


def font(size: int, bold: bool = False):
    names = [
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
    ]
    for name in names:
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


def parse_art_map():
    path = FRONTEND / "src/config/cosmeticsArt.js"
    result = {}
    key = None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.match(r"\s*([A-Za-z0-9]+):\s*\[", line)
        if match:
            key = match.group(1)
        if key and key not in result:
            match = re.search(r"require\('([^']+)'\)", line)
            if match:
                result[key] = (path.parent / match.group(1)).resolve()
        if re.search(r"\],?\s*$", line):
            key = None
    return result


def parse_catalog():
    art_map = parse_art_map()
    items = {key: [] for key in CATEGORY_NAMES}
    for path, kind in CATALOGS:
        slot = None
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if kind == "main":
                match = re.match(r"  (face|hair|headwear|glasses|top|bottom|accessory): \[", line)
                if match:
                    slot = match.group(1)
                elif re.match(r"ITEMS\.footwear\s*=\s*\[", line):
                    slot = "footwear"
            elif kind == "outfit":
                if line.startswith("export const OUTFIT_TOPS"):
                    slot = "top"
                elif line.startswith("export const OUTFIT_BOTTOMS"):
                    slot = "bottom"
                elif line.startswith("export const OUTFIT_SUITS"):
                    slot = "top"
                elif line.startswith("export const FOOTWEAR"):
                    slot = "footwear"
            else:
                slot = "hair"

            match = re.search(
                r"\{ id: '([^']+)', label: '([^']+)'.*?rarity: '([^']+)'",
                line,
            )
            if not match or slot not in items:
                continue
            item_id, label, rarity = match.groups()
            image_path = None
            req = re.search(r"(?:img|art):\s*(?:\[)?require\('([^']+)'\)", line)
            art = re.search(r"art:\s*ART\.([A-Za-z0-9]+)", line)
            if req:
                image_path = (path.parent / req.group(1)).resolve()
            elif art:
                image_path = art_map.get(art.group(1))
            items[slot].append(
                {"id": item_id, "label": label, "rarity": rarity, "path": image_path}
            )
    return items


def fit_art(path: Path | None, size=(188, 172)):
    if path is None or not path.exists():
        tile = Image.new("RGBA", size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(tile)
        draw.ellipse((65, 45, 123, 103), outline="#738093", width=4)
        draw.line((70, 118, 118, 70), fill="#738093", width=5)
        return tile
    with Image.open(path) as source:
        image = source.convert("RGBA")
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        image = image.crop(bbox)
    image.thumbnail(size, Image.Resampling.LANCZOS)
    result = Image.new("RGBA", size, (0, 0, 0, 0))
    result.alpha_composite(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
    return result


def make_sheet(slot: str, entries: list[dict]):
    cols = 8
    cell_w, cell_h = 220, 240
    margin, header_h = 28, 110
    rows = math.ceil(len(entries) / cols)
    width = margin * 2 + cols * cell_w
    height = header_h + margin + rows * cell_h
    sheet = Image.new("RGB", (width, height), "#101722")
    draw = ImageDraw.Draw(sheet)
    title_font, count_font = font(38, True), font(20)
    label_font, id_font = font(18, True), font(14)
    draw.text((margin, 22), CATEGORY_NAMES[slot], fill="#FFFFFF", font=title_font)
    draw.text((margin, 72), f"{len(entries)} cosmetic entries • one representative PNG per ID", fill="#A9B4C4", font=count_font)

    for index, item in enumerate(entries):
        row, col = divmod(index, cols)
        x = margin + col * cell_w
        y = header_h + row * cell_h
        border = RARITY_COLOR.get(item["rarity"], "#8B98A8")
        draw.rounded_rectangle((x + 7, y + 6, x + cell_w - 7, y + cell_h - 8), 18, fill="#192331", outline=border, width=3)
        art = fit_art(item["path"])
        sheet.paste(art, (x + 16, y + 14), art)
        label = item["label"]
        while draw.textlength(label, font=label_font) > cell_w - 25 and len(label) > 7:
            label = label[:-2]
        if label != item["label"]:
            label += "…"
        draw.text((x + 13, y + 190), label, fill="#FFFFFF", font=label_font)
        draw.text((x + 13, y + 216), item["id"], fill="#91A0B5", font=id_font)

    output = OUT / f"{slot}-cosmetics.png"
    sheet.save(output, optimize=True)
    return output


def main():
    items = parse_catalog()
    outputs = [make_sheet(slot, items[slot]) for slot in CATEGORY_NAMES]
    archive = ROOT / "artifacts" / "cosmetic-contact-sheets.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for output in outputs:
            bundle.write(output, output.name)
    for slot, entries in items.items():
        print(f"{slot}: {len(entries)}")
    print(archive)


if __name__ == "__main__":
    main()
