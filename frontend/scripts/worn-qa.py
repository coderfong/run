"""Composite the new items onto the real body art, mirroring CharacterRig."""
import json
import os
import re
from PIL import Image

CH = r"C:\Users\user\Desktop\run\frontend\assets\character"
COS = r"C:\Users\user\Desktop\run\frontend\src\config\cosmetics.js"
QA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qa")

BODY_W, BODY_H = 248, 640
HEADROOM = 0.14 * BODY_H
HAIR_LIFT = -0.05
MARGIN = 150

LAYOUT = {
    "face": dict(w=0.34, cy=0.1813), "glasses": dict(w=0.42, cy=0.166),
    "hair": dict(w=0.92, top=-0.025), "headwear": dict(w=0.85, top=-0.07),
    "top": dict(w=0.9718, top=0.3169), "bottom": dict(w=0.62, top=0.555),
    "onepiece": dict(w=0.62, top=0.42), "accessory": dict(w=0.9, top=0.32),
}

src = open(COS, encoding="utf-8").read()
CAT = {}
for m in re.finditer(r"\n  (\w+): \[([\s\S]*?)\n  \],", src):
    slot, body = m.group(1), m.group(2)
    for line in body.splitlines():
        mid = re.search(r"id: '([^']+)'", line)
        if not mid:
            continue
        img = re.search(r"img: require\('\.\./\.\./assets/character/([^']+)'\)", line)
        back = re.search(r"backImg: require\('\.\./\.\./assets/character/([^']+)'\)", line)
        lay = re.search(r"layout: \{([^}]*)\}", line)
        d = {}
        if lay:
            for kv in lay.group(1).split(","):
                if ":" in kv:
                    k, v = kv.split(":")
                    d[k.strip()] = float(v)
        CAT[(slot, mid.group(1))] = {
            "img": img.group(1) if img else None,
            "back": back.group(1) if back else None,
            "layout": d,
            "z": (re.search(r"z: '(\w+)'", line) or [None, None])[1],
            "fit": (re.search(r"fit: '(\w+)'", line) or [None, None])[1],
            "hideHair": "hideHair: true" in line,
        }


def place(canvas, path, slot, over, fit=None):
    im = Image.open(os.path.join(CH, path)).convert("RGBA")
    spec = {**LAYOUT[fit or slot], **over}
    w = spec["w"] * BODY_W
    h = w * im.height / im.width
    top = (spec["cy"] * BODY_H - h / 2) if spec.get("cy") is not None else spec["top"] * BODY_H
    if slot == "hair":
        top += HAIR_LIFT * BODY_H
    left = BODY_W / 2 - w / 2 + spec.get("dx", 0) * BODY_W
    im = im.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS)
    canvas.alpha_composite(im, (round(left + MARGIN), round(top + HEADROOM)))


def avatar(spec):
    W, H = BODY_W + 2 * MARGIN, round(BODY_H + HEADROOM) + 10
    c = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    body = Image.open(os.path.join(CH, "body", "body.png")).convert("RGBA").resize(
        (BODY_W, BODY_H), Image.LANCZOS)

    acc = CAT.get(("accessory", spec.get("accessory"))) if spec.get("accessory") else None
    if acc and acc["z"] == "back" and acc["img"]:
        place(c, acc["img"], "accessory", acc["layout"])
    if acc and acc["back"]:
        place(c, acc["back"], "accessory", acc["layout"])
    c.alpha_composite(body, (MARGIN, round(HEADROOM)))

    for slot in ("bottom", "top"):
        it = CAT.get((slot, spec.get(slot)))
        if it and it["img"]:
            place(c, it["img"], slot, it["layout"], it["fit"])
    if acc and acc["z"] != "back" and acc["img"]:
        place(c, acc["img"], "accessory", acc["layout"])
    face = CAT.get(("face", spec.get("face", "smiley")))
    if face and face["img"]:
        place(c, face["img"], "face", face["layout"])
    hat = CAT.get(("headwear", spec.get("headwear"))) if spec.get("headwear") else None
    if not (hat and hat["hideHair"]):
        hair = CAT.get(("hair", spec.get("hair")))
        if hair and hair["img"]:
            place(c, hair["img"], "hair", hair["layout"])
    for slot in ("glasses", "headwear"):
        it = CAT.get((slot, spec.get(slot)))
        if it and it["img"]:
            place(c, it["img"], slot, it["layout"])
    return c


TESTS = [
    dict(headwear="laurel", top="champjersey", bottom="flameshorts", face="determined"),
    dict(headwear="flamecrown", top="varsity", bottom="flamejoggers", accessory="dragonwings", face="smiley"),
    dict(headwear="halo", top="aurorajacket", bottom="lightjeans", accessory="jetpack", face="content"),
    dict(headwear="wolfears", glasses="cybershades", top="bomber", bottom="leatherpants", accessory="boombox"),
    dict(headwear="jester", glasses="monocle", top="cardigan", bottom="checkered", face="tongueout"),
    dict(headwear="piratehat", glasses="eyepatch", top="judogi", bottom="overalls", face="smiley"),
    dict(headwear="chefhat", top="labcoat", bottom="khakishorts", accessory="ribbonmedal", face="smiley"),
    dict(headwear="cowboyhat", glasses="aviators", top="denimjacket", bottom="rippedjeans", accessory="greenscarf"),
    dict(headwear="catears", glasses="starglasses", top="sailortop", bottom="denimshorts", accessory="starnecklace"),
    dict(headwear="turban", glasses="steampunk", top="utilityvest", bottom="cargoshorts", accessory="trophypack"),
    dict(headwear="tiara", top="stripedtee", bottom="bluejeans", accessory="tealscarf", face="hearteyes"),
    dict(headwear="frogbeanie", glasses="pixelshades", top="greyhoodie", bottom="sweatpants", accessory="headset"),
]

cell_w, cell_h, cols = 320, 500, 6
rows = (len(TESTS) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (34, 36, 40))
for i, t in enumerate(TESTS):
    av = avatar(t)
    av.thumbnail((cell_w - 10, cell_h - 10), Image.LANCZOS)
    x = (i % cols) * cell_w + (cell_w - av.width) // 2
    y = (i // cols) * cell_h + (cell_h - av.height) // 2
    sheet.paste(av, (x, y), av)
sheet.save(os.path.join(QA, "worn-new.png"))
print("wrote worn-new.png;", len(CAT), "catalogue entries parsed")
