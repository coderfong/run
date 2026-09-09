"""Install the rank tier illustrations — one wide scene per rung of the ladder.

WHAT THESE ARE. Ten 16:9 illustrations, one per tier (wood..mythic), each of
them the runner AT that tier: a stick and a bark shield in the woods, a medal
and a banner at Bronze, a crown on a pile of coins at Gold, a cape over a
crystal field at Diamond, and so on up. They are drawn to be seen as a set —
the same character, the same line weight, ten different worlds — which is the
whole reason the ladder screen reads as a climb rather than as a list.

WHERE THEY GO. `assets/art/rank/<tier>.png`, keyed by the tier keys the rest of
the app already uses (config/rankLadder.js, PortraitBorder, the map filters), so
the registry in src/config/rankArt.js is a plain lookup and a tier can never
show another tier's world.

WHY THIS IS A SCRIPT AND NOT A DRAG AND DROP.

  * CAPPED AT 1024 on the long side. The ladder draws a rung's art about 300pt
    wide, and 3x that is the most any display can resolve. The generation
    exports are 1672px — nearly three times the pixels for no visible gain, on
    a page that decodes ten of them in one scroll.
  * QUANTIZED to a 256 colour palette with Floyd-Steinberg dither. This is flat
    vector-style art with a handful of large gradients, which is the exact case
    an indexed PNG handles well: 6.8 MB of truecolour became 2.8 MB with no
    difference visible at the size the art is drawn (checked at 1:1 on the two
    hardest, Platinum's near-white armour and Prismatic's rainbow). The saving
    is real bundle weight on a build that is already over the OTA asset ceiling.
  * OPAQUE. These are full-bleed scenes with their background baked in — there
    is nothing to cut out, and an alpha channel would be a third more bytes for
    a plane of 255s.

RE-RUNNING IT. Drop new exports into `assets/art/rank/_src/<tier>.png` and run
this again; every tier present is rebuilt, the rest are left alone. The _src
directory is NOT in the repo (see .gitignore) — it is 15 MB of generation-size
originals that the installed copies are derived from, same arrangement as
assets/character/_src.

`scripts/downscale-art.py` also carries a rule for art/rank/*.png so a future
export dropped straight into the shipped folder gets trimmed rather than
falling through to the 640 card rule and turning to mush. This script is the
owner; that rule is the safety net.

Run from frontend/:  python scripts/install-rank-art.py [--src DIR] [--dry-run]
"""

import argparse
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "art" / "rank"
SRC = OUT / "_src"

# The ladder, floor first. Mirrors RANK_TIERS in src/config/rankLadder.js.
TIERS = [
    "wood", "bronze", "silver", "gold", "platinum",
    "diamond", "onyx", "ember", "prismatic", "mythic",
]

# The long side, in pixels. 3x the ~300pt a rung draws at.
CAP = 1024
COLOURS = 256


def ground(im):
    """The art's own ground colour, averaged over the bottom sixth.

    src/config/rankArt.js paints this under the image so a rung that is still
    decoding is the scene's own dirt, sand, lava or ice rather than a grey
    hole — and so the art has something to sit on when it is letterboxed.
    """
    band = im.convert("RGB").crop((0, im.height - im.height // 6, im.width, im.height))
    band = band.resize((32, 8), Image.LANCZOS)
    raw = band.tobytes()
    n = len(raw) // 3
    r, g, b = (sum(raw[i::3]) // n for i in range(3))
    return f"#{r:02x}{g:02x}{b:02x}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(SRC), help="directory of <tier>.png exports")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src = pathlib.Path(args.src)
    if not src.is_dir():
        print(f"no source directory at {src}", file=sys.stderr)
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    done = 0
    for tier in TIERS:
        path = src / f"{tier}.png"
        if not path.exists():
            print(f"{tier:<10} (no source, left alone)")
            continue

        with Image.open(path) as raw:
            im = raw.convert("RGB")
            w, h = im.size
            if max(w, h) > CAP:
                scale = CAP / max(w, h)
                # round() rather than int(): flooring drifts the aspect, and
                # the ladder lays its rungs out against the art's own ratio.
                im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
            out = im.quantize(colors=COLOURS, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)

        dest = OUT / f"{tier}.png"
        print(f"{tier:<10} {w}x{h} -> {im.width}x{im.height}   ground {ground(im)}")
        if not args.dry_run:
            out.save(dest, optimize=True)
        done += 1

    print(f"\n{done} tier(s)" + (" (dry run)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
