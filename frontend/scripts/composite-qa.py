"""QA composites — mirror CharacterRig's Layer math over the real assets."""
import os
from PIL import Image

CH = r"C:\Users\user\Desktop\run\frontend\assets\character"
QA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "qa")

BODY_W, BODY_H = 248, 640
HEADROOM = 0.14 * BODY_H
HAIR_LIFT = -0.05
MARGIN_X = 130

LAYOUT = {
    "face": dict(w=0.34, cy=0.1813),
    "glasses": dict(w=0.42, cy=0.166),
    "hair": dict(w=0.92, top=-0.025),
    "headwear": dict(w=0.85, top=-0.07),
    "top": dict(w=0.9718, top=0.3169),
    "bottom": dict(w=0.62, top=0.555),
    "accessory": dict(w=0.9, top=0.32),
}

# id -> (folder, file, layout-overrides) ; variants picked via {i}
NEW = {
    "hijab":       ("hair", "hairW14_{i}.png", dict(w=0.88, top=0.02)),
    "curtainlong": ("hair", "hairW17_{i}.png", dict(w=0.95, top=-0.015)),
    "twoblock":    ("hair", "hairM11_{i}.png", dict(w=0.8, top=-0.01)),
    "buzz":        ("hair", "hairM12_{i}.png", dict(w=0.72, top=0.005)),
    "braids":      ("hair", "hairW15_{i}.png", dict(w=0.88, top=-0.02)),
    "bunstrands":  ("hair", "hairW16_{i}.png", dict(w=0.86, top=-0.08)),
    "comma":       ("hair", "hairM13_{i}.png", dict(w=0.82, top=-0.015)),
    "texturedcrop":("hair", "hairM14_{i}.png", dict(w=0.84, top=-0.03)),
    "curtains":    ("hair", "hairM1_{i}.png", dict()),
    "pixie":       ("hair", "hairW10_{i}.png", dict(top=-0.045)),
    "curls":       ("hair", "hairM5_{i}.png", dict(top=-0.045, bulky=True)),
    "longwaves":   ("hair", "hairW1_{i}.png", dict(top=0.015)),
    "roundfro":    ("hair", "hairM8_{i}.png", dict(top=-0.045, bulky=True)),
    "topknot":     ("hair", "hairM2_{i}.png", dict(w=0.88, top=-0.10, bulky=True)),
    "highpony":    ("hair", "hairW7_{i}.png", dict(w=0.90, top=-0.105, dx=0.03, bulky=True)),
    "cap":         ("headwear", "hat1_{i}.png", dict(hidesBulky=True)),
    "snapback":    ("headwear", "hat2_{i}.png", dict(hidesBulky=True)),
    "beanie":      ("headwear", "hat3_{i}.png", dict(top=-0.1, hideHair=True, back="hat3b_{i}.png")),
    "pombeanie":   ("headwear", "hat4_{i}.png", dict(top=-0.115, hideHair=True, back="hat4b_{i}.png")),
    "sweatband":   ("headwear", "hat5_{i}.png", dict(w=0.68, top=0.045)),
    "bandana":     ("headwear", "hat6_{i}.png", dict(w=0.66, top=0.02)),
    "crown":       ("headwear", "hat7.png", dict(w=0.62, top=-0.085)),
    "bikehelmet":  ("headwear", "hat8.png", dict(top=-0.085, hideHair=True)),
    "skatehelmet": ("headwear", "hat9.png", dict(w=0.82, hideHair=True)),
    "bucket":      ("headwear", "hat10_{i}.png", dict(hideHair=True)),
    "visor":       ("headwear", "hat11_{i}.png", dict()),
    "hardhat":     ("headwear", "hat12.png", dict(top=-0.095, hidesBulky=True)),
    "scarf":       ("accessory", "acc5.png", dict(w=0.5, top=0.272, back="acc5b.png")),
    "goldmedal":   ("accessory", "acc7.png", dict(w=0.26, top=0.285, back="acc7b.png")),
    "hydropack":   ("accessory", "acc1.png", dict(w=0.92, cy=0.42, back="acc1b.png")),
    "hydrovest":   ("accessory", "acc2.png", dict(w=0.84, top=0.325)),
    "cape":        ("accessory", "acc6.png", dict(w=1.18, top=0.285, back="acc6b.png")),
    "champmedal":  ("accessory", "acc8.png", dict(w=0.24, top=0.26, back="acc8b.png")),
    "angelwings":  ("accessory", "acc3.png", dict(w=1.7, cy=0.36)),
    "neonwings":   ("accessory", "acc4.png", dict(w=1.7, cy=0.36)),
    "singlet":     ("outfit", "top12_{i}.png", dict(w=0.75, top=0.302)),
    "oversized":   ("outfit", "top17_{i}.png", dict(w=1.0, top=0.302)),
    "camisole":    ("outfit", "top16_{i}.png", dict(w=0.72)),
    "polo":        ("outfit", "top13_{i}.png", dict(w=0.95, top=0.302)),
    "croptee":     ("outfit", "top15_{i}.png", dict(w=0.9, top=0.335)),
    "windbreaker": ("outfit", "top14_{i}.png", dict(w=0.98, top=0.3)),
    "tee":         ("outfit", "top1_{i}.png", dict()),
    "fbtshorts":   ("outfit", "bottom5_{i}.png", dict(w=0.66)),
    "trackpants":  ("outfit", "bottom9_{i}.png", dict(w=0.62)),
    "leggings":    ("outfit", "bottom6_{i}.png", dict(w=0.62)),
    "bikeshorts":  ("outfit", "bottom7_{i}.png", dict(w=0.6)),
    "tennisskirt": ("outfit", "bottom8_{i}.png", dict(w=0.78, top=0.548)),
    "pants":       ("outfit", "bottom1_{i}.png", dict()),
    "wayfarer":    ("glasses", "specs4_{i}.png", dict(w=0.51)),
    "roundgold":   ("glasses", "specs9_{i}.png", dict(w=0.48)),
    "halfframe":   ("glasses", "specs8_{i}.png", dict(w=0.52)),
    "heart":       ("glasses", "specs7_{i}.png", dict(w=0.53)),
    "shieldvisor": ("glasses", "specs5_{i}.png", dict(w=0.55)),
    "cleargoggles":("glasses", "specs10_{i}.png", dict(w=0.56)),
    "sportshield": ("glasses", "specs3.png", dict(w=0.56)),
    "skigoggles":  ("glasses", "specs6.png", dict(w=0.58, cy=0.162)),
    "smiley":      ("face", "face2.png", dict()),
    "content":     ("face", "face15.png", dict()),
    "determined":  ("face", "face10.png", dict()),
    "tongueout":   ("face", "face14.png", dict()),
    "stareyes":    ("face", "face11.png", dict()),
    "hearteyes":   ("face", "face12.png", dict()),
    "exhausted":   ("face", "face13.png", dict(w=0.37)),
}

