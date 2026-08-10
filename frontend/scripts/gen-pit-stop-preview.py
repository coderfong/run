"""Render deterministic Pit Stop phone-width QA images.

This is deliberately a static compositor, not a second implementation. It
mirrors the frames in config/pitStop.js and CharacterRig's layer math closely
enough to catch crop, collision, and visual-hierarchy mistakes when a browser
or simulator is unavailable. Output is ignored under scripts/qa-pit-stop/.

Run from frontend/:

    python scripts/gen-pit-stop-preview.py
"""

import math
import os

from PIL import Image, ImageDraw


FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = os.path.join(FE, "assets", "character")
OUT = os.path.join(FE, "scripts", "qa-pit-stop")

W, H = 1536, 1146
# What the hero SHOWS. The scene is still drawn against the full H; the bottom
# of the counter skirt is cropped off, matching SCENE.visibleHeight.
VISIBLE_H = 1014
INK = "#0C0C10"
SKY_TOP = "#16273D"
SKY_BOTTOM = "#0F3946"
FABRIC = "#F5EFE6"
FABRIC_SHADE = "#E2D8C8"
FABRIC_DEEP = "#CFC2AE"
TEAL = "#2DD4BF"
PINK = "#EC4899"
GOLD = "#F5C451"
PAPER = "#FAF7F2"
BOARD = "#123243"
COUNTER_TOP = "#1C5B69"
COUNTER_FACE = "#12414E"
PURPLE = "#8B5CF6"

BODY_W, BODY_H = 248, 640
HEADROOM = round(BODY_H * 0.14)
HAIR_LIFT = -0.05
LAYOUT = {
    "face": {"w": 0.3735, "top": (8 + 0.34 * 218) / 640},
    "hair": {"w": 0.92, "top": -0.025},
    "headwear": {"w": 0.85, "top": -0.07},
    "top": {"w": 0.9718, "top": 0.3169},
    "bottom": {"w": 0.62, "top": 0.554},
    "accessory": {"w": 0.9, "top": 0.32},
}


FE_ASSETS = os.path.join(FE, "assets")

# Layers that are no longer drawn here at all, because real art now ships for
# them: the supplied clips are pasted straight in at their first frame, which
# makes this preview a truer mirror of the screen than an approximation of them
# could be. Frames mirror PIT_STOP_LAYOUT in config/pitStop.js.
PROP_CLIPS = {
    "coconut": ("animations/prop-coconut.webp", (40, 686, 260, 906)),
    "watermelon": ("animations/prop-watermelon.webp", (635, 656, 885, 906)),
    "sodaBottles": ("animations/prop-soda-bottles.webp", (1290, 686, 1510, 906)),
    # `balloons` was here — dropped from the scene, so dropped from the mirror.
    "openSign": ("animations/open-sign.webp", (598, 28, 938, 368)),
}

# y, tile width, opacity — the three sky strips in PIT_STOP_ANIM.ambient.clouds.
CLOUD_STRIPS = ((8, 220, 0.14), (3, 330, 0.20), (0, 460, 0.28))


def rgba(path):
    return Image.open(path).convert("RGBA")


def paste_clip(canvas, rel, box):
    """First frame of a shipped clip, scaled into its layout frame."""
    path = os.path.join(FE_ASSETS, rel)
    if not os.path.exists(path):
        return
    with Image.open(path) as clip:
        frame = clip.convert("RGBA")
    left, top, right, bottom = box
    frame = frame.resize((right - left, bottom - top), Image.Resampling.LANCZOS)
    canvas.alpha_composite(frame, (left, top))


def paste_cloud_strips(canvas):
    """The tiling sky band, laid across the scene at its three parallax sizes."""
    path = os.path.join(FE_ASSETS, "art", "shop", "pitstop-cloud-band.png")
    if not os.path.exists(path):
        return
    band = rgba(path)
    for y, tile_w, opacity in CLOUD_STRIPS:
        tile_h = round(tile_w * band.height / band.width)
        tile = band.resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        tile.putalpha(tile.getchannel("A").point(lambda a: round(a * opacity)))
        for x in range(0, W + tile_w, tile_w):
            canvas.alpha_composite(tile, (x, y))


def asset(folder, name):
    return rgba(os.path.join(CH, folder, name))


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


