#!/usr/bin/env python
"""Build PASER's handwriting face from its specimen sheet.

    python scripts/fonts/build-handwriting-font.py               # all three weights
    python scripts/fonts/build-handwriting-font.py Bold          # one weight
    python scripts/fonts/build-handwriting-font.py --proof p.png # plus a proof sheet

PASER sets every word in Pistachio Cloud Magnolia, a hand-lettered face that
exists only as a picture: pistachio-cloud-magnolia-specimen.webp, beside this
script. There is no font file to buy or download, so this traces one out of
the sheet. Needs: pip install numpy scipy pillow scikit-image fonttools

Writes assets/fonts/PistachioCloudMagnolia-{Regular,Medium,Bold}.ttf, which
src/theme/fontFiles.js loads and src/theme/tokens.js maps every style onto.
Re-run this rather than editing the TTFs.

HOW A GLYPH IS MADE

1. The sheet's glyph panel is cut into blobs of ink, and the blobs are grouped
   into characters row by row, in the order the sheet prints them.
2. Each character is upsampled, smoothed and turned into a signed distance
   field. The field's level set at the right offset IS the outline drawn with
   a pen of the target width. That is how one drawing gives three weights, and
   why the pen stays even across letters the sheet drew with more or less
   pressure. The offset backs off only rather than close a real counter or
   fuse the separate marks of i j ! ? : ; " % =. Near-touching strokes may
   join and pinholes may fill; that is what a heavier pen does.
3. The contour is resampled every 11 units and written as a TrueType spline
   of off-curve points only: smooth by construction, like a marker.

WHAT IS NOT TAKEN FROM THE SHEET AS DRAWN (each is a choice, not a bug)

- Wobble: each letter keeps ~40% of how far it strayed from its line. All of
  it made body text seasick; none of it looked typeset.
- Figures are tidied hardest: sat on the line at cap height, and the broad 0
  and 2 narrowed, because tabular figures set at the widest figure's width.
- Punctuation is placed by rule (hyphen on the maths axis, brackets reaching
  below the line), not where the sheet happened to write it.
- `_` is a drawn line; the accents, degree ring, bullet, multiply and
  plus-minus are drawn with the same round pen; accented letters are base +
  mark.
- The line box is Inter's (960 / -250), the face PASER used before, so no
  layout moves. No glyph may leave it: iOS crops ink outside the line box, so
  the build fails rather than ship one.
- Tabular figures ship as a `tnum` feature, which is what React Native's
  fontVariant: ['tabular-nums'] turns on.

IF THE FIGURES CHANGE, re-measure the share card's EM table in
src/components/share/RunShareCard.js; it is read off the Bold.
"""
import argparse
import math
import os
import sys
import unicodedata

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from skimage import measure, morphology
from fontTools.agl import UV2AGL
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.dirname(os.path.dirname(HERE))
SPECIMEN = os.path.join(HERE, "pistachio-cloud-magnolia-specimen.webp")
OUT = os.path.join(FRONTEND, "assets", "fonts")

FAMILY = "Pistachio Cloud Magnolia"
PSNAME = "PistachioCloudMagnolia"
# (style, usWeightClass, pen width in font units). The sheet's own pen is ~64.
WEIGHTS = [("Regular", 400, 64), ("Medium", 500, 82), ("Bold", 700, 104)]

UPM = 1000
CAP = 700                     # cap height, font units
ASCENT, DESCENT = 960, -250   # Inter's line box
U = 8                         # upsampling for tracing
THRESH = 0.36                 # ink level that counts as stroke after smoothing
SPACING = 11.0                # control point spacing along a contour, font units
COUNTER_MIN = 8.0             # sheet px^2: enclosed white smaller than this is a pinhole, not a counter
PINHOLE = 2.0                 # sheet px^2: holes left smaller than this are filled in
# Characters made of separate marks, which must stay separate however heavy the pen.
KEEP_APART = set("ij!?:;\"%=")

# ---------------------------------------------------------------------------
# 1. Cutting the sheet into characters
# ---------------------------------------------------------------------------

PANEL = (40, 293, 745, 990)   # the glyph panel, x0 y0 x1 y1 (the column rule is at x=756)
SHEET_ROWS = [
    "abcdefghijklm",
    "nopqrstuvwxyz",
    None,                     # the "UPPERCASE" label
    "ABCDEFGHIJKLM",
    "NOPQRSTUVWXYZ",
    None,                     # "numbers"
    "0123456789",
    None,                     # "punctuation & symbols"
    ".,!?'\"@#$%^&*()",
    "-_+=[]{}/\\|:;<>~",
]


