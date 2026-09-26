"""Build the ChatGPT pack for "hat hair": one redrawn version of each
hairstyle as it sits under a hat (crown pressed flat, sides and fringe kept).

For every listed hairstyle this writes C:\\Users\\user\\Desktop\\hat-hair\\guides\\<id>.png,
two panels side by side:

  ORIGINAL   the style's art in the reference colour (HAIR_COLORS[1]).
  GUIDE      the same art where the app draws it on the head, with the band a
             hat covers shaded magenta above the SEAT line and the skull
             outline dashed in cyan. Above the seat line the new hair has to
             stay inside that outline so every closed hat hides it; below the
             line it stays as drawn.

The seat line is the median measured seat of the live hats (headwearFit.json
`hats`, head fractions), so a lower hat hides a little more of the pressed
hair and a higher one shows a little of it.

Reads the Fit Studio's /manifest.json (so its server must be running) for
layouts, the rig and the hidden list.
"""
import json
import os
import urllib.request

from PIL import Image, ImageDraw, ImageFont

FRONT = r"C:\Users\user\Desktop\run\frontend"
OUT = r"C:\Users\user\Desktop\hat-hair"
STUDIO = "http://localhost:5178/manifest.json"

# Covers the whole head already; a hat goes on top of it as it is.
SKIP = {"none", "hijab"}
REF_COLOUR = 1                 # HAIR_COLORS[1], the dark brown
PANEL_H = 900                  # both panels are drawn this tall
BG = (243, 239, 231, 255)
MAGENTA = (236, 72, 153)
CYAN = (14, 165, 233)


def load_manifest():
    with urllib.request.urlopen(STUDIO) as r:
        return json.load(r)