def load(iid, color=0):
    folder, f, over = NEW[iid]
    return Image.open(os.path.join(CH, folder, f.format(i=color))).convert("RGBA"), over

def place(canvas, img, slot, over):
    over = {k: v for k, v in over.items() if k not in ("hideHair", "back", "bulky")}
    spec = {**LAYOUT[slot], **over}
    w = spec["w"] * BODY_W
    h = w * img.height / img.width
    if spec.get("cy") is not None:
        top = spec["cy"] * BODY_H - h / 2
    else:
        top = spec["top"] * BODY_H
    if slot == "hair":
        top += HAIR_LIFT * BODY_H
    left = BODY_W / 2 - w / 2 + spec.get("dx", 0) * BODY_W
    im = img.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS)
    canvas.alpha_composite(im, (round(left + MARGIN_X), round(top + HEADROOM)))

def avatar(spec):
    W = BODY_W + 2 * MARGIN_X
    H = round(BODY_H + HEADROOM) + 10
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    body = Image.open(os.path.join(CH, "body", "body.png")).convert("RGBA")
    body = body.resize((BODY_W, BODY_H), Image.LANCZOS)

    def layer(slot, key, colorkey=None):
        iid = spec.get(key)
        if not iid:
            return None
        img, over = load(iid, spec.get(colorkey, 0) if colorkey else 0)
        return (slot, img, over)

    def back_layer(slot, key, colorkey=None):
        iid = spec.get(key)
        if not iid:
            return None
        folder, f, over = NEW[iid]
        if "back" not in over:
            return None
        color = spec.get(colorkey, 0) if colorkey else 0
        img = Image.open(os.path.join(CH, folder, over["back"].format(i=color))).convert("RGBA")
        return (slot, img, over)

    acc = layer("accessory", "accessory")
    acc_back = acc if acc and NEW[spec["accessory"]][0] == "accessory" and spec.get("accz") == "back" else None
    order = []
    if acc_back:
        order.append(acc_back)
    for bl in [back_layer("accessory", "accessory"),
               back_layer("headwear", "headwear", "headwearColor")]:
        if bl:
            order.append(bl)
    order.append(("body", body, None))
    for slot, key, ck in [("bottom", "bottom", "bottomColor"), ("top", "top", "topColor")]:
        l = layer(slot, key, ck)
        if l:
            order.append(l)
    if acc and not acc_back:
        order.append(acc)
    hat = spec.get("headwear")
    hair_bulky = spec.get("hair") and NEW[spec["hair"]][2].get("bulky")
    hat_hides = hat and (NEW[hat][2].get("hideHair")
                         or (NEW[hat][2].get("hidesBulky") and hair_bulky))
    for slot, key, ck in [("face", "face", None), ("hair", "hair", "hairColor"),
                          ("glasses", "glasses", "glassesColor"),
                          ("headwear", "headwear", "headwearColor")]:
        if slot == "hair" and hat_hides:
            continue
        l = layer(slot, key, ck)
        if l:
            order.append(l)
    for slot, img, over in order:
        if slot == "body":
            canvas.alpha_composite(body, (MARGIN_X, round(HEADROOM)))
        else:
            place(canvas, img, slot, over)
    return canvas

