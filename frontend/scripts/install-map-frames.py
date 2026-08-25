"""Install the ranked-map board frames from ten delivered PNGs.

The predecessor, cut-rank-frames.py, took ONE contact sheet and had to find the
frames on it. This batch arrives as ten separate files that are already cut on
alpha, so the work here is only what the board needs on top of that:

  * CROP TO THE INK. Every file is a 941x1672 canvas with the frame floating
    somewhere inside it, and the empty margin is not the same on any two. The
    board stretches the art into a fixed rect, so an uncropped file spends part
    of that rect on nothing and lands the rail short of the screen edge — which
    is exactly the gap this pass exists to close. Cropping to the alpha bounding
    box makes the file's edge the frame's edge.

  * DOWNSCALE AND QUANTISE. Delivered at ~900px across and drawn at ~390pt:
    past 2x there is no more detail to show, only bytes to ship and pixels to
    decode. A 256-colour palette then takes each file from ~500KB to ~130KB,
    which is where the art it replaces already sat. Both matter on the map tab
    specifically, because that is the tab this decodes on.

Order is the ORDER THE FILES SORT IN, matched against TIER_ORDER below, the
same convention cut-rank-frames.py uses. Trailing "(n)" in a filename sorts
numerically, so the ten "ChatGPT Image ... (1..10).png" land in delivery order.

Usage:
    python scripts/install-map-frames.py <dir-or-files...> [--qa]

Writes assets/borders/map/<tier>.png, plus a QA contact sheet on a
checkerboard when asked — on white, a white halo and a clean edge look alike.
"""

import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets" / "borders" / "map"

# Which delivered frame is which rank, in sorted-filename order.
#
# THIS IS THE ONE THING TO CORRECT if a frame landed on the wrong rank. Each
# tier keeps the identity its previous art had, so a player who already knows
# the ladder still recognises it: gold is the laurel with the flame finial,
# mythic is the one wearing star badges, and so on.
TIER_ORDER = [
    "prismatic",  # 1   iridescent pastel band, violet gems
    "gold",       # 2   gold laurel wreath, flame finial
    "wood",       # 3   plain timber, knotted grain
    "bronze",     # 4   brass band, round rivets
    "silver",     # 5   polished chrome, mitred corners
    "mythic",     # 6   gold rope, star badges
    "platinum",   # 7   white metal, plain chamfer
    "diamond",    # 8   pale ice blue, round set gems
    "onyx",       # 9   near-black stone, violet spikes
    "ember",      # 10  charred iron, lava glow
]

# Anything under this is the feathered edge of the cut, not the frame.
FLOOR = 8

# Rendered width on the widest phone is ~430pt. 2x that is the last size with
# detail left to show; the art is stretched into the board's rect anyway, so
# the exact number only ever decides sharpness against bytes.
TARGET_W = 860

# Palette size. These are metal and stone under a few light stops, not
# photographs; 256 holds their gradients without visible banding.
PALETTE = 256


def sort_key(path):
    """Sorted order, with a trailing "(n)" read as a number."""
    m = re.search(r"\((\d+)\)\s*$", path.stem)
    return (0, int(m.group(1))) if m else (1, path.stem.lower())


def sources(args):
    paths = []
    for a in args:
        p = Path(a)
        if p.is_dir():
            paths.extend(p.glob("*.png"))
        else:
            paths.append(p)
    return sorted(paths, key=sort_key)


def prepare(path):
    """One delivered file in, one board-ready frame out."""
    img = Image.open(path).convert("RGBA")
    alpha = np.asarray(img)[..., 3]
    ys, xs = np.nonzero(alpha > FLOOR)
    if not ys.size:
        raise SystemExit(f"{path.name}: nothing but transparency")
    img = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

    if img.width > TARGET_W:
        h = round(img.height * TARGET_W / img.width)
        img = img.resize((TARGET_W, h), Image.LANCZOS)

    # FASTOCTREE, not the default median cut: it is the one PIL quantiser that
    # keeps an alpha channel, and the alpha IS the frame here — a palette that
    # dropped it would fill the middle back in and cover the map.
    return img.quantize(colors=PALETTE, method=Image.FASTOCTREE)


def band_pct(img):
    """The rail's thickness as a percentage of the frame's width.

    The number this whole pass is about: it is what decides how much map the
    board gives away to its own frame.
    """
    alpha = np.asarray(img.convert("RGBA"))[..., 3]
    row = alpha[alpha.shape[0] // 2] > FLOOR
    lit = np.nonzero(row)[0]
    if not lit.size:
        return 0.0
    run = 0
    i = lit[0]
    while i < row.size and row[i]:
        run += 1
        i += 1
    return 100 * run / img.width


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 1

    paths = sources(args)
    if len(paths) != len(TIER_ORDER):
        print(f"found {len(paths)} files, expected {len(TIER_ORDER)}")
        for p in paths:
            print(f"  {p.name}")
        return 1

    ASSETS.mkdir(parents=True, exist_ok=True)
    out = {}
    for tier, path in zip(TIER_ORDER, paths):
        img = prepare(path)
        target = ASSETS / f"{tier}.png"
        img.save(target, optimize=True)
        out[tier] = img
        kb = target.stat().st_size / 1024
        print(f"{tier:10} {img.size[0]}x{img.size[1]}  rail {band_pct(img):4.1f}%  {kb:6.0f} KB  <- {path.name}")

    if "--qa" in sys.argv:
        cols, pad, tile = 5, 16, 8
        rows = (len(out) + cols - 1) // cols
        cw = max(i.size[0] for i in out.values())
        ch = max(i.size[1] for i in out.values())
        qw, qh = cols * (cw + pad) + pad, rows * (ch + pad) + pad
        board = np.indices((qh, qw)).sum(axis=0) // tile % 2
        qa = Image.fromarray((board * 40 + 90).astype(np.uint8)).convert("RGBA")
        for i, tier in enumerate(TIER_ORDER):
            x = pad + (i % cols) * (cw + pad)
            y = pad + (i // cols) * (ch + pad)
            qa.alpha_composite(out[tier].convert("RGBA"), (x, y))
        path = HERE / "qa-map-frames.png"
        qa.save(path)
        print(f"\nQA sheet: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