def read_sheet(path):
    """(ink map 0..1, blob labels over the panel, {char: glyph})."""
    im = np.asarray(Image.open(path).convert("L")).astype(np.float32)
    # Paper level: a max filter wider than any stroke wipes the ink out and the
    # blur evens the grain. Ink is how far below paper a pixel sits.
    paper = ndi.gaussian_filter(ndi.maximum_filter(im, size=13), 4)
    ink = np.clip(1.0 - im / np.maximum(paper, 1.0), 0.0, 1.0)
    px0, py0, px1, py1 = PANEL
    sub = ink[py0:py1, px0:px1]
    lab, _ = ndi.label(sub > 0.30, structure=np.ones((3, 3)))
    comps = []
    for i, sl in enumerate(ndi.find_objects(lab), start=1):
        if sl is None:
            continue
        ys, xs = sl
        own = lab[sl] == i
        h, w = ys.stop - ys.start, xs.stop - xs.start
        if own.sum() < 7 or sub[sl][own].max() < 0.45:
            continue  # paper grain
        if h > 80 or (w > 90 and h < 22):
            continue  # the column rule, and the rules under the section labels
        comps.append({"id": i, "x0": xs.start + px0, "x1": xs.stop + px0,
                      "y0": ys.start + py0, "y1": ys.stop + py0, "area": int(own.sum())})

    # Rows are vertical runs of ink, bridged across small gaps (the i dots).
    on = np.zeros(im.shape[0], bool)
    for c in comps:
        on[c["y0"]:c["y1"]] = True
    bands, y = [], 0
    while y < len(on):
        if not on[y]:
            y += 1
            continue
        start = y
        while y < len(on) and on[y]:
            y += 1
        if bands and start - bands[-1][1] < 4:
            bands[-1] = (bands[-1][0], y)
        else:
            bands.append((start, y))
    if len(bands) != len(SHEET_ROWS):
        sys.exit(f"expected {len(SHEET_ROWS)} rows of ink on the sheet, found {len(bands)}")

    glyphs = {}
    for (top, bottom), chars in zip(bands, SHEET_ROWS):
        if chars is None:
            continue
        row = sorted((c for c in comps if c["y0"] < bottom and c["y1"] > top), key=lambda c: c["x0"])
        groups = []
        for c in row:
            if groups and c["x0"] <= groups[-1]["x1"] + 1:
                groups[-1]["comps"].append(c)
                groups[-1]["x1"] = max(groups[-1]["x1"], c["x1"])
            else:
                groups.append({"x0": c["x0"], "x1": c["x1"], "comps": [c]})
        # Too many groups: fuse the tightest neighbours (the two strokes of ").
        while len(groups) > len(chars):
            gaps = [groups[k + 1]["x0"] - groups[k]["x1"] for k in range(len(groups) - 1)]
            k = int(np.argmin(gaps))
            groups[k]["comps"] += groups[k + 1]["comps"]
            groups[k]["x1"] = max(groups[k]["x1"], groups[k + 1]["x1"])
            del groups[k + 1]
        if len(groups) != len(chars):
            sys.exit(f"row {chars!r}: found {len(groups)} glyphs, expected {len(chars)}")
        for ch, g in zip(chars, groups):
            glyphs[ch] = {
                "row": chars, "comps": g["comps"], "x0": g["x0"], "x1": g["x1"],
                "y0": min(c["y0"] for c in g["comps"]), "y1": max(c["y1"] for c in g["comps"]),
            }
    return ink, lab, glyphs


# ---------------------------------------------------------------------------
# 2. The sheet's own lines and size
# ---------------------------------------------------------------------------

# Glyphs that sit ON their row's line; the line is fitted through their feet.
SITTERS = {
    "abcdefghijklm": "abcdefhiklm",
    "nopqrstuvwxyz": "norstuvwxz",
    "ABCDEFGHIJKLM": "ABCDEFGHIKLM",
    "NOPQRSTUVWXYZ": "NOPRSTUVWXZ",
    "0123456789": "0123456789",
}
SITTER_SET = set("".join(SITTERS.values()))


def fit_line(xs, ys):
    xs, ys = np.asarray(xs, float), np.asarray(ys, float)
    A = np.vstack([xs, np.ones_like(xs)]).T
    m, b = np.linalg.lstsq(A, ys, rcond=None)[0]
    for _ in range(2):
        r = ys - (m * xs + b)
        keep = np.abs(r) <= max(2.0, 2.5 * np.median(np.abs(r)))
        if keep.sum() < 3:
            break
        m, b = np.linalg.lstsq(A[keep], ys[keep], rcond=None)[0]
    return m, b


def baseline_at(g):
    m, b = BASE[g["row"]]
    return m * (g["x0"] + g["x1"]) / 2 + b


def main_comp(g):
    return max(g["comps"], key=lambda c: c["area"])


def height_px(ch):
    g = GL[ch]
    top = main_comp(g)["y0"] if ch in "ij" else g["y0"]
    return baseline_at(g) - top


def median_h(chars):
    return float(np.median([height_px(c) for c in chars]))


def clamp(v, lo=0.82, hi=1.22):
    return max(lo, min(hi, v))


def letter_scale(ch):
    """Pull outliers part of the way to their row's median size: keep the mess, lose the accidents."""
    h = height_px(ch)
    if ch in "acemnorsuvwxzgpqyij":
        return clamp((XH_PX / h) ** 0.6)
    if ch in "bdhklf":
        return clamp((ASC_PX / h) ** 0.5)
    if ch == "Y" or ch.isdigit():
        # The sheet hangs Y's stem below the line and writes its figures at
        # four different sizes (the 3 and 9 drop, the 0 floats). Figures carry
        # every stat in the app, so these are tidied to cap height, full ink.
        g = GL[ch]
        return clamp((CAP_PX / (g["y1"] - g["y0"])) ** 0.85, 0.6, 1.4)
    if ch.isupper():
        return clamp((CAP_PX / h) ** 0.75, 0.8, 1.3)
    return 1.0


def condense(ch):
    """Horizontal squeeze for figures broader than they should be.

    The sheet's 0 and 2 are wide ovals, and tabular figures all set at the
    widest figure's width, so leaving them would open a gap round every 1 in
    every live stat. Squeezed BEFORE tracing, so the pen stays the same width."""
    if not ch.isdigit():
        return 1.0
    g = GL[ch]
    return min(1.0, 0.62 / ((g["x1"] - g["x0"]) / (g["y1"] - g["y0"])))


