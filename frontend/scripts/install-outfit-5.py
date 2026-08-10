"""Install the wave-5 outfit pieces cut by cut-outfit-5.py.

15 tops + 21 bottoms, drawn in the body's own flat line-art style (the same
hand as the wave-4 headwear).

ABOUT THE LAYOUTS. Every earlier wave could MEASURE its placement — the outfit
cutter had the garment on a rendered body, the wigs and hats had a drawn head
to register against. This art has neither: each garment is drawn alone, scaled
to fill its cell on the sheet, so a tee and a pair of joggers that look the same
size on the sheet are nothing like the same size on a body. There is no landmark
to solve from.

So these layouts are a CATEGORY GUESS, not a measurement: a width per garment
family (measured off the body silhouette — legs span 0.63 of the frame at the
knee, torso-plus-arms 0.95 at the chest) and a shared collar / waist anchor.
Height then follows each piece's own aspect, which is what makes a crop top end
high and joggers reach the ankle without either being specified.

They are meant to be adjusted. Run `npm run fit`, drag them onto the body, and
press "Write into catalogue" — that is the tool that owns these numbers now.
"""
import json
import os
import re
import shutil

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CUTS = os.path.join(HERE, "out5")
DEST = r"C:\Users\user\Desktop\run\frontend\assets\character\outfit"
CONFIG = r"C:\Users\user\Desktop\run\frontend\src\config\outfitItems.js"

# Width as a fraction of the 248px body box, and where the art's TOP edge sits
# as a fraction of the 640px body height. Measured reference points on the body
# art: collar y=203 (0.317), waist y=355 (0.555), sole y=635.
FAMILY = {
    #                     w      top
    "vest":            (0.62, 0.3172),
    "tee":             (1.00, 0.3172),
    "croptee":         (0.92, 0.3172),
    "shirt":           (1.02, 0.3100),
    "jacket":          (1.05, 0.2980),
    "cropjacket":      (1.00, 0.3050),
    "gilet":           (0.86, 0.3050),
    "shorts":          (0.70, 0.5480),
    "bikeshorts":      (0.64, 0.5480),
    "trousers":        (0.70, 0.5480),
    "leggings":        (0.64, 0.5480),
    "skirt":           (0.86, 0.5620),
}

# key, slot, id, stem, family label, colorway, fit family, rarity, unlock
# unlock: None = free | ("runs", n) | ("dist", km)
N = [
    # ---------------------------- sheet 0 ----------------------------
    ("0-00", "top", "k1t",  "ofT101", "Running vest",   "White",    "vest",       "common", None),
    ("0-01", "top", "k2t",  "ofT102", "Boxy tee",       "Black",    "tee",        "common", None),
    ("0-02", "top", "k3t",  "ofT103", "Zip hoodie",     "Charcoal", "jacket",     "common", None),
    ("0-03", "top", "k4t",  "ofT104", "Raglan tee",     "Black",    "tee",        "common", None),
    ("0-04", "top", "k5t",  "ofT105", "Crop tee",       "Pink",     "croptee",    "common", None),
    ("0-05", "top", "k6t",  "ofT106", "Track hoodie",   "Blue",     "jacket",     "rare",   ("runs", 15)),
    ("0-06", "bottom", "k1b",  "ofB101", "Sprint shorts",  "Charcoal", "shorts",  "common", None),
    ("0-07", "bottom", "k2b",  "ofB102", "Track joggers",  "Charcoal", "trousers", "common", None),
    ("0-08", "bottom", "k3b",  "ofB103", "Sweatpants",     "Grey",     "trousers", "common", None),
    ("0-09", "bottom", "k4b",  "ofB104", "Split shorts",   "Charcoal", "shorts",  "common", None),
    ("0-10", "bottom", "k5b",  "ofB105", "Leggings",       "Black",    "leggings", "common", None),
    ("0-11", "bottom", "k6b",  "ofB106", "Pleated skirt",  "Charcoal", "skirt",   "common", None),
    # ---------------------------- sheet 1 ----------------------------
    ("1-00", "top", "k7t",  "ofT107", "Zip gilet",      "Teal",     "gilet",      "rare",   ("runs", 15)),
    ("1-01", "top", "k8t",  "ofT108", "Half-zip",       "Lilac",    "shirt",      "common", None),
    ("1-02", "top", "k9t",  "ofT109", "Block hoodie",   "Blush",    "jacket",     "common", None),
    ("1-03", "bottom", "k7b",  "ofB107", "Gym shorts",     "Blush",    "shorts",  "common", None),
    ("1-04", "bottom", "k8b",  "ofB108", "Track pants",    "Teal",     "trousers", "common", None),
    ("1-05", "bottom", "k9b",  "ofB109", "Cargo pants",    "Charcoal", "trousers", "rare",  ("runs", 15)),
    ("1-06", "bottom", "k10b", "ofB110", "Retro shorts",   "Cream",    "shorts",  "common", None),
    ("1-07", "bottom", "k11b", "ofB111", "Cargo shorts",   "Charcoal", "shorts",  "common", None),
    ("1-08", "bottom", "k12b", "ofB112", "Tennis skort",   "Mint",     "skirt",   "common", None),
    ("1-09", "bottom", "k13b", "ofB113", "Bike shorts",    "Charcoal", "bikeshorts", "common", None),
    ("1-10", "bottom", "k14b", "ofB114", "Flare pants",    "Mauve",    "trousers", "epic",  ("dist", 25)),
    ("1-11", "bottom", "k15b", "ofB115", "Pleated skirt",  "Navy",     "skirt",   "common", None),
    # ---------------------------- sheet 2 ----------------------------
    ("2-00", "top", "k10t", "ofT110", "Varsity jacket", "Navy",     "jacket",     "epic",   ("dist", 25)),
    ("2-01", "top", "k11t", "ofT111", "Stripe polo",    "White",    "shirt",      "common", None),
    ("2-02", "top", "k12t", "ofT112", "Crop jacket",    "Blush",    "cropjacket", "rare",   ("runs", 15)),
    ("2-03", "top", "k13t", "ofT113", "Rugby shirt",    "Lilac",    "shirt",      "common", None),
    ("2-04", "top", "k14t", "ofT114", "Crop puffer",    "Grey",     "cropjacket", "common", None),
    ("2-05", "top", "k15t", "ofT115", "Pocket hoodie",  "Slate",    "jacket",     "common", None),
    ("2-06", "bottom", "k16b", "ofB116", "Utility shorts", "Slate",    "shorts",  "rare",  ("runs", 15)),
    ("2-07", "bottom", "k17b", "ofB117", "Board shorts",   "Navy",     "shorts",  "common", None),
    ("2-08", "bottom", "k18b", "ofB118", "Bike shorts",    "Pastel",   "bikeshorts", "common", None),
    ("2-09", "bottom", "k19b", "ofB119", "Cargo joggers",  "Mint",     "trousers", "common", None),
    ("2-10", "bottom", "k20b", "ofB120", "Stripe pants",   "Slate",    "trousers", "common", None),
    ("2-11", "bottom", "k21b", "ofB121", "Pleated skirt",  "White",    "skirt",   "common", None),
]