def seat_line(m):
    hats = [h for h in m["items"]["headwear"] if h["id"] != "none" and not h.get("hidden")]
    ys = sorted(m["fit"]["hats"][h["id"]]["edgeY"] for h in hats
                if h["id"] in m["fit"]["hats"] and m["fit"]["hats"][h["id"]].get("edgeY") is not None)
    return ys[len(ys) // 2]


def art_path(item):
    art = item.get("art") or []
    rel = art[REF_COLOUR] if len(art) > REF_COLOUR else (art[0] if art else item["img"])
    return os.path.join(FRONT, rel)


def hair_frame(m, item, nat_w, nat_h):
    """frameOf('hair') from the studio, in 248-wide body px."""
    rig = m["rig"]
    body_w = 248.0
    body_h = body_w * rig["BODY_RATIO"]
    spec = {**rig["LAYOUT"]["hair"], **(item.get("layout") or {})}
    w = spec["w"] * body_w
    h = w * nat_h / nat_w
    top = spec["cy"] * body_h - h / 2 if spec.get("cy") is not None else spec["top"] * body_h
    top += rig["HAIR_LIFT"] * body_h
    left = body_w / 2 - w / 2 + (spec.get("dx") or 0) * body_w
    return left, top, w, h


def font(size):
    try:
        return ImageFont.truetype("arialbd.ttf", size)
    except OSError:
        return ImageFont.load_default()


def dashed(draw, pts, fill, width, dash=14, gap=9):
    run, on = 0.0, True
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        seg = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
        if on:
            draw.line([(x0, y0), (x1, y1)], fill=fill, width=width)
        run += seg
        if run >= (dash if on else gap):
            run, on = 0.0, not on


def skull_top(head_alpha, y_limit):
    """The head's outer edge, left side then right, down to y_limit (body px)."""
    w, h = head_alpha.size
    px = head_alpha.load()
    left, right = [], []
    for y in range(0, int(y_limit) + 1):
        xs = [x for x in range(w) if px[x, y] > 128]
        if xs:
            left.append((xs[0], y))
            right.append((xs[-1], y))
    # up the left side, across the crown, down the right side
    return left[::-1] + right


def guide(m, item, seat_y):
    rig = m["rig"]
    head = rig["HEAD"]
    hair = Image.open(art_path(item)).convert("RGBA")
    nat_w, nat_h = hair.size
    left, top, w, h = hair_frame(m, item, nat_w, nat_h)

    body = Image.open(os.path.join(FRONT, m["head"])).convert("RGBA")   # 248 x 640, head only
    seat_body_y = head["top"] + seat_y * head["h"]
    chin_y = head["top"] + head["h"]

    # One view box that holds the hair and the whole head, in body px.
    pad = 14
    bx0 = min(left, (248 - head["w"]) / 2) - pad
    bx1 = max(left + w, (248 + head["w"]) / 2) + pad
    by0 = min(top, head["top"]) - pad
    by1 = max(top + h, chin_y) + pad
    s = PANEL_H / (by1 - by0)
    vw, vh = round((bx1 - bx0) * s), PANEL_H
    to = lambda x, y: ((x - bx0) * s, (y - by0) * s)

    # GUIDE panel: head, hair, then the zone and lines on top.
    g = Image.new("RGBA", (vw, vh), BG)
    head_big = body.resize((round(248 * s), round(body.height * s)), Image.LANCZOS)
    g.alpha_composite(head_big, (round(-bx0 * s), round(-by0 * s)))
    hair_big = hair.resize((round(w * s), round(h * s)), Image.LANCZOS)
    g.alpha_composite(hair_big, tuple(round(v) for v in to(left, top)))

    zone = Image.new("RGBA", (vw, vh), (0, 0, 0, 0))
    zd = ImageDraw.Draw(zone)
    _, sy = to(0, seat_body_y)
    zd.rectangle([0, 0, vw, sy], fill=MAGENTA + (70,))
    g.alpha_composite(zone)
    d = ImageDraw.Draw(g)
    d.line([(0, sy), (vw, sy)], fill=MAGENTA + (255,), width=5)
    skull = [to(x, y) for x, y in skull_top(body.getchannel("A"), seat_body_y)]
    dashed(d, skull, CYAN + (255,), 6)
    # ORIGINAL panel: the art alone, same scale.
    o = Image.new("RGBA", (round(w * s) + 80, vh), BG)
    o.alpha_composite(hair_big, (40, round((vh - hair_big.height) / 2)))

    # Words live in a header above the art, never on it, so nothing in the
    # panels can be mistaken for part of the drawing.
    f, fs = font(28), font(21)
    head_h = 140
    sheet = Image.new("RGBA", (o.width + 24 + g.width, vh + head_h), (255, 255, 255, 255))
    sheet.alpha_composite(o, (0, head_h))
    sheet.alpha_composite(g, (o.width + 24, head_h))
    d = ImageDraw.Draw(sheet)
    d.text((16, 14), "1  ORIGINAL", fill=(30, 30, 30), font=f)
    gx = o.width + 24 + 16
    d.text((gx, 14), "2  FIT GUIDE (not part of the art)", fill=(30, 30, 30), font=f)
    d.text((gx, 52), "pink = under the hat: press hair flat", fill=(150, 25, 85), font=fs)
    d.text((gx, 78), "to the cyan skull line", fill=(150, 25, 85), font=fs)
    d.text((gx, 104), "below pink line = keep as original", fill=(70, 70, 70), font=fs)
    return sheet.convert("RGB"), hair


def main():
    m = load_manifest()
    seat = seat_line(m)
    styles = [h for h in m["items"]["hair"] if h["id"] not in SKIP and not h.get("hidden")]
    os.makedirs(os.path.join(OUT, "guides"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "originals"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "generated"), exist_ok=True)
    for item in styles:
        sheet, hair = guide(m, item, seat)
        sheet.save(os.path.join(OUT, "guides", item["id"] + ".png"))
        hair.save(os.path.join(OUT, "originals", item["id"] + ".png"))
    with open(os.path.join(OUT, "styles.json"), "w", encoding="utf8") as fh:
        json.dump({"seatY": seat, "refColour": REF_COLOUR,
                   "styles": [{"id": h["id"], "label": h["label"]} for h in styles]}, fh, indent=1)
    print(f"{len(styles)} guides, seat line at {seat:.3f} of head height -> {OUT}")


if __name__ == "__main__":
    main()
