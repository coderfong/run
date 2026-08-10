"""Composite every wave-3 item onto the body and montage the result.

Mirrors CharacterRig's Layer math exactly (same LAYOUT table, same HAIR_LIFT,
same z-order including back-halves rendered behind the body) so what shows up
here is what the app draws. Reads installed3.json, so it always reflects
whatever install-items-3.py last wrote.

  python worn-qa-3.py            all items, grouped by slot
  python worn-qa-3.py hair top   only those slots
"""
import json
import os
import sys
from PIL import Image, ImageDraw

SCRATCH = os.path.dirname(os.path.abspath(__file__))
CH = r"C:\Users\user\Desktop\run\frontend\assets\character"
QA = os.path.join(SCRATCH, "qa3")

BODY_W, BODY_H = 248, 640
HEADROOM = 0.14 * BODY_H
HAIR_LIFT = -0.05
MARGIN = 90

LAYOUT = {
    "face": dict(w=0.3735, top=0.1283),
    "glasses": dict(w=0.5445, cy=0.1692),
    "hair": dict(w=0.92, top=-0.025),
    "headwear": dict(w=0.85, top=-0.07),
    "top": dict(w=0.9718, top=0.3169),
    "bottom": dict(w=0.62, top=0.554),
    "onepiece": dict(w=0.62, top=0.4197),
    "accessory": dict(w=0.9, top=0.32),
}

# the baseline loadout every probe is dressed in
BASE = {
    "face": ("face", "faceN9.png", {}),
    "hair": ("hair", "hairM1_0.png", {}),
    "top": ("outfit", "top1_7.png", {}),
    "bottom": ("outfit", "bottom1_1.png", {}),
}


def art(folder, f):
    return Image.open(os.path.join(CH, folder, f)).convert("RGBA")


def place(canvas, img, slot, layout, fit=None):
    spec = {**LAYOUT[fit or slot], **(layout or {})}
    w = spec["w"] * BODY_W
    h = w * img.height / img.width
    top = (spec["cy"] * BODY_H - h / 2) if spec.get("cy") is not None \
        else spec["top"] * BODY_H
    if slot == "hair":
        top += HAIR_LIFT * BODY_H
    left = BODY_W / 2 - w / 2 + spec.get("dx", 0) * BODY_W
    canvas.alpha_composite(
        img.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS),
        (round(left) + MARGIN, round(top + HEADROOM)))


def replay_head(canvas):
    """Mirror CharacterRig's foreground head plate over torso wearables."""
    head = art("body", "head.png").resize((BODY_W, BODY_H), Image.LANCZOS)
    canvas.alpha_composite(head, (MARGIN, round(HEADROOM)))


def avatar(item):
    canvas = Image.new("RGBA", (BODY_W + 2 * MARGIN, round(BODY_H + HEADROOM) + 8),
                       (46, 48, 54, 255))
    slot = item["slot"]
    img = art(item["folder"], item["stem"] + ".png")
    back = art(item["folder"], item["back"]) if item.get("back") else None
    lay = item.get("layout") or {}

    # --- behind the body: back-z accessories and every wrap-around's far half
    if slot == "accessory" and item.get("z") == "back":
        place(canvas, img, "accessory", lay)
    if back:
        place(canvas, back, slot if slot in ("headwear", "accessory") else "accessory", lay)

    canvas.alpha_composite(art("body", "body.png").resize((BODY_W, BODY_H),
                                                          Image.LANCZOS),
                           (MARGIN, round(HEADROOM)))

    # --- bottom, top
    if slot == "bottom":
        place(canvas, img, "bottom", lay, fit=item.get("fit"))
    else:
        f, fn, l = BASE["bottom"]
        place(canvas, art(f, fn), "bottom", l)
    if slot == "top":
        place(canvas, img, "top", lay, fit=item.get("fit"))
    elif slot != "bottom" or not item.get("fit"):
        f, fn, l = BASE["top"]
        place(canvas, art(f, fn), "top", l)

    # --- front accessories, then face / hair / glasses / headwear
    if slot == "accessory" and item.get("z") != "back":
        place(canvas, img, "accessory", lay)
    replay_head(canvas)
    f, fn, l = BASE["face"]
    place(canvas, art(f, fn), "face", l)
    if slot == "hair":
        place(canvas, img, "hair", lay)
    elif not item.get("hideHair"):
        f, fn, l = BASE["hair"]
        place(canvas, art(f, fn), "hair", l)
    if slot == "glasses":
        place(canvas, img, "glasses", lay)
    if slot == "headwear":
        place(canvas, img, "headwear", lay)
    return canvas


