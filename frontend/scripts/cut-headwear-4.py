"""Wave-4 headwear: lift each hat off the drawn head it is worn on.

Source: 79 sheets in C:\\Users\\user\\Desktop\\headwear, 1448x1086 RGB on white,
each showing the SAME flat line-art head twice wearing one hat. Only the LEFT
copy is used. This art is the first batch drawn in the app body's own style
(compare assets/character/body/body.png) rather than the shaded cartoon look of
waves 1-3.

The cut is REGION-based, not stroke-based, because the hat's outline and the
head's outline touch wherever they cross and so land in one ink component:

  BG   near-white flood from the image border — everything outside the drawing.
  F    the visible face: the enclosed near-white region holding the six face
       feature islands (2 brows, 2 eyes, nose, mouth). It stops at the hat's
       lower edge, so it is exactly as much head as the hat leaves showing.
  sep  ink that lies within R of BOTH F and BG — i.e. the stroke separating
       the face from the outside world. That IS the head outline. A hat's own
       edge always has hat on one side, so it survives even when the hat is
       filled white (an enclosed white fill is not BG).

Erasing `sep` is safe even where it nicks the hat: the app draws its own head
outline along that exact line once the piece is fitted, so the gap is filled.

After the cut the ears and the face features are free-floating islands (they
only ever attached to the head outline) and get swept, along with anything else
small that is not part of the hat mass.

Writes RGBA cut-outs + a measurement json to scripts/out4/.
"""
import glob
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"C:\Users\user\Desktop\headwear"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out4")
HALF = 724                      # the sheet's left copy

WHITE = 236                     # min channel above this = paper
INK = 110                       # luminance below this = a drawn stroke
# The head outline has to be erased by its whole ANTI-ALIASED width, not just
# its ink core: interior pixels are opaque by construction (see `masks`), so a
# leftover grey ramp reads as a full second outline traced round the face.
EDGE = 222
RING_R = 11                     # half the head-outline stroke, generously


def load_left(path):
    return np.asarray(Image.open(path).convert("RGB")).astype(np.int16)[:, :HALF]


def masks(rgb):
    """Background, drawing, and a soft alpha for the drawing's outer edge."""
    lum = rgb.mean(2)
    paper = rgb.min(2) > WHITE
    lab, n = ndimage.label(paper)
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    bg = np.isin(lab, list(border))
    drawing = ~bg
    soft = np.clip((240.0 - lum) / 45.0, 0, 1)
    alpha = np.maximum(soft, ndimage.binary_erosion(drawing, np.ones((3, 3)),
                                                    iterations=2).astype(float))
    return bg, drawing, alpha, lum


def face_islands(ink):
    """The six feature strokes float free inside the face; nothing else in the
    drawing is both this small and fully enclosed by one white region."""
    lab, n = ndimage.label(ink)
    out = []
    for i in range(1, n + 1):
        comp = lab == i
        s = comp.sum()
        if 60 < s < 5000:
            ys, xs = np.where(comp)
            out.append(dict(mask=comp, size=int(s), cx=xs.mean(), cy=ys.mean(),
                            x0=xs.min(), x1=xs.max(), y0=ys.min(), y1=ys.max()))
    return out


def find_face(rgb, bg, drawing, lum):
    """Locate the face's white region and the feature block inside it.

    Seeds come from the feature islands rather than a fixed fraction of the
    canvas: the head drifts ~40px between sheets and a hat can push it further.
    The winning seed is the one whose white region holds the most islands.
    """
    ink = (lum < INK) & drawing
    isl = face_islands(ink)
    if not isl:
        return None, None
    white = drawing & ~ink & ~bg
    white = ndimage.binary_closing(white, np.ones((3, 3)))
    lab, n = ndimage.label(white)
    score = {}
    for it in isl:
        # sample the white just outside the island — its own pixels are ink
        yy, xx = int(it["cy"]), int(it["cx"])
        for dy in (0, 12, -12, 24, -24):
            v = lab[min(max(yy + dy, 0), lab.shape[0] - 1), xx]
            if v:
                score.setdefault(v, []).append(it)
                break
    if not score:
        return None, None
    best = max(score, key=lambda k: (len(score[k]), (lab == k).sum()))
    F = ndimage.binary_fill_holes(lab == best)
    return F, score[best]