def punct_rules():
    """char -> (anchor, at, target ink height or None to keep the sheet's)."""
    return {
        ".": ("bottom", 0, None),
        ",": ("top", 130, 300),
        "!": ("bottom", 0, CAP),
        "?": ("bottom", 0, CAP),
        "'": ("top", CAP + 20, None),
        '"': ("top", CAP + 20, None),
        "@": ("center", 300, 660),
        "#": ("bottom", 0, CAP * 0.95),
        "$": ("center", CAP / 2, CAP * 1.18),
        "%": ("bottom", 0, CAP * 0.95),
        "^": ("top", CAP + 10, None),
        "&": ("bottom", 0, CAP),
        "*": ("top", CAP + 10, CAP * 0.5),
        "(": ("center", 290, 900),
        ")": ("center", 290, 900),
        "-": ("center", MATH, None),
        "_": ("top", -70, None),
        "+": ("center", MATH, None),
        "=": ("center", MATH, None),
        "[": ("center", 290, 900),
        "]": ("center", 290, 900),
        "{": ("center", 290, 900),
        "}": ("center", 290, 900),
        "/": ("bottom", -40, CAP + 80),
        "\\": ("bottom", -40, CAP + 80),
        "|": ("center", 290, 980),
        ":": ("bottom", 0, None),
        ";": ("top", None, None),  # top = the colon's top, filled in per weight
        "<": ("center", MATH, None),
        ">": ("center", MATH, None),
        "~": ("center", MATH, None),
    }


def setup(specimen):
    global INK, LAB, GL, BASE, S, CAP_PX, XH_PX, ASC_PX, XH, MATH, PUNCT, SHEET_STROKE
    INK, LAB, GL = read_sheet(specimen)
    BASE = {row: fit_line([(GL[c]["x0"] + GL[c]["x1"]) / 2 for c in sitters], [GL[c]["y1"] for c in sitters])
            for row, sitters in SITTERS.items()}
    CAP_PX = median_h("BDEFHIKLMNPRTUVWXZ")
    S = CAP / CAP_PX                      # font units per sheet pixel
    XH_PX = median_h("acemnorsuvwxz")
    ASC_PX = median_h("bdhkl")
    XH = XH_PX * S
    MATH = round(XH * 0.52)               # where - + = < > ~ sit
    PUNCT = punct_rules()
    SHEET_STROKE = measure_sheet_stroke()
    print(f"sheet: {S:.2f} units/px, x-height {XH:.0f}, ascender {ASC_PX * S:.0f}, pen {SHEET_STROKE:.0f}")


# ---------------------------------------------------------------------------
# 3. Ink -> field -> contours
# ---------------------------------------------------------------------------


def isolate(ch, which=None):
    g = GL[ch]
    comps = g["comps"] if which is None else which(g["comps"])
    ids = [c["id"] for c in comps]
    x0 = min(c["x0"] for c in comps) - 5
    x1 = max(c["x1"] for c in comps) + 5
    y0 = min(c["y0"] for c in comps) - 5
    y1 = max(c["y1"] for c in comps) + 5
    sub = LAB[y0 - PANEL[1]:y1 - PANEL[1], x0 - PANEL[0]:x1 - PANEL[0]]
    own = np.isin(sub, ids)
    other = (sub > 0) & ~own
    keep = ndi.binary_dilation(own, iterations=2) & ~ndi.binary_dilation(other, iterations=1)
    return INK[y0:y1, x0:x1] * keep, x0, y0


def clean(B, Z):
    lab, n = ndi.label(B, np.ones((3, 3)))
    if n:
        sizes = ndi.sum(B, lab, range(1, n + 1))
        B = B & ~np.isin(lab, np.nonzero(sizes < 2.0 * Z * Z)[0] + 1)
    bg, m = ndi.label(~B)
    if m:
        border = set(np.unique(np.concatenate([bg[0], bg[-1], bg[:, 0], bg[:, -1]])).tolist())
        sizes = ndi.sum(~B, bg, range(1, m + 1))
        for k in range(1, m + 1):
            if k not in border and sizes[k - 1] < 1.5 * Z * Z:
                B[bg == k] = True
    return B


def signed_field(B):
    s = ndi.distance_transform_edt(~B) - ndi.distance_transform_edt(B)
    return ndi.gaussian_filter(s, 0.35 * U)


def stroke_px(B):
    d = ndi.distance_transform_edt(B)
    v = d[morphology.skeletonize(B)]
    return 2.0 * float(np.median(v)) - 1.0 if v.size else 0.0


def counters(mask, Z):
    """The enclosed white regions of `mask` big enough to be real counters."""
    bg, m = ndi.label(~mask)
    if not m:
        return []
    border = set(np.unique(np.concatenate([bg[0], bg[-1], bg[:, 0], bg[:, -1]])).tolist())
    sizes = ndi.sum(np.ones_like(bg), bg, range(1, m + 1))
    return [bg == k for k in range(1, m + 1) if k not in border and sizes[k - 1] >= COUNTER_MIN * Z * Z]


def parts(mask):
    return ndi.label(mask, np.ones((3, 3)))[1]


def pick_level(s, B, target_px, Z, keep_apart):
    """Offset that gives the target pen width.

    It backs off only for what a heavier pen must not do: close a real counter
    (each keeps at least a third of its white), or fuse the separate marks of
    a KEEP_APART character. Strokes the sheet drew almost touching may join,
    open bowls may close, pinholes may fill: that is what a heavier pen does.
    Refusing it is what left B o s y P Q U 2 3 8 at the sheet's thin pen in
    the first Bold. A thinner pen must not snap a stroke in two."""
    base = s < 0
    real = counters(base, Z)
    n0 = parts(base)
    o = (target_px - stroke_px(B)) / 2.0
    step = 0.5 if o > 0 else -0.5
    while abs(o) > 1e-9:
        mask = s < o
        n = parts(mask)
        ok = all((region & ~mask).sum() >= 0.35 * region.sum() for region in real)
        if (o > 0 and keep_apart and n < n0) or (o < 0 and n > n0):
            ok = False
        if ok:
            break
        o -= step
        if (step > 0 and o < 0) or (step < 0 and o > 0):
            o = 0.0
    return o


