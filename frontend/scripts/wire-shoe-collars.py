"""Point every shoe at the back piece scripts/split-shoe-collars.py cut for it.

Adds `footLBack`/`footRBack` beside `footL`/`footR`, or `backImg` for the few
shoes still worn as one pair image. The rig draws those before the body, which
is what lets the ankle pass through the collar.

Idempotent: a shoe that already carries the field is left alone.

Run from frontend/ AFTER split-shoe-collars.py:
    python scripts/wire-shoe-collars.py [--dry]
"""
import os
import re
import shutil
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
FE = os.path.dirname(HERE)
SHOES = os.path.join(FE, "assets", "character", "footwear")
CONFIG = os.path.join(FE, "src", "config", "outfitItems.js")
ART = "require('../../assets/character/footwear/%s')"


def main():
    dry = "--dry" in sys.argv
    lines = open(CONFIG, encoding="utf-8").read().split("\n")
    added = skipped = missing = 0

    for i, line in enumerate(lines):
        m = re.search(r"footwear/(shoe\d+)\.png", line)
        if not m:
            continue
        stem = m.group(1)
        if "footL: " in line:
            if "footLBack: " in line:
                skipped += 1
                continue
            names = {f"foot{s}Back": f"{stem}{s}-back.png" for s in "LR"}
            anchor = re.search(r"(footR: require\('[^']*'\), )", line)
        else:
            if "backImg: " in line:
                skipped += 1
                continue
            worn = f"{stem}_worn-back.png"
            names = {"backImg": worn if os.path.exists(os.path.join(SHOES, worn))
                     else f"{stem}-back.png"}
            anchor = re.search(r"((?:wornImg|img): require\('[^']*'\), )", line)

        if not anchor or any(not os.path.exists(os.path.join(SHOES, n))
                             for n in names.values()):
            print(f"  {stem}: no back piece on disk, left as one layer")
            missing += 1
            continue
        ins = "".join(f"{k}: {ART % v}, " for k, v in names.items())
        lines[i] = line[:anchor.end()] + ins + line[anchor.end():]
        added += 1

    print(f"\n{added} wired, {skipped} already wired, {missing} without art")
    if dry or not added:
        print("(dry run)" if dry else "nothing to write")
        return
    shutil.copy2(CONFIG, os.path.join(
        HERE, "fit-studio", "backups",
        f"outfitItems.js.collarbak-{time.strftime('%Y%m%dT%H%M%S')}"))
    open(CONFIG, "w", encoding="utf-8").write("\n".join(lines))
    print("written to src/config/outfitItems.js")


if __name__ == "__main__":
    main()
