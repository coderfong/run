"""Install the wave-6 wardrobe cut by cut-wardrobe-6.py — 111 bottoms + 88 shoes.

This refills the two slots that were emptied on 2026-08-08.

NAMING is generated, not written: two hundred pieces cannot be labelled by hand,
so each is "<family> · <colour>" with the colour read off the art (see
cut-wardrobe-6.py). Where that collides — and it does, there are five charcoal
shorts — the colourway takes a number. They are genuinely different garments
rather than one garment recoloured, which is what `family`/`colorway` normally
means in this file, so a picker should not collapse them.

SKIRTS are the one hand-made list. Length separates shorts from trousers
reliably, but skirt-vs-shorts does not automate on this art: the shorts are
drawn wide-legged with the crotch notch only in the last few percent of the
piece, so every geometric test tried (crotch gap at several depths, hem flare)
gave a smooth continuum with no separation. Twelve pieces picked off a contact
sheet beats a threshold that is wrong forty times.

LAYOUTS are a category guess for the same reason as wave 5 — the art has no
body under it to measure against. Adjust in Fit Studio (`npm run fit`).
"""
import json
import os
import re
import shutil
from collections import Counter

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CUTS = os.path.join(HERE, "out6")
OUTFIT = r"C:\Users\user\Desktop\run\frontend\assets\character\outfit"
SHOES = r"C:\Users\user\Desktop\run\frontend\assets\character\footwear"
CONFIG = r"C:\Users\user\Desktop\run\frontend\src\config\outfitItems.js"

BODY = r"C:\Users\user\Desktop\run\frontend\assets\character\body\body.png"
BODY_W, BODY_H = 248, 640
WAIST_Y = 355.0          # top of every bottom
SOLE_Y = 635.0           # where a shoe has to land

# Ease — clothes are cut wider than the limb inside them.
EASE = {"shorts": 1.14, "trousers": 1.12, "bike": 1.02, "skirt": 1.10}


def leg_span():
    """Width of the LEGS (arms excluded) at each y of the body art.

    A flat width-per-family constant was the first attempt and it is what put
    the runner's thighs outside their own shorts: the garments were scaled so
    their WIDEST point matched the body, but these are drawn tapering while the
    body's legs stay wide all the way to the ankle, so every hem came in
    narrower than the leg it was supposed to cover. Scaling against a measured
    profile fixes it for all 111 pieces at once.
    """
    import numpy as np
    m = np.asarray(Image.open(BODY).convert("RGBA"))[..., 3] > 128
    span = {}
    for y in range(int(WAIST_Y), BODY_H):
        on = np.where(m[y])[0]
        if len(on) < 2:
            continue
        groups, s, p = [], on[0], on[0]
        for x in on[1:]:
            if x - p > 3:
                groups.append((s, p))
                s = x
            p = x
        groups.append((s, p))
        # Above ~y450 the arms are still touching the torso and there is one
        # run; below it the outer two runs are arms and the inner two are legs.
        legs = groups[1:-1] if len(groups) >= 4 else groups
        span[y] = legs[-1][1] - legs[0][0] + 1
    return span


SPAN = None
LABEL = {"shorts": "Shorts", "bike": "Bike shorts", "trousers": "Trousers",
         "skirt": "Skirt", "shoes": "Shoes", "boots": "Boots"}


def at(y):
    y = int(max(WAIST_Y, min(SOLE_Y - 1, y)))
    return SPAN.get(y, SPAN[min(SPAN)])


# Widths chosen by rendering one garment of each family over the body at 0.70 /
# 0.80 / 0.90 / 1.00 and looking (scripts/qa-wardrobe6/ab.png). Two earlier
# attempts are worth not repeating: 0.70 for everything left the runner's
# thighs sticking out of their own shorts, and solving the scale against the
# measured leg profile over-corrected to 1.07-1.25 because these garments taper
# while the body's legs do not. The eye settled it at 0.90.
PLACE = {
    "shorts":   0.90,
    "bike":     0.80,
    "trousers": 0.90,
    "skirt":    0.98,
}


def fit_bottom(img, family):
    return PLACE[family], round(WAIST_Y / BODY_H, 4)


def fit_shoe(img):
    """Width by eye like the rest; the vertical IS solved — whatever the pair's
    proportions, the sole has to land on the ground the body stands on."""
    w_px = 0.70 * BODY_W
    h_px = w_px * img.height / img.width
    return round(w_px / BODY_W, 4), round((SOLE_Y - h_px) / BODY_H, 4)


def width_at(img, frac):
    """Opaque width at `frac` down the art, as a fraction of its full width."""
    import numpy as np
    m = np.asarray(img.convert("RGBA"))[..., 3] > 40
    ys, xs = np.where(m)
    y = min(ys.max(), ys.min() + int((ys.max() - ys.min()) * frac))
    on = np.where(m[y])[0]
    if len(on) < 2:
        return 1.0
    return (on.max() - on.min() + 1) / img.width

