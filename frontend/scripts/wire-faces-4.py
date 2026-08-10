"""Wire the rebuilt face slot into the app.

Replaces the face array in cosmetics.js and re-anchors the rig.

IDS ARE KEPT even though every PNG behind them is new. A face id is stored in
each user's saved avatar and referenced by FREE_ITEMS in the backend pass, so
dropping one would blank out the face of anyone wearing it and break a reward
tier. The old art is deleted; the ids are re-pointed at the closest new
expression.
"""
import os
import re

SCRATCH = os.path.dirname(os.path.abspath(__file__))
FE = os.path.dirname(SCRATCH)
CAT = os.path.join(FE, "src", "config", "cosmetics.js")
RIG = os.path.join(FE, "src", "components", "character", "CharacterRig.js")
FACE_DIR = os.path.join(FE, "assets", "character", "face")

LAYOUT_W, LAYOUT_TOP, GLASSES_CY = 0.3806, 0.1182, 0.1549

# id, stem, label, unlock — the first 15 are the pre-existing ids with their
# original unlocks untouched, so nobody loses a face they had earned.
FACES = [
    ("smiley",     "faceN9",  "Smiley",    "free"),
    ("neutral",    "faceN22", "Neutral",   "free"),
    ("chill",      "faceN1",  "Chill",     "free"),
    ("laugh",      "faceN28", "Laugh",     "free"),
    ("content",    "faceN23", "Content",   "free"),
    ("grump",      "faceN5",  "Grump",     "runs(1, 'Finish your first run')"),
    ("determined", "faceN3",  "Game face", "runs(3, 'Finish 3 runs')"),
    ("wink",       "faceN13", "Wink",      "runs(5, 'Finish 5 runs')"),
    ("tongueout",  "faceN17", "Cheeky",    "runs(5, 'Finish 5 runs')"),
    ("whoa",       "faceN16", "Whoa",      "zones(1, 'Claim your first zone')"),
    ("stareyes",   "faceN21", "Star eyes", "zones(1, 'Claim your first zone')"),
    ("sleepy",     "faceN14", "Sleepy",    "streak(2, 'Hold a 2-week streak')"),
    # Was "Heart eyes" — there is no heart-eye drawing in the new set, so the
    # id (which the pass grants at tier 38 and users may be wearing) keeps its
    # slot but is relabelled to the art it now points at.
    ("hearteyes",  "faceN19", "Dizzy",     "streak(2, 'Hold a 2-week streak')"),
    ("exhausted",  "faceN12", "Cooked",    "dist(25, 'Run 25 km total')"),
    ("blush",      "faceN15", "Blush",     "dist(50, 'Run 50 km total')"),
    # --- new expressions ---
    ("worried",    "faceN2",  "Worried",   "free"),
    ("uneasy",     "faceN4",  "Uneasy",    "free"),
    ("glum",       "faceN8",  "Glum",      "free"),
    ("deadpan",    "faceN20", "Deadpan",   "free"),
    ("sad",        "faceN24", "Sad",       "free"),
    ("smirk",      "faceN6",  "Smirk",     "runs(3, 'Finish 3 runs')"),
    ("beam",       "faceN7",  "Beaming",   "runs(8, 'Finish 8 runs')"),
    ("angry",      "faceN10", "Angry",     "runs(10, 'Finish 10 runs')"),
    ("joy",        "faceN11", "Joy",       "dist(10, 'Run 10 km total')"),
    ("sob",        "faceN18", "Sob",       "dist(25, 'Run 25 km total')"),
    ("gasp",       "faceN26", "Gasp",      "zones(3, 'Hold 3 zones')"),
    ("sly",        "faceN27", "Sly",       "streak(3, 'Hold a 3-week streak')"),
    ("rage",       "faceN25", "Rage",      "level(15)"),
]

RARITY = {"free": "common"}