def outfit(picks):
    """Full loadouts built only from wave-3 items — the layering test that
    single-item probes can't do: hat over hair, glasses over face, a neck
    piece between top and chin, wings behind everything."""
    canvas = Image.new("RGBA", (BODY_W + 2 * MARGIN, round(BODY_H + HEADROOM) + 8),
                       (46, 48, 54, 255))
    by = {i["slot"]: i for i in picks}
    acc, hat, hair = by.get("accessory"), by.get("headwear"), by.get("hair")

    if acc and acc.get("z") == "back":
        place(canvas, art(acc["folder"], acc["stem"] + ".png"), "accessory",
              acc.get("layout"))
    for it, slot in ((acc, "accessory"), (hat, "headwear")):
        if it and it.get("back"):
            place(canvas, art(it["folder"], it["back"]), slot, it.get("layout"))

    canvas.alpha_composite(art("body", "body.png").resize((BODY_W, BODY_H),
                                                          Image.LANCZOS),
                           (MARGIN, round(HEADROOM)))
    bottom, top = by.get("bottom"), by.get("top")
    onepiece = bottom and bottom.get("fit")
    if bottom:
        place(canvas, art(bottom["folder"], bottom["stem"] + ".png"), "bottom",
              bottom.get("layout"), fit=bottom.get("fit"))
    else:
        f, fn, l = BASE["bottom"]
        place(canvas, art(f, fn), "bottom", l)
    if top and not onepiece:
        place(canvas, art(top["folder"], top["stem"] + ".png"), "top",
              top.get("layout"), fit=top.get("fit"))
    elif not onepiece:
        f, fn, l = BASE["top"]
        place(canvas, art(f, fn), "top", l)

    if acc and acc.get("z") != "back":
        place(canvas, art(acc["folder"], acc["stem"] + ".png"), "accessory",
              acc.get("layout"))
    replay_head(canvas)
    f, fn, l = BASE["face"]
    place(canvas, art(f, fn), "face", l)
    hidden = hat and (hat.get("hideHair") or (hat.get("hidesBulky")
                                              and hair and hair.get("bulky")))
    if hair and not hidden:
        place(canvas, art(hair["folder"], hair["stem"] + ".png"), "hair",
              hair.get("layout"))
    elif not hat or not hat.get("hideHair"):
        if not hidden:
            f, fn, l = BASE["hair"]
            place(canvas, art(f, fn), "hair", l)
    g = by.get("glasses")
    if g:
        place(canvas, art(g["folder"], g["stem"] + ".png"), "glasses", g.get("layout"))
    if hat:
        place(canvas, art(hat["folder"], hat["stem"] + ".png"), "headwear",
              hat.get("layout"))
    return canvas


def outfits(items):
    import random
    random.seed(7)
    by = {}
    for i in items:
        by.setdefault(i["slot"], []).append(i)
    cell_w, cell_h, cols = 250, 330, 8
    picks = []
    for _ in range(24):
        combo = [random.choice(by[s]) for s in
                 ("hair", "headwear", "top", "bottom", "accessory") if s in by]
        if random.random() < 0.5 and "glasses" in by:
            combo.append(random.choice(by["glasses"]))
        picks.append(combo)
    rows = (len(picks) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (28, 30, 34))
    d = ImageDraw.Draw(sheet)
    for k, combo in enumerate(picks):
        av = outfit(combo)
        av.thumbnail((cell_w - 12, cell_h - 30), Image.LANCZOS)
        x = (k % cols) * cell_w + (cell_w - av.width) // 2
        y = (k // cols) * cell_h + (cell_h - av.height) // 2 + 10
        sheet.paste(av, (x, y), av)
        d.text(((k % cols) * cell_w + 6, (k // cols) * cell_h + 4),
               "+".join(i["id"][:7] for i in combo), fill=(255, 210, 90))
    p = os.path.join(QA, "worn-outfits.png")
    sheet.save(p)
    print("wrote", p)


def main():
    items = json.load(open(os.path.join(SCRATCH, "installed3.json")))
    if "--outfits" in sys.argv:
        return outfits(items)
    wanted = [a for a in sys.argv[1:] if not a.startswith("--")]
    if wanted:
        items = [i for i in items if i["slot"] in wanted]
    per_slot = {}
    for it in items:
        per_slot.setdefault(it["slot"], []).append(it)

    cell_w, cell_h, cols = 250, 330, 8
    for slot, group in per_slot.items():
        rows = (len(group) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (28, 30, 34))
        d = ImageDraw.Draw(sheet)
        for k, it in enumerate(group):
            av = avatar(it)
            av.thumbnail((cell_w - 12, cell_h - 30), Image.LANCZOS)
            x = (k % cols) * cell_w + (cell_w - av.width) // 2
            y = (k // cols) * cell_h + (cell_h - av.height) // 2 + 10
            sheet.paste(av, (x, y), av)
            d.text(((k % cols) * cell_w + 6, (k // cols) * cell_h + 4),
                   f"{it['idx']} {it['id']}", fill=(255, 210, 90))
        p = os.path.join(QA, f"worn-{slot}.png")
        sheet.save(p)
        print("wrote", p, f"({len(group)} items)")


if __name__ == "__main__":
    main()
