"""The wave-4 repair as the app actually draws it: each hat worn, before | after.

The bites this repair fills sit exactly where a hat meets the face, so a flat
view of the piece understates them — against the dark QA background a notch
reads as a shadow, while on the head it reads as the hat dissolving into the
skin. This dresses the same rig worn-qa-3.py mirrors (same LAYOUT, same z-order)
and draws each hat twice: from scripts/headwear4-prerepair/ and from the
installed art.

    python worn-repair-qa.py            all wave-4 hats
    python worn-repair-qa.py hat120 ... named hats, in the order given
"""
import importlib.util
import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
CH = r"C:\Users\user\Desktop\run\frontend\assets\character"
BACKUP = os.path.join(HERE, "headwear4-prerepair")
OUT = os.path.join(HERE, "qa-headwear4")

_spec = importlib.util.spec_from_file_location("worn3", os.path.join(HERE, "worn-qa-3.py"))
worn3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(worn3)

SCALE = 0.62          # the head is all that matters here, so crop and shrink
COLS = 6
# worn-qa-3's baseline names the recoloured variants wave 3 installed; the
# garments kept their plain names since, so dress the probe in those.
worn3.BASE["top"] = ("outfit", "top1.png", {})
worn3.BASE["bottom"] = ("outfit", "bottom1.png", {})


def dressed(item, folder):
    """The base loadout with this hat on top, hat art taken from `folder`."""
    c = Image.new("RGBA", (worn3.BODY_W + 2 * worn3.MARGIN,
                           round(worn3.BODY_H + worn3.HEADROOM) + 8), (46, 48, 54, 255))
    lay = item.get("layout") or {}
    if item.get("back"):
        worn3.place(c, Image.open(os.path.join(folder, item["back"])).convert("RGBA"),
                    "headwear", lay)
    c.alpha_composite(worn3.art("body", "body.png").resize((worn3.BODY_W, worn3.BODY_H),
                                                           Image.LANCZOS),
                      (worn3.MARGIN, round(worn3.HEADROOM)))
    for slot in ("bottom", "top"):
        f, fn, l = worn3.BASE[slot]
        worn3.place(c, worn3.art(f, fn), slot, l)
    worn3.replay_head(c)
    f, fn, l = worn3.BASE["face"]
    worn3.place(c, worn3.art(f, fn), "face", l)
    if not item.get("hideHair"):
        f, fn, l = worn3.BASE["hair"]
        worn3.place(c, worn3.art(f, fn), "hair", l)
    worn3.place(c, Image.open(os.path.join(folder, item["stem"] + ".png")).convert("RGBA"),
                "headwear", lay)
    return c.crop((0, 0, c.width, round(0.42 * c.height)))


def main():
    manifest = json.load(open(os.path.join(HERE, "installed-headwear4.json")))
    want = sys.argv[1:]
    items = [m for m in manifest
             if os.path.exists(os.path.join(BACKUP, m["stem"] + ".png"))
             and (not want or m["stem"] in want)]
    if want:
        items.sort(key=lambda m: want.index(m["stem"]))
    if not items:
        print("nothing to draw")
        return

    probe = dressed(items[0], BACKUP)
    cw, chh = round(probe.width * SCALE), round(probe.height * SCALE)
    rows = -(-len(items) // COLS)
    sheet = Image.new("RGB", (COLS * (cw * 2 + 10) + 10, rows * (chh + 20) + 10), (24, 25, 28))
    d = ImageDraw.Draw(sheet)
    hats = os.path.join(CH, "headwear")
    for i, m in enumerate(items):
        r, c = divmod(i, COLS)
        for j, folder in enumerate((BACKUP, hats)):
            im = dressed(m, folder).resize((cw, chh), Image.LANCZOS).convert("RGB")
            sheet.paste(im, (10 + c * (cw * 2 + 10) + j * cw, 10 + r * (chh + 20)))
        d.text((12 + c * (cw * 2 + 10), 10 + r * (chh + 20) + chh + 4),
               f"{m['stem']} {m['label']}  before | after", fill=(225, 225, 230))
    os.makedirs(OUT, exist_ok=True)
    name = "worn-repair-picked.png" if want else "worn-repair.png"
    path = os.path.join(OUT, name)
    sheet.save(path, quality=94)
    print(path, sheet.size, len(items), "hats")


if __name__ == "__main__":
    main()
