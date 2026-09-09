"""Lift the Home rail stickers off the tile panels they were drawn on.

The masters in assets/art/rail/ are drawn as FINISHED TILES: a black rounded
frame, a flat colour panel inside it, and the sticker painted on top. The rail
already draws the tile — a hand-drawn `Framed` box filled with the tile's tint
(components/SideRail.js) — so shipping the masters as-is would print a second,
square-cornered frame and a second background inside the first one. Framed
content never paints its own background.

So each master is reduced to just its sticker, on real alpha, and the panel
colour moves into the tile's `tint` in SideRail instead.

HOW IT WORKS. Same key as scripts/cut-header-art.py, with a crop in front of
it because these grounds are not the border of the image:

  1. The PANEL is the LARGEST bright, opaque region — the black frame and
     whatever lies outside it (transparent on one master, black on the others)
     are dark, the panel is not. Largest, not first-bright-pixel-inward: every
     master carries a thin light die-cut outline OUTSIDE its black frame, and
     scanning in from the edge stops on that instead of on the panel. Filling
     its holes gives the panel's real ROUNDED shape, which is what the frame is
     cut away against — a rectangular crop leaves a scrap of black frame at
     each corner, and those scraps then set the trim.
  2. `bg` is the MEDIAN of that region, which is the visible ground itself.
  3. Ground is found by CONNECTIVITY, not colour alone. The yellow spark marks
     sit on yellow and orange grounds; they survive because their black
     outlines make them landlocked, which a pure colour key would not.
  4. Anti-aliased edges get partial alpha, and the result is trimmed to its ink
     so the tile draws the sticker at full size rather than its margin.

Masters are read, never written, so this is re-runnable.

Run from frontend/:  python scripts/cut-rail-art.py
"""

import pathlib
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# (master, output), both relative to assets/art/. The outputs are what
# config/onboardingArt.js wires to the rail's `artKey`s.
SOURCES = [
    ("rail/missions.png", "ui/rail-missions.png"),
    ("rail/pass.png", "ui/rail-pass.png"),
    ("rail/shop.png", "ui/rail-shop.png"),
    ("rail/rivals.png", "ui/rail-rivals.png"),
    ("rail/crossroads.png", "ui/rail-crossroads.png"),
]

# A pixel is panel (not frame, not outside) above this luma, opaque.
T_PANEL = 90.0
# How far inside the panel's own edge the ground is taken from, so the frame's
# anti-aliased inner rim is never mistaken for it.
EDGE_PX = 6

# Distance from the sampled ground, in RGB units. Below T_BG a pixel is ground;
# above T_INK it is art; between the two it is an anti-aliased edge.
T_BG = 34.0
T_INK = 96.0
FEATHER_PX = 3
# 3x the 64pt the inline rail draws a tile at, with room for the You-page rail.
MAX_SIDE = 320


def panel(rgba: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """(ground pixels, panel interior) of a drawn tile."""
    rgb = rgba[:, :, :3].astype(np.float32)
    lit = (rgba[:, :, 3] > 128) & (rgb.max(axis=2) > T_PANEL)

    labels, n = ndimage.label(lit)
    if not n:
        raise SystemExit("no panel found — is this a drawn tile?")
    areas = np.bincount(labels.ravel())
    areas[0] = 0
    ground = labels == int(areas.argmax())
    inside = ndimage.binary_erosion(
        ndimage.binary_fill_holes(ground), iterations=EDGE_PX
    )
    return ground, inside


def cut(path: pathlib.Path) -> Image.Image:
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    rgb = rgba[:, :, :3].astype(np.float32)
    h, w, _ = rgb.shape
    ground, inside = panel(rgba)

    bg = np.median(rgb[ground], axis=0)
    dist = np.linalg.norm(rgb - bg, axis=2)

    # Ground = near-bg AND reachable from the panel's own edge, so the sparks
    # and paper drawn in a shade of the ground survive on their outlines.
    near = (dist <= T_BG) & inside
    labels, n = ndimage.label(near)
    outside = ~inside
    if n:
        edge = labels[inside & ~ndimage.binary_erosion(inside, iterations=EDGE_PX)]
        outside |= np.isin(labels, np.unique(edge[edge > 0]))

    alpha = np.full((h, w), 255.0, dtype=np.float32)
    alpha[outside] = 0.0

    rim = ndimage.binary_dilation(outside, iterations=FEATHER_PX) & ~outside
    band = rim & (dist < T_INK)
    alpha[band] = np.clip((dist[band] - T_BG) / (T_INK - T_BG), 0.0, 1.0) * 255.0

    img = Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), "RGBA")

    bbox = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        img = img.crop(bbox)

    if max(img.size) > MAX_SIDE:
        scale = MAX_SIDE / max(img.size)
        img = img.resize(
            (max(1, round(img.width * scale)), max(1, round(img.height * scale))),
            Image.LANCZOS,
        )
    return img


def main() -> int:
    for src, out in SOURCES:
        path = ASSETS / "art" / src
        if not path.exists():
            print(f"MISSING {src}")
            return 1
        img = cut(path)
        dest = ASSETS / "art" / out
        dest.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest, optimize=True)
        # The ground the sticker was lifted off, for the tile's `tint` middle
        # stop in components/SideRail.js — the two have to agree.
        rgba = np.asarray(Image.open(path).convert("RGBA"))
        ground, _ = panel(rgba)
        r, g, b = np.median(rgba[:, :, :3][ground], axis=0).astype(int)
        opaque = (np.asarray(img)[:, :, 3] > 8).mean()
        print(
            f"{src:22s} -> {out:24s} {img.size[0]:3d}x{img.size[1]:3d}"
            f"  {opaque * 100:2.0f}% ink  ground #{r:02X}{g:02X}{b:02X}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
