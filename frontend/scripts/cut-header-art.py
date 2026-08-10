"""Lift the header and onboarding art off its baked background.

Every one of these illustrations was drawn as a full-bleed scene: a flat colour
ground with the characters painted on top, 0% transparent. That only works for
the treatment they had — the art filling a rectangle, with a scrim over it and
white outlined text floating on top, or boxed in a coloured squircle.

They now sit as CUT-OUTS: the page headers use Home's hero-card format (flat
brand panel, black copy on the left, characters on the right), and the
onboarding steps stand their characters straight on the night stage. Both need
real alpha, which is what this produces. Originals in assets/art/season/,
assets/art/ui/ and assets/art/onboarding/ are read but never written, so this
is re-runnable.

HOW THE KEY WORKS. The ground is flat but noisy (+/-5 per channel from the
generator), so a plain equality test leaves speckle:

  1. `bg` is the MEDIAN of the border ring, not a corner pixel — a corner can
     land on noise or on a stray bit of scene.
  2. Background is found by CONNECTIVITY, not by colour alone: near-bg pixels
     are labelled, and only the components touching the frame become
     transparent. A shirt or a flag painted in the ground colour is landlocked
     and survives. Keying purely on colour punches holes through the art.
  3. The outlines are anti-aliased, so pixels between the two thresholds get
     PARTIAL alpha — but only where they neighbour the removed ground, or the
     soft interior shading inside the characters goes translucent too.
  4. The result is trimmed to its ink. The panel draws the art `contain` in a
     fixed box, so any leftover margin shrinks the characters for nothing.

Run from frontend/:  python scripts/cut-header-art.py
"""

import pathlib
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# (source, output), both relative to assets/art/. Outputs go to their own
# directories so a source is never overwritten by its own cut-out.
SOURCES = [
    # The panel page headers draw these on the right.
    ("season/clubs.png", "panel/clubs.png"),
    ("season/solo.png", "panel/solo.png"),
    ("season/land.png", "panel/land.png"),
    ("season/claims.png", "panel/claims.png"),
    ("season/captures.png", "panel/captures.png"),
    ("season/defenses.png", "panel/defenses.png"),
    ("season/distance.png", "panel/distance.png"),
    ("ui/header-pasers.png", "panel/pasers.png"),
    ("ui/header-rivals.png", "panel/rivals.png"),
    # PASERBY: two runners passing each other, on a flat yellow ground. Same
    # treatment as the two above — the Crossroads header draws it as a cut-out.
    ("ui/header-crossroads.png", "panel/crossroads.png"),
    # The first-run steps stand these on the night stage, unboxed.
    ("onboarding/thumb-name.png", "onboarding/cut/name.png"),
    ("onboarding/thumb-birthday.png", "onboarding/cut/birthday.png"),
    ("onboarding/thumb-ready.png", "onboarding/cut/ready.png"),
]

# Distance from the sampled ground, in RGB units. Below T_BG a pixel is ground;
# above T_INK it is art; between the two it is an anti-aliased edge.
T_BG = 34.0
T_INK = 96.0
# How far the feather may reach in from the removed ground.
FEATHER_PX = 3
# 3x the ~190pt the panel draws the art at.
MAX_SIDE = 640


def cut(path: pathlib.Path) -> Image.Image:
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    h, w, _ = rgb.shape

    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)

    dist = np.linalg.norm(rgb - bg, axis=2)

    # Ground = near-bg AND reachable from the frame.
    near = dist <= T_BG
    labels, n = ndimage.label(near)
    if n:
        edge = np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])
        outside = np.isin(labels, np.unique(edge[edge > 0]))
    else:
        outside = np.zeros_like(near)

    alpha = np.full((h, w), 255.0, dtype=np.float32)
    alpha[outside] = 0.0

    # Feather only the rim of what was removed.
    rim = ndimage.binary_dilation(outside, iterations=FEATHER_PX) & ~outside
    band = rim & (dist < T_INK)
    alpha[band] = np.clip((dist[band] - T_BG) / (T_INK - T_BG), 0.0, 1.0) * 255.0

    # The ground colour bleeds into the anti-aliased rim; without this the
    # cut-out keeps a halo of its old background on the new panel colour.
    out = np.dstack([rgb, alpha]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")

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
        opaque = (np.asarray(img)[:, :, 3] > 8).mean()
        print(f"{src:30s} -> {out:26s} {img.size[0]}x{img.size[1]}  {opaque * 100:.0f}% ink")
    return 0


if __name__ == "__main__":
    sys.exit(main())
