"""Cut the ten ranked-map frames out of a contact sheet.

The sheet arrives as one image with the frames laid out in a grid on a mottled
background, and each frame's OPENING filled with a colour wash. Neither is
wanted: the map has to show through the middle, and the board has to show
around the outside. What we want is the band, alone, on alpha.

HOW THE ALPHA IS BUILT

Join every pixel to its four-neighbour when the two are within TOL of each
other and take the connected components of that graph. Those components are
the locally-flat regions of the sheet: the background is one (mottled, but
smoothly so), each frame's opening is one, and the band's own facets are many.
An inked outline is a step edge, so no component ever crosses one.

  * BACKGROUND is every region touching the sheet's border.
  * A FRAME is then one connected blob of not-background.
  * Its OPENING is the region under the blob's own centre.

Band = blob minus opening. This is why the cut is done on the whole sheet at
once rather than cell by cell on a grid: the frames in the sheet's second row
overhang the row above, so a grid split cuts the top rail off each of them and
leaves it behind in the wrong cell. Finding the blobs finds the real bounds.

Usage:
    python scripts/cut-rank-frames.py <sheet.png> [--qa]

Writes assets/borders/map/<tier>.png, one per BORDER_TIERS key except `none`
(which keeps the plain NB stroke), plus a QA contact sheet on a checkerboard so
the cut can be looked at rather than assumed.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets" / "borders" / "map"

# Which frame is which rank, in the sheet's READING ORDER (left to right, top
# row first). Blobs are sorted into that order by their centroids, so this
# holds even though the frames are found rather than sliced off a grid.
#
# THIS IS THE ONE THING TO CORRECT if a frame landed on the wrong rank.
TIER_ORDER = [
    "prismatic",  # 0  iridescent pastel band, violet gems
    "gold",       # 1  gold laurel wreath, flame finial
    "wood",       # 2  sawn planks, rope-bound corners
    "bronze",     # 3  brass band, round rivets
    "silver",     # 4  polished silver, chamfered corners
    "mythic",     # 5  black and gold hazard band, star badge
    "diamond",    # 6  pale ice blue, round set gems
    "platinum",   # 7  white metal, plain chamfer
    "onyx",       # 8  near-black stone, violet spikes
    "ember",      # 9  charred iron, lava glow
]

# How far two neighbouring pixels may differ and still count as the same
# region. Low enough that an inked outline stops it, high enough to cross the
# background's mottling and the soft radial wash inside each opening.
TOL = 26.0

# A blob smaller than this fraction of the largest is dust, not a frame.
DUST = 0.02

# How far apart two pieces of the same frame may sit, in pixels, and still be
# recognised as one frame. See find_frames.
MERGE = 10


def regions(rgb, tol):
    """Label the image into locally-flat regions.

    Four-neighbour, not eight: a diagonal link lets a region squeeze through a
    single-pixel nick in an outline, which merges the background with an
    opening and takes the whole band with it.
    """
    h, w = rgb.shape[:2]
    idx = np.arange(h * w).reshape(h, w)

    dh = np.linalg.norm(rgb[:, 1:] - rgb[:, :-1], axis=2)
    dv = np.linalg.norm(rgb[1:, :] - rgb[:-1, :], axis=2)
    rows = np.concatenate([idx[:, :-1][dh <= tol], idx[:-1, :][dv <= tol]])
    cols = np.concatenate([idx[:, 1:][dh <= tol], idx[1:, :][dv <= tol]])

    graph = coo_matrix(
        (np.ones(rows.size, dtype=np.uint8), (rows, cols)), shape=(h * w, h * w)
    )
    _, labels = connected_components(graph, directed=False)
    return labels.reshape(h, w)


def find_frames(labels):
    """Every frame on the sheet, as a boolean mask, in reading order."""
    edge = np.concatenate(
        [labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]]
    )
    foreground = ~np.isin(labels, np.unique(edge))

    # Label a DILATED copy, then intersect each blob back with the real
    # foreground. Several tiers hang ornaments off the band with a gap of clear
    # background between — the gems floating inside onyx's rails, the finial
    # over gold — and those come back as their own blobs otherwise. Growing
    # everything by MERGE first pulls each ornament into the frame it belongs
    # to without adding a pixel to what actually gets cut.
    grown = ndimage.binary_dilation(foreground, iterations=MERGE)
    blobs, n = ndimage.label(grown)

    found = []
    for b in range(1, n + 1):
        mask = (blobs == b) & foreground
        size = mask.sum()
        if not size:
            continue
        ys, xs = np.nonzero(mask)
        found.append({"mask": mask, "size": size, "cy": ys.mean(), "cx": xs.mean()})

    biggest = max(f["size"] for f in found)
    found = [f for f in found if f["size"] >= biggest * DUST]

    # Reading order. Rows are banded by centroid so a frame that sits a little
    # high does not sort ahead of its whole row: anything within half a frame
    # height of the topmost unplaced frame is on the same row.
    height = max(f["mask"].sum(0).max() for f in found)
    found.sort(key=lambda f: f["cy"])
    ordered, rest = [], list(found)
    while rest:
        top = rest[0]["cy"]
        # Split by index, not by value: these carry numpy masks, and `in` on a
        # list of them compares arrays element-wise rather than by identity.
        cut_at = next(
            (i for i, f in enumerate(rest) if f["cy"] - top >= height * 0.5),
            len(rest),
        )
        ordered.extend(sorted(rest[:cut_at], key=lambda f: f["cx"]))
        rest = rest[cut_at:]
    return ordered


def cut(sheet_rgb, labels, blob):
    """One frame blob in, one RGBA image with a hollow middle out."""
    mask = blob["mask"]
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1

    # The opening is the region under the blob's own centre. Taken from the
    # bounding box's midpoint rather than the mask's centroid, which on a
    # spiked frame can land on an ornament instead of in the hole.
    opening = labels == labels[(y0 + y1) // 2, (x0 + x1) // 2]
    band = mask & ~opening

    # Speckle where the region walk stopped early on a noisy pixel.
    band = ndimage.binary_closing(band, structure=np.ones((3, 3)), iterations=2)

    alpha = np.zeros(band.shape, dtype=np.float32)
    alpha[band] = 255.0
    # A one-pixel feather so the cut edge is not a hard jag against the map.
    # The band is many pixels thick, so this costs it nothing.
    alpha = ndimage.uniform_filter(alpha, size=3)
    alpha[~ndimage.binary_dilation(band, np.ones((3, 3)))] = 0

    rgba = np.dstack([sheet_rgb, alpha.clip(0, 255).astype(np.uint8)])
    return Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    sheet = Image.open(sys.argv[1]).convert("RGB")
    sheet_rgb = np.asarray(sheet, dtype=np.uint8)
    labels = regions(sheet_rgb.astype(np.float32), TOL)

    blobs = find_frames(labels)
    if len(blobs) != len(TIER_ORDER):
        print(f"found {len(blobs)} frames, expected {len(TIER_ORDER)} — check TOL/DUST")
        return 1

    ASSETS.mkdir(parents=True, exist_ok=True)
    out = {}
    for tier, blob in zip(TIER_ORDER, blobs):
        img = cut(sheet_rgb, labels, blob)
        img.save(ASSETS / f"{tier}.png")
        out[tier] = img
        print(f"{tier:10} {img.size[0]}x{img.size[1]}")

    if "--qa" in sys.argv:
        # A checkerboard behind the cut is the only way to see a bad alpha; on
        # white, a white halo and a clean edge look identical.
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
            qa.alpha_composite(out[tier], (x, y))
        path = HERE / "qa-rank-frames.png"
        qa.save(path)
        print(f"\nQA sheet: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