def crew_avatar(role):
    """The three exact loadouts declared in PIT_STOP_CREW."""
    specs = {
        "keeper": {
            "face": "faceN22.png",
            "hair": ("hairM5_0.png", {"top": -0.045}),
            "hat": ("hat11_9.png", "hat11b_9.png", {}),
            "top": ("top13_6.png", {"w": 0.95, "top": 0.3021}),
            "bottom": ("bottom5_1.png", {"w": 0.66}),
            "acc": ("acc2.png", None, {"w": 0.84, "top": 0.3328}),
        },
        "restocker": {
            "face": "faceN23.png",
            "hair": ("hairX22.png", {"w": 1.168, "top": 0.0022}),
            "hat": ("hat1_6.png", None, {}),
            "top": ("top14_3.png", {"w": 0.98, "top": 0.3002}),
            "bottom": ("bottom9_1.png", {"w": 0.62}),
            "acc": None,
        },
        "helper": {
            "face": "faceN23.png",
            "hair": ("hairW8_4.png", {"w": 1.0, "top": -0.06}),
            "hat": ("hat5_0.png", "hat5b_0.png", {"w": 0.68, "top": 0.045}),
            "top": ("top12_9.png", {"w": 0.75, "top": 0.3021}),
            "bottom": ("bottom7_8.png", {"w": 0.6}),
            "acc": ("acc7.png", "acc7b.png", {"w": 0.26, "top": 0.2853}),
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
    bottom, bottom_layout = specs["bottom"]
    place(c, asset("outfit", bottom), "bottom", bottom_layout)
    top, top_layout = specs["top"]
    place(c, asset("outfit", top), "top", top_layout)
    if specs["acc"]:
        front, _, acc_layout = specs["acc"]
        place(c, asset("accessory", front), "accessory", acc_layout)

    # Exact foreground head plate: the runtime draws this after every torso
    # layer, which is the jaw-ordering fix this preview must preserve.
    c.alpha_composite(asset("body", "head.png"), (0, HEADROOM))
    place(c, asset("face", specs["face"]), "face")
    hair, hair_layout = specs["hair"]
    place(c, asset("hair", hair), "hair", hair_layout)
    place(c, asset("headwear", hat), "headwear", hat_layout)
    return c


def rounded(draw, box, radius, fill, outline=INK, width=8):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def draw_scene():
    im = Image.new("RGBA", (W, H), SKY_BOTTOM)
    px = im.load()
    top = tuple(int(SKY_TOP[i:i + 2], 16) for i in (1, 3, 5))
    bottom = tuple(int(SKY_BOTTOM[i:i + 2], 16) for i in (1, 3, 5))
    for y in range(H):
        t = y / (H - 1)
        col = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,)
        for x in range(W):
            px[x, y] = col
    # Sky strips go down before the canopy, which is what crops them — only
    # the tops of the clouds survive above the tent, and that is the effect.
    paste_cloud_strips(im)
    d = ImageDraw.Draw(im)

    # Tent and back wall.
    d.rectangle((96, 250, 126, H), fill=FABRIC_SHADE, outline=INK, width=8)
    d.rectangle((1410, 250, 1440, H), fill=FABRIC_SHADE, outline=INK, width=8)
    d.polygon([(-30, 268), (-30, 132), (768, 34), (1566, 132), (1566, 268)], fill=FABRIC, outline=INK)
    for i in range(13):
        x = -30 + i * 128
        d.rectangle((x, 112, x + 64, 264), fill=TEAL if i % 2 == 0 else PINK)
    d.line([(-30, 268), (-30, 132), (768, 34), (1566, 132), (1566, 268)], fill=INK, width=8, joint="curve")
    rounded(d, (110, 262, 1426, 884), 2, FABRIC_SHADE, width=8)
    for x in (260, 470, 700, 940, 1180):
        d.line((x, 270, x + 14, 876), fill=FABRIC_DEEP, width=14)

    # Shelves and deliberately separated stock.
    for x in (116, 1064):
        rounded(d, (x, 520, x + 360, 538), 6, BOARD, width=5)
        d.rectangle((x + 26, 538, x + 42, 572), fill=BOARD, outline=INK, width=5)
        d.rectangle((x + 318, 538, x + 334, 572), fill=BOARD, outline=INK, width=5)
    for x, col in ((230, PINK), (286, "#60A5FA")):
        rounded(d, (x, 446, x + 40, 520), 12, col, width=5)
        rounded(d, (x + 12, 428, x + 28, 448), 4, PAPER, width=5)
    for i in range(3):
        rounded(d, (342, 494 - i * 22, 462, 516 - i * 22), 6, TEAL if i == 1 else PAPER, width=5)
    for x in (1180, 1248):
        d.polygon([(x, 442), (x + 52, 442), (x + 44, 520), (x + 8, 520)], fill=PAPER, outline=INK)

    # Wall props.
    rounded(d, (486, 360, 614, 474), 12, BOARD, width=6)
    d.line((510, 446, 548, 414, 576, 390), fill=TEAL, width=8)
    rounded(d, (946, 372, 1074, 488), 10, PAPER, width=6)
    d.rectangle((968, 398, 1052, 412), fill=PINK)
    rounded(d, (126, 432, 206, 512), 40, "#60A5FA", width=7)

    # Hanging props behind the crew.
    def bottle(x, y, h, col):
        d.line((x + 37, y, x + 37, y + 62), fill=INK, width=6)
        rounded(d, (x + 6, y + 62, x + 68, y + h - 6), 22, col, width=6)
        d.rectangle((x + 14, y + 96, x + 60, y + 126), fill=PAPER)

    bottle(56, 292, 210, TEAL)

    # Counter top. Nothing stands on it behind the crew any more — the drawn
    # cooler shared a lane with the featured item and was covered by it.
    d.polygon([(20, 830), (1516, 830), (1516, 900), (20, 900)], fill=COUNTER_TOP, outline=INK)
    rounded(d, (457, 702, 607, 738), 12, TEAL, width=8)

    # Exact catalogue avatars.
    for role, cx, y, width in (
        ("restocker", 330, 320, 260),
        ("helper", 1210, 310, 265),
        ("keeper", 768, 183, 330),
    ):
        av = crew_avatar(role)
        ah = round(av.height * width / av.width)
        av = av.resize((width, ah), Image.Resampling.LANCZOS)
        im.alpha_composite(av, (round(cx - width / 2), y))

    # Offered cup, resting just above the counter.
    rounded(d, (967, 714, 1043, 828), 12, PAPER, width=8)
    d.polygon([(974, 740), (1036, 740), (1028, 820), (982, 820)], fill="#93C5FD")

    # Counter front, then the foreground stock row.
    d.rectangle((20, 900, 1516, H + 10), fill=COUNTER_FACE, outline=INK, width=8)
    d.rectangle((20, 914, 1516, H), fill=TEAL)
    d.rectangle((20, 984, 1516, 1010), fill=PURPLE)
    d.line((20, 914, 1516, 914), fill=INK, width=5)
    d.line((20, 984, 1516, 984), fill=INK, width=5)
    d.line((20, 1010, 1516, 1010), fill=INK, width=5)

    # Towels and the reward box are still drawn; the rest of the front row is
    # shipped art, pasted below.
    rounded(d, (264, 770, 396, 902), 18, PURPLE, width=8)
    d.line((330, 770, 330, 902), fill=GOLD, width=14)
    for slot in ("coconut", "watermelon", "sodaBottles"):
        paste_clip(im, *PROP_CLIPS[slot])

    # Right cluster in its corrected, fully visible frames.
    d.line((1390, 286, 1360, 418), fill=PINK, width=16)
    d.line((1390, 286, 1420, 418), fill=PINK, width=16)
    d.ellipse((1342, 418, 1438, 514), fill=GOLD, outline=INK, width=7)
    bottle(1454, 292, 196, PINK)

    # High bunting and sign are the final foreground layers.
    pts = []
    for x in range(-40, W + 41, 118):
        lift = math.sin((x / W) * math.pi) * 92
        y = 180 - lift
        pts.append((x, y))
    d.line(pts, fill=INK, width=7)
    palette = (TEAL, PINK, GOLD, PAPER)
    for i, (x, y) in enumerate(pts):
        d.polygon([(x, y), (x + 72, y), (x + 36, y + 70)], fill=palette[i % 4], outline=INK)
    # The OPEN sign is last of all: it is the nearest object in the scene, in
    # front of the counter and the bunting both.
    paste_clip(im, *PROP_CLIPS["openSign"])
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    scene = draw_scene()
    for width in (320, 390, 430):
        height = round(VISIBLE_H * width / W)
        full_h = round(H * width / W)
        out = scene.resize((width, full_h), Image.Resampling.LANCZOS).crop((0, 0, width, height)).convert("RGB")
        path = os.path.join(OUT, f"pit-stop-{width}.png")
        out.save(path, quality=94)
        print("wrote", path, out.size)


if __name__ == "__main__":
    main()
