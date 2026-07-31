"""Install the selected harvested items into the game.

Rules honoured here:
  * ORIGINAL COLOUR KEPT — every new item ships as fixed art (`img:`), no
    10-swatch recolour, so the drawn colours survive exactly.
  * WRAPS AROUND THE BODY — three mechanisms, per item:
      - `interior`: cut the garment's inner-back / collar lining so the neck
        and chest show through the opening instead of a painted interior.
      - `neck`: split into front + back layers at a seam so the far side of a
        loop (necklace, medal ribbon, scarf, cape collar) passes BEHIND the
        head, and only the near side draws in front.
      - `hideHair` / `hidesBulky`: full-coverage headwear hides hair instead
        of letting it poke through the hat outline.
  * NO REPEATS — indices come from the concept-clustered representatives, and
    anything already in the catalogue was dropped during harvesting.
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SCRATCH = os.path.dirname(os.path.abspath(__file__))
ITEMS_DIR = os.path.join(SCRATCH, "out", "items")
CH = r"C:\Users\user\Desktop\run\frontend\assets\character"

SLOT_FIT = {
    "headwear": dict(max_dim=512),
    "glasses": dict(width=420),
    "top": dict(max_dim=512),
    "bottom": dict(max_dim=512),
    "accessory": dict(max_dim=560),
}
FOLDER = {"headwear": "headwear", "glasses": "glasses", "top": "outfit",
          "bottom": "outfit", "accessory": "accessory"}

# idx, slot, id, file stem, label, rarity, unlock, extra
# unlock: None=free | ("runs",n) | ("dist",km) | ("zones",n) | ("streak",n)
#         | ("level",n) | "premium"
N = [
    # ---------------- headwear ----------------
    (850, "headwear", "laurel",     "hat13", "Laurel wreath",  "epic",      "premium", {}),
    (851, "headwear", "flamecrown", "hat14", "Flame crown",    "legendary", "premium", {}),
    (132, "headwear", "halo",       "hat15", "Halo",           "legendary", "premium", {"layout": {"w": 0.62, "top": -0.13}}),
    (757, "headwear", "wolfears",   "hat16", "Wolf ears",      "epic",      "premium", {"layout": {"w": 0.78, "top": -0.075}}),
    (648, "headwear", "jester",     "hat17", "Jester crown",   "epic",      "premium", {"layout": {"w": 0.7, "top": -0.10}}),
    (803, "headwear", "frogbeanie", "hat18", "Frog beanie",    "rare",   ("runs", 3),   {"hideHair": True}),
    (12,  "headwear", "wizardhat",  "hat19", "Wizard hat",     "epic",   ("level", 18), {"layout": {"w": 0.8, "top": -0.20}}),
    (160, "headwear", "antlers",    "hat20", "Antlers",        "rare",   ("zones", 3),  {"layout": {"w": 0.9, "top": -0.13}}),
    (581, "headwear", "aviatorcap", "hat21", "Aviator cap",    "rare",   ("dist", 25),  {"hideHair": True}),
    (158, "headwear", "chefhat",    "hat22", "Chef hat",       "rare",   ("runs", 10),  {"layout": {"top": -0.17}, "hideHair": True}),
    (572, "headwear", "cowboyhat",  "hat23", "Cowboy hat",     "rare",   ("dist", 50),  {"hidesBulky": True}),
    (164, "headwear", "piratehat",  "hat24", "Pirate hat",     "epic",   ("level", 22), {"layout": {"w": 0.95, "top": -0.11}, "hidesBulky": True}),
    (759, "headwear", "headdress",  "hat25", "Feather crown",  "epic",   ("level", 28), {"layout": {"w": 0.85, "top": -0.12}}),
    (165, "headwear", "gradcap",    "hat26", "Grad cap",       "rare",   ("runs", 25),  {"layout": {"top": -0.09}, "hidesBulky": True}),
    (423, "headwear", "bowler",     "hat27", "Bowler",         "common", ("runs", 5),   {"hidesBulky": True}),
    (424, "headwear", "sunhat",     "hat28", "Sun hat",        "common", ("dist", 10),  {"hidesBulky": True}),
    (747, "headwear", "tiara",      "hat29", "Tiara",          "epic",   ("level", 12), {"layout": {"w": 0.6, "top": -0.075}}),
    (573, "headwear", "turban",     "hat30", "Turban",         "rare",   ("zones", 5),  {"hideHair": True}),
    (758, "headwear", "catears",    "hat31", "Cat ears",       "common", ("runs", 1),   {"layout": {"w": 0.62, "top": -0.085}}),
    (729, "headwear", "pinkbow",    "hat32", "Bow",            "common", None,          {"layout": {"w": 0.5, "top": -0.045}}),
    (154, "headwear", "flowercrown", "hat33", "Flower crown",  "common", ("runs", 3),   {"layout": {"w": 0.82, "top": -0.035}}),
    (651, "headwear", "earmuffs",   "hat34", "Earmuffs",       "common", ("streak", 2), {"layout": {"w": 0.86, "top": -0.02}}),
    # ---------------- glasses ----------------
    (195, "glasses", "monocle",     "specs11", "Monocle",      "epic",      "premium", {"layout": {"w": 0.42}}),
    (827, "glasses", "cybershades", "specs12", "Cyber shades", "legendary", "premium", {"layout": {"w": 0.56}}),
    (881, "glasses", "mirrorvisor", "specs13", "Mirror visor", "epic",      "premium", {"layout": {"w": 0.56}}),
    (36,  "glasses", "starglasses", "specs14", "Star shades",  "rare",   ("streak", 2), {"layout": {"w": 0.54}}),
    (114, "glasses", "steampunk",   "specs15", "Steampunk goggles", "epic", ("level", 16), {"layout": {"w": 0.54}}),
    (707, "glasses", "hexshades",   "specs16", "Hex shades",   "rare",   ("runs", 15),  {"layout": {"w": 0.5}}),
    (448, "glasses", "cateye",      "specs17", "Cat-eye",      "rare",   ("dist", 25),  {"layout": {"w": 0.52}}),
    (198, "glasses", "pixelshades", "specs18", "Pixel shades", "epic",   ("level", 20), {"layout": {"w": 0.54}}),
    (509, "glasses", "aviators",    "specs19", "Aviators",     "common", ("runs", 5),   {"layout": {"w": 0.52}}),
    (715, "glasses", "eyepatch",    "specs20", "Eyepatch",     "rare",   ("zones", 3),  {"layout": {"w": 0.44}}),
    (632, "glasses", "clownglasses", "specs21", "Clown glasses", "rare", ("runs", 20),  {"layout": {"w": 0.56}}),
    (196, "glasses", "sleepmask",   "specs22", "Sleep mask",   "common", ("streak", 3), {"layout": {"w": 0.5}}),
    (712, "glasses", "heromask",    "specs23", "Hero mask",    "epic",   ("level", 24), {"layout": {"w": 0.56}}),
    # ---------------- tops ----------------
    (408, "top", "champjersey",  "top18", "Champion jersey", "legendary", "premium", {"interior": True, "neckhole": (0.5, 0.075, 0.155, 0.085)}),
    (419, "top", "aurorajacket", "top19", "Aurora jacket",   "epic",      "premium", {"interior": True, "neckhole": (0.5, 0.125, 0.105, 0.075)}),
    (416, "top", "varsity",      "top20", "Varsity jacket",  "epic",      "premium", {"interior": True, "neckhole": (0.5, 0.085, 0.11, 0.065)}),
    (666, "top", "stripedtee",   "top21", "Striped tee",     "common", None,          {"interior": True, "neckhole": (0.5, 0.07, 0.125, 0.07)}),
    (670, "top", "sportpolo",    "top22", "Sport polo",      "common", ("runs", 3),   {"interior": True, "neckhole": (0.5, 0.095, 0.10, 0.075)}),
    (669, "top", "greyhoodie",   "top23", "Hoodie",          "common", ("runs", 5),   {"interior": True, "neckhole": (0.5, 0.125, 0.11, 0.075)}),
    (413, "top", "bomber",       "top24", "Bomber jacket",   "rare",   ("dist", 25),  {"interior": True, "neckhole": (0.5, 0.085, 0.11, 0.065)}),
    (412, "top", "denimjacket",  "top25", "Denim jacket",    "rare",   ("dist", 50),  {"interior": True, "neckhole": (0.5, 0.10, 0.10, 0.07)}),
    (411, "top", "cardigan",     "top26", "Cardigan",        "common", ("runs", 10),  {"interior": True, "neckhole": (0.5, 0.105, 0.09, 0.095)}),
    (598, "top", "labcoat",      "top27", "Lab coat",        "rare",   ("level", 14), {"interior": True, "neckhole": (0.5, 0.10, 0.085, 0.09)}),
    (677, "top", "judogi",       "top28", "Judo gi",         "rare",   ("zones", 5),  {"interior": True, "neckhole": (0.5, 0.095, 0.09, 0.085)}),
    (676, "top", "utilityvest",  "top29", "Utility vest",    "rare",   ("zones", 3),  {"interior": True, "neckhole": (0.5, 0.09, 0.10, 0.075)}),
    (242, "top", "sailortop",    "top30", "Sailor top",      "common", ("streak", 2), {"interior": True, "neckhole": (0.5, 0.07, 0.10, 0.065)}),
    (418, "top", "puffer",       "top31", "Puffer jacket",   "rare",   ("dist", 75),  {"interior": True, "neckhole": (0.5, 0.11, 0.10, 0.07)}),
    # ---------------- bottoms ----------------
    (871, "bottom", "flamejoggers", "bottom10", "Flame joggers", "legendary", "premium", {}),
    (785, "bottom", "flameshorts",  "bottom11", "Flame shorts",  "epic",      "premium", {}),
    (694, "bottom", "overalls",     "bottom12", "Overalls",   "rare",   ("runs", 15),  {"fit": "onepiece"}),
    (787, "bottom", "khakishorts",  "bottom13", "Khaki shorts", "common", None,        {}),
    (818, "bottom", "rippedjeans",  "bottom14", "Ripped jeans", "rare", ("dist", 25),  {}),
    (99,  "bottom", "cargoshorts",  "bottom15", "Cargo shorts", "common", ("runs", 3), {}),
    (274, "bottom", "lightjeans",   "bottom16", "Light jeans",  "common", ("runs", 5), {}),
    (788, "bottom", "trackpants2",  "bottom17", "Stripe track pants", "common", ("runs", 10), {}),
    (823, "bottom", "checkered",    "bottom18", "Checkered pants", "rare", ("level", 10), {}),
    (692, "bottom", "denimshorts",  "bottom19", "Denim shorts", "common", ("dist", 10), {}),
    (182, "bottom", "bluejeans",    "bottom20", "Blue jeans",   "common", ("streak", 2), {}),
    (358, "bottom", "leatherpants", "bottom21", "Leather pants", "epic", ("level", 26), {}),
    (876, "bottom", "sweatpants",   "bottom22", "Sweatpants",   "common", ("runs", 8),  {}),
    # ---------------- accessories ----------------
    (49,  "accessory", "jetpack",     "acc9",  "Jetpack",      "legendary", "premium", {"z": "back", "layout": {"w": 1.15, "cy": 0.44}}),
    (900, "accessory", "boombox",     "acc10", "Boombox",      "epic",      "premium", {"z": "front", "layout": {"w": 0.62, "top": 0.34}}),
    (892, "accessory", "dragonwings", "acc11", "Dragon wings", "legendary", "premium", {"z": "back", "layout": {"w": 1.7, "cy": 0.36}}),
    (40,  "accessory", "trophypack",  "acc12", "Adventure pack", "epic",    "premium", {"z": "back", "layout": {"w": 0.95, "cy": 0.44}}),
    (119, "accessory", "redcape",     "acc13", "Hero cape",    "epic",   ("level", 30), {"z": "back", "neck": 0.14, "layout": {"w": 1.15, "top": 0.285}}),
    (604, "accessory", "capepauldron", "acc14", "Champion cape", "legendary", ("level", 45), {"z": "front", "layout": {"w": 1.05, "top": 0.30}}),
    (717, "accessory", "starnecklace", "acc15", "Star pendant", "rare",  ("runs", 12),  {"z": "front", "neck": 0.34, "layout": {"w": 0.4, "top": 0.27}}),
    (778, "accessory", "ribbonmedal", "acc16", "Ribbon medal", "rare",   ("zones", 4),  {"z": "front", "neck": 0.30, "layout": {"w": 0.4, "top": 0.275}}),
    (47,  "accessory", "greenscarf",  "acc17", "Knit scarf",   "common", ("streak", 2), {"z": "front", "neck": 0.20, "layout": {"w": 0.55, "top": 0.27}}),
    (48,  "accessory", "tealscarf",   "acc18", "Winter scarf", "common", ("dist", 15),  {"z": "front", "neck": 0.20, "layout": {"w": 0.55, "top": 0.27}}),
    (306, "accessory", "fannypack",   "acc19", "Bum bag",      "common", ("runs", 6),   {"z": "front", "layout": {"w": 0.62, "top": 0.52}}),
    (719, "accessory", "gaiter",      "acc20", "Neck gaiter",  "common", ("runs", 2),   {"z": "front", "neck": 0.30, "layout": {"w": 0.46, "top": 0.265}}),
    (79,  "accessory", "headset",     "acc21", "Headset",      "rare",   ("level", 8),  {"z": "front", "layout": {"w": 0.72, "cy": 0.155}}),
    (213, "accessory", "katanas",     "acc22", "Twin blades",  "epic",   ("level", 34), {"z": "back", "layout": {"w": 1.25, "cy": 0.40}}),
]

FEATHER = 5


def load(idx):
    return np.asarray(Image.open(os.path.join(ITEMS_DIR, f"{idx:03d}.png"))
                      .convert("RGBA")).copy()


def trim(a):
    m = a[..., 3] > 16
    ys, xs = np.where(m)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def fit(a, max_dim=None, width=None):
    im = Image.fromarray(a.astype(np.uint8), "RGBA")
    w, h = im.size
    s = (width / w) if width else (max_dim / max(w, h))
    if s < 1:
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    return np.asarray(im).copy()


def cut_interior(a, neck=None):
    """Punch the neck opening clean through the garment.

    These garments are drawn flat-on with the collar opening at top centre and
    the garment's own inner back painted inside it. A clean elliptical cut
    (sharp, barely feathered) reads as an opening you see the neck through;
    a luminance-derived mask just smudges the collar, so geometry wins here.
    The ellipse is deliberately smaller than the collar so the collar itself
    survives and frames the hole.
    """
    h, w = a.shape[:2]
    cx, cy, rx, ry = neck or (0.5, 0.085, 0.115, 0.085)
    yy, xx = np.mgrid[0:h, 0:w]
    ell = (((xx / w - cx) / rx) ** 2 + ((yy / h - cy) / ry) ** 2) <= 1.0
    # never cut above the garment's own top edge
    opaque = a[..., 3] > 32
    mask = ell & opaque
    if mask.sum() < 50:
        return a, 0
    soft = np.clip(ndimage.gaussian_filter(mask.astype(float), 0.8), 0, 1)
    a[..., 3] = (a[..., 3] * (1 - soft)).astype(np.uint8)
    return a, int(mask.sum())


def split_neck(a, seam_frac):
    """Top part -> behind the body, bottom part -> in front."""
    h = a.shape[0]
    seam = int(h * seam_frac)
    yy = np.arange(h)
    ramp = np.clip((seam + FEATHER / 2 - yy) / FEATHER, 0, 1)   # 1 above seam
    back = a.copy()
    back[..., 3] = (a[..., 3] * ramp[:, None]).astype(np.uint8)
    front = a.copy()
    front[..., 3] = (a[..., 3] * (1 - ramp[:, None])).astype(np.uint8)
    return front, back


def main():
    js = {s: [] for s in ["headwear", "glasses", "top", "bottom", "accessory"]}
    premium = []
    for idx, slot, iid, stem, label, rarity, unlock, extra in N:
        a = trim(load(idx))
        cut = 0
        if extra.get("interior"):
            a, cut = cut_interior(a, extra.get("neckhole"))
        a = fit(trim(a), **SLOT_FIT[slot])
        folder = os.path.join(CH, FOLDER[slot])
        os.makedirs(folder, exist_ok=True)

        back_ref = ""
        if "neck" in extra:
            front, back = split_neck(a, extra["neck"])
            Image.fromarray(back.astype(np.uint8), "RGBA").save(
                os.path.join(folder, f"{stem}b.png"), optimize=True)
            Image.fromarray(front.astype(np.uint8), "RGBA").save(
                os.path.join(folder, f"{stem}.png"), optimize=True)
            back_ref = (f", backImg: require('../../assets/character/"
                        f"{FOLDER[slot]}/{stem}b.png')")
        else:
            Image.fromarray(a.astype(np.uint8), "RGBA").save(
                os.path.join(folder, f"{stem}.png"), optimize=True)

        # ---- build the catalogue line
        if unlock is None:
            unl = "free"
        elif unlock == "premium":
            unl = "premiumOnly"
            premium.append((iid, slot, label, rarity))
        else:
            k, v = unlock
            unl = {"runs": f"runs({v}, 'Finish {v} runs')",
                   "dist": f"dist({v}, 'Run {v} km total')",
                   "zones": f"zones({v}, 'Hold {v} zones')",
                   "streak": f"streak({v}, 'Hold a {v}-week streak')",
                   "level": f"level({v})"}[k]
        bits = [f"id: '{iid}'", f"label: '{label}'",
                f"img: require('../../assets/character/{FOLDER[slot]}/{stem}.png')"]
        line_extra = back_ref
        if extra.get("z"):
            bits.append(f"z: '{extra['z']}'")
        if extra.get("fit"):
            bits.append(f"fit: '{extra['fit']}'")
        if extra.get("layout"):
            L = ", ".join(f"{k2}: {v2}" for k2, v2 in extra["layout"].items())
            bits.append(f"layout: {{ {L} }}")
        for flag in ("hideHair", "hidesBulky"):
            if extra.get(flag):
                bits.append(f"{flag}: true")
        bits.append(f"rarity: '{rarity}'")
        bits.append(f"unlock: {unl}")
        js[slot].append("    { " + ", ".join(bits).replace(
            f"img: require('../../assets/character/{FOLDER[slot]}/{stem}.png')",
            f"img: require('../../assets/character/{FOLDER[slot]}/{stem}.png'){line_extra}")
            + " },")
        print(f"{iid:14s} {slot:9s} {a.shape[1]}x{a.shape[0]}"
              + (f"  interior-cut {cut}px" if cut else ""))

    with open(os.path.join(SCRATCH, "catalog_snippet.js"), "w") as f:
        for slot, lines in js.items():
            f.write(f"// ---- {slot} ----\n" + "\n".join(lines) + "\n\n")
    with open(os.path.join(SCRATCH, "premium.txt"), "w") as f:
        for iid, slot, label, rarity in premium:
            f.write(f"{slot}:{iid}|{label}|{rarity}\n")
    print(f"\n{len(N)} items installed, {len(premium)} premium-exclusive")


if __name__ == "__main__":
    main()