def head_zone(shape, g):
    """The skull plus the strip the ears live in, as a mask.

    Anything adrift inside this after the cut belongs to the head, whatever its
    size — which is the test that removes the ears. Size alone does not: an ear
    outline is bigger than a bow or a tiara, so a size threshold that clears the
    ears also clears the smaller hats.
    """
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    cy = g["top"] + g["h"] / 2
    rx, ry = g["w"] / 2 * 1.10, g["h"] / 2 * 1.04
    skull = (((xx - g["cx"]) / rx) ** 2 + ((yy - cy) / ry) ** 2) <= 1.0
    ears = (np.abs(xx - g["cx"]) < 0.78 * g["w"]) & \
           (yy > g["top"] + 0.26 * g["h"]) & (yy < g["top"] + 0.98 * g["h"])
    return skull | ears


def ear_mask(ink, g):
    """The two ears, found by their enclosed white centres.

    They have to go before the component sweep, not after: an ear that still
    touches the hat brim it was tucked under survives the sweep as part of the
    hat. Their holes are read off the UNCUT ink, where both ears are still
    closed loops. Earmuffs and headphone cups sit in the same band and are also
    hollow, so the size caps do the separating — an ear hole is a slit.
    """
    holes = ndimage.binary_fill_holes(ink) & ~ink
    lab, n = ndimage.label(holes)
    out = np.zeros_like(holes)
    for i in range(1, n + 1):
        comp = lab == i
        ys, xs = np.where(comp)
        off = abs(xs.mean() - g["cx"]) / g["w"]
        rely = (ys.mean() - g["top"]) / g["h"]
        rw = (xs.max() - xs.min()) / g["w"]
        rh = (ys.max() - ys.min()) / g["h"]
        area = comp.sum() / (g["w"] * g["h"])
        # measured across the set: an ear hole is a 0.08w x 0.16h slit centred
        # 0.55w out and halfway down. Headphone cups are twice as tall, muffs
        # nearly three times as wide, trapper flaps taller still.
        if (0.48 < off < 0.66 and 0.40 < rely < 0.62
                and 0.05 < rw < 0.115 and 0.11 < rh < 0.21
                and 0.005 < area < 0.018):
            out |= comp
    if not out.any():
        return out
    # only the ear's own stroke and centre come out — dilating over everything
    # takes bites out of the brim the ear was tucked under.
    grown = ndimage.binary_dilation(out, np.ones((3, 3)), iterations=13)
    return grown & (ink | out)


def cut_head(rgb):
    bg, drawing, alpha, lum = masks(rgb)
    ink = (lum < INK) & drawing
    F, feats = find_face(rgb, bg, drawing, lum)
    if F is None:
        return None
    g = head_geometry(F, feats)
    k = np.ones((3, 3))
    # "Separator" = a drawn pixel that lies on a SHORT path from the face to
    # the outside world. Two independent radii (near F and near BG) were the
    # first cut and left the chin: down at the tip the face tapers away from
    # the outline faster than any single radius covers. The sum of the two
    # distances tracks the stroke instead of the geometry, and a hat's edge
    # scores far higher because the face is nowhere near it.
    # Inside the skull the rule is relaxed a long way, because several sheets
    # draw a hairline or an alice band as a second arc parallel to the outline
    # and the head line then sits a whole band-width away from the face. It
    # cannot be relaxed everywhere: a bucket brim's tip also has background on
    # both sides. The ellipse is the divider — a brim reaches past it, a head
    # line never does. Erasing along the skull edge is safe either way, since
    # the rig draws its own head outline on exactly that line.
    dF = ndimage.distance_transform_edt(~F)
    dB = ndimage.distance_transform_edt(~bg)
    h, w = lum.shape
    yy, xx = np.mgrid[0:h, 0:w]
    inner = ((((xx - g["cx"]) / (g["w"] / 2 * 1.06)) ** 2
              + ((yy - (g["top"] + g["h"] / 2)) / (g["h"] / 2 * 1.06)) ** 2) <= 1.0)
    sep = (lum < EDGE) & drawing & (
        ((dB <= 16) & (dF + dB <= 30))
        | (inner & (dB <= 34) & (dF + dB <= 45)))

    keep = drawing.copy()
    keep &= ~F                       # the face itself
    keep &= ~ndimage.binary_dilation(sep, k, iterations=2)
    keep &= ~ear_mask(ink, g)

    # Sweep what the cut set adrift: ears, feature islands, stroke crumbs.
    # The ears only ever attached to the outline that was just erased, so they
    # are free-floating now and fall out as "adrift inside the head zone".
    zone = head_zone(keep.shape, g)
    lab, n = ndimage.label(keep)
    if n:
        sizes = ndimage.sum(keep, lab, range(1, n + 1))
        inzone = ndimage.sum(keep & zone, lab, range(1, n + 1))
        order = np.argsort(-sizes) + 1
        drop = np.zeros(n + 1, bool)
        for i in order:
            if inzone[i - 1] > 0.85 * sizes[i - 1] and sizes[i - 1] < 0.5 * sizes.max():
                drop[i] = True
        big = max((s for i, s in enumerate(sizes, 1) if not drop[i]), default=1)
        for i, s in enumerate(sizes, 1):
            if s < max(0.05 * big, 300):
                drop[i] = True
        keep = keep & ~drop[lab]

    a = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    a[..., :3] = rgb
    a[..., 3] = (alpha * 255 * keep).astype(np.uint8)
    return a, F, feats, g