# Picked off scripts/qa-wardrobe6/short.png — see the module docstring.
SKIRTS = {"b012", "b030", "b034", "b037", "b045", "b056",
          "b062", "b072", "b082", "b090", "b106", "b107"}
BIKE = {"b017", "b051", "b061", "b071", "b085", "b095"}


def main():
    global SPAN
    SPAN = leg_span()
    rows = json.load(open(os.path.join(HERE, "wardrobe6.json")))
    os.makedirs(OUTFIT, exist_ok=True)
    os.makedirs(SHOES, exist_ok=True)

    for r in rows:
        if r["slot"] == "bottom":
            r["family"] = ("skirt" if r["key"] in SKIRTS
                           else "bike" if r["key"] in BIKE
                           else r["family"])
            if r["family"] == "skirt" and r["key"] not in SKIRTS:
                r["family"] = "shorts"          # the auto-guess only gets a vote
        else:
            # Every pair is drawn to the same landscape canvas, so the trimmed
            # aspect ratio is 0.67 for all 88 of them — boots, sandals and
            # trainers alike. There is nothing in the geometry to tell them
            # apart, so they share one family name rather than a guessed one.
            r["family"] = "shoes"

    # unique colourways
    counts = Counter((r["family"], r["colour"]) for r in rows)
    used = Counter()
    for r in rows:
        k = (r["family"], r["colour"])
        used[k] += 1
        r["colorway"] = r["colour"] if counts[k] == 1 else f"{r['colour']} {used[k]}"

    bottoms, shoes, manifest = [], [], []
    nb = nf = 0
    for r in rows:
        is_shoe = r["slot"] == "footwear"
        if is_shoe:
            nf += 1
            stem, iid, dest = f"shoe{300 + nf}", f"wf{nf:03d}", SHOES
            folder = "footwear"
        else:
            nb += 1
            stem, iid, dest = f"ofB{300 + nb}", f"wb{nb:03d}", OUTFIT
            folder = "outfit"
        art_path = os.path.join(CUTS, f"{r['key']}.png")
        shutil.copyfile(art_path, os.path.join(dest, f"{stem}.png"))
        img = Image.open(art_path)
        w, top = fit_shoe(img) if is_shoe else fit_bottom(img, r["family"])
        n = nf if is_shoe else nb
        rarity, unlock = "common", "free"
        if n % 11 == 0:
            rarity, unlock = "epic", "dist(25, 'Run 25 km total')"
        elif n % 5 == 0:
            rarity, unlock = "rare", "runs(15, 'Finish 15 runs')"
        fam = LABEL[r["family"]]
        line = (f"  {{ id: '{iid}', label: '{fam} · {r['colorway']}', family: '{fam}', "
                f"colorway: '{r['colorway']}', "
                f"img: require('../../assets/character/{folder}/{stem}.png'), "
                f"layout: {{ w: {w}, top: {top} }}, "
                f"rarity: '{rarity}', unlock: {unlock} }},")
        (shoes if is_shoe else bottoms).append(line)
        manifest.append(dict(key=r["key"], id=iid, stem=stem, slot=r["slot"],
                             family=r["family"], colorway=r["colorway"],
                             layout={"w": w, "top": top}, rarity=rarity))

    src = open(CONFIG, encoding="utf-8").read()
    # Idempotent: drop anything a previous run of THIS script left behind, so
    # re-running after a naming tweak replaces the block instead of doubling it.
    keep = [l for l in src.splitlines()
            if not re.search(r"id: 'w[bf]\d{3}'", l)
            and "--- wave 6 (2026-08-09) ---" not in l
            and "Names and layouts are both generated" not in l]
    src = "\n".join(keep) + "\n"
    banner = ("  // --- wave 6 (2026-08-09) --- refills the slots emptied on 08-08.\n"
              "  // Names and layouts are both generated; see scripts/install-wardrobe-6.py.\n")
    for arr, lines in (("OUTFIT_BOTTOMS", bottoms), ("FOOTWEAR", shoes)):
        i = src.index(f"export const {arr} = [")
        end = src.index("\n];", i)
        src = src[:end] + "\n" + banner + "\n".join(lines) + src[end:]
    open(CONFIG, "w", encoding="utf-8").write(src)

    json.dump(manifest, open(os.path.join(HERE, "installed-wardrobe6.json"), "w"), indent=1)
    print(f"{len(bottoms)} bottoms + {len(shoes)} shoes written into outfitItems.js")
    print("  bottoms by family:", dict(Counter(m["family"] for m in manifest
                                               if m["slot"] == "bottom")))
    print("  shoes by family  :", dict(Counter(m["family"] for m in manifest
                                               if m["slot"] == "footwear")))
    print("  rarity           :", dict(Counter(m["rarity"] for m in manifest)))


if __name__ == "__main__":
    main()
