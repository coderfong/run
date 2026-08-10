"""Raise the shoulder line so almost no neck shows.

The head, the neck and the torso are one image (`body/body.png` plus the eight
skin variants), so this is an art edit, not a layout change.

WHY IT WARPS THE SHOULDERS RATHER THAN MOVING THE HEAD
Moving the head down would drag every head-anchored layer with it — 28 faces,
62 hairstyles, 65 hats, 29 glasses, all of them calibrated against the head at
y=9..204 (the wave-3 wigs were fitted to it by measurement). Moving the torso
up would do the same to 41 tops, 35 bottoms and 47 accessories. Sliding ONLY
the shoulder line up leaves both anchors where they are: nothing in
cosmetics.js or CharacterRig changes, and the two dark strokes either side of
the neck stop reading as a neck.

The warp samples output row y from input row y + DROP*ramp(y): full shift
across the neck, tapering to zero by the time it reaches the chest, so the
shoulders rise and the body below is untouched.

Run from frontend/:  python scripts/shorten-neck.py [--preview]
"""
import os
import sys

import numpy as np
from PIL import Image

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BODY = os.path.join(FE, "assets", "character", "body")

# Measured off body.png: chin bottom ~205, neck 205..217 (~60px wide),
# shoulders flare from 214 and reach full width by ~245.
NECK_TOP = 205      # start lifting here (just under the chin)
BLEND_END = 268     # by here nothing has moved
DROP = 7            # pixels the shoulder line rises


def ramp(y):
    """1 across the neck, easing to 0 by BLEND_END."""
    if y <= NECK_TOP:
        return 0.0
    if y >= BLEND_END:
        return 0.0
    t = (y - NECK_TOP) / float(BLEND_END - NECK_TOP)
    # rise fast, fall away smoothly: full shift over the neck itself
    return float(np.sin(np.pi * min(1.0, t * 1.6)) if t < 0.625 else
                 (1.0 - (t - 0.625) / 0.375) ** 1.5)


def warp(im):
    a = np.asarray(im.convert("RGBA")).astype(np.float32)
    h, w = a.shape[:2]
    out = a.copy()
    for y in range(NECK_TOP, min(BLEND_END, h)):
        src = y + DROP * ramp(y)
        y0 = int(np.floor(src))
        f = src - y0
        if y0 + 1 >= h:
            continue
        out[y] = a[y0] * (1 - f) + a[y0 + 1] * f
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def main():
    preview = "--preview" in sys.argv
    files = sorted(f for f in os.listdir(BODY) if f.endswith(".png"))
    for f in files:
        p = os.path.join(BODY, f)
        im = Image.open(p)
        out = warp(im)
        if preview:
            out.save(os.path.join(FE, "scripts", "qa4", "_warp_" + f))
        else:
            out.save(p, optimize=True)
        print(("previewed " if preview else "rewrote ") + f)
    print(f"\n{len(files)} body files, shoulder line raised {DROP}px")


if __name__ == "__main__":
    main()
