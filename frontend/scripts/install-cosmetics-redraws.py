"""Install the September 2026 hair and accessory redraw sheets.

HAIR
The hair redraws came back as ONE labelled contact sheet: 36 styles, each worn
on the blank head that body.png is drawn with. The first install cut that
sheet on a fixed 153.6px grid, kept every dark pixel within 8px of the brown
fill, and never re-solved a layout. All three showed on the phone:

  * The grid was not the art's grid. Wide styles ran past their cell, so they
    were sliced flat on one side and carried a sliver of the neighbouring head
    on the other (the stray marks beside half the studio's hair tiles).
  * "Dark and near the hair" is also the eyebrows under a fringe, the ears
    under a side lock and the jaw where it leaves the hair, so tiles carried
    stray dashes and the runner a second set of brows.
  * Every style kept the placement solved for the OLD drawing it replaced, so
    the new art sat wherever the old art's box had been. The curly updo
    floated a head's height above the skull.

What this does instead:

  1. SEGMENT by what is on the page. Paper is the light region touching the
     sheet's border; each head is one connected island of everything else.
     36 islands, row by row, is the catalogue order, and nothing outside a
     head's own island can reach its art.
  2. UNMIX every pixel into brown fill, black ink and white paper (least
     squares over the three reference colours), so anti-aliasing survives as
     fractions instead of being thresholded into jaggies.
  3. OWN the ink. A stroke is hair when the brown fill is one of the two
     things it separates: outline (fill | paper), hairline (fill | face),
     strand (fill | fill). The face outline separates face from paper and the
     features sit wholly inside the face, so neither survives.
  4. REDRAW at 4x. The sheet gives ~140px per style; the old art was 512 and
     the studio decodes it at full size. The fractions are upsampled, their
     edges tightened, and painted as flat palette fill under black ink.
  5. FIT to the head. Every style comes off a drawing of the body's own head,
     so its layout is solved by registering the visible face outline (cheeks,
     jaw, ears) onto body.png's head outline: one scale for the sheet (it is
     one head drawn 36 times), one translation per head. The eyes cross-check
     it, and place any head whose outline the hair hides (the hijab).

ACCESSORIES
The first ten accessory redraws are transparent standalone drawings. Items
that wrap around the neck/body are split into registered front/back canvases
so the avatar can occlude the far side while PartThumb can recombine both.

Run from frontend/:
  python scripts/install-cosmetics-redraws.py --only hair --qa <dir>
  python scripts/install-cosmetics-redraws.py --only hair --dry --qa <dir>
--dry renders the QA sheets and leaves the art and the catalogue alone.
"""
from pathlib import Path
import argparse
import io
import os
import re
import subprocess
import time

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, optimize


ROOT = Path(__file__).resolve().parents[1]
REDRAWS = Path(r"C:\Users\user\Desktop\paser-cosmetics-regen\after")
HAIR_SHEET = REDRAWS / "hair" / "ChatGPT Image Sep 13, 2026, 11_26_41 PM.png"
HAIR_DIR = ROOT / "assets" / "character" / "hair"
ACC_DIR = ROOT / "assets" / "character" / "accessory"
BODY_PNG = ROOT / "assets" / "character" / "body" / "body.png"
FACE_PNG = ROOT / "assets" / "character" / "face" / "faceN1.png"
RIG_JS = ROOT / "src" / "components" / "character" / "CharacterRig.js"
COSMETICS_JS = ROOT / "src" / "config" / "cosmetics.js"
SHEET_ITEMS_JS = ROOT / "src" / "config" / "hairSheetItems.js"