def rarity_for(unlock):
    if unlock == "free":
        return "common"
    if unlock.startswith("level") or "50 km" in unlock:
        return "epic"
    if unlock.startswith(("zones", "streak")) or "25 km" in unlock:
        return "rare"
    return "common"


def main():
    stems = {f[1] for f in FACES}
    have = {os.path.splitext(f)[0] for f in os.listdir(FACE_DIR)}
    missing = stems - have
    assert not missing, f"missing art: {sorted(missing)}"

    # --- catalogue -------------------------------------------------------
    lines = ["  face: ["]
    lines.append("    // Every face shares one placement, measured off the "
                 "reference head:")
    lines.append("    //   width = 0.59 x head width (outer brow to outer brow)")
    lines.append("    //   top   = 0.34 x head height (top of the eyebrows)")
    lines.append("    // That lives in CharacterRig's LAYOUT.face as a `top` "
                 "anchor rather")
    lines.append("    // than `cy`, so the brows hold their line while a long "
                 "mouth, a tear")
    lines.append("    // or a tongue is free to hang lower. No per-item "
                 "overrides — an item")
    lines.append("    // that drifts off the shared anchor also drifts away "
                 "from the glasses.")
    for iid, stem, label, unlock in FACES:
        lines.append(
            f"    {{ id: '{iid}', label: '{label}', "
            f"img: require('../../assets/character/face/{stem}.png'), "
            f"rarity: '{rarity_for(unlock)}', unlock: {unlock} }},")
    lines.append("  ],")
    block = "\n".join(lines)

    src = open(CAT, encoding="utf-8").read()
    new, n = re.subn(r"  face: \[\n.*?\n  \],", block, src, count=1, flags=re.S)
    assert n == 1, "face array not found"
    open(CAT, "w", encoding="utf-8", newline="\n").write(new)

    # --- rig anchors ------------------------------------------------------
    r = open(RIG, encoding="utf-8").read()
    r2, n1 = re.subn(r"  face: \{ w: [\d.]+, cy: [\d.]+ \},",
                     f"  face: {{ w: {LAYOUT_W}, top: {LAYOUT_TOP} }},", r, count=1)
    assert n1 == 1, "LAYOUT.face not found"
    r2, n2 = re.subn(r"  glasses: \{ w: ([\d.]+), cy: [\d.]+ \},",
                     lambda m: f"  glasses: {{ w: {m.group(1)}, cy: {GLASSES_CY} }},",
                     r2, count=1)
    assert n2 == 1, "LAYOUT.glasses not found"
    # the face chip: art was 0.62 of the chip against a 0.92 head circle
    # (0.67 of the head) — bring it to the same 0.59 the body uses
    r2, n3 = re.subn(r"(if \(slot === 'face'\).*?width: size \* )0\.62(,\n\s*height: size \* )0\.62",
                     r"\g<1>0.54\g<2>0.54", r2, count=1, flags=re.S)
    open(RIG, "w", encoding="utf-8", newline="\n").write(r2)

    # --- drop the old art -------------------------------------------------
    removed = []
    for f in sorted(os.listdir(FACE_DIR)):
        stem = os.path.splitext(f)[0]
        if re.fullmatch(r"face\d+", stem):
            os.remove(os.path.join(FACE_DIR, f))
            removed.append(f)
    unused = sorted(have - stems - {os.path.splitext(f)[0] for f in removed})
    for stem in unused:
        if stem.startswith("faceN"):
            os.remove(os.path.join(FACE_DIR, stem + ".png"))

    print(f"catalogue: {len(FACES)} faces wired")
    print(f"rig: face {{w:{LAYOUT_W}, top:{LAYOUT_TOP}}}, glasses cy {GLASSES_CY}, "
          f"chip {'0.54' if n3 else 'UNCHANGED'}")
    print(f"removed {len(removed)} old face PNGs, {len(unused)} unused new ones")


if __name__ == "__main__":
    main()
