"""Render deterministic Pit Stop phone-width QA images.

This is deliberately a static compositor, not a second implementation. It
mirrors the frames in config/pitStop.js and CharacterRig's layer math closely
enough to catch crop, collision, and visual-hierarchy mistakes when a browser
or simulator is unavailable.

IT DRAWS THE REAL PLATES. The stall used to be re-drawn here in ImageDraw
primitives, which meant this mirror could agree with itself and still disagree
with the app. Now that the environment is two painted files, the mirror opens
those files — so the only things approximated are the crew (rebuilt from the
same catalogue PNGs the rig composes) and the small vector props, which are
stand-in shapes at their real frames. A collision this shows is a real one.

Run from frontend/:

    python scripts/gen-pit-stop-preview.py

Output is ignored under scripts/qa-pit-stop/.
"""

import os

from PIL import Image, ImageDraw


FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = os.path.join(FE, "assets", "character")
FE_ASSETS = os.path.join(FE, "assets")
OUT = os.path.join(FE, "scripts", "qa-pit-stop")

# The reference box from config/pitStop.js. The plates are cut at this aspect
# and are upscaled to it here, which is exactly what the scene does on device.
W, H = 1536, 1490
COUNTER_TOP = 1188

INK = "#0C0C10"
SIGN_BOARD = "#1173AE"
PLATE_SKY = "#55C1FD"
TEAL = "#2DD4BF"
GOLD = "#F5C451"
PAPER = "#FAF7F2"

BODY_W, BODY_H = 248, 640
HEADROOM = round(BODY_H * 0.14)
HAIR_LIFT = -0.02
LAYOUT = {
    "face": {"w": 0.3735, "top": (8 + 0.34 * 218) / 640},
    "hair": {"w": 0.92, "top": -0.025},
    "headwear": {"w": 0.85, "top": -0.07},
    "top": {"w": 0.9718, "top": 0.3169},
    "bottom": {"w": 0.62, "top": 0.554},
    "accessory": {"w": 0.9, "top": 0.32},
}

# The painted plates, in draw order around the crew.
PLATES = (
    os.path.join(FE_ASSETS, "art", "shop", "pitstop-backdrop.png"),
    os.path.join(FE_ASSETS, "art", "shop", "pitstop-counter.png"),
)

# Supplied clips, at PIT_STOP_LAYOUT's frames (left, top, right, bottom).
PROP_CLIPS = {
    "coconut": ("animations/prop-coconut.webp", (143, 1086, 329, 1272)),
    "watermelon": ("animations/prop-watermelon.webp", (666, 1068, 870, 1272)),
    "sodaBottles": ("animations/prop-soda-bottles.webp", (1207, 1086, 1393, 1272)),
}

# Icon art standing in the scene: the two shelf props and the reward box.
ICON_PROPS = {
    "stopwatch": ("icons/timer.png", (208, 832, 296, 920)),
    "trophy": ("icons/trophy.png", (1232, 836, 1320, 924)),
    "lootbox": ("icons/lootbox.png", (396, 1176, 508, 1288)),
}

CREW = (
    ("restocker", 418, 766, 215),
    ("helper", 1112, 758, 220),
    ("keeper", 768, 668, 265),
)


def rgba(path):
    return Image.open(path).convert("RGBA")