def iso_contours(field, level):
    out = []
    for c in measure.find_contours(field, level):
        if len(c) < 5 or np.linalg.norm(c[0] - c[-1]) > 1e-6:
            continue
        out.append(c[:-1])
    return out


def resample(P, spacing=SPACING):
    closed = np.vstack([P, P[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    L = float(seg.sum())
    n = max(8, int(round(L / spacing)))
    t = np.concatenate([[0.0], np.cumsum(seg)])
    u = np.linspace(0.0, L, n, endpoint=False)
    return np.stack([np.interp(u, t, closed[:, 0]), np.interp(u, t, closed[:, 1])], 1)


def signed_area(P):
    x, y = P[:, 0], P[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def point_in_poly(pt, P):
    x, y = pt
    xs, ys = P[:, 0], P[:, 1]
    xj, yj = np.roll(xs, 1), np.roll(ys, 1)
    cond = ((ys > y) != (yj > y)) & (x < (xj - xs) * (y - ys) / (yj - ys + 1e-12) + xs)
    return bool(np.count_nonzero(cond) % 2)


def orient(contours):
    """TrueType winding: outer contours clockwise, counters anticlockwise (y up).

    Only valid for contours that do not cross, i.e. one traced shape. Shapes
    laid over each other are oriented one by one (see overlay)."""
    out = []
    for i, c in enumerate(contours):
        depth = sum(1 for j, d in enumerate(contours) if j != i and point_in_poly(c[0], d))
        if (depth % 2 == 0) == (signed_area(c) > 0):
            c = c[::-1]
        out.append(c)
    return out


class Rec:
    """A glyph in font units: contours, plus the row-by-row ink profile used for spacing."""

    def __init__(self, contours, prof_y=None, prof_l=None, prof_r=None, row_h=None):
        self.contours = [np.asarray(c, float) for c in contours]
        self.prof_y, self.prof_l, self.prof_r = prof_y, prof_l, prof_r
        self.row_h = row_h
        self.adv = 0

    def bbox(self):
        pts = np.vstack(self.contours)
        return pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()

    def shift(self, dx=0.0, dy=0.0):
        self.contours = [c + [dx, dy] for c in self.contours]
        if self.prof_y is not None:
            self.prof_y = self.prof_y + dy
            self.prof_l = self.prof_l + dx
            self.prof_r = self.prof_r + dx
        return self

    def transformed(self, fn):
        r = Rec([fn(c) for c in self.contours])
        r.adv = self.adv
        return r

    def copy(self):
        r = Rec([c.copy() for c in self.contours],
                None if self.prof_y is None else self.prof_y.copy(),
                None if self.prof_l is None else self.prof_l.copy(),
                None if self.prof_r is None else self.prof_r.copy(), self.row_h)
        r.adv = self.adv
        return r


def trace(ch, stroke_units, *, which=None, f=1.0, fx=1.0, baseline=None):
    """Outline of sheet glyph `ch` drawn with a pen `stroke_units` wide.

    y is measured from `baseline` (sheet px; default: the glyph's own bottom).
    `f` scales the drawing, `fx` squeezes it horizontally, both before the pen."""
    crop, x0, y0 = isolate(ch, which)
    Z = U * f
    big = ndi.zoom(crop.astype(np.float64), (Z, Z * fx), order=3, grid_mode=True, mode="grid-constant")
    big = ndi.gaussian_filter(big, 0.45 * Z)
    B = clean(big > THRESH, Z)
    s = signed_field(B)
    o = pick_level(s, B, stroke_units * U / S, Z, ch in KEEP_APART)
    base = GL[ch]["y1"] if baseline is None else baseline
    v_base = (base - y0) * Z
    k = S / U  # font units per upsampled pixel

    raw = []
    for c in iso_contours(s, o):
        P = np.stack([(c[:, 1] + 0.5) * k, (v_base - (c[:, 0] + 0.5)) * k], 1)
        if abs(signed_area(P)) < 250:
            continue
        raw.append(resample(P))
    # Pinholes: specks of white left inside a stroke where the pen crossed itself.
    contours = [c for i, c in enumerate(raw)
                if abs(signed_area(c)) >= PINHOLE * S * S
                or sum(point_in_poly(c[0], d) for j, d in enumerate(raw) if j != i) % 2 == 0]

    mask = s < o
    rows = np.nonzero(mask.any(1))[0]
    first = mask[rows].argmax(1)
    last = mask.shape[1] - 1 - mask[rows][:, ::-1].argmax(1)
    return Rec(contours, (v_base - (rows + 0.5)) * k, first * k, (last + 1) * k, k)


def space(rec, zone, base_sb, gain, min_sb, dmax):
    """Optical sidebearings: the more white a side lets into the zone, the less extra it gets."""
    y, L, R = rec.prof_y, rec.prof_l, rec.prof_r
    z0, z1 = zone
    sel = (y >= z0) & (y <= z1)
    if sel.sum() < 3:
        sel = np.ones_like(y, bool)
        z0, z1 = y.min(), y.max()
    zl, zr = L[sel].min(), R[sel].max()
    total = max(sel.sum(), int((z1 - z0) / rec.row_h))
    empty = total - sel.sum()
    avg_l = (np.clip(L[sel] - zl, 0, dmax).sum() + empty * dmax) / total
    avg_r = (np.clip(zr - R[sel], 0, dmax).sum() + empty * dmax) / total
    lsb = max(min_sb, base_sb - gain * avg_l)
    rsb = max(min_sb, base_sb - gain * avg_r)
    rec.shift(dx=lsb - zl)
    rec.adv = (zr - zl) + lsb + rsb
    return rec


def space_by_ink(rec, sb):
    x0, _, x1, _ = rec.bbox()
    rec.shift(dx=sb - x0)
    rec.adv = (x1 - x0) + 2 * sb
    return rec


# ---------------------------------------------------------------------------
# 4. Drawn extras (accents, degree, bullet...) with the same round pen
# ---------------------------------------------------------------------------


def densify(P, step):
    P = np.asarray(P, float)
    out = [P[0]]
    for a, b in zip(P[:-1], P[1:]):
        n = max(1, int(np.linalg.norm(b - a) / step))
        for t in np.linspace(0, 1, n + 1)[1:]:
            out.append(a + (b - a) * t)
    return np.array(out)


def smooth_path(P, closed=False, iters=2):
    """Chaikin corner cutting, so drawn marks curve like a pen rather than zig-zag."""
    P = np.asarray(P, float)
    for _ in range(iters):
        Q = [] if closed else [P[0]]
        n = len(P)
        for i in range(n if closed else n - 1):
            a, b = P[i], P[(i + 1) % n]
            Q.append(0.75 * a + 0.25 * b)
            Q.append(0.25 * a + 0.75 * b)
        if not closed:
            Q.append(P[-1])
        P = np.array(Q)
    return P


def stroke_shape(paths, dots, stroke_units, dot_scale=1.25, closed=()):
    """Round-pen strokes along `paths` (font units) plus round dots."""
    k = S / U
    r_line = stroke_units / 2
    r_dot = r_line * dot_scale
    pts = [np.asarray(p, float) for p in paths] + ([np.asarray(dots, float)] if dots else [])
    allp = np.vstack(pts)
    pad = max(r_line, r_dot) + 30
    xmin, ymin = allp.min(0) - pad
    xmax, ymax = allp.max(0) + pad
    W = int(math.ceil((xmax - xmin) / k)) + 1
    H = int(math.ceil((ymax - ymin) / k)) + 1

    def px(p):
        return ((p[0] - xmin) / k, (ymax - p[1]) / k)

    field = np.full((H, W), 1e9)
    if paths:
        img = Image.new("1", (W, H), 0)
        d = ImageDraw.Draw(img)
        for i, p in enumerate(paths):
            p = smooth_path(p, closed=i in closed)
            if i in closed:
                p = np.vstack([p, p[:1]])
            d.line([px(q) for q in densify(p, k)], fill=1, width=1)
        field = np.minimum(field, ndi.distance_transform_edt(~np.asarray(img, bool)) - r_line / k)
    if dots:
        img = Image.new("1", (W, H), 0)
        d = ImageDraw.Draw(img)
        for q in dots:
            d.point(px(q), fill=1)
        field = np.minimum(field, ndi.distance_transform_edt(~np.asarray(img, bool)) - r_dot / k)
    contours = []
    for c in iso_contours(field, 0.0):
        P = np.stack([xmin + (c[:, 1] + 0.5) * k, ymax - (c[:, 0] + 0.5) * k], 1)
        contours.append(resample(P))
    return Rec(contours)


def circle(cx, cy, r, n=28, wob=0.04, seed=1):
    rng = np.random.default_rng(seed)
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    rr = r * (1 + wob * rng.standard_normal(n))
    return np.stack([cx + rr * np.cos(a), cy + rr * np.sin(a)], 1)


def marks(stroke, case=False):
    """Accents with their anchor at (0, 0): bottom centre, or the attachment point for the cedilla.
    Capitals get flatter ones so an accented capital stays inside the line box."""
    h = 0.62 if case else 1.0
    m = {
        "grave": ([[(34, 0), (-36, 120 * h)]], []),
        "acute": ([[(-34, 0), (36, 120 * h)]], []),
        "circumflex": ([[(-70, 0), (0, 100 * h), (70, 0)]], []),
        "caron": ([[(-70, 100 * h), (0, 0), (70, 100 * h)]], []),
        "tilde": ([[(-85, 15), (-50, 60 * h + 15), (-5, 35 * h + 10), (40, 8), (85, 50 * h + 10)]], []),
        "macron": ([[(-75, 18), (75, 26)]], []),
        "dieresis": ([], [(-62, 38), (62, 40)]),
        "dotaccent": ([], [(0, 38)]),
        "ring": ([circle(0, 48 * h + 8, 44 * (0.85 if case else 1.0))], []),
        "cedilla": ([[(6, 20), (10, -40), (58, -72), (34, -124), (-36, -128)]], []),
    }
    return {name: stroke_shape(paths, dots, stroke * 0.9, closed=(0,) if name == "ring" else ())
            for name, (paths, dots) in m.items()}


COMBINING = {
    "̀": "grave", "́": "acute", "̂": "circumflex", "̃": "tilde",
    "̄": "macron", "̈": "dieresis", "̊": "ring", "̌": "caron",
    "̧": "cedilla", "̇": "dotaccent",
}
# Carons on ascenders and comma-below letters need their own mark shapes, and
# ĥ/ĺ would stack an accent on an ascender past the line box. System fallback.
SKIP_ACCENTED = set("ďťľĽĢģĶķĻļŅņŖŗĥĺ")


def glyph_name(cp):
    return UV2AGL.get(cp) or f"uni{cp:04X}"


def overlay(base, extra, dx=0.0, dy=0.0):
    """`base` with `extra` drawn over it. Oriented part by part: the two may
    overlap, and nesting worked out across both reads the overlap as a counter."""
    r = base.copy()
    r.contours = orient(r.contours) + [c + [dx, dy] for c in orient(extra.contours)]
    r.adv = base.adv
    return r


# ---------------------------------------------------------------------------
# 5. One weight
# ---------------------------------------------------------------------------


def build_weight(stroke, wclass):
    delta = (stroke - SHEET_STROKE) / 2  # how far the ink grew past the sheet's own edge
    G = {}
    cmap = {}

    def put(name, rec, cps=(), reorient=True):
        if reorient:
            rec.contours = orient(rec.contours)
        G[name] = rec
        for cp in cps:
            cmap[cp] = name

    def place_letter(ch, rec):
        """The sheet's own vertical placement, with most of each glyph's wobble taken out."""
        g = GL[ch]
        base = baseline_at(g)
        dev = (g["y1"] - base) * S * letter_scale(ch)  # how far below its line the sheet sat it
        ink_bottom = rec.bbox()[1]
        if ch.isdigit() or ch == "Y":
            rec.shift(dy=-ink_bottom - float(np.clip(0.2 * dev, -14, 14)))
        elif ch == "J":
            rec.shift(dy=-110 - ink_bottom)
        elif ch in SITTER_SET:
            keep = 0.35 if ch.isupper() else 0.4
            rec.shift(dy=-ink_bottom - float(np.clip(keep * dev, -22, 22)))
        else:
            rec.shift(dy=delta)

    def space_letter(ch, rec):
        if ch.islower():
            space(rec, (0, XH), 76, 0.6, 16, 110)
        elif ch.isupper():
            space(rec, (0, CAP), 84, 0.6, 16, 130)
        else:
            space(rec, (0, CAP), 64, 0.5, 18, 110)

    for ch in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
        rec = trace(ch, stroke, f=letter_scale(ch), fx=condense(ch), baseline=baseline_at(GL[ch]))
        place_letter(ch, rec)
        space_letter(ch, rec)
        put(glyph_name(ord(ch)), rec, [ord(ch)])

    # Dotless i and j carry the accents: the stem blob only.
    for ch, name, cp in (("i", "dotlessi", 0x131), ("j", "uni0237", 0x237)):
        rec = trace(ch, stroke, which=lambda cs: [max(cs, key=lambda c: c["area"])],
                    f=letter_scale(ch), baseline=baseline_at(GL[ch]))
        place_letter(ch, rec)
        space_letter(ch, rec)
        put(name, rec, [cp])

    # Punctuation, placed by rule.
    colon_top = None
    for ch in ".,!?'\"@#$%^&*()-_+=[]{}/\\|:;<>~":
        mode, at, height = PUNCT[ch]
        g = GL[ch]
        if ch == "_":
            # The sheet drew it as a slash lying down; a line is what reads as one.
            rec = stroke_shape([[(0, 0), (150, 5), (330, 0)]], [], stroke)
        else:
            f = 1.0
            if height:
                f = max(0.7, min(2.0, height / ((g["y1"] - g["y0"]) * S)))
            rec = trace(ch, stroke, f=f)
        x0, y0, x1, y1 = rec.bbox()
        if ch == ";":
            mode, at = "top", colon_top
        if mode == "bottom":
            rec.shift(dy=at - y0)
        elif mode == "top":
            rec.shift(dy=at - y1)
        else:
            rec.shift(dy=at - (y0 + y1) / 2)
        if ch == ":":
            colon_top = rec.bbox()[3]
        if ch == "-":
            # Shorter than the sheet's, which is a dash: it has to sit inside a word.
            cx = (x0 + x1) / 2
            rec = rec.transformed(lambda c: np.stack([cx + (c[:, 0] - cx) * 0.8, c[:, 1]], 1))
        if rec.prof_y is None:
            space_by_ink(rec, 64)
        else:
            space(rec, (-1e9, 1e9), 64, 0.35, 26, 80)
        put(glyph_name(ord(ch)), rec, [ord(ch)])

    # The sheet's quote marks are already the curly right-hand ones.
    put("quoteright", G["quotesingle"].copy(), [0x2019])
    put("quotedblright", G["quotedbl"].copy(), [0x201D])

    def rot180(src, name, cp):
        r = G[src]
        x0, y0, x1, y1 = r.bbox()
        put(name, r.transformed(lambda c: np.stack([x0 + x1 - c[:, 0], y0 + y1 - c[:, 1]], 1)), [cp])

    rot180("quotesingle", "quoteleft", 0x2018)
    rot180("quotedbl", "quotedblleft", 0x201C)
    for src, name, cp in (("exclam", "exclamdown", 0xA1), ("question", "questiondown", 0xBF)):
        r = G[src]
        x0, y0, x1, y1 = r.bbox()
        rr = r.transformed(lambda c, x0=x0, x1=x1, y0=y0, y1=y1: np.stack([x0 + x1 - c[:, 0], y0 + y1 - c[:, 1]], 1))
        rr.shift(dy=XH + 20 - rr.bbox()[3])
        put(name, rr, [cp])

    per = G["period"]
    px0, py0, px1, py1 = per.bbox()
    # The middle dot is the app's empty-value placeholder, so it matters.
    put("periodcentered", per.copy().shift(dy=MATH - (py0 + py1) / 2), [0xB7])

    ell = Rec([])
    for i in range(3):
        ell.contours += [c + [i * (px1 - px0 + 70), 0] for c in per.contours]
    put("ellipsis", space_by_ink(ell, 50), [0x2026])

    hy = G["hyphen"]
    hx0, _, hx1, _ = hy.bbox()
    hcx = (hx0 + hx1) / 2
    for name, cp, fac in (("endash", 0x2013, 1.7), ("emdash", 0x2014, 2.9), ("minus", 0x2212, 1.25)):
        r = hy.transformed(lambda c, fac=fac: np.stack([hcx + (c[:, 0] - hcx) * fac, c[:, 1]], 1))
        put(name, space_by_ink(r, 40 if name == "emdash" else 50), [cp])

    # Superscripts (km²): traced heavier, then scaled, so the pen does not come out spindly.
    for d, name, cp in (("1", "onesuperior", 0xB9), ("2", "twosuperior", 0xB2), ("3", "threesuperior", 0xB3)):
        g = GL[d]
        rec = trace(d, stroke * 0.86 / 0.6, f=letter_scale(d), fx=condense(d), baseline=baseline_at(g))
        r = rec.transformed(lambda c: c * 0.6)
        r.shift(dy=CAP + 25 - r.bbox()[3])
        put(name, space_by_ink(r, 30), [cp])

    deg = stroke_shape([circle(0, 0, 62, seed=3)], [], stroke * 0.85, closed=(0,))
    deg.shift(dy=CAP + 20 - deg.bbox()[3])
    put("degree", space_by_ink(deg, 40), [0xB0])

    bul = stroke_shape([], [(0, 0)], 1, dot_scale=(110 + 0.3 * stroke) * 2)
    put("bullet", space_by_ink(bul.shift(dy=MATH), 60), [0x2022])

    mul = stroke_shape([[(-105, -105), (105, 105)], [(-105, 105), (105, -105)]], [], stroke)
    put("multiply", space_by_ink(mul.shift(dy=MATH), 55), [0xD7])

    pm = stroke_shape([[(0, 70), (0, 330)], [(-140, 200), (140, 205)], [(-140, 0), (140, 8)]], [], stroke)
    put("plusminus", space_by_ink(pm, 55), [0xB1])

    # Accents: the spacing marks on their own, then base + mark letters.
    low = marks(stroke)
    cap = marks(stroke, case=True)
    for mname, cp in (("grave", 0x60), ("acute", 0xB4), ("circumflex", 0x2C6), ("caron", 0x2C7),
                      ("tilde", 0x2DC), ("macron", 0xAF), ("dieresis", 0xA8), ("dotaccent", 0x2D9),
                      ("ring", 0x2DA), ("cedilla", 0xB8)):
        r = low[mname].copy()
        if mname == "grave":  # the ASCII backtick sits up at cap height
            r.shift(dy=CAP + 20 - r.bbox()[3])
        elif mname != "cedilla":
            r.shift(dy=XH + 60)
        put(mname, space_by_ink(r, 45), [cp])

    for cp in range(0xC0, 0x180):
        ch = chr(cp)
        if ch in SKIP_ACCENTED:
            continue
        dec = unicodedata.normalize("NFD", ch)
        if len(dec) != 2 or dec[1] not in COMBINING or not dec[0].isascii() or not dec[0].isalpha():
            continue
        base_ch, mname = dec[0], COMBINING[dec[1]]
        above = mname != "cedilla"
        base = G[{"i": "dotlessi", "j": "uni0237"}.get(base_ch, base_ch) if above else base_ch]
        bx0, by0, bx1, by1 = base.bbox()
        pts = np.vstack(base.contours)
        if above:
            band = pts[pts[:, 1] > by0 + 0.7 * (by1 - by0)]
            ay = by1 + (35 if base_ch.isupper() else 55)
        else:
            band = pts[pts[:, 1] < by0 + 0.25 * (by1 - by0)]
            ay = by0 + 40
        ax = (band[:, 0].min() + band[:, 0].max()) / 2
        mark = (cap if base_ch.isupper() else low)[mname]
        put(glyph_name(cp), overlay(base, mark, ax, ay), [cp], reorient=False)

    # Letters with a stroke through them (no decomposition to lean on).
    def barred(base_name, name, cp, band, seg):
        base = G[base_name]
        bx0, by0, bx1, by1 = base.bbox()
        pts = np.vstack(base.contours)
        lo, hi = by0 + band[0] * (by1 - by0), by0 + band[1] * (by1 - by0)
        sel = pts[(pts[:, 1] > lo) & (pts[:, 1] < hi)]
        cx, cy = (sel[:, 0].min() + sel[:, 0].max()) / 2, (lo + hi) / 2
        bar = stroke_shape([[(cx + a, cy + b) for a, b in seg]], [], stroke * 0.95)
        put(name, overlay(base, bar), [cp], reorient=False)

    barred("L", "Lslash", 0x141, (0.35, 0.75), [(-95, -60), (105, 70)])
    barred("l", "lslash", 0x142, (0.35, 0.7), [(-90, -55), (95, 65)])
    for name, base_name, cp in (("Oslash", "O", 0xD8), ("oslash", "o", 0xF8)):
        base = G[base_name]
        bx0, by0, bx1, by1 = base.bbox()
        bar = stroke_shape([[(bx0 - 20, by0 - 45), (bx1 + 20, by1 + 45)]], [], stroke * 0.95)
        put(name, overlay(base, bar), [cp], reorient=False)

    # Tabular figures for live numbers (fontVariant: tabular-nums -> 'tnum').
    tf_adv = max(G[d].adv for d in DIGITS)
    for d in DIGITS:
        r = G[d].copy()
        r.shift(dx=(tf_adv - r.adv) / 2)
        r.adv = tf_adv
        put(d + ".tf", r, reorient=False)

    for name, cp in (("space", 0x20), ("uni00A0", 0xA0)):
        G[name] = Rec([])
        G[name].adv = {400: 290, 500: 296, 700: 304}[wclass]
        cmap[cp] = name

    nd = Rec([np.array([[50, 0], [50, 700], [450, 700], [450, 0]], float),
              np.array([[110, 60], [390, 60], [390, 640], [110, 640]], float)])
    nd.adv = 500
    G[".notdef"] = nd
    return G, cmap


DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]


# ---------------------------------------------------------------------------
# 6. Writing the font
# ---------------------------------------------------------------------------


def tt_glyph(rec):
    pen = TTGlyphPen(None)
    for c in rec.contours:
        pts = [(int(round(x)), int(round(y))) for x, y in c]
        ded = [pts[0]]
        for p in pts[1:]:
            if p != ded[-1]:
                ded.append(p)
        if len(ded) > 1 and ded[0] == ded[-1]:
            ded.pop()
        if len(ded) < 3:
            continue
        pen.qCurveTo(*ded, None)  # all off-curve: implied on-curve points between them
        pen.closePath()
    return pen.glyph()


def save_font(style, wclass, G, cmap, out_dir):
    order = [".notdef", "space"] + sorted(n for n in G if n not in (".notdef", "space"))
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf({n: tt_glyph(G[n]) for n in order})
    glyf = fb.font["glyf"]
    fb.setupHorizontalMetrics({n: (int(round(G[n].adv)), glyf[n].xMin if glyf[n].numberOfContours else 0)
                               for n in order})
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT, lineGap=0)
    ribbi = style in ("Regular", "Bold")
    fb.setupNameTable({
        "familyName": FAMILY if ribbi else f"{FAMILY} {style}",
        "styleName": style if ribbi else "Regular",
        "typographicFamily": FAMILY,
        "typographicSubfamily": style,
        "uniqueFontIdentifier": f"PASER;{PSNAME}-{style};1.000",
        "fullName": f"{FAMILY} {style}",
        "psName": f"{PSNAME}-{style}",
        "version": "Version 1.000",
        "manufacturer": "Gameable Studios",
        "description": "PASER's handwriting face, traced from the Pistachio Cloud Magnolia specimen sheet.",
    })
    inked = [n for n in order if glyf[n].numberOfContours]
    fb.setupOS2(
        version=4, usWeightClass=wclass, fsType=0, achVendID="PASR",
        fsSelection=(0x20 if style == "Bold" else 0x40) | 0x80,  # BOLD/REGULAR + USE_TYPO_METRICS
        sTypoAscender=ASCENT, sTypoDescender=DESCENT, sTypoLineGap=0,
        usWinAscent=max(ASCENT, max(glyf[n].yMax for n in inked)),
        usWinDescent=max(-DESCENT, -min(glyf[n].yMin for n in inked)),
        sxHeight=int(round(XH)), sCapHeight=CAP, ulCodePageRange1=1,
    )
    fb.font["OS/2"].recalcUnicodeRanges(fb.font)
    fb.setupPost()
    if style == "Bold":
        fb.font["head"].macStyle = 1
    addOpenTypeFeaturesFromString(fb.font, (
        "languagesystem DFLT dflt;\nlanguagesystem latn dflt;\n"
        f"feature tnum {{ sub [{' '.join(DIGITS)}] by [{' '.join(d + '.tf' for d in DIGITS)}]; }} tnum;\n"
    ))
    path = os.path.join(out_dir, f"{PSNAME}-{style}.ttf")
    fb.save(path)
    return path


def measure_sheet_stroke():
    """The sheet's own pen in font units, measured the way the weights are set."""
    vals = []
    for ch in "abcdehmnoprsuvwxzBDEHLMNRSTUZ":
        crop, _, _ = isolate(ch)
        Z = U * letter_scale(ch)
        big = ndi.zoom(crop.astype(np.float64), Z, order=3, grid_mode=True, mode="grid-constant")
        vals.append(stroke_px(clean(ndi.gaussian_filter(big, 0.45 * Z) > THRESH, Z)) * S / U)
    return float(np.median(vals))


def proof(png, out_dir):
    lines = [
        ("pistachio cloud magnolia", 72, "Regular"),
        ("abcdefghijklm nopqrstuvwxyz", 46, "Regular"),
        ("ABCDEFGHIJKLM NOPQRSTUVWXYZ", 46, "Regular"),
        ("0123456789  .,!?'\"@#$%^&*()  -_+=[]{}/\\|:;<>~", 40, "Regular"),
        ("·•…–—‘’“”°×±¹²³  "
         "Café Zoë Ñandú Łódź Ørsted François Şeker", 40, "Regular"),
    ]
    lines += [(f"good drinks make better days ({s})", 40, s) for s, _, _ in WEIGHTS]
    lines += [("CLAIM YOUR LAND  5.02 KM  5:31 /KM  27:45", 40, "Bold")]
    img = Image.new("RGB", (1700, sum(int(sz * 1.45) for _, sz, _ in lines) + 40), "#fbfaf6")
    d = ImageDraw.Draw(img)
    y = 20
    for text, sz, style in lines:
        font = ImageFont.truetype(os.path.join(out_dir, f"{PSNAME}-{style}.ttf"), sz)
        d.text((24, y), text, font=font, fill="#111")
        y += int(sz * 1.45)
    img.save(png)
    print("proof:", png)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("styles", nargs="*", help="Regular, Medium and/or Bold (default: all three)")
    ap.add_argument("--specimen", default=SPECIMEN)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--proof", help="also render a proof sheet to this PNG")
    args = ap.parse_args()
    setup(args.specimen)
    os.makedirs(args.out, exist_ok=True)
    for style, wclass, stroke in WEIGHTS:
        if args.styles and style not in args.styles:
            continue
        G, cmap = build_weight(stroke, wclass)
        over = sorted((n, round(r.bbox()[1]), round(r.bbox()[3])) for n, r in G.items()
                      if r.contours and (r.bbox()[3] > ASCENT or r.bbox()[1] < DESCENT))
        if over:
            sys.exit(f"{style}: ink outside the {ASCENT}/{DESCENT} line box, which iOS would crop: {over}")
        path = save_font(style, wclass, G, cmap, args.out)
        print(f"wrote {os.path.relpath(path, FRONTEND)}  ({len(G)} glyphs, tabular figure {G['zero.tf'].adv:.0f})")
    if args.proof:
        proof(args.proof, args.out)


if __name__ == "__main__":
    main()