def unlock_src(unlock):
    if unlock is None:
        return "free"
    kind, v = unlock
    return {"runs": f"runs({v}, 'Finish {v} runs')",
            "dist": f"dist({v}, 'Run {v} km total')"}[kind]


def line_for(iid, family, colorway, stem, layout, rarity, unlock):
    lay = ", ".join(f"{k}: {v}" for k, v in layout.items())
    return (
        f"  {{ id: '{iid}', label: '{family} · {colorway}', family: '{family}', "
        f"colorway: '{colorway}', "
        f"img: require('../../assets/character/outfit/{stem}.png'), "
        f"layout: {{ {lay} }}, rarity: '{rarity}', unlock: {unlock_src(unlock)} }},"
    )


def main():
    os.makedirs(DEST, exist_ok=True)
    tops, bottoms, manifest = [], [], []
    seen = set()
    for key, slot, iid, stem, family, colorway, fam, rarity, unlock in N:
        assert iid not in seen and stem not in seen, f"duplicate {iid}/{stem}"
        seen.update((iid, stem))
        src = os.path.join(CUTS, f"{key}.png")
        im = Image.open(src).convert("RGBA")
        shutil.copyfile(src, os.path.join(DEST, f"{stem}.png"))
        w, top = FAMILY[fam]
        layout = {"w": w, "top": top}
        line = line_for(iid, family, colorway, stem, layout, rarity, unlock)
        (tops if slot == "top" else bottoms).append(line)
        manifest.append(dict(key=key, slot=slot, id=iid, stem=stem, family=family,
                             colorway=colorway, fit=fam, layout=layout,
                             w=im.width, h=im.height))
        print(f"{iid:6s} {stem:8s} {slot:6s} {im.width:3d}x{im.height:3d}  "
              f"{family} / {colorway}  w={w} top={top}")

    src = open(CONFIG, encoding="utf-8").read()
    banner = ("  // --- wave 5 (2026-08-07) --- drawn alone rather than on a body, so\n"
              "  // these layouts are a category guess, not a measurement. Adjust them\n"
              "  // in Fit Studio (`npm run fit`), not by hand.\n")
    for arr, lines in (("OUTFIT_TOPS", tops), ("OUTFIT_BOTTOMS", bottoms)):
        marker = f"export const {arr} = ["
        i = src.index(marker)
        end = src.index("\n];", i)
        src = src[:end] + "\n" + banner + "\n".join(lines) + src[end:]
    open(CONFIG, "w", encoding="utf-8").write(src)

    json.dump(manifest, open(os.path.join(HERE, "installed-outfit5.json"), "w"), indent=1)
    print(f"\n{len(tops)} tops + {len(bottoms)} bottoms written into outfitItems.js")


if __name__ == "__main__":
    main()