def head_geometry(F, feats):
    """Where the head is, in source pixels.

    The visible face is clipped by the hat, so the skull is derived from the
    FEATURE BLOCK, which every sheet shows in full and always draws in the same
    proportion (verified against the body art: brow-to-brow spans 0.59 of the
    skull, the brow line sits 0.34 down it).
    """
    x0 = min(f["x0"] for f in feats)
    x1 = max(f["x1"] for f in feats)
    y0 = min(f["y0"] for f in feats)
    fw = x1 - x0
    head_w = fw / 0.59
    head_h = head_w * (218.0 / 157.0)
    return dict(w=float(head_w), h=float(head_h),
                cx=float((x0 + x1) / 2), top=float(y0 - 0.34 * head_h))


def main():
    os.makedirs(OUT, exist_ok=True)
    fs = sorted(glob.glob(os.path.join(SRC, "*.png")))
    meta = []
    for i, f in enumerate(fs):
        rgb = load_left(f)
        res = cut_head(rgb)
        if res is None:
            print(f"{i:3d} FAILED (no face) {os.path.basename(f)}")
            meta.append(dict(i=i, src=os.path.basename(f), ok=False))
            continue
        a, F, feats, g = res
        ys, xs = np.where(a[..., 3] > 16)
        if len(ys) == 0:
            print(f"{i:3d} EMPTY {os.path.basename(f)}")
            meta.append(dict(i=i, src=os.path.basename(f), ok=False))
            continue
        box = dict(x0=int(xs.min()), x1=int(xs.max()) + 1,
                   y0=int(ys.min()), y1=int(ys.max()) + 1)
        Image.fromarray(a, "RGBA").save(os.path.join(OUT, f"{i:03d}.png"),
                                        optimize=True)
        # how much colour is in the piece, to flag the line-art-only ones
        m = a[..., 3] > 200
        rgbm = a[..., :3][m].astype(int)
        chroma = rgbm.max(1) - rgbm.min(1)
        pale = rgbm.mean(1) > 150
        colour_frac = float((chroma > 28).mean()) if len(rgbm) else 0.0
        meta.append(dict(i=i, src=os.path.basename(f), ok=True, head=g, box=box,
                         colour=round(colour_frac, 3),
                         pale=round(float(pale.mean()), 3) if len(rgbm) else 0))
        print(f"{i:3d} head w={g['w']:.0f} cx={g['cx']:.0f} top={g['top']:.0f} "
              f"box={box['x1']-box['x0']}x{box['y1']-box['y0']} "
              f"colour={colour_frac:.2f}")
    json.dump(meta, open(os.path.join(HERE, "headwear4.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