TESTS = [
    # necklines around the neck + resized singlet/vest
    dict(face="smiley", hair="twoblock", hairColor=0, top="singlet", topColor=2, bottom="fbtshorts", bottomColor=1),
    dict(face="determined", hair="curtains", hairColor=0, top="polo", topColor=0, bottom="trackpants", bottomColor=1),
    dict(face="smiley", hair="braids", hairColor=2, top="oversized", topColor=0, bottom="leggings", bottomColor=1),
    dict(face="hearteyes", hair="curtainlong", hairColor=1, top="croptee", topColor=9, bottom="tennisskirt", bottomColor=0),
    dict(face="exhausted", hair="comma", hairColor=0, top="singlet", topColor=7, bottom="fbtshorts", bottomColor=1, accessory="hydrovest"),
    # hydration pack: straps in front, pack behind
    dict(face="determined", hair="buzz", hairColor=1, top="singlet", topColor=4, bottom="fbtshorts", bottomColor=1, accessory="hydropack"),
    # snapback see-through hole + crown rim + no more back bands
    dict(face="smiley", hair="curtains", hairColor=3, headwear="snapback", headwearColor=1, top="tee", topColor=7, bottom="pants", bottomColor=1),
    dict(face="smiley", hair="bunstrands", hairColor=3, headwear="crown", top="camisole", topColor=4, bottom="tennisskirt", bottomColor=9),
    dict(face="tongueout", hair="buzz", hairColor=0, headwear="sweatband", headwearColor=2, top="oversized", topColor=3, bottom="bikeshorts", bottomColor=1),
    dict(face="content", hair="topknot", hairColor=1, headwear="visor", headwearColor=2, top="polo", topColor=0, bottom="trackpants", bottomColor=1),
    # widened hems + medal height + bigger glasses
    dict(face="smiley", hair="longwaves", hairColor=5, glasses="wayfarer", glassesColor=1, top="croptee", topColor=6, bottom="leggings", bottomColor=1),
    dict(face="smiley", hair="buzz", hairColor=1, glasses="heart", glassesColor=9, top="polo", topColor=2, bottom="bikeshorts", bottomColor=1, accessory="goldmedal"),
]

def main():
    cell_w, cell_h = 300, 460
    cols = 6
    rows = (len(TESTS) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (34, 36, 40))
    for i, t in enumerate(TESTS):
        av = avatar(t)
        av.thumbnail((cell_w - 10, cell_h - 10), Image.LANCZOS)
        x = (i % cols) * cell_w + (cell_w - av.width) // 2
        y = (i // cols) * cell_h + (cell_h - av.height) // 2
        sheet.paste(av, (x, y), av)
    p = os.path.join(QA, "composites.png")
    sheet.save(p)
    print("wrote", p)

if __name__ == "__main__":
    main()
