"""Put every open shoe on a body and look at it, before and after the cut.

The whole point of scripts/open-footwear-mouths.py is what the shoe looks like
on a LEG, which is exactly what neither the art file nor the picker shows. So
this composites each item the way CharacterRig does — per-foot placement from
`feet` where the item has it, the pair `layout` where it does not — with the
pristine art on the left of each pair and the cut art on the right.

Skin tone matters here: the mouth is cut, not painted, so what fills it is the
wearer's own leg. Pass a body index 0-7 to check a tone other than the default.

It also counts, per item, the pixels the cut opened that have no body behind
them. Those are holes onto the background, and they are the one mistake this
sheet hides: it flattens onto white, so a hole and a pale lining look the
same. A seed on the sole rather than the footbed reads as a plausible shoe
here while leaving the runner in a floating outline on a coloured screen.

Run from frontend/:  python scripts/open-footwear-qa.py [tone] [stem ...]
Writes scripts/out-open-footwear/qa-body<N>.png
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
FE = os.path.dirname(HERE)
SHOES = os.path.join(FE, "assets", "character", "footwear")
BACKUP = os.path.join(HERE, "backups", "footwear-mouths")
BODIES = os.path.join(FE, "assets", "character", "body")
CONFIG = os.path.join(FE, "src", "config", "outfitItems.js")
MAP = os.path.join(HERE, "open-footwear.json")
OUT = os.path.join(HERE, "out-open-footwear")

SCALE = 2
CROP = 165           # bottom slice of the 640-tall body: shin down to the sole
COLS = 4


def spec_of(line, key):
    m = re.search(key + r": \{ ([^}]*) \}", line)
    if not m:
        return None
    return {k.strip(): float(v) for k, v in (p.split(":") for p in m.group(1).split(","))}


def place(canvas, img, spec, bw, bh):
    w = spec["w"] * bw
    h = w * img.height / img.width
    img = img.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS)
    left = bw / 2 - w / 2 + spec.get("dx", 0) * bw
    canvas.alpha_composite(img, (round(left), round(spec["top"] * bh)))


def art(name, pristine):
    """The cut art, or the copy kept aside before the first cut."""
    keep = os.path.join(BACKUP, name)
    p = keep if pristine and os.path.exists(keep) else os.path.join(SHOES, name)
    return Image.open(p).convert("RGBA")


def back(name):
    """The far rim of the collar, if the shoe has been split at it."""
    p = os.path.join(SHOES, name)
    return Image.open(p).convert("RGBA") if os.path.exists(p) else None


def worn(body, line, stem, pair, pristine):
    bw, bh = body.size
    feet = re.search(r"feet: \{ l: \{ ([^}]*) \}, r: \{ ([^}]*) \} \}", line)
    # The collar's far rim draws BEFORE the body, so the ankle passes through
    # the shoe (scripts/split-shoe-collars.py). Compositing without it would
    # show a shoe missing its collar and send you hunting a bug that is not
    # there.
    canvas = Image.new("RGBA", body.size, (0, 0, 0, 0))
    if feet and not pair:
        for side, s in zip("LR", feet.groups()):
            spec = {k.strip(): float(v) for k, v in (p.split(":") for p in s.split(","))}
            b = back(f"{stem}{side}-back.png")
            if b is not None:
                place(canvas, b, spec, bw, bh)
    else:
        stub = f"{stem}_worn" if pair else stem
        b = back(f"{stub}-back.png")
        if b is not None:
            place(canvas, b, spec_of(line, "layout"), bw, bh)
    canvas.alpha_composite(body)

    if feet and not pair:
        for side, s in zip("LR", feet.groups()):
            spec = {k.strip(): float(v) for k, v in (p.split(":") for p in s.split(","))}
            place(canvas, art(f"{stem}{side}.png", pristine), spec, bw, bh)
    else:
        # no split art: the pair image is placed as one block, and the cut for
        # those lives beside it so the picker keeps a solid shoe
        name = f"{stem}.png"
        if pair and not pristine and os.path.exists(os.path.join(SHOES, f"{stem}_worn.png")):
            name = f"{stem}_worn.png"
        place(canvas, art(name, pristine), spec_of(line, "layout"), bw, bh)
    return canvas


def main():
    argv = sys.argv[1:]
    tone = argv[0] if argv and argv[0].isdigit() else None
    stems = [a for a in argv if not a.isdigit()]
    body = Image.open(os.path.join(BODIES, f"body_{tone}.png" if tone else "body.png")).convert("RGBA")
    bw, bh = body.size
    src = open(CONFIG, encoding="utf-8").read().split("\n")
    items = json.load(open(MAP, encoding="utf-8"))["items"]
    if stems:
        items = {k: v for k, v in items.items() if k in stems}

    # A short list is being looked at closely, so give it the whole width.
    cols = min(COLS, len(items))
    scale = SCALE if len(items) > COLS else SCALE * 2
    cell_w, cell_h = bw * scale * 2, CROP * scale
    rows = -(-len(items) // cols)
    sheet = Image.new("RGB", (cols * cell_w, rows * (cell_h + 18)), (255, 255, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)

    solid = np.asarray(body)[..., 3] > 8
    holes = []

    for k, (stem, item) in enumerate(sorted(items.items())):
        line = next(l for l in src if f"footwear/{stem}.png" in l)
        pair = bool(item.get("pair"))
        strip = Image.new("RGB", (cell_w, cell_h), (255, 255, 255))
        alpha = []
        for j, pristine in enumerate((True, False)):
            c = worn(body, line, stem, pair, pristine)
            alpha.append(np.asarray(c)[..., 3] > 8)
            crop = c.crop((0, bh - CROP, bw, bh)).resize((bw * scale, CROP * scale), Image.LANCZOS)
            flat = Image.new("RGBA", crop.size, (255, 255, 255, 255))
            flat.alpha_composite(crop)
            strip.paste(flat.convert("RGB"), (j * bw * scale, 0))
        # Wherever the body is behind the shoe the composite stays opaque, so
        # what this catches is exactly the cut that opened onto nothing.
        holes.append((int((alpha[0] & ~alpha[1] & ~solid).sum()), stem))
        x, y = (k % cols) * cell_w, (k // cols) * (cell_h + 18)
        sheet.paste(strip, (x, y))
        d.line([x + cell_w // 2, y, x + cell_w // 2, y + cell_h], fill=(215, 215, 215))
        d.text((x + 4, y + cell_h + 3), f"{stem}   before | after", fill=(0, 0, 0))

    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, f"qa-body{tone or ''}.png")
    sheet.save(p)
    print(p)

    bad = sorted((h for h in holes if h[0] > 60), reverse=True)
    for n, stem in bad:
        print(f"  {stem}: {n}px of the cut opens onto the background, not the "
              f"leg — re-seed it off the sole")
    if not bad:
        print(f"  every cut lands on the leg ({max(h for h, _ in holes)}px of "
              f"edge fringe at worst)")


if __name__ == "__main__":
    main()