# Sheet order is the catalogue order: three rows of the base styles (10, 10,
# 9), then one strip holding wave 3's two and the five silhouette styles.
HAIR_BASES = [
    "hairM1", "hairM4", "hairM3", "hairM5", "hairW10",
    "hairW4", "hairW2", "hairW5", "hairM10", "hairW1",
    "hairM6", "hairW6", "hairW11", "hairM8", "hairW12",
    "hairM2", "hairW9", "hairM7", "hairW7", "hairM9",
    "hairW8", "hairW14", "hairW17", "hairM11", "hairM12",
    "hairW15", "hairW16", "hairM13", "hairM14", "hairX24",
    "hairX25", "hairS11", "hairS15", "hairS22", "hairS25", "hairS26",
]
ROW_COUNTS = (10, 10, 9, 7)
# `img` items in the catalogue: one file in one colour, no swatches.
SINGLE_COLOUR = ("hairX24", "hairX25")

PAPER = np.array([253.0, 253.0, 251.0])
INK_OUT = np.array([0.0, 0.0, 0.0])   # body.png's own outline is pure black
UPSCALE = 4
MAX_DIM = 512                         # the long side the hair art ships at
PAD = 6                               # sheet px kept around each head island

# body.png is 248x640. The jaw meets the shoulders at row 213 (the rig's
# HEAD_CHIN), so the head's own outline is everything above that; below it
# body.png draws a neck and shoulders, not a chin.
BODY_W, BODY_H = 248, 640
HEAD_CUT_Y = 212
HEAD_H = 218                          # CharacterRig HEAD.h: top 8, chin 226
CHIN_HIDDEN = (226 - 213) / HEAD_H    # the part of the head the shoulders cover

# QA only: the rig's 'chill' face, so the hairline can be judged against brows.
FACE_SPEC = {"w": 0.3951, "top": 0.1219, "dx": -0.0033, "maxH": 0.1396}

ACCESSORIES = {
    1: "acc5",   # scarf
    2: "acc7",   # gold medal
    3: "acc2",   # hydration vest
    4: "acc6",   # cape
    5: "acc3",   # angel wings
    6: "acc4",   # neon wings
    7: "acc9",   # jetpack
    8: "acc11",  # dragon wings
    9: "acc13",  # red cape
    10: "acc15", # star necklace
}


def tight(im, padding=4):
    box = im.getchannel("A").getbbox()
    if not box:
        raise ValueError("image has no visible pixels")
    left, top, right, bottom = box
    return im.crop((max(0, left-padding), max(0, top-padding),
                    min(im.width, right+padding), min(im.height, bottom+padding)))


def save_png(im, path):
    """Write atomically; Windows thumbnail/indexing can briefly hold targets."""
    temp = path.with_name(path.stem + ".installing.png")
    im.save(temp, optimize=True)
    for attempt in range(8):
        try:
            os.replace(temp, path)
            return
        except OSError:
            if attempt == 7:
                raise
            time.sleep(0.05 * (attempt + 1))


# --- catalogue and rig constants, read from the source so they cannot drift --

def hair_colours():
    src = COSMETICS_JS.read_text(encoding="utf-8")
    block = re.search(r"export const HAIR_COLORS = \[(.*?)\];", src, re.S).group(1)
    colours = re.findall(r"'(#[0-9A-Fa-f]{6})'", block)
    if len(colours) != 10:
        raise ValueError(f"expected 10 hair colours, found {len(colours)}")
    return colours


def rig_hair_lift():
    src = RIG_JS.read_text(encoding="utf-8")
    return float(re.search(r"const HAIR_LIFT = (-?[\d.]+);", src).group(1))


def locate(base):
    """The catalogue file and the pattern that finds this style's line."""
    if base.startswith("hairS"):
        return SHEET_ITEMS_JS, re.compile(rf"hair/{base}_0\.png'")
    if base in SINGLE_COLOUR:
        return COSMETICS_JS, re.compile(rf"hair/{base}\.png'")
    return COSMETICS_JS, re.compile(rf"art: ART\.{base},")


