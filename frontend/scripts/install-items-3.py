"""Install the wave-3 items (harvest from C:\\Users\\user\\Desktop\\assets).

Everything here is about the art reading as WORN rather than pasted on. Four
treatments, applied per item:

  facehole  (hair)      ChatGPT draws hairstyles as whole heads — hair plus a
                        filled face and ears. Flood-fill the fill away so the
                        piece becomes a wig and the rig's own face shows
                        through. Colour rules fail here (pale hair is as light
                        as the face); position does not.
  neckhole  (garments)  Punch a clean elliptical opening through the collar so
                        you see the neck through it instead of the garment's
                        own painted inner back.
  neck      (wrap-arounds) Split at a seam into front + back images. The back
                        renders BEHIND the body, so a chain/scarf/ribbon reads
                        as passing around the neck rather than lying on it.
  hideHair / hidesBulky Full-coverage headwear hides hair; crown-hugging hats
                        hide only bulky updos, so a bun still shows under an
                        open band.

Original colours are kept (fixed `img:`, no 10-swatch recolour), matching the
wave-2 convention.

Writes the art into frontend/assets/character/**, a catalogue snippet, and
installed3.json for worn-qa-3.py to composite.
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SCRATCH = os.path.dirname(os.path.abspath(__file__))
ITEMS_DIR = os.path.join(SCRATCH, "out3", "items")
CH = r"C:\Users\user\Desktop\run\frontend\assets\character"

SLOT_FIT = {
    "hair": dict(max_dim=512),
    "headwear": dict(max_dim=512),
    "glasses": dict(width=420),
    "top": dict(max_dim=512),
    "bottom": dict(max_dim=512),
    "accessory": dict(max_dim=560),
}
FOLDER = {"hair": "hair", "headwear": "headwear", "glasses": "glasses",
          "top": "outfit", "bottom": "outfit", "accessory": "accessory"}

# idx, slot, id, stem, label, rarity, unlock, extra
# unlock: None=free | ("runs",n) | ("dist",km) | ("zones",n) | ("streak",n)
#         | ("level",n) | "premium"
N = [
    # ------------------------------ hair ------------------------------
    (518, "hair", "beachwaves",  "hairX1",  "Beach waves",    "common", None,           {}),
    (283, "hair", "odango",      "hairX2",  "Odango buns",    "rare",   ("runs", 10),   {"bulky": True, "layout": {"w": 0.95, "top": -0.06}}),
    (362, "hair", "twinbraids",  "hairX3",  "Twin braids",    "common", None,           {}),
    (515, "hair", "bluntbangs",  "hairX4",  "Blunt bangs",    "common", None,           {}),
    (514, "hair", "blondebob",   "hairX5",  "Soft bob",       "common", None,           {}),
    (128, "hair", "longstraight", "hairX6", "Long straight",  "common", ("runs", 3),    {}),
    (466, "hair", "spikes",      "hairX7",  "Spikes",         "common", ("runs", 3),    {}),
    (516, "hair", "emofringe",   "hairX8",  "Emo fringe",     "rare",   ("runs", 5),    {}),
    (461, "hair", "fauxhawk",    "hairX9",  "Faux hawk",      "rare",   ("dist", 10),   {}),
    (290, "hair", "crownbraid",  "hairX10", "Crown braid",    "rare",   ("dist", 25),   {}),
    (26,  "hair", "messybun",    "hairX11", "Messy bun",      "common", ("runs", 5),    {"bulky": True, "layout": {"top": -0.055}}),
    (281, "hair", "topbun",      "hairX12", "Ballet bun",     "common", ("runs", 8),    {"bulky": True, "layout": {"top": -0.05}}),
    (275, "hair", "sidepart",    "hairX13", "Side part",      "common", None,           {}),
    (205, "hair", "bowlcut",     "hairX14", "Bowl cut",       "common", None,           {}),
    (130, "hair", "braidcrown",  "hairX15", "Braid crown",    "rare",   ("zones", 3),   {}),
    (469, "hair", "quiff",       "hairX16", "Quiff",          "common", ("runs", 3),    {}),
    (32,  "hair", "twinplaits",  "hairX17", "Twin plaits",    "common", ("runs", 5),    {}),
    (507, "hair", "shag",        "hairX18", "Shag",           "common", ("dist", 10),   {}),
    (277, "hair", "longlayers",  "hairX19", "Long layers",    "common", ("dist", 15),   {}),
    (519, "hair", "silverflow",  "hairX20", "Silver flow",    "epic",   ("level", 20),  {}),
    (613, "hair", "goldbuns",    "hairX21", "Gold buns",      "rare",   ("streak", 2),  {"bulky": True, "layout": {"w": 0.95, "top": -0.05}}),
    (462, "hair", "locs",        "hairX22", "Locs",           "common", ("runs", 5),    {}),
    (506, "hair", "sleekbob",    "hairX23", "Sleek bob",      "common", None,           {}),
    (608, "hair", "bigafro",     "hairX24", "Big afro",       "rare",   ("runs", 10),   {"bulky": True, "layout": {"top": -0.05}}),
    (607, "hair", "highbun",     "hairX25", "High bun",       "rare",   ("streak", 2),  {"bulky": True, "layout": {"top": -0.06}}),
    (117, "hair", "lowpony",     "hairX26", "Low pony",       "common", ("runs", 3),    {}),
    (34,  "hair", "silverbob",   "hairX27", "Ash bob",        "common", ("dist", 10),   {}),
    (125, "hair", "longbrown",   "hairX28", "Long waves",     "common", None,           {}),
    (37,  "hair", "mohawk",      "hairX29", "Mohawk",         "epic",   ("level", 14),  {"bulky": True}),
    (512, "hair", "emberspikes", "hairX30", "Ember spikes",   "epic",   ("level", 24),  {"bulky": True}),
    (120, "hair", "seawaves",    "hairX31", "Sea waves",      "epic",   ("level", 32),      {}),
    (463, "hair", "halfup",      "hairX32", "Half-up",        "common", ("runs", 8),    {}),
    # ---------------------------- headwear ----------------------------
    (524, "headwear", "catbeanie",  "hat35", "Cat beanie",    "rare",   ("runs", 5),    {"hideHair": True}),
    (624, "headwear", "boater",     "hat36", "Boater",        "common", ("dist", 10),   {"hidesBulky": True}),
    (377, "headwear", "jockeycap",  "hat37", "Jockey cap",    "common", ("runs", 3),    {"hidesBulky": True}),
    (218, "headwear", "beret",      "hat38", "Beret",         "common", None,           {"hidesBulky": True, "layout": {"w": 0.78, "top": -0.06}}),
    (221, "headwear", "newsboy",    "hat39", "Newsboy cap",   "common", ("runs", 5),    {"hidesBulky": True}),
    (369, "headwear", "flatcap",    "hat40", "Flat cap",      "common", ("runs", 8),    {"hidesBulky": True}),
    (142, "headwear", "captaincap", "hat41", "Captain cap",   "rare",   ("zones", 3),   {"hidesBulky": True}),
    (66,  "headwear", "sailorhat",  "hat42", "Sailor hat",    "common", ("dist", 15),   {"hidesBulky": True}),
    (144, "headwear", "nursecap",   "hat43", "Nurse cap",     "common", ("runs", 10),   {"layout": {"w": 0.66, "top": -0.055}}),
    (525, "headwear", "spacehelmet", "hat44", "Space helmet", "legendary", ("level", 44),   {"hideHair": True, "layout": {"w": 0.95, "top": -0.05}}),
    (523, "headwear", "kabuto",     "hat45", "Kabuto",        "epic",   "premium",      {"hidesBulky": True, "layout": {"w": 1.0, "top": -0.055}}),
    (529, "headwear", "sultanturban", "hat46", "Jewel turban", "epic",  ("level", 26),  {"hidesBulky": True, "layout": {"top": -0.05}}),
    (625, "headwear", "ushanka",    "hat47", "Ushanka",       "rare",   ("dist", 50),   {"hideHair": True}),
    (137, "headwear", "bunnyears",  "hat48", "Bunny ears",    "common", ("runs", 3),    {"layout": {"w": 0.66, "top": -0.13}}),
    (197, "headwear", "bearears",   "hat49", "Bear ears",     "common", ("runs", 5),    {"layout": {"w": 0.72, "top": -0.14}}),
    (528, "headwear", "devilhorns", "hat50", "Devil horns",   "rare",   ("level", 10),  {"layout": {"w": 0.7, "top": -0.09}}),
    (140, "headwear", "heartbopper", "hat51", "Heart boppers", "common", ("streak", 2), {"layout": {"w": 0.72, "top": -0.11}}),
    (141, "headwear", "cherrybopper", "hat52", "Cherry boppers", "common", ("runs", 8), {"layout": {"w": 0.72, "top": -0.10}}),
    (430, "headwear", "spikecrown", "hat53", "Spike band",    "rare",   ("zones", 5),   {"layout": {"w": 0.7, "top": -0.055}}),
    (622, "headwear", "punkcrown",  "hat54", "Punk crown",    "epic",   ("level", 18),  {"layout": {"w": 0.74, "top": -0.06}}),
    (431, "headwear", "royalcrown", "hat55", "Royal crown",   "legendary", ("level", 38),   {"layout": {"w": 0.72, "top": -0.10}}),
    (59,  "headwear", "bowberet",   "hat56", "Bow beret",     "common", ("runs", 10),   {"hidesBulky": True, "layout": {"w": 0.8, "top": -0.055}}),
    (138, "headwear", "bowcap",     "hat57", "Bow cap",       "common", ("dist", 10),   {"hidesBulky": True}),
    (191, "headwear", "maidband",   "hat58", "Maid band",     "common", ("streak", 2),  {"layout": {"w": 0.72, "top": -0.045}}),
    (143, "headwear", "daisyband",  "hat59", "Daisy band",    "common", None,           {"layout": {"w": 0.76, "top": -0.03}}),
    (353, "headwear", "starband",   "hat60", "Star band",     "rare",   ("runs", 15),   {"layout": {"w": 0.72, "top": 0.0}}),
    (198, "headwear", "champband",  "hat61", "Champion band", "rare",   ("zones", 5),   {"layout": {"w": 0.72, "top": 0.0}}),
    (504, "headwear", "varsityband", "hat62", "Varsity band", "common", ("runs", 12),   {"layout": {"w": 0.72, "top": 0.0}}),
    (199, "headwear", "angelheart", "hat63", "Angel heart",   "epic",   ("level", 16),      {"layout": {"w": 0.8, "top": -0.05}}),
    (441, "headwear", "flowerclip", "hat64", "Flower clip",   "common", None,           {"layout": {"w": 0.32, "top": 0.02, "dx": -0.26}}),
    # ---------------------------- glasses -----------------------------
    (647, "glasses", "weldgoggles", "specs24", "Welder goggles", "epic", ("level", 22), {"layout": {"w": 0.56}}),
    (490, "glasses", "pearlspecs",  "specs25", "Pearl specs",  "rare",   ("streak", 3), {"layout": {"w": 0.54}}),
    (484, "glasses", "butterfly",   "specs26", "Butterfly shades", "rare", ("runs", 12), {"layout": {"w": 0.56}}),
    (419, "glasses", "tintgoggles", "specs27", "Tint goggles", "rare",   ("dist", 25),  {"layout": {"w": 0.56}}),
    (182, "glasses", "onimask",     "specs28", "Oni mask",     "legendary", ("level", 42),  {"layout": {"w": 0.62, "cy": 0.175}}),
    # ------------------------------ tops ------------------------------
    (42,  "top", "puffblouse",  "top32", "Puff blouse",     "common", None,           {"interior": True, "neckhole": (0.5, 0.09, 0.10, 0.075)}),
    (574, "top", "letterman",   "top33", "Letterman jacket", "rare",  ("dist", 50),   {"interior": True, "neckhole": (0.5, 0.085, 0.11, 0.065)}),
    (633, "top", "teamjersey",  "top34", "Team jersey",     "rare",   ("runs", 15),   {"interior": True, "neckhole": (0.5, 0.075, 0.115, 0.07)}),
    (537, "top", "cyclejersey", "top35", "Cycle jersey",    "rare",   ("dist", 75),   {"interior": True, "neckhole": (0.5, 0.075, 0.10, 0.065)}),
    (581, "top", "puffervest",  "top36", "Puffer vest",     "rare",   ("zones", 3),   {"interior": True, "neckhole": (0.5, 0.075, 0.105, 0.085)}),
    (532, "top", "blackvest",   "top37", "Tech vest",       "rare",   ("level", 12),  {"interior": True, "neckhole": (0.5, 0.07, 0.10, 0.08)}),
    (43,  "top", "pastelcardi", "top38", "Pastel cardigan", "common", ("runs", 5),    {"interior": True, "neckhole": (0.5, 0.105, 0.09, 0.09)}),
    (49,  "top", "snowpuffer",  "top39", "Snow puffer",     "rare",   ("dist", 100),  {"interior": True, "neckhole": (0.5, 0.10, 0.10, 0.07)}),
    (451, "top", "sleevehoodie", "top40", "Sleeveless hoodie", "common", ("runs", 8), {"interior": True, "neckhole": (0.5, 0.08, 0.10, 0.09)}),
    (438, "top", "frilltop",    "top41", "Frill top",       "common", ("streak", 2),  {"interior": True, "neckhole": (0.5, 0.085, 0.10, 0.07)}),
    (109, "top", "maidapron",   "top42", "Maid apron",      "rare",   ("level", 8),   {"interior": True, "neckhole": (0.5, 0.075, 0.105, 0.065)}),
    (347, "top", "apron",       "top43", "Work apron",      "common", ("runs", 10),   {}),
    (149, "top", "bowcami",     "top44", "Bow cami",        "common", ("dist", 15),   {"interior": True, "neckhole": (0.5, 0.07, 0.115, 0.06)}),
    (535, "top", "knightarmor", "top45", "Knight armour",   "legendary", ("level", 46),   {"interior": True, "neckhole": (0.5, 0.085, 0.095, 0.065)}),
    (572, "top", "samuraiarmor", "top46", "Samurai armour", "epic",   ("zones", 10),      {"interior": True, "neckhole": (0.5, 0.10, 0.09, 0.07)}),
    # ----------------------------- bottoms ----------------------------
    (82,  "bottom", "ruffleskirt", "bottom23", "Ruffle skirt", "common", ("runs", 5),  {"layout": {"w": 0.82, "top": 0.545}}),
    (399, "bottom", "pleatskirt",  "bottom24", "Pleated skirt", "common", None,        {"layout": {"w": 0.80, "top": 0.545}}),
    (400, "bottom", "pencilskirt", "bottom25", "Pencil skirt", "common", ("runs", 8),  {"layout": {"w": 0.72, "top": 0.548}}),
    (77,  "bottom", "cargoskirt",  "bottom26", "Cargo skirt",  "rare",   ("zones", 3), {"layout": {"w": 0.80, "top": 0.545}}),
    (79,  "bottom", "splitshorts", "bottom27", "Split shorts", "common", None,         {"layout": {"w": 0.66}}),
    (558, "bottom", "pleatshorts", "bottom28", "Pleated shorts", "common", ("runs", 3), {"layout": {"w": 0.72}}),
    (474, "bottom", "plaidshorts", "bottom29", "Plaid shorts", "common", ("dist", 10), {"layout": {"w": 0.68}}),
    (233, "bottom", "sweatshorts", "bottom30", "Sweat shorts", "common", ("runs", 6),  {"layout": {"w": 0.68}}),
    (75,  "bottom", "flarepants",  "bottom31", "Flare pants",  "rare",   ("level", 10), {}),
    (404, "bottom", "cargojeans",  "bottom32", "Cargo jeans",  "rare",   ("dist", 50), {}),
    (472, "bottom", "pinstripe",   "bottom33", "Pinstripe pants", "epic", ("level", 28), {}),
    (395, "bottom", "overallshorts", "bottom34", "Overall shorts", "rare", ("runs", 12), {"fit": "onepiece", "layout": {"w": 0.68, "top": 0.40}}),
    (480, "bottom", "overalls",    "bottom35", "Overalls",     "rare",   ("streak", 3), {"fit": "onepiece", "layout": {"w": 0.68, "top": 0.40}}),
    # --------------------------- accessories --------------------------
    (494, "accessory", "lacecollar",  "acc23", "Lace collar",  "rare",   ("streak", 2), {"z": "front", "neck": 0.26, "layout": {"w": 0.50, "top": 0.285}}),
    (436, "accessory", "dogtags",     "acc24", "Dog tags",     "rare",   ("runs", 15),  {"z": "front", "neck": 0.30, "layout": {"w": 0.42, "top": 0.265}}),
    (439, "accessory", "pearlcollar", "acc25", "Pearl collar", "rare",   ("level", 12), {"z": "front", "neck": 0.30, "layout": {"w": 0.46, "top": 0.278}}),
    (259, "accessory", "pearls",      "acc26", "Pearl strand", "common", ("dist", 15),  {"z": "front", "neck": 0.32, "layout": {"w": 0.42, "top": 0.268}}),
    (107, "accessory", "charmchain",  "acc27", "Charm chain",  "common", ("runs", 10),  {"z": "front", "neck": 0.30, "layout": {"w": 0.44, "top": 0.265}}),
    (188, "accessory", "flowerchain", "acc28", "Daisy chain",  "common", None,          {"z": "front", "neck": 0.30, "layout": {"w": 0.46, "top": 0.265}}),
    (266, "accessory", "lei",         "acc29", "Flower lei",   "common", ("dist", 10),  {"z": "front", "neck": 0.28, "layout": {"w": 0.52, "top": 0.268}}),
    (104, "accessory", "neckerchief", "acc30", "Neckerchief",  "common", None,          {"z": "front", "neck": 0.24, "layout": {"w": 0.42, "top": 0.282}}),
    (110, "accessory", "sailorcollar", "acc31", "Sailor collar", "common", ("runs", 5), {"z": "front", "neck": 0.22, "layout": {"w": 0.62, "top": 0.265}}),
    (186, "accessory", "bowtie",      "acc32", "Bow tie",      "common", ("runs", 3),   {"z": "front", "layout": {"w": 0.26, "top": 0.29}}),
    (600, "accessory", "necktie",     "acc33", "Necktie",      "common", ("runs", 8),   {"z": "front", "neck": 0.16, "layout": {"w": 0.28, "top": 0.29}}),
    (606, "accessory", "medallion",   "acc34", "Medallion",    "epic",   ("level", 30), {"z": "front", "neck": 0.30, "layout": {"w": 0.42, "top": 0.265}}),
    (111, "accessory", "trophychain", "acc35", "Trophy chain", "epic",   ("runs", 30),     {"z": "front", "neck": 0.30, "layout": {"w": 0.42, "top": 0.265}}),
    (17,  "accessory", "silvermedal", "acc36", "Silver medal", "rare",   ("runs", 20),  {"z": "front", "neck": 0.28, "layout": {"w": 0.30, "top": 0.275}}),
    (23,  "accessory", "wintscarf",   "acc37", "Wool scarf",   "common", ("dist", 20),  {"z": "front", "neck": 0.20, "layout": {"w": 0.58, "top": 0.268}}),
    (550, "accessory", "candyscarf",  "acc38", "Candy scarf",  "common", ("streak", 3), {"z": "front", "neck": 0.20, "layout": {"w": 0.56, "top": 0.268}}),
    (599, "accessory", "redscarf",    "acc39", "Red scarf",    "common", ("runs", 12),  {"z": "front", "neck": 0.20, "layout": {"w": 0.56, "top": 0.268}}),
    (113, "accessory", "pageantsash", "acc40", "Pageant sash", "rare",   ("zones", 5),  {"z": "front", "layout": {"w": 0.78, "top": 0.30}}),
    (604, "accessory", "racesash",    "acc41", "Race sash",    "rare",   ("runs", 25),  {"z": "front", "layout": {"w": 0.82, "top": 0.30}}),
    (492, "accessory", "suspenders",  "acc42", "Suspenders",   "common", ("runs", 6),   {"z": "front", "layout": {"w": 0.70, "top": 0.315}}),
    (605, "accessory", "harness",     "acc43", "Race harness", "rare",   ("dist", 75),  {"z": "front", "layout": {"w": 0.74, "top": 0.315}}),
    (13,  "accessory", "fairywings",  "acc44", "Fairy wings",  "legendary", ("level", 36),  {"z": "back", "layout": {"w": 1.9, "cy": 0.36}}),
    (21,  "accessory", "teddypack",   "acc45", "Teddy pack",   "epic",   ("level", 16), {"z": "back", "layout": {"w": 1.25, "cy": 0.40}}),
    (549, "accessory", "messengerbag", "acc46", "Messenger bag", "common", ("runs", 10), {"z": "front", "layout": {"w": 0.80, "top": 0.34}}),
    (108, "accessory", "handbag",     "acc47", "Handbag",      "common", ("dist", 15),  {"z": "front", "layout": {"w": 0.62, "top": 0.40}}),
    (193, "accessory", "heartbag",    "acc48", "Heart bag",    "common", ("streak", 2), {"z": "front", "layout": {"w": 0.62, "top": 0.36}}),
    (500, "accessory", "sheriffstar", "acc49", "Sheriff star", "rare",   ("zones", 8),  {"z": "front", "layout": {"w": 0.24, "top": 0.37}}),
    (663, "accessory", "boombox",     "acc50", "Boombox",      "epic",   "premium",     {"z": "front", "layout": {"w": 0.66, "top": 0.36}}),
    (584, "accessory", "royalrobe",   "acc51", "Royal robe",   "legendary", ("level", 50),  {"z": "back", "layout": {"w": 1.25, "top": 0.28}}),
    (496, "accessory", "lacebib",     "acc52", "Lace bib",     "common", ("runs", 4),   {"z": "front", "neck": 0.18, "layout": {"w": 0.52, "top": 0.278}}),
]

FEATHER = 5


def load(idx):
    return np.asarray(Image.open(os.path.join(ITEMS_DIR, f"{idx:03d}.png"))
                      .convert("RGBA")).copy()


def trim(a):
    m = a[..., 3] > 16
    ys, xs = np.where(m)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def fit(a, max_dim=None, width=None, mask=None):
    """Downscale to the slot canvas. `mask` (the face opening) rides along
    through the same resize so it still lines up afterwards."""
    im = Image.fromarray(a.astype(np.uint8), "RGBA")
    w, h = im.size
    s = (width / w) if width else (max_dim / max(w, h))
    if s < 1:
        size = (max(1, round(w * s)), max(1, round(h * s)))
        im = im.resize(size, Image.LANCZOS)
        if mask is not None:
            mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8), "L")
                              .resize(size, Image.LANCZOS)) > 127
    return np.asarray(im).copy(), mask


# --- rig geometry, measured off body.png -----------------------------------
# The head's skin fill on the 248x640 body: centred at (0.5028 W, 0.1652 H),
# 158 px across at the 80th percentile of its row widths. A wig's opening is
# fitted to exactly this, which is what makes the hair wrap the head instead
# of floating over it.
BODY_W, BODY_H = 248, 640
# Rebuilt body (scripts/build-body-2.py, 2026-08-01): skull 157 wide, head box
# y 8..226, so its centre sits at (124, 117). Was 158 wide centred (124.7, 105.7).
HEAD_WIDTH = 157.0
HEAD_CX, HEAD_CY = 124.0, 117.0
HAIR_LIFT = -0.05          # CharacterRig adds this to every hair layer


def fit_to_head(art_w, art_h, hole):
    """Solve the layout that drops this wig's face opening onto the head.

    Scale comes from how WIDE the opening is, position from its centroid.
    Area was the obvious choice and is wrong here: a long style that hides the
    ears and cheeks exposes far less face than a cropped one, so matching area
    scaled those wigs up until they hung past the shoulders. The width of the
    opening tracks the head across every style. Returns a layout in the rig's
    own units, with HAIR_LIFT backed out so the rig adding it lands where we
    asked.
    """
    if hole is None or hole.sum() < 0.05 * art_w * art_h:
        return None          # too little opening for the centroid to mean much
    ar = art_h / art_w
    rows = hole.sum(1)
    hole_w = float(np.percentile(rows[rows > 0], 80))
    if hole_w < 4:
        return None
    W = HEAD_WIDTH * art_w / hole_w
    w_spec = min(max(W / BODY_W, 0.55), 1.45)
    W = w_spec * BODY_W
    ys, xs = np.where(hole)
    cx, cy = xs.mean() / art_w, ys.mean() / art_h
    left = HEAD_CX - cx * W
    top = HEAD_CY - cy * W * ar
    out = {"w": round(w_spec, 3),
           "top": round(top / BODY_H - HAIR_LIFT, 4)}
    dx = (left - (BODY_W / 2 - W / 2)) / BODY_W
    if abs(dx) > 0.006:
        out["dx"] = round(dx, 4)
    return out


def find_hole(a):
    """The face opening of a wig that already has one.

    Some styles ship with the face area transparent, so there is nothing to
    cut — but the opening still has to be located to place the piece. A plain
    hole-fill misses it whenever the opening runs off the bottom (any bob or
    open cut), so the alpha is closed off with a solid bottom row first; the
    face then reads as enclosed and falls out as a hole.
    """
    opaque = a[..., 3] > 100
    closed = opaque.copy()
    closed[-1, :] = True
    holes = ndimage.binary_fill_holes(closed) & ~opaque
    lab, n = ndimage.label(holes)
    best = None
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() < 0.04 * comp.size:
            continue
        if comp[:, 0].any() or comp[:, -1].any() or comp[0, :].any():
            continue                    # runs off the side/top: not a face
        if best is None or comp.sum() > best.sum():
            best = comp
    return best


def cut_face(a, tol=30):
    """Turn a drawn head into a wig — see probe-hair-3.py for the rationale."""
    h, w = a.shape[:2]
    rgb = a[..., :3].astype(int)
    opaque = a[..., 3] > 100
    best = None
    for fy in (0.52, 0.62, 0.72):
        for fx in (0.5, 0.42, 0.58):
            y, x = int(h * fy), int(w * fx)
            if not opaque[y, x]:
                continue
            s = rgb[y, x]
            # the fill is always pale; a dark seed is a fringe, and flooding
            # from there eats the hairstyle instead of the face
            if s.mean() < 155 or int(s.max() - s.min()) > 70:
                continue
            near = (np.abs(rgb - s).max(2) <= tol) & opaque
            near = ndimage.binary_opening(near, np.ones((3, 3)))
            lab, n = ndimage.label(near)
            if n == 0 or lab[y, x] == 0:
                continue
            blob = lab == lab[y, x]
            if not 0.04 < blob.mean() < 0.55:
                continue
            if (blob[0, :].mean() + blob[-1, :].mean()) / 2 > 0.35:
                continue
            if best is None or blob.sum() > best.sum():
                best = blob
    if best is None:
        return a, None
    mask = ndimage.binary_fill_holes(best)
    grow = max(3, round(0.012 * min(h, w)))
    mask = ndimage.binary_dilation(mask, np.ones((3, 3)), iterations=grow)
    soft = np.clip(ndimage.gaussian_filter(mask.astype(float), 0.8), 0, 1)
    a[..., 3] = (a[..., 3] * (1 - soft)).astype(np.uint8)

    # the drawn jaw line sits just outside the fill and is left stranded by the
    # cut; bangs survive because they stay attached to the hair mass
    inside = ndimage.binary_dilation(mask, np.ones((3, 3)), iterations=grow * 3)
    lab, n = ndimage.label(a[..., 3] > 100)
    if n > 1:
        drop = np.zeros(n + 1, bool)
        for i in range(1, n + 1):
            comp = lab == i
            if comp.sum() < 0.03 * h * w and (comp & inside).sum() > 0.7 * comp.sum():
                drop[i] = True
        if drop.any():
            a[..., 3] = np.where(drop[lab], 0, a[..., 3]).astype(np.uint8)
    return a, mask


def cut_interior(a, neck=None):
    """Punch the neck opening clean through a garment.

    A sharp ellipse beats a luminance-derived mask here: these garments are
    drawn flat-on with their own inner back painted inside the collar, and a
    soft mask just smudges it. The ellipse is deliberately smaller than the
    collar so the collar survives and frames the hole.
    """
    h, w = a.shape[:2]
    cx, cy, rx, ry = neck or (0.5, 0.085, 0.115, 0.085)
    yy, xx = np.mgrid[0:h, 0:w]
    ell = (((xx / w - cx) / rx) ** 2 + ((yy / h - cy) / ry) ** 2) <= 1.0
    mask = ell & (a[..., 3] > 32)
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
    js = {s: [] for s in ["hair", "headwear", "glasses", "top", "bottom", "accessory"]}
    manifest, premium = [], []
    seen_ids = set()
    for idx, slot, iid, stem, label, rarity, unlock, extra in N:
        assert iid not in seen_ids, f"duplicate id {iid}"
        seen_ids.add(iid)
        a = trim(load(idx))
        notes = []
        hole = None
        if slot == "hair":
            a, hole = cut_face(a)
            notes.append(f"face-cut {int(hole.sum())}px" if hole is not None
                         else "no face fill")
            if hole is None:
                hole = find_hole(a)
                if hole is not None:
                    notes.append(f"opening {int(hole.sum())}px")
        if extra.get("interior"):
            a, n_cut = cut_interior(a, extra.get("neckhole"))
            notes.append(f"neck-hole {n_cut}px")

        # trim (and carry the opening through the same crop + resize)
        ys, xs = np.where(a[..., 3] > 16)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        a = a[y0:y1, x0:x1]
        if hole is not None:
            hole = hole[y0:y1, x0:x1]
        a, hole = fit(a, mask=hole, **SLOT_FIT[slot])

        if slot == "hair":
            solved = fit_to_head(a.shape[1], a.shape[0], hole)
            if solved:
                # measured placement beats a hand-tuned guess; keep any dx the
                # spec asked for only if the solver didn't produce one
                extra = {**extra, "layout": solved}
                notes.append("head-fitted " + str(solved))
            else:
                notes.append("HAND LAYOUT")
        folder = os.path.join(CH, FOLDER[slot])
        os.makedirs(folder, exist_ok=True)

        back_ref, back_file = "", None
        if "neck" in extra:
            front, back = split_neck(a, extra["neck"])
            back_file = f"{stem}b.png"
            Image.fromarray(back.astype(np.uint8), "RGBA").save(
                os.path.join(folder, back_file), optimize=True)
            Image.fromarray(front.astype(np.uint8), "RGBA").save(
                os.path.join(folder, f"{stem}.png"), optimize=True)
            back_ref = (f", backImg: require('../../assets/character/"
                        f"{FOLDER[slot]}/{back_file}')")
            notes.append(f"split @{extra['neck']}")
        else:
            Image.fromarray(a.astype(np.uint8), "RGBA").save(
                os.path.join(folder, f"{stem}.png"), optimize=True)

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
        img_ref = (f"img: require('../../assets/character/"
                   f"{FOLDER[slot]}/{stem}.png'){back_ref}")
        bits = [f"id: '{iid}'", f"label: '{label}'", img_ref]
        if extra.get("z"):
            bits.append(f"z: '{extra['z']}'")
        if extra.get("fit"):
            bits.append(f"fit: '{extra['fit']}'")
        if extra.get("layout"):
            L = ", ".join(f"{k2}: {v2}" for k2, v2 in extra["layout"].items())
            bits.append(f"layout: {{ {L} }}")
        for flag in ("hideHair", "hidesBulky", "bulky"):
            if extra.get(flag):
                bits.append(f"{flag}: true")
        bits.append(f"rarity: '{rarity}'")
        bits.append(f"unlock: {unl}")
        js[slot].append("    { " + ", ".join(bits) + " },")

        manifest.append(dict(idx=idx, slot=slot, id=iid, stem=stem, label=label,
                             folder=FOLDER[slot], back=back_file,
                             layout=extra.get("layout", {}),
                             z=extra.get("z"), fit=extra.get("fit"),
                             hideHair=bool(extra.get("hideHair")),
                             hidesBulky=bool(extra.get("hidesBulky")),
                             bulky=bool(extra.get("bulky")),
                             w=int(a.shape[1]), h=int(a.shape[0])))
        print(f"{iid:14s} {slot:9s} {a.shape[1]}x{a.shape[0]}  "
              + ", ".join(notes))

    with open(os.path.join(SCRATCH, "catalog_snippet3.js"), "w") as f:
        for slot, lines in js.items():
            f.write(f"// ---- {slot} ----\n" + "\n".join(lines) + "\n\n")
    json.dump(manifest, open(os.path.join(SCRATCH, "installed3.json"), "w"), indent=1)
    with open(os.path.join(SCRATCH, "premium3.txt"), "w") as f:
        for iid, slot, label, rarity in premium:
            f.write(f"{slot}:{iid}|{label}|{rarity}\n")
    print(f"\n{len(N)} items installed, {len(premium)} PRO-exclusive")
    for s, lines in js.items():
        print(f"  {s:9s} {len(lines)}")


if __name__ == "__main__":
    main()