def paste_fitted(canvas, path, box):
    """One asset scaled into its layout frame, keeping its own aspect."""
    if not os.path.exists(path):
        return
    with Image.open(path) as src:
        art = src.convert("RGBA")
    left, top, right, bottom = box
    width = right - left
    height = round(art.height * width / art.width)
    art = art.resize((width, max(1, height)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(art, (left, top))


def place(canvas, im, slot, layout=None):
    spec = {**LAYOUT[slot], **(layout or {})}
    width = spec["w"] * BODY_W
    height = width * im.height / im.width
    top = spec.get("cy", None)
    top = top * BODY_H - height / 2 if top is not None else spec["top"] * BODY_H
    if slot == "hair":
        top += HAIR_LIFT * BODY_H
    left = BODY_W / 2 - width / 2 + spec.get("dx", 0) * BODY_W
    im = im.resize((max(1, round(width)), max(1, round(height))), Image.Resampling.LANCZOS)
    canvas.alpha_composite(im, (round(left), round(top + HEADROOM)))


def asset(folder, name):
    return rgba(os.path.join(CH, folder, name))


def crew_avatar(role):
    """The three exact loadouts declared in PIT_STOP_CREW.

    Art filenames and layouts are copied from the catalogue entries in
    config/cosmetics.js, colour suffix included — `_6` is CLOTH_COLORS teal,
    `_9` pink, `_0` white/black. Keep them in step: a stale layout here is a
    mirror that disagrees with the screen it exists to check.

    NOBODY WEARS BOTTOMS. All three crew are `bottom: 'none'` — everything
    below the hip is behind the counter, so the slot would ship art nobody can
    see. The restocker's hair is likewise absent: `cap` is `hidesBulky` and
    `curls` is `bulky`, so the rig hides it, and drawing it here would put a
    head in this preview that the app does not draw.
    """
    specs = {
        "keeper": {
            "face": "faceN23.png",
            "hair": ("hairM5_0.png", {"top": -0.045}),
            "hat": ("hat11_9.png", "hat11b_9.png", {"w": 0.6133, "top": -0.010, "dx": -0.005}),
            "top": ("top13_6.png", {"w": 0.95, "top": 0.3021}),
            "acc": ("acc2.png", None, {"w": 0.64, "top": 0.3276}),
        },
        "restocker": {
            "face": "faceN23.png",
            "hair": None,
            "hat": ("hat1_6.png", None, {"w": 0.6567, "top": -0.0571, "dx": -0.0033}),
            "top": ("top14_3.png", {"w": 0.98, "top": 0.2744}),
            "acc": None,
        },
        "helper": {
            "face": "faceN23.png",
            "hair": ("hairW8_4.png", {"w": 1.0, "top": -0.06}),
            "hat": ("hat5_0.png", "hat5b_0.png", {"w": 0.6234, "top": 0.0579, "dx": -0.0017}),
            "top": ("top12_9.png", {"w": 0.6233, "top": 0.3356, "dx": 0.0067}),
            "acc": ("acc7.png", "acc7b.png", {"w": 0.37, "top": 0.2608, "dx": 0.005}),
        },
    }[role]

    c = Image.new("RGBA", (BODY_W, BODY_H + HEADROOM), (0, 0, 0, 0))
    hat, hat_back, hat_layout = specs["hat"]
    if specs["acc"] and specs["acc"][1]:
        _, back, layout = specs["acc"]
        place(c, asset("accessory", back), "accessory", layout)
    if hat_back:
        place(c, asset("headwear", hat_back), "headwear", hat_layout)

    c.alpha_composite(asset("body", "body.png"), (0, HEADROOM))
    top, top_layout = specs["top"]
    place(c, asset("outfit", top), "top", top_layout)
    if specs["acc"]:
        front, _, acc_layout = specs["acc"]
        place(c, asset("accessory", front), "accessory", acc_layout)

    # Exact foreground head plate: the runtime draws this after every torso
    # layer, which is the jaw-ordering fix this preview must preserve.
    c.alpha_composite(asset("body", "head.png"), (0, HEADROOM))
    place(c, asset("face", specs["face"]), "face")
    if specs["hair"]:
        hair, hair_layout = specs["hair"]
        place(c, asset("hair", hair), "hair", hair_layout)
    place(c, asset("headwear", hat), "headwear", hat_layout)
    return c


def plate(path):
    if not os.path.exists(path):
        raise SystemExit(f"missing plate {path} — run scripts/install-pit-stop-art.py")
    return rgba(path).resize((W, H), Image.Resampling.LANCZOS)


def hanging_bottle(d, box, colour):
    left, top, right, bottom = box
    mid = (left + right) // 2
    d.line((mid, top, mid, top + 40), fill=INK, width=6)
    d.rounded_rectangle((left, top + 40, right, bottom), radius=20, fill=colour,
                        outline=INK, width=6)
    d.rectangle((left + 8, top + 78, right - 8, top + 108), fill=PAPER)


def hanging_medal(d, box):
    left, top, right, bottom = box
    mid = (left + right) // 2
    d.line((mid, top, left + 12, top + 96), fill="#EC4899", width=14)
    d.line((mid, top, right - 12, top + 96), fill="#EC4899", width=14)
    d.ellipse((left, bottom - (right - left), right, bottom), fill=GOLD,
              outline=INK, width=7)


def offer_cup(d, box):
    left, top, right, bottom = box
    d.rounded_rectangle(box, radius=12, fill=PAPER, outline=INK, width=8)
    d.polygon([(left + 8, top + 26), (right - 8, top + 26),
               (right - 16, bottom - 10), (left + 16, bottom - 10)], fill="#93C5FD")


def station_sign(d):
    left, top, width, height = 553, 435, 430, 118
    d.rounded_rectangle((left, top, left + width, top + height), radius=14,
                        fill=SIGN_BOARD, outline=INK, width=8)
    # The real screen sets this in type; a bar stands in for the word so the
    # board's footprint is what gets checked, not the font.
    d.rectangle((left + 40, top + 46, left + width - 40, top + height - 46),
                fill="#FFFFFF")


def draw_scene():
    im = Image.new("RGBA", (W, H), PLATE_SKY)

    # 01 backdrop, and the two icons standing on its shelves.
    im.alpha_composite(plate(PLATES[0]))
    for key in ("stopwatch", "trophy"):
        rel, box = ICON_PROPS[key]
        paste_fitted(im, os.path.join(FE_ASSETS, rel), box)

    d = ImageDraw.Draw(im)

    # 02 hanging props, in the two clear lanes.
    hanging_bottle(d, (545, 671, 611, 849), TEAL)
    hanging_medal(d, (918, 671, 1002, 867))

    # 03-04 the crew, drawn back to front (the attendant last).
    for role, cx, y, width in CREW:
        av = crew_avatar(role)
        ah = round(av.height * width / av.width)
        av = av.resize((width, ah), Image.Resampling.LANCZOS)
        im.alpha_composite(av, (round(cx - width / 2), y))

    # The offered cup, resting at the counter's back edge.
    offer_cup(ImageDraw.Draw(im), (919, 1074, 1001, 1186))

    # 05 the counter, then the stock standing on it.
    im.alpha_composite(plate(PLATES[1]))
    for rel, box in PROP_CLIPS.values():
        paste_fitted(im, os.path.join(FE_ASSETS, rel), box)
    rel, box = ICON_PROPS["lootbox"]
    paste_fitted(im, os.path.join(FE_ASSETS, rel), box)

    # 07 the sign, last, so nothing crosses it.
    station_sign(ImageDraw.Draw(im))
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    scene = draw_scene()
    for width in (320, 390, 430):
        height = round(H * width / W)
        out = scene.resize((width, height), Image.Resampling.LANCZOS).convert("RGB")
        path = os.path.join(OUT, f"pit-stop-{width}.png")
        out.save(path, quality=94)
        print("wrote", path, out.size)
    full = os.path.join(OUT, "pit-stop-full.png")
    scene.convert("RGB").save(full)
    print("wrote", full, scene.size)


if __name__ == "__main__":
    main()