def catalogue_line(lines, base, pattern):
    hits = [i for i, line in enumerate(lines) if pattern.search(line)]
    if len(hits) != 1:
        raise ValueError(f"{base}: expected one catalogue line, found {len(hits)}")
    return hits[0]


def current_layouts():
    out = {}
    for base in HAIR_BASES:
        path, pattern = locate(base)
        lines = path.read_text(encoding="utf-8").split("\n")
        line = lines[catalogue_line(lines, base, pattern)]
        spec = {"w": 0.92, "top": -0.025}          # CharacterRig LAYOUT.hair
        m = re.search(r"layout: \{([^}]*)\}", line)
        if m:
            for key, value in re.findall(r"(\w+): (-?[\d.]+)", m.group(1)):
                spec[key] = float(value)
        out[base] = spec
    return out


def format_layout(spec):
    parts = [f"w: {spec['w']:.4f}", f"top: {spec['top']:.4f}"]
    if spec.get("dx"):
        parts.append(f"dx: {spec['dx']:.4f}")
    return "layout: { " + ", ".join(parts) + " }"


def patch_layouts(layouts):
    """Rewrite each style's `layout` in place. Nothing else on the line moves,
    and the files are read and written with their own line endings."""
    by_file = {}
    for base, spec in layouts.items():
        path, pattern = locate(base)
        by_file.setdefault(path, []).append((base, pattern, spec))
    for path, entries in by_file.items():
        with open(path, encoding="utf-8", newline="") as f:
            lines = f.read().split("\n")
        for base, pattern, spec in entries:
            i = catalogue_line(lines, base, pattern)
            line, layout = lines[i], format_layout(spec)
            if "layout: {" in line:
                line = re.sub(r"layout: \{[^}]*\}", layout, line, count=1)
            else:
                end = pattern.search(line).end()
                line = f"{line[:end]} {layout},{line[end:]}"
            lines[i] = line
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write("\n".join(lines))


# --- pixels ------------------------------------------------------------------

