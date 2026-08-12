"""Install the nature_5 parallax landscape as the first-run backdrop.

The pack ships each scene as a stack of same-sized PNGs — one opaque sky and
several transparent overlays that composite back into `orig.png`. That is
exactly what a parallax backdrop wants, so the layers are copied through
unchanged; the only work here is recording which is which, how far each should
drift, and where the sky colour is, so the app never has to guess.

WHAT IS NOT DONE HERE: no resizing. These are 576x324 pixel-art frames and any
resample would soften the pixels. The app draws them oversized and lets the
GPU scale, which keeps the grid square (see ParallaxScene).

Run: python scripts/animations/install_scene_nature.py
Writes: assets/art/scenes/nature5/<n>.png, plus scene-manifest.json.
"""
from __future__ import annotations

import json
import shutil
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

SOURCE_CANDIDATES = (
    Path(r"D:\downloads\Nature Landscapes Free Pixel Art.zip"),
    Path(r"C:\Users\user\Desktop\animations\Nature Landscapes Free Pixel Art.zip"),
)
SCENE = "nature_5"
OUT_ID = "nature5"
LAYER_COUNT = 5

# How far each layer sways, as a fraction of its own width, and how long one
# breath takes. Back to front: the sky does not move at all, the clouds drift
# furthest because they are the only thing in the scene that would, and the
# ground barely does.
#
# The sway is a SWAY and not a scroll on purpose. A scroll has to loop, and a
# loop needs art that tiles horizontally; this pack's layers do not promise
# that, and a seam sliding through the trees every twelve seconds is far more
# noticeable than no parallax at all.
DRIFT = [
    {"amplitude": 0.000, "seconds": 0, "role": "sky"},
    {"amplitude": 0.030, "seconds": 9, "role": "clouds"},
    {"amplitude": 0.008, "seconds": 7, "role": "far ground"},
    {"amplitude": 0.016, "seconds": 5, "role": "trees"},
    {"amplitude": 0.050, "seconds": 3.5, "role": "birds"},
]

# How much of the box's HEIGHT the landscape should fill, and where the
# horizontal crop is taken from.
#
# The art is 16:9 and a phone is about 9:19.5, so a scene pinned to the bottom
# at its own aspect covers barely a quarter of the screen and the rest is a
# flat slab of sky — which is exactly what "too zoomed out, too much sky"
# means. Filling more height means cropping width; there is no third option.
#
# `focus` is which part of the frame survives that crop, 0 = left edge. This
# scene's trees are at roughly a fifth to a third of the way across, and they
# are the only thing in it with any silhouette, so the crop is taken left of
# centre to keep them rather than centring on an empty field.
# Chosen by rendering the crop against the picker sheet's top edge rather than
# by taste: at 0.58 the treeline sat entirely BELOW the sheet, so every
# character step showed a flat blue slab and nothing else. At 0.85 the trees
# cross the sheet line, which is the only part of the scene most steps can
# show. Past that the crop is tight enough to lose the second tree.
COVER = 0.85
FOCUS_X = 0.20


def find_source() -> Path:
    for candidate in SOURCE_CANDIDATES:
        if candidate.exists():
            return candidate
    raise SystemExit(
        "Nature Landscapes pack not found. Looked in:\n  "
        + "\n  ".join(str(c) for c in SOURCE_CANDIDATES)
    )


def main() -> int:
    source = find_source()
    frontend = Path(__file__).resolve().parents[2]
    out_dir = frontend / "assets" / "art" / "scenes" / OUT_ID
    out_dir.mkdir(parents=True, exist_ok=True)

    layers = []
    with zipfile.ZipFile(source) as archive:
        names = {n.rsplit("/", 1)[-1]: n for n in archive.namelist() if f"{SCENE}/" in n}
        for i in range(1, LAYER_COUNT + 1):
            member = names.get(f"{i}.png")
            if not member:
                raise SystemExit(f"{SCENE}/{i}.png missing from {source}")
            target = out_dir / f"{i}.png"
            with archive.open(member) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)

            image = Image.open(target).convert("RGBA")
            pixels = np.array(image)
            painted = pixels[:, :, 3] > 8
            rows = np.flatnonzero(painted.any(axis=1))
            layers.append({
                "index": i,
                "width": image.width,
                "height": image.height,
                # A layer that only paints the bottom third does not need to be
                # drawn over the whole box; the app uses this to skip work.
                "coverage": round(float(painted.mean()), 4),
                "top": int(rows.min()) if rows.size else 0,
                "opaque": bool((pixels[:, :, 3] > 250).all()),
                **DRIFT[i - 1],
            })

    # The colour at the top of the opaque layer. A landscape is a letterbox and
    # a phone is a portrait, so the scene is pinned to the bottom and the sky
    # above it is continued as flat colour — this is that colour, read off the
    # art so the join can never show.
    sky = Image.open(out_dir / "1.png").convert("RGB").getpixel((0, 0))

    manifest = {
        "schemaVersion": 1,
        "source": str(source),
        "license": {
            "package": "Nature Landscapes Free Pixel Art (CraftPix)",
            "file": "License.txt in the pack: https://craftpix.net/file-licenses/",
            # Cleared to ship by the project owner, who supplied the pack and
            # asked for this scene by name. That is a DIRECTION, not a reading
            # of the terms — see the note. CraftPix's free licence permits
            # commercial use but restricts redistribution of the assets
            # themselves, which is worth confirming before a public release.
            "releaseApproved": True,
            "note": (
                "Owner supplied the pack and directed its use 2026-08-12. "
                "Free-licence terms at craftpix.net/file-licenses not yet read "
                "line by line; confirm before the store release."
            ),
        },
        "scenes": {
            OUT_ID: {
                "id": OUT_ID,
                "name": "Meadow",
                "sky": "#%02X%02X%02X" % sky,
                "aspect": round(layers[0]["width"] / layers[0]["height"], 4),
                "cover": COVER,
                "focusX": FOCUS_X,
                "layers": layers,
            }
        },
    }
    (frontend / "assets" / "art" / "scenes" / "scene-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    for layer in layers:
        print(f"  {OUT_ID}/{layer['index']}.png  {layer['width']}x{layer['height']}"
              f"  {layer['role']:<11} sway={layer['amplitude']}")
    print(f"Wrote {len(layers)} layers to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
