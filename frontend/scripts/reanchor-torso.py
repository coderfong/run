"""Re-anchor torso items after the body rebuild.

The rebuilt body gained a neck, which pushed the shoulders down and squeezed
the torso slightly:

    shoulder line   230 -> 214
    crotch          450 -> 443      (head pulled down onto the shoulders)

(The first run of this script mapped 214->240 / 444->454 when the neck was
first added; the constants below are always CURRENT -> TARGET.)

Head-anchored slots (face, hair, headwear, glasses) are NOT touched — they key
off HEAD, which the rig derives, and the head itself did not move.

Everything anchored to the torso IS touched: tops, bottoms, one-pieces and
accessories. A flat offset would be wrong because the torso also got shorter,
so each `top` / `cy` is remapped affinely through the two landmarks — a point
that sat 40% of the way down the old torso still sits 40% down the new one.

Run from frontend/:  python scripts/reanchor-torso.py [--dry]
"""
import os
import re
import sys

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(FE, "src", "config", "cosmetics.js")
RIG = os.path.join(FE, "src", "components", "character", "CharacterRig.js")

BODY_H = 640
OLD_SHOULDER, OLD_CROTCH = 230.0, 450.0
NEW_SHOULDER, NEW_CROTCH = 214.0, 443.0
TORSO_SLOTS = {"top", "bottom", "accessory"}


def remap(frac):
    y = frac * BODY_H
    f = (y - OLD_SHOULDER) / (OLD_CROTCH - OLD_SHOULDER)
    return round((NEW_SHOULDER + f * (NEW_CROTCH - NEW_SHOULDER)) / BODY_H, 4)


def slot_blocks(src):
    """(slot, start, end) for each ITEMS array."""
    for m in re.finditer(r"\n  (\w+): \[\n(.*?)\n  \],", src, re.S):
        yield m.group(1), m.start(2), m.end(2)


def main():
    dry = "--dry" in sys.argv
    src = open(CAT, encoding="utf-8").read()
    out, cursor, changed = [], 0, 0

    for slot, s, e in slot_blocks(src):
        if slot not in TORSO_SLOTS:
            continue
        block = src[s:e]

        def fix(m):
            nonlocal changed
            changed += 1
            return f"{m.group(1)}: {remap(float(m.group(2)))}"

        new_block = re.sub(r"\b(top|cy): (-?[\d.]+)", fix, block)
        out.append((s, e, new_block))

    for s, e, new_block in reversed(out):
        src = src[:s] + new_block + src[e:]

    if not dry:
        open(CAT, "w", encoding="utf-8", newline="\n").write(src)
    print(f"cosmetics.js: {changed} torso anchors remapped")

    # --- the rig's base layouts -----------------------------------------
    rig = open(RIG, encoding="utf-8").read()
    n = 0
    for key in ("top", "bottom", "onepiece", "accessory"):
        pat = re.compile(r"(  %s: \{ w: [\d.]+, top: )(-?[\d.]+)( \},)" % key)

        def fix2(m):
            nonlocal n
            n += 1
            return f"{m.group(1)}{remap(float(m.group(2)))}{m.group(3)}"

        rig = pat.sub(fix2, rig)
    if not dry:
        open(RIG, "w", encoding="utf-8", newline="\n").write(rig)
    print(f"CharacterRig: {n} base layouts remapped")
    for key in ("top", "bottom", "onepiece", "accessory"):
        m = re.search(r"  %s: \{ w: [\d.]+, top: (-?[\d.]+) \}," % key, rig)
        if m:
            print(f"  {key:10s} top -> {m.group(1)}")


if __name__ == "__main__":
    main()