def luma(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def chroma(rgb):
    return rgb.max(-1) - rgb.min(-1)


def smoothstep(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def distance_to(mask):
    """Distance from every pixel to the nearest pixel of `mask`."""
    if not mask.any():
        return np.full(mask.shape, np.inf)
    return ndimage.distance_transform_edt(~mask)


def touching_border(mask):
    lab, _ = ndimage.label(mask)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    return np.isin(lab, edge[edge > 0])


def segment_heads(rgb):
    """Label every head on the sheet, in catalogue order."""
    paper = touching_border((luma(rgb) >= 200) & (chroma(rgb) < 30))
    lab, n = ndimage.label(~paper, structure=np.ones((3, 3)))
    sizes = np.bincount(lab.ravel(), minlength=n + 1)
    boxes = ndimage.find_objects(lab)
    # A head is thousands of pixels; the letters of its caption are tens.
    heads = [{"label": i, "box": boxes[i - 1]} for i in range(1, n + 1) if sizes[i] > 2500]
    heads.sort(key=lambda h: h["box"][0].start)
    rows = [[heads[0]]]
    for head in heads[1:]:
        if head["box"][0].start - rows[-1][-1]["box"][0].start > 80:
            rows.append([head])
        else:
            rows[-1].append(head)
    counts = tuple(len(row) for row in rows)
    if counts != ROW_COUNTS:
        raise ValueError(f"expected rows of {ROW_COUNTS} heads, found {counts}")
    return lab, [h for row in rows for h in sorted(row, key=lambda h: h["box"][1].start)]


def unmix(rgb, fill_rgb, ink_rgb):
    """Each pixel as fractions of fill and ink; paper is what is left."""
    basis = np.stack([fill_rgb - PAPER, ink_rgb - PAPER], axis=1)
    bk = (rgb - PAPER) @ np.linalg.pinv(basis).T
    b = np.clip(bk[..., 0], 0.0, 1.0)
    k = np.clip(bk[..., 1], 0.0, 1.0)
    over = b + k > 1.0
    total = (b + k)[over]
    b[over] /= total
    k[over] /= total
    return b, k


def cut_head(rgb, heads_lab, head, ink_rgb, stroke):
    ys, xs = head["box"]
    y0, y1 = max(0, ys.start - PAD), min(rgb.shape[0], ys.stop + PAD)
    x0, x1 = max(0, xs.start - PAD), min(rgb.shape[1], xs.stop + PAD)
    crop = rgb[y0:y1, x0:x1].copy()
    island = ndimage.binary_dilation(heads_lab[y0:y1, x0:x1] == head["label"], iterations=2)
    crop[~island] = PAPER                      # a neighbour's edge is not ours

    lum, chr_ = luma(crop), chroma(crop)
    fill_rgb = np.median(crop[island & (chr_ > 40) & (lum > 50) & (lum < 170)], axis=0)
    b, k = unmix(crop, fill_rgb, ink_rgb)
    cls = np.argmax(np.stack([b, k, 1.0 - b - k]), axis=0)
    fill, ink, light = cls == 0, cls == 1, cls == 2
    paper = touching_border(light)
    skin = light & ~paper                      # face and ears: light, walled in

    # Face features are ink islands with face on every side of them.
    ink_lab, n = ndimage.label(ink, structure=np.ones((3, 3)))
    grown = ndimage.grey_dilation(ink_lab, footprint=np.ones((5, 5)))
    ring = (grown > 0) & ~ink
    around = np.bincount(grown[ring], minlength=n + 1)
    on_skin = np.bincount(grown[ring & skin], minlength=n + 1)
    features = ((around > 0) & (on_skin >= 0.97 * around))[ink_lab] & ink

    # A stroke is hair when the fill is one of the two things it separates.
    cap = stroke + 1.5
    d_fill, d_skin, d_paper = distance_to(fill), distance_to(skin), distance_to(paper)
    owned = ink & ~features & (d_fill <= cap) & ((d_fill <= d_skin) | (d_fill <= d_paper))
    core = fill | owned

    # Where that rule is ambiguous (a junction, a brow grazing a fringe) it
    # leaves specks. Hair is one mass plus braids and buns, never dust.
    lab, _ = ndimage.label(core, structure=np.ones((3, 3)))
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    core = (sizes >= max(40, 0.02 * sizes.max()))[lab]

    # Small pockets of light walled in by hair are paint the sheet left out,
    # not holes. The face opening is far bigger than this.
    plab, _ = ndimage.label(ndimage.binary_fill_holes(core) & ~core)
    psize = np.bincount(plab.ravel())
    psize[0] = 0
    pockets = ((psize > 0) & (psize < 0.01 * core.sum()))[plab]
    b = np.where(pockets, 1.0, b)
    k = np.where(pockets, 0.0, k)
    core |= pockets

    # The anti-aliased rim around the hair belongs to it; dropped ink does not.
    region = core | (ndimage.binary_dilation(core) & ~(ink & ~core))
    # Inside the hair there is no paper to mix with: a lighter patch of fill is
    # fill, not a translucent spot.
    solid = region & ~ndimage.binary_dilation(light & ~pockets, iterations=2)
    total = np.maximum(b + k, 1e-6)
    b = np.where(solid, b / total, b) * region
    k = np.where(solid, k / total, k) * region

    # For the fit: the visible head outline (cheek, jaw, ears), which is ink
    # between face and paper that the hair did not keep.
    outline = ink & ~core & ~features & (d_skin <= cap) & (d_paper <= cap)
    return {"origin": (x0, y0), "b": b, "k": k, "outline": outline, "features": features}


def redraw(cut):
    """4x the fractions, tighten their edges, trim to the ink."""
    def up(a):
        return np.clip(ndimage.zoom(a, UPSCALE, order=3, grid_mode=True,
                                    mode="grid-constant", cval=0.0), 0.0, 1.0)
    fill, ink = up(cut["b"]), up(cut["k"])
    alpha = smoothstep(np.clip(fill + ink, 0.0, 1.0), 0.3, 0.7)
    ink = np.minimum(smoothstep(ink, 0.3, 0.7), alpha)
    ys, xs = np.nonzero(alpha > 2 / 255)
    m = 2 * UPSCALE
    v0, v1 = max(0, ys.min() - m), min(alpha.shape[0], ys.max() + 1 + m)
    u0, u1 = max(0, xs.min() - m), min(alpha.shape[1], xs.max() + 1 + m)
    x0, y0 = cut["origin"]
    # Extent in sheet coordinates (pixel edges), which is what the fit maps.
    box = (x0 + u0 / UPSCALE, y0 + v0 / UPSCALE, x0 + u1 / UPSCALE, y0 + v1 / UPSCALE)
    return {"alpha": alpha[v0:v1, u0:u1], "ink": ink[v0:v1, u0:u1], "box": box}


def paint(art, hex_colour):
    colour = np.array([int(hex_colour[i:i + 2], 16) for i in (1, 3, 5)], float)
    a, k = art["alpha"], art["ink"]
    rgb = ((a - k)[..., None] * colour + k[..., None] * INK_OUT) / np.maximum(a, 1e-6)[..., None]
    rgba = np.dstack([np.clip(rgb, 0, 255), a * 255.0]).round().astype(np.uint8)
    im = Image.fromarray(rgba, "RGBA")
    if max(im.size) > MAX_DIM:
        s = MAX_DIM / max(im.size)
        size = (max(1, round(im.width * s)), max(1, round(im.height * s)))
        im = im.convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")
    return im


# --- fit ---------------------------------------------------------------------

def body_outline_distance():
    body = np.asarray(Image.open(BODY_PNG).convert("RGBA")).astype(float)
    ink = (body[..., 3] > 128) & (luma(body[..., :3]) < 110)
    ink[HEAD_CUT_Y:] = False
    return ndimage.distance_transform_edt(~ink)


def outline_points(cut, scale):
    ys, xs = np.nonzero(cut["outline"])
    x0, y0 = cut["origin"]
    pts = np.column_stack([xs + 0.5 + x0, ys + 0.5 + y0])
    if not len(pts):
        return pts
    # body.png has shoulders where the sheet has a chin; matching the chin
    # would pull every head down onto the collar.
    head_h = HEAD_H / scale
    return pts[pts[:, 1] < pts[:, 1].max() - (CHIN_HIDDEN + 0.02) * head_h]


def chamfer(dt, pts, s, tx, ty, cap=6.0):
    x = s * pts[:, 0] + tx - 0.5
    y = s * pts[:, 1] + ty - 0.5
    d = ndimage.map_coordinates(dt, [y, x], order=1, mode="nearest")
    return float(np.mean(np.minimum(d, cap) ** 2))


def fit(dt, pts, scale=None):
    """(s, tx, ty) mapping sheet pixels onto body.png, and its chamfer cost."""
    def start(s):
        return BODY_W / 2 - s * pts[:, 0].mean(), HEAD_CUT_Y - s * pts[:, 1].max()
    offsets = np.arange(-16, 17, 2.0)
    best = (np.inf, None)
    for s in ([scale] if scale else np.arange(1.30, 1.90, 0.02)):
        tx0, ty0 = start(s)
        for dx in offsets:
            for dy in offsets:
                c = chamfer(dt, pts, s, tx0 + dx, ty0 + dy)
                if c < best[0]:
                    best = (c, (s, tx0 + dx, ty0 + dy))
    if scale:
        r = optimize.minimize(lambda p: chamfer(dt, pts, scale, *p), best[1][1:],
                              method="Nelder-Mead", options={"xatol": 0.02, "fatol": 1e-5})
        return (scale, *r.x), float(r.fun)
    r = optimize.minimize(lambda p: chamfer(dt, pts, *p), best[1],
                          method="Nelder-Mead", options={"xatol": 0.002, "fatol": 1e-5})
    return tuple(r.x), float(r.fun)


def eye_centre(cut):
    """Midpoint of the two round dots at one height: the drawn eyes."""
    lab, _ = ndimage.label(cut["features"], structure=np.ones((3, 3)))
    x0, y0 = cut["origin"]
    dots = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        comp = lab[sl] == i
        h, w = comp.shape
        if 10 <= comp.sum() <= 200 and max(h, w) <= 1.8 * min(h, w):
            cy, cx = ndimage.center_of_mass(comp)
            dots.append((sl[1].start + cx + 0.5 + x0, sl[0].start + cy + 0.5 + y0))
    best = None
    for i in range(len(dots)):
        for j in range(i + 1, len(dots)):
            (ax, ay), (bx, by) = dots[i], dots[j]
            if 15 <= abs(ax - bx) <= 70 and abs(ay - by) <= 4:
                if best is None or abs(ay - by) < best[0]:
                    best = (abs(ay - by), ((ax + bx) / 2, (ay + by) / 2))
    return best[1] if best else None


# --- QA ------------------------------------------------------------------------

def place(canvas, img, spec, oy, scale, lift=0.0):
    """Draw one layer the way CharacterRig's Layer does."""
    w = spec["w"] * BODY_W
    h = w * img.height / img.width
    if spec.get("maxH") and h > spec["maxH"] * BODY_H:
        h = spec["maxH"] * BODY_H
        w = h * img.width / img.height
    top = (spec["top"] + lift) * BODY_H
    left = BODY_W / 2 - w / 2 + spec.get("dx", 0.0) * BODY_W
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    im = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    layer.paste(im, (round(left * scale), round((top + oy) * scale)))
    canvas.alpha_composite(layer)


def worn_panel(hair, spec, lift, label, scale=0.8, oy=90, height=330):
    canvas = Image.new("RGBA", (round(BODY_W * scale), round(height * scale) + 14), (236, 236, 236, 255))
    place(canvas, Image.open(BODY_PNG).convert("RGBA"), {"w": 1.0, "top": 0.0}, oy, scale)
    place(canvas, Image.open(FACE_PNG).convert("RGBA"), FACE_SPEC, oy, scale)
    if hair is not None:
        place(canvas, hair, spec, oy, scale, lift)
    ImageDraw.Draw(canvas).text((4, canvas.height - 13), label, fill=(0, 0, 0, 255))
    return canvas


def grid(panels, cols, gap=6):
    w, h = panels[0].size
    rows = (len(panels) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * (w + gap), rows * (h + gap)), (255, 255, 255, 255))
    for i, p in enumerate(panels):
        sheet.alpha_composite(p, ((i % cols) * (w + gap), (i // cols) * (h + gap)))
    return sheet


def thumb(img, label, size=150):
    tile = Image.new("RGBA", (size, size + 14), (236, 236, 236, 255))
    s = min((size - 10) / img.width, (size - 10) / img.height)
    im = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    tile.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    ImageDraw.Draw(tile).text((4, size), label, fill=(0, 0, 0, 255))
    return tile


def shipped_art(base, rev=None):
    """Variant 3 (gold) of a style, on disk or at a git revision."""
    name = f"{base}.png" if base in SINGLE_COLOUR else f"{base}_3.png"
    if rev is None:
        return Image.open(HAIR_DIR / name).convert("RGBA")
    out = subprocess.run(
        ["git", "-C", str(ROOT.parent), "show", f"{rev}:frontend/assets/character/hair/{name}"],
        capture_output=True,
    )
    return Image.open(io.BytesIO(out.stdout)).convert("RGBA") if out.returncode == 0 else None


# --- install -----------------------------------------------------------------

def install_hair(dry=False, qa=None):
    colours = hair_colours()
    lift = rig_hair_lift()
    rgb = np.asarray(Image.open(HAIR_SHEET).convert("RGB")).astype(float)
    if rgb.shape[:2] != (1024, 1536):
        raise ValueError(f"unexpected hair sheet size {rgb.shape[1]}x{rgb.shape[0]}")
    heads_lab, heads = segment_heads(rgb)

    lum, chr_ = luma(rgb), chroma(rgb)
    ink_rgb = np.median(rgb[(heads_lab > 0) & (lum < 45) & (chr_ < 30)], axis=0)
    ink_mask = (heads_lab > 0) & (lum < 90) & (chr_ < 30)
    depth = ndimage.distance_transform_edt(ink_mask)
    ridge = ink_mask & (depth >= ndimage.maximum_filter(depth, size=3)) & (depth >= 1)
    stroke = float(2 * np.median(depth[ridge]))
    print(f"ink {ink_rgb.round().tolist()}, stroke ~{stroke:.1f}px")

    cuts = [cut_head(rgb, heads_lab, head, ink_rgb, stroke) for head in heads]
    dt = body_outline_distance()

    # One head drawn 36 times: take the scale from the heads showing the most
    # outline, then fit each head's position at that one scale.
    guess = 1.55
    pts = [outline_points(c, guess) for c in cuts]
    probes = sorted(range(len(cuts)), key=lambda i: -len(pts[i]))[:12]
    scales = []
    for i in probes:
        (s, _, _), cost = fit(dt, pts[i])
        scales.append(s)
        print(f"  scale probe {HAIR_BASES[i]:8s} s={s:.3f} cost={cost:.2f} points={len(pts[i])}")
    scale = float(np.median(scales))
    print(f"sheet scale {scale:.4f} (spread {min(scales):.3f}..{max(scales):.3f})")
    pts = [outline_points(c, scale) for c in cuts]

    fits, eyes = {}, {}
    for base, cut, p in zip(HAIR_BASES, cuts, pts):
        eye = eye_centre(cut)
        if eye:
            eyes[base] = eye
        if len(p) >= 60:
            (_, tx, ty), cost = fit(dt, p, scale)
            fits[base] = (tx, ty, cost)
    landed = {b: (scale * eyes[b][0] + fits[b][0], scale * eyes[b][1] + fits[b][1])
              for b in fits if b in eyes}
    eye_body = np.median(np.array(list(landed.values())), axis=0)
    print(f"eyes land at body ({eye_body[0]:.1f}, {eye_body[1]:.1f})")
    for base in HAIR_BASES:
        if base not in fits:
            if base not in eyes:
                raise ValueError(f"{base}: no outline and no eyes to place it by")
            ex, ey = eyes[base]
            fits[base] = (eye_body[0] - scale * ex, eye_body[1] - scale * ey, float("nan"))
            landed[base] = tuple(eye_body)
            print(f"  {base}: outline hidden, placed by its eyes")

    before = current_layouts()
    layouts, arts = {}, {}
    print(f"{'style':8s} {'points':>6s} {'cost':>5s} {'eye dx,dy':>11s}   old -> new layout")
    for base, cut, p in zip(HAIR_BASES, cuts, pts):
        art = redraw(cut)
        tx, ty, cost = fits[base]
        x0, y0, x1, y1 = art["box"]
        width = scale * (x1 - x0)
        left, top = scale * x0 + tx, scale * y0 + ty
        spec = {"w": round(width / BODY_W, 4), "top": round(top / BODY_H - lift, 4)}
        dx = round((left + width / 2 - BODY_W / 2) / BODY_W, 4)
        if dx:
            spec["dx"] = dx
        layouts[base], arts[base] = spec, art
        ex, ey = (np.array(landed[base]) - eye_body) if base in landed else (np.nan, np.nan)
        print(f"{base:8s} {len(p):6d} {cost:5.2f} {ex:5.1f},{ey:5.1f}   "
              f"{format_layout(before[base])[8:]} -> {format_layout(spec)[8:]}")

    if qa:
        qa.mkdir(parents=True, exist_ok=True)
        gold = colours[3]
        new_art = {b: paint(arts[b], colours[1] if b in SINGLE_COLOUR else gold) for b in HAIR_BASES}
        grid([thumb(new_art[b], b) for b in HAIR_BASES], 9).save(qa / "hair_thumbs.png")
        panels = []
        for base in HAIR_BASES:
            panels += [
                worn_panel(shipped_art(base, "b775054^"), before[base], lift, f"{base} before 71"),
                worn_panel(shipped_art(base), before[base], lift, f"{base} build 71"),
                worn_panel(new_art[base], layouts[base], lift, f"{base} fixed"),
            ]
        for n in range(3):
            grid(panels[n * 36:(n + 1) * 36], 9).save(qa / f"hair_worn_{n + 1}.png")
        print(f"QA sheets in {qa}")

    if dry:
        return layouts
    for base in HAIR_BASES:
        if base in SINGLE_COLOUR:
            save_png(paint(arts[base], colours[1]), HAIR_DIR / f"{base}.png")
        else:
            for index, colour in enumerate(colours):
                save_png(paint(arts[base], colour), HAIR_DIR / f"{base}_{index}.png")
    patch_layouts(layouts)
    print(f"installed {len(HAIR_BASES)} hairstyles and their layouts")
    return layouts


def split_registered(im, seam_frac, back_below=False):
    arr = np.asarray(im).copy()
    seam = int(im.height * seam_frac)
    y = np.arange(im.height)
    weight = np.clip((seam + 2.5 - y) / 5, 0, 1)
    if back_below:
        weight = 1 - weight
    back = arr.copy()
    front = arr.copy()
    back[..., 3] = (arr[..., 3] * weight[:, None]).astype("uint8")
    front[..., 3] = (arr[..., 3] * (1 - weight[:, None])).astype("uint8")
    return Image.fromarray(front, "RGBA"), Image.fromarray(back, "RGBA")


def install_accessories():
    sources = {}
    for path in (REDRAWS / "accessory").glob("*.png"):
        match = re.search(r"\((\d+)\)\.png$", path.name)
        if match:
            sources[int(match.group(1))] = path
    if set(sources) != set(ACCESSORIES):
        raise ValueError(f"unexpected accessory files: {sorted(sources)}")
    for number, base in ACCESSORIES.items():
        art = tight(Image.open(sources[number]).convert("RGBA"), padding=4)
        if base == "acc5":
            front, back = split_registered(art, 0.18)
        elif base == "acc7":
            front, back = split_registered(art, 0.39)
        elif base == "acc6":
            front, back = split_registered(art, 0.16, back_below=True)
        elif base == "acc15":
            front, back = split_registered(art, 0.36)
        else:
            save_png(art, ACC_DIR / f"{base}.png")
            # acc13 is wholly behind the body now; its old split layer must not
            # remain available as a stale fragment.
            if base == "acc13":
                stale = ACC_DIR / "acc13b.png"
                if stale.exists():
                    stale.unlink()
            continue
        save_png(front, ACC_DIR / f"{base}.png")
        save_png(back, ACC_DIR / f"{base}b.png")
    print(f"installed {len(ACCESSORIES)} accessories")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=("hair", "accessory"))
    parser.add_argument("--dry", action="store_true",
                        help="render QA sheets only; leave the art and the catalogue alone")
    parser.add_argument("--qa", type=Path, help="directory for the QA sheets")
    args = parser.parse_args()
    if args.only in (None, "hair"):
        install_hair(dry=args.dry, qa=args.qa)
    if args.only in (None, "accessory") and not args.dry:
        install_accessories()
