"""Install the wave-4 headwear cut by cut-headwear-4.py.

Three things happen here that the cut deliberately left alone:

  colour     Most of the batch is line art on white. Enclosed white regions are
             flood-tinted per item; `bands` lets a piece take a second colour by
             where the region sits down the piece (a cap's peak, a hat's ribbon),
             which survives re-runs where indexing regions by area would not.
             The tint multiplies the source luminance rather than replacing it,
             so the anti-aliased pixels along every stroke stay a soft edge.
  fit        The head is drawn at a different size on every sheet, so each piece
             is solved onto the rig's head from the geometry cut-headwear-4
             measured off the face features: scale by head width, then place the
             piece's own bbox. No hand-tuned layouts.
  hair       hideHair for anything that closes over the skull, hidesBulky for
             brims and crowns that leave the sides showing but would have a bun
             or an afro poking through the outline. Open bands and ears take
             neither — hair reads fine under them.

Writes the art into frontend/assets/character/headwear/, a catalogue snippet,
and installed-headwear4.json for headwear-qa-4.py to composite.
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
CUTS = os.path.join(HERE, "out4")
DEST = r"C:\Users\user\Desktop\run\frontend\assets\character\headwear"
MAX_DIM = 512

# Rig geometry (CharacterRig.js): the head drawn inside the 248x640 body.
BODY_W, BODY_H = 248, 640
HEAD_W, HEAD_H, HEAD_TOP = 157.0, 218.0, 8.0
HEAD_CX = 124.0

# hair: None | "hide" (closes over the skull) | "bulky" (brim/crown, only an
#       updo or an afro would break its outline)
# col:  base fill for line-art pieces; bands: [(y0, y1, hex), ...] as fractions
#       of the piece's own height, matched against a region's centroid.
# crop: keep only the top f of the piece (drops a drawn hairline).
N = [
    # idx  id             stem     label            rarity   unlock          hair     colour
    (0,  "ballcap",     "hat65", "Ball cap",       "common", ("runs", 1),   "bulky", {}),
    (1,  "knitbeanie",  "hat66", "Knit beanie",    "common", None,          "hide",  {}),
    (2,  "hoodup",      "hat67", "Hood up",        "rare",   ("runs", 10),  "hide",  {}),
    (3,  "canvasbucket", "hat68", "Canvas bucket", "common", ("dist", 10),  "hide",  {}),
    (4,  "runvisor",    "hat69", "Run visor",      "common", ("runs", 3),   None,    {}),
    (5,  "sportcap",    "hat70", "Sport cap",      "common", None,          "bulky",
     {"col": "#D8443C", "bands": [(0.60, 1.01, "#F2EFE6")]}),
    (6,  "partycrown",  "hat71", "Party crown",    "epic",   ("level", 20), None,    {}),
    (7,  "headphones",  "hat72", "Headphones",     "rare",   ("runs", 8),   "bulky",
     {"col": "#3A404A", "bands": [(0.42, 1.01, "#E7E9EC")]}),
    (8,  "sitehelmet",  "hat73", "Site helmet",    "rare",   ("zones", 3),  "bulky", {}),
    (9,  "witchhat",    "hat74", "Witch hat",      "epic",   ("level", 16), "bulky", {}),
    (10, "bowband",     "hat75", "Bow band",       "common", None,          None,
     {"col": "#F489B4"}),
    (11, "flatberet",   "hat76", "Flat beret",     "common", None,          "bulky",
     {"col": "#3F4E7C"}),
    (12, "puffmuffs",   "hat77", "Puff earmuffs",  "common", ("streak", 2), None,
     {"col": "#D9506F", "bands": [(0.30, 1.01, "#F6E7EB")]}),
    (13, "flatsnap",    "hat78", "Flat snapback",  "common", ("runs", 5),   "bulky",
     {"col": "#33405A", "bands": [(0.34, 0.72, "#F0F1F3")]}),
    (14, "gardenhat",   "hat79", "Garden hat",     "common", ("dist", 10),  "bulky",
     {"col": "#EFE0BC"}),
    (15, "cuffbeanie",  "hat80", "Cuffed beanie",  "common", None,          "hide",
     {"col": "#4C7C59"}),
    (16, "wideband",    "hat81", "Wide band",      "common", ("runs", 1),   None,
     {"col": "#3B82F6"}),
    (17, "tiedbandana", "hat82", "Tied bandana",   "common", ("runs", 5),   "hide",
     {"col": "#DD5450"}),
    (18, "jeweltiara",  "hat83", "Jewel tiara",    "epic",   ("level", 12), None,
     {"col": "#F1CE6B"}),
    (19, "classiccap",  "hat84", "Classic cap",    "common", None,          "bulky",
     {"col": "#2E4E8E"}),
    (20, "tophat",      "hat85", "Top hat",        "epic",   ("level", 20), "bulky",
     {"col": "#2B2D33"}),
    (21, "fedora",      "hat86", "Fedora",         "rare",   ("runs", 10),  "bulky",
     {"col": "#7C6449", "bands": [(0.36, 0.60, "#4A3B2C")]}),
    (22, "cowpokehat",  "hat87", "Cowpoke hat",    "rare",   ("dist", 25),  "bulky",
     {"col": "#9C6D40"}),
    (23, "cheftoque",   "hat88", "Chef toque",     "rare",   ("runs", 10),  "hide",
     {"col": "#F7F6F2"}),
    (24, "mortarboard", "hat89", "Mortarboard",    "rare",   ("runs", 25),  "bulky",
     {"col": "#2C3039"}),
    (25, "kittyears",   "hat90", "Kitty ears",     "common", None,          None,
     {"col": "#F2A2C1"}),
    (26, "bloomcrown",  "hat91", "Bloom crown",    "common", ("runs", 3),   None,
     {"col": "#F7C7D7"}),
    (27, "rabbitears",  "hat92", "Rabbit ears",    "common", ("runs", 3),   None,
     {"col": "#F3E5E9"}),
    (30, "tricorn",     "hat93", "Tricorn",        "epic",   ("level", 18), "bulky",
     {"col": "#2F3B57"}),
    (31, "flightcap",   "hat94", "Flight cap",     "rare",   ("dist", 25),  "hide",
     {"col": "#70543A"}),
    (32, "firehelmet",  "hat95", "Fire helmet",    "rare",   ("zones", 5),  "bulky",
     {"col": "#D53C2E"}),
    (33, "golfcap",     "hat96", "Golf cap",       "common", ("runs", 5),   "bulky",
     {"col": "#4F6D54"}),
    (34, "trapperhat",  "hat97", "Trapper hat",    "rare",   ("dist", 50),  "hide",
     {"col": "#6D5339"}),
    (35, "unicornhorn", "hat98", "Unicorn horn",   "epic",   ("level", 14), None,
     {"col": "#F1E0AA"}),
    (36, "butterflyclip", "hat99", "Butterfly clip", "common", None,        None,
     {"col": "#92C9EA"}),
    (37, "haloring",    "hat100", "Halo ring",     "legendary", ("level", 40), None,
     {"col": "#F5D571"}),
    (39, "loveboppers", "hat101", "Love boppers",  "common", ("streak", 2), None,
     {"col": "#F26D9C"}),
    (40, "officercap",  "hat102", "Officer cap",   "rare",   ("zones", 3),  "bulky",
     {"col": "#2C3654", "bands": [(0.46, 1.01, "#1F2740")]}),
    (41, "navycap",     "hat103", "Navy cap",      "common", ("dist", 15),  "bulky",
     {"col": "#F3F3F1"}),
    (42, "ribboncap",   "hat104", "Ribbon cap",    "common", ("runs", 8),   "bulky",
     {"col": "#F0A2BE"}),
    (43, "scrumcap",    "hat105", "Scrum cap",     "rare",   ("runs", 15),  "hide",
     {"col": "#3F816F"}),
    (45, "sunbowhat",   "hat106", "Sun hat",       "common", ("dist", 10),  "bulky",
     {"col": "#F4E6C6"}),
    (48, "santahat",    "hat107", "Santa hat",     "rare",   ("streak", 2), "hide",
     {"col": "#D93A31", "bands": [(0.66, 1.01, "#F6F4F2")]}),
    (49, "slouchberet", "hat108", "Slouch beret",  "common", None,          "bulky",
     {"col": "#8D4C59"}),
    (50, "rodeohat",    "hat109", "Rodeo hat",     "rare",   ("dist", 50),  "bulky",
     {"col": "#8E643B"}),
    (52, "headwrap",    "hat110", "Head wrap",     "rare",   ("zones", 5),  "hide",
     {"col": "#CB5741"}),
    (53, "vikinghelm",  "hat111", "Viking helm",   "epic",   ("level", 22), "bulky",
     {"col": "#909599", "bands": [(0.0, 0.42, "#EFE6D2")]}),
    (54, "mobcap",      "hat112", "Mob cap",       "common", ("runs", 5),   "hide",
     {"col": "#F0E7F3"}),
    (56, "headscarf",   "hat113", "Head scarf",    "common", None,          "hide",
     {"col": "#81AADA"}),
    (57, "clochehat",   "hat114", "Cloche hat",    "common", ("runs", 10),  "bulky",
     {"col": "#616D8E"}),
    (58, "bowwrap",     "hat115", "Bow wrap",      "common", ("streak", 2), "bulky",
     {"col": "#E25A56"}),
    (60, "minerhelmet", "hat116", "Miner helmet",  "rare",   ("zones", 5),  "bulky",
     {"col": "#E2A530", "bands": [(0.0, 0.34, "#EDEDEA")]}),
    (61, "fez",         "hat117", "Fez",           "rare",   ("level", 12), "bulky",
     {"col": "#B23137"}),
    (62, "paradeshako", "hat118", "Parade shako",  "epic",   ("level", 28), "hide",
     {"col": "#2E3552", "bands": [(0.0, 0.22, "#E9E5DC")]}),
    (63, "jestercap",   "hat119", "Jester cap",    "epic",   ("level", 18), "hide",
     {"col": "#9051AA"}),
    (64, "weddingveil", "hat120", "Wedding veil",  "epic",   ("level", 24), None,
     {"col": "#F7F5F9"}),
    (66, "rosecrown",   "hat121", "Rose crown",    "common", None,          None,
     {"col": "#F091AA"}),
    (67, "scallopband", "hat122", "Scallop band",  "common", ("runs", 8),   None,
     {"col": "#82CADA"}),
    (68, "pinupwrap",   "hat123", "Pin-up wrap",   "common", ("runs", 12),  "bulky",
     {"col": "#E45A61"}),
    (69, "derbyhat",    "hat124", "Derby hat",     "common", ("runs", 5),   "bulky",
     {"col": "#3D3932"}),
    (70, "dadcap",      "hat125", "Dad cap",       "common", None,          "bulky",
     {"col": "#7091B7"}),
    (71, "laurelcrown", "hat126", "Laurel crown",  "epic",   ("level", 30), None,
     {"col": "#7DAA5C"}),
    (72, "samuraihelm", "hat127", "Samurai helm",  "epic",   ("level", 36), "bulky",
     {"col": "#404C65", "bands": [(0.0, 0.30, "#E2C55E")]}),
    (73, "skullcap",    "hat128", "Skull cap",     "common", ("runs", 3),   "hide",
     {"col": "#313742"}),
    (74, "topbow",      "hat129", "Top bow",       "common", None,          None,
     {"col": "#F281AA"}),
    (75, "boaterhat",   "hat130", "Boater hat",    "common", ("dist", 15),  "bulky",
     {"col": "#F1E4C0"}),
    (76, "pearltiara",  "hat131", "Pearl tiara",   "rare",   ("streak", 3), None,
     {"col": "#ECDBF2"}),
    (77, "swimcap",     "hat132", "Swim cap",      "common", ("runs", 3),   "hide",
     {"col": "#5FA3E0"}),
    (78, "bigbow",      "hat133", "Big bow",       "common", ("runs", 5),   None,
     {"col": "#F161A2"}),
]

# Dropped from the batch: 28/29 (a curly wig with a bow, not headwear), 38/44/
# 46/47/55/65 (drawn hair the cut cannot separate from the piece), 51 and 59
# (a second mortarboard and a second tricorn, indistinguishable from 24/30).


def hexrgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)


def colourise(a, spec):
    """Tint the enclosed white regions of a line-art piece.

    Multiplying the source luminance keeps every anti-aliased pixel along the
    strokes as a soft edge of the new colour; assigning the colour flat leaves
    a pale halo between the fill and the outline.
    """
    if not spec.get("col"):
        return a, 0
    lum = a[..., :3].mean(2)
    solid = a[..., 3] > 200
    fill = solid & (lum >= 150)
    lab, n = ndimage.label(fill)
    h = a.shape[0]
    base = hexrgb(spec["col"])
    bands = [(y0, y1, hexrgb(c)) for y0, y1, c in spec.get("bands", [])]
    painted = 0
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() < 200:
            continue
        cy = np.where(comp)[0].mean() / h
        col = base
        for y0, y1, c in bands:
            if y0 <= cy < y1:
                col = c
                break
        # take the ramp into the stroke with the region, so no white rim is left
        area = ndimage.binary_dilation(comp, np.ones((3, 3)), iterations=2) & solid & (lum > 96)
        k = np.clip(lum[area] / 252.0, 0, 1)[:, None]
        a[..., :3][area] = np.clip(col * k, 0, 255).astype(np.uint8)
        painted += 1
    return a, painted


def solve_layout(box, head):
    """Place the piece on the rig's head. Scale from head width, position from
    the piece's own bounding box — both measured in the source's pixels."""
    s = HEAD_W / head["w"]
    w_px = (box["x1"] - box["x0"]) * s
    left = HEAD_CX + (box["x0"] - head["cx"]) * s
    top = HEAD_TOP + (box["y0"] - head["top"]) * s
    out = {"w": round(w_px / BODY_W, 4), "top": round(top / BODY_H, 4)}
    dx = (left - (BODY_W / 2 - w_px / 2)) / BODY_W
    if abs(dx) > 0.006:
        out["dx"] = round(dx, 4)
    return out


def main():
    meta = {m["i"]: m for m in json.load(open(os.path.join(HERE, "headwear4.json")))}
    os.makedirs(DEST, exist_ok=True)
    lines, manifest, premium = [], [], []
    seen = set()
    for idx, iid, stem, label, rarity, unlock, hair, spec in N:
        assert iid not in seen and stem not in seen, f"duplicate {iid}/{stem}"
        seen.update((iid, stem))
        a = np.asarray(Image.open(os.path.join(CUTS, f"{idx:03d}.png"))
                       .convert("RGBA")).copy()
        head = meta[idx]["head"]
        if spec.get("crop"):
            ys = np.where(a[..., 3] > 16)[0]
            cut = int(ys.min() + spec["crop"] * (ys.max() - ys.min()))
            a[cut:, :, 3] = 0
        ys, xs = np.where(a[..., 3] > 16)
        box = dict(x0=int(xs.min()), x1=int(xs.max()) + 1,
                   y0=int(ys.min()), y1=int(ys.max()) + 1)
        layout = solve_layout(box, head)
        a = a[box["y0"]:box["y1"], box["x0"]:box["x1"]]
        a, painted = colourise(a, spec)

        im = Image.fromarray(a.astype(np.uint8), "RGBA")
        if max(im.size) > MAX_DIM:
            s = MAX_DIM / max(im.size)
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))),
                           Image.LANCZOS)
        im.save(os.path.join(DEST, f"{stem}.png"), optimize=True)

        if unlock is None:
            unl = "free"
        elif unlock == "premium":
            unl = "premiumOnly"
            premium.append((iid, label, rarity))
        else:
            k, v = unlock
            unl = {"runs": (f"runs(1, 'Finish your first run')" if v == 1
                            else f"runs({v}, 'Finish {v} runs')"),
                   "dist": f"dist({v}, 'Run {v} km total')",
                   "zones": f"zones({v}, 'Hold {v} zones')",
                   "streak": f"streak({v}, 'Hold a {v}-week streak')",
                   "level": f"level({v})"}[k]
        bits = [f"id: '{iid}'", f"label: '{label}'",
                f"img: require('../../assets/character/headwear/{stem}.png')",
                "layout: { " + ", ".join(f"{a2}: {b2}" for a2, b2 in layout.items()) + " }"]
        if hair == "hide":
            bits.append("hideHair: true")
        elif hair == "bulky":
            bits.append("hidesBulky: true")
        bits += [f"rarity: '{rarity}'", f"unlock: {unl}"]
        lines.append("    { " + ", ".join(bits) + " },")
        manifest.append(dict(idx=idx, id=iid, stem=stem, label=label, layout=layout,
                             hair=hair, rarity=rarity, w=im.width, h=im.height,
                             painted=painted))
        print(f"{iid:14s} {stem:7s} {im.width}x{im.height} {str(layout):52s} "
              f"{hair or '-':6s} {painted} regions")

    with open(os.path.join(HERE, "catalog-headwear4.js"), "w") as f:
        f.write("\n".join(lines) + "\n")
    json.dump(manifest, open(os.path.join(HERE, "installed-headwear4.json"), "w"),
              indent=1)
    with open(os.path.join(HERE, "premium-headwear4.txt"), "w") as f:
        for iid, label, rarity in premium:
            f.write(f"headwear:{iid}|{label}|{rarity}\n")
    print(f"\n{len(N)} headwear installed, {len(premium)} PRO-exclusive")


if __name__ == "__main__":
    main()
