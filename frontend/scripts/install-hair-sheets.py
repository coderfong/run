"""Install the silhouette hair sheets (C:\\Users\\user\\Desktop\\hair).

Each sheet is a grid of black hairstyle silhouettes on white. Three things
have to happen before they can join the catalogue:

  segment   Split the sheet into one sprite per style. The styles are far
            apart and the background is a single connected white field, so
            connected components on the ink does it — no grid assumptions,
            which matters because the rows are not evenly spaced.

  solidify  The art carries white highlight strokes inside the hair mass, and
            they vary a lot between styles: some are hairline, some are wide
            enough to read as gaps. They are CLOSED first (sealing any stroke
            that runs out to the silhouette edge) and then hole-filled, so
            every style ends up the same flat, solid shape. The face opening
            survives because it runs off the bottom of the sprite rather than
            being enclosed — that is the same property find_hole relies on.

  colour    A solid silhouette is the ideal source for a colourable slot: each
            style is emitted as the 10 HAIR_COLORS variants, matching how the
            rest of the hair catalogue works.

Placement reuses the rig geometry from install-items-3.py: the face opening's
WIDTH sets the scale and its centroid sets the position, so each wig wraps the
head instead of floating over it.
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"C:\Users\user\Desktop\hair"
CH = r"C:\Users\user\Desktop\run\frontend\assets\character\hair"
SCRATCH = os.path.dirname(os.path.abspath(__file__))
QA = os.path.join(SCRATCH, "hair-qa")

# --- rig geometry (identical to install-items-3.py) -------------------------
BODY_W, BODY_H = 248, 640
HEAD_WIDTH = 157.0
HEAD_CX, HEAD_CY = 124.0, 117.0
# Top of the eyebrows on the 248x640 frame — LAYOUT.face anchors the face art
# here. A fringe may reach it; anything past it is hair over the eyes.
BROW_Y = 70.0
HAIR_LIFT = -0.02          # CharacterRig's global dial, backed out below
MAX_DIM = 512

# Palette from config/cosmetics.js — index selects the pre-rendered variant.
HAIR_COLORS = ["#26282B", "#4A2F1F", "#7B4B2A", "#C9922B", "#E8D06B",
               "#C6482C", "#9EA3AB", "#E85D9E", "#8B5CF6", "#3B82F6"]

# A style is a sprite only if it is at least this fraction of the sheet.
MIN_AREA = 0.0015

# Hand corrections from looking at the composites, as (width x, y nudge in rig
# px). The fitter measures a style's crown and hairline, and for a handful it
# measures the wrong thing and no amount of threshold tuning fixes it without
# breaking the ones that are right:
#
#   twin buns / bear buns  the buns sit IN the crown band, so the measured
#                          crown comes out far too wide and the style is
#                          scaled down to suit. Both landed smallest of all 30.
#   slick cap / pomp       compact sprites with no overhang, so crown width is
#                          nearly the whole sprite and they scale up too far;
#                          shrinking also brings the sideburns back onto the
#                          head's own edge.
#   crest / curly updo     both pinned against a clamp, so the solved position
#                          was never actually used.
OVERRIDES = {
    8:  (1.22, -14),   # Twin buns   - too small, too low
    11: (0.86, -2),    # Slick cap   - too big, sideburns off the head
    12: (0.86, -2),    # Pomp sweep  - too big, sideburns off the head
    15: (1.00, -16),   # Crest       - too low
    18: (1.22, -14),   # Bear buns   - too small, too low
    24: (1.14, 0),     # Shag        - too small
    25: (1.00, -14),   # Curly updo  - too low (was against the floor clamp)
}

# Names in segmentation order (sheet 1 rows, then sheet 2, then sheet 3).
# Segmentation is deterministic, so these stay put across re-runs.
NAMES = [
    "Side sweep", "Messy spikes", "Curtain cut", "Wind spikes", "Tight afro",
    "Round bob", "Side pony", "Twin buns", "Blunt bangs", "Long locs",
    "Slick cap", "Pomp sweep", "Bowl cut", "Shaggy crop", "Crest",
    "Soft part", "Side braid", "Bear buns", "Layered bob", "Ringlets",
    "Straight fringe", "Tousled crop", "Long waves", "Shag", "Curly updo",
    "Pigtails", "Bob fringe", "Long sweep", "Feathered", "Braided tails",
]


def rgb_of(hex_):
    h = hex_.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def sheet_masks(path):
    """Ink mask for a sheet, keyed off the white background."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(int)
    # Sheets may be opaque-white or already transparent; handle both.
    alpha = a[..., 3]
    lum = a[..., :3].mean(2)
    return (alpha > 40) & (lum < 140)


def segment(ink):
    """One bbox per hairstyle, reading order (top row first, then left→right)."""
    # Dilate before labelling: a style whose strands are separated by white
    # would otherwise come apart into a dozen fragments.
    fat = ndimage.binary_dilation(ink, np.ones((9, 9), bool))
    lab, n = ndimage.label(fat)
    boxes = []
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() < MIN_AREA * comp.size:
            continue
        ys, xs = np.where(comp)
        boxes.append((ys.min(), ys.max() + 1, xs.min(), xs.max() + 1))
    # reading order: cluster by row centre, then sort by x within a row
    boxes.sort(key=lambda b: b[0])
    rows, cur = [], []
    for b in boxes:
        if cur and b[0] > cur[-1][1] - (cur[-1][1] - cur[-1][0]) * 0.4:
            rows.append(sorted(cur, key=lambda z: z[2]))
            cur = []
        cur.append(b)
    if cur:
        rows.append(sorted(cur, key=lambda z: z[2]))
    return [b for row in rows for b in row]


def solidify(ink, close_px):
    """Flat, solid silhouette: fill every interior white EXCEPT the face.

    Fill-what-is-enclosed alone is not enough, because plenty of the highlight
    strokes vent out to the silhouette edge and so are not enclosed at all. So
    the mask is closed first (bridging those channels shut), everything inside
    the result is filled, and then the one opening that must survive — the face
    — is punched back out. Protecting the face explicitly rather than hoping it
    stays open is what makes this safe to run at a fill-everything strength.

    The union with the original ink restores the spiky outlines that closing
    rounds off, so a hedgehog style stays a hedgehog.
    """
    def attempt(k):
        st = np.ones((max(2, int(k)), max(2, int(k))), bool)
        closed = ndimage.binary_closing(ink, st)
        face = face_hole(closed)
        out = ndimage.binary_fill_holes(closed)
        if face is not None:
            out &= ~face
        return out | ink

    # A heavily textured style — an afro's lobes, a style with ear buns — has
    # deep bays in its outline. Close it too hard and neighbouring lobes bridge,
    # the fill floods the bays, and a curly silhouette comes out a rectangle.
    # Back the radius off until the result stops being much bigger than the ink.
    base = ink.sum()
    for k in (close_px, close_px * 0.6, close_px * 0.35, 2):
        out = attempt(k)
        if out.sum() <= 1.55 * base:
            return out
    return ndimage.binary_fill_holes(ink) | ink


def strip_jaw(solid):
    """Drop any jaw/chin outline, keeping only the hair mass.

    Some styles are drawn as a face: a thin arc traces the jaw and the hair
    sits on top of it. The rig draws its own head, so that arc has to go or the
    runner gets a second chin. It is found by thinness — an opening removes
    strokes narrower than the brush and leaves the hair mass — then filtered to
    shapes that are WIDE, FLAT and LOW, which is what a jaw is. Braids,
    ponytails and spikes are thin too but tall and narrow, so they survive.
    """
    h, w = solid.shape
    r = max(3, int(w * 0.035))
    st = np.ones((r, r), bool)
    thin = solid & ~ndimage.binary_opening(solid, st)
    lab, n = ndimage.label(thin)
    out = solid.copy()
    for i in range(1, n + 1):
        comp = lab == i
        ys, xs = np.where(comp)
        bw = xs.max() - xs.min() + 1
        bh = ys.max() - ys.min() + 1
        if bw > 0.34 * w and bh < 0.9 * bw and ys.mean() > 0.42 * h:
            out &= ~comp
    # Removing the arc can orphan specks that were only attached through it.
    lab, n = ndimage.label(out)
    if n > 1:
        sizes = ndimage.sum(out, lab, range(1, n + 1))
        keep = np.argmax(sizes) + 1
        out &= (lab == keep) | (ndimage.sum(out, lab, range(1, n + 1))[lab - 1]
                                > 0.06 * sizes.max()) & out
    return out


def fringe_bottom(mask):
    """Row where the forehead fringe ends — the style's own hairline.

    Measured down the centre columns only: that is the band that crosses the
    forehead. Scanning stops at the first row the fringe stops covering, so a
    curtain part or a face opening below it is not mistaken for more fringe.
    """
    h, w = mask.shape
    c0, c1 = int(w * 0.32), int(w * 0.68)
    band = mask[:, c0:c1]
    # Per column, how far the hair runs unbroken down from the top. Averaging
    # coverage across the band instead was the bug behind every fringe that
    # sat on the eyes: a ragged or spiky fringe drops below any coverage
    # threshold within a few rows, so the whole style measured as having
    # practically no fringe and got placed low to compensate.
    depths = []
    for j in range(band.shape[1]):
        col = band[:, j]
        k = 0
        while k < h and col[k]:
            k += 1
        if k:
            depths.append(k)
    if not depths:
        # Centre-parted, so nothing reaches the top of the centre band.
        return int(h * 0.10)
    # High percentile, not the mean: it is the DEEPEST tips that reach the
    # eyes, so those are what has to clear the brow.
    return max(int(np.percentile(depths, 80)), int(h * 0.10))


def fit_cap(mask):
    """Placement for a style with no usable face opening.

    Scale comes from the CROWN, not from the sprite. On anything long the
    widest point is the hair falling past the jaw, so sizing by total width
    shrinks the part that actually has to sit on the skull and the style ends
    up looking small and perched. Measuring the top band instead makes a long
    style and a cropped one land on the same skull.
    """
    h, w = mask.shape
    band = mask[:max(3, int(h * 0.30))]
    rows = band.sum(1)
    rows = rows[rows > 0]
    crown = float(np.percentile(rows, 85)) if len(rows) else float(w)
    scale = (HEAD_WIDTH * 1.08) / max(crown, 1.0)
    W = w * scale
    w_spec = min(max(W / BODY_W, 0.6), 1.6)
    W = w_spec * BODY_W

    # Vertical anchor is the HAIRLINE, not the top of the sprite. Pinning the
    # crown at a fixed y only works if every style carries the same amount of
    # fringe, and they do not — the ones drawn with a heavy fringe hung it over
    # the eyes. Line the bottom of the forehead fringe up with the brow instead
    # and let the crown sit wherever that puts it, which for a voluminous style
    # is above the skull, exactly as it should be.
    s = W / w
    top = BROW_Y - fringe_bottom(mask) * s
    # Floor is the rig's headroom (0.14 of body height) less a margin, so a
    # voluminous style can rise off the skull without being clipped.
    top = max(min(top, 8.0), -0.12 * BODY_H)
    out = {"w": round(w_spec, 3), "top": round(top / BODY_H - HAIR_LIFT, 4)}
    # Centre the CROWN on the skull, not the sprite: a side pony hangs its mass
    # off to one side and would otherwise drag the whole cut off-centre.
    ys, xs = np.where(band)
    if len(xs):
        cx = xs.mean() / w
        left = HEAD_CX - cx * W
        dx = (left - (BODY_W / 2 - W / 2)) / BODY_W
        # Cap the correction. A style whose crown is itself drawn off-centre
        # would otherwise be shoved far enough sideways that its mass lands
        # across the face — worse than the lean it was correcting for.
        dx = max(-0.03, min(0.03, dx))
        if abs(dx) > 0.006:
            out["dx"] = round(dx, 4)
    return out


def looks_like_a_face(hole, w, h):
    """Reject openings that are not a face.

    An afro's bays and the gap between two buns fill the hole test perfectly
    well, and fitting to one of those solves a wildly wrong scale — that is
    what flattened the afro and the bun style into bands across the head. A
    real face opening is centred, sits low, and is not far wider than it is
    tall.
    """
    ys, xs = np.where(hole)
    bw = xs.max() - xs.min() + 1
    bh = ys.max() - ys.min() + 1
    if not (0.55 <= bh / bw <= 2.4):
        return False
    if not (0.3 < xs.mean() / w < 0.7):
        return False
    return ys.mean() / h > 0.35


def is_sprite(sub):
    """Reject sheet artefacts — rules, faint separators, stray specks.

    The sheets carry thin horizontal rules that survive the ink threshold and
    label as their own component; they are the reason sheet 3 first segmented
    into 12 styles instead of 10. A hairstyle is chunky in both axes and fills
    a good share of its own bounding box; a rule fails both.
    """
    h, w = sub.shape
    if h < 0.22 * w or w < 0.22 * h:
        return False
    return sub.mean() > 0.12


def face_hole(mask):
    """The face opening — the interior white that runs off the bottom."""
    closed = mask.copy()
    closed[-1, :] = True
    holes = ndimage.binary_fill_holes(closed) & ~mask
    lab, n = ndimage.label(holes)
    best = None
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() < 0.03 * comp.size:
            continue
        if comp[:, 0].any() or comp[:, -1].any() or comp[0, :].any():
            continue
        if best is None or comp.sum() > best.sum():
            best = comp
    return best


def fit_to_head(art_w, art_h, hole):
    if hole is None or hole.sum() < 0.03 * art_w * art_h:
        return None
    ar = art_h / art_w
    rows = hole.sum(1)
    hole_w = float(np.percentile(rows[rows > 0], 80))
    if hole_w < 4:
        return None
    W = HEAD_WIDTH * art_w / hole_w
    w_spec = min(max(W / BODY_W, 0.55), 1.45)
    W = w_spec * BODY_W
    ys, xs = np.where(hole)
    cx, cy = xs.mean() / art_w, ys.mean() / art_h
    left = HEAD_CX - cx * W
    top = HEAD_CY - cy * W * ar
    out = {"w": round(w_spec, 3), "top": round(top / BODY_H - HAIR_LIFT, 4)}
    dx = (left - (BODY_W / 2 - W / 2)) / BODY_W
    if abs(dx) > 0.006:
        out["dx"] = round(dx, 4)
    return out


def main():
    os.makedirs(CH, exist_ok=True)
    os.makedirs(QA, exist_ok=True)
    sheets = sorted(f for f in os.listdir(SRC) if f.lower().endswith(".png"))
    if not sheets:
        raise SystemExit(f"no sheets in {SRC} - save the three PNGs there first")

    out = []
    n = 0
    for si, name in enumerate(sheets):
        ink = sheet_masks(os.path.join(SRC, name))
        boxes = segment(ink)
        print(f"{name}: {len(boxes)} styles")
        for (y0, y1, x0, x1) in boxes:
            pad = 6
            sub = ink[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad]
            if not is_sprite(sub):
                continue
            # Stroke width scales with the sprite, so the closing radius does too.
            solid = solidify(sub, close_px=max(3, sub.shape[1] * 0.035))
            solid = strip_jaw(solid)
            ys, xs = np.where(solid)
            solid = solid[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

            s = MAX_DIM / max(solid.shape)
            if s < 1:
                im = Image.fromarray((solid * 255).astype(np.uint8), "L")
                im = im.resize((max(1, round(solid.shape[1] * s)),
                                max(1, round(solid.shape[0] * s))), Image.LANCZOS)
                alpha = np.asarray(im)
            else:
                alpha = (solid * 255).astype(np.uint8)

            am = alpha > 128
            hole = face_hole(am)
            if hole is not None and not looks_like_a_face(hole, am.shape[1], am.shape[0]):
                hole = None
            lay = (fit_to_head(alpha.shape[1], alpha.shape[0], hole) if hole is not None
                   else None) or fit_cap(am)
            n += 1
            stem = f"hairS{n}"
            # Keyed by the style's own number, so this has to come after the
            # counter moves — reading it earlier silently shifted every
            # correction onto the following style.
            #
            # Applied after the clamps on purpose: two of these sit against a
            # clamp, so a nudge folded into the solve would be thrown away.
            ws, dy = OVERRIDES.get(n, (1.0, 0.0))
            if ws != 1.0 or dy:
                lay = dict(lay)
                lay["w"] = round(lay["w"] * ws, 3)
                lay["top"] = round(lay["top"] + dy / BODY_H, 4)
            for ci, hexc in enumerate(HAIR_COLORS):
                rgb = np.zeros((*alpha.shape, 4), np.uint8)
                rgb[..., :3] = rgb_of(hexc)
                rgb[..., 3] = alpha
                Image.fromarray(rgb).save(os.path.join(CH, f"{stem}_{ci}.png"))
            Image.fromarray(np.dstack([np.full_like(alpha, 24)] * 3 + [alpha])) \
                .save(os.path.join(QA, f"{stem}.png"))
            ah, aw = alpha.shape
            out.append({"stem": stem, "sheet": name, "layout": lay,
                        "hole": bool(hole is not None),
                        # `bulky` drives the rig's hat rules: a crown-hugging
                        # cap hides a style this tall rather than letting it
                        # jut through the hat outline.
                        "tall": bool(ah > 1.15 * aw),
                        "label": NAMES[n - 1] if n - 1 < len(NAMES) else f"Style {n}"})

    json.dump(out, open(os.path.join(SCRATCH, "hair-sheets.json"), "w"), indent=1)

    # Catalogue module. Colourable like the rest of the hair slot: `art` is the
    # 10 palette variants, indexed by the loadout's hairColor.
    lines = []
    for i, o in enumerate(out):
        art = ", ".join(
            f"require('../../assets/character/hair/{o['stem']}_{c}.png')" for c in range(10))
        lay = ", ".join(f"{k}: {v}" for k, v in o["layout"].items())
        rarity = ["common"] * 6 + ["rare"] * 3 + ["epic"]
        r = rarity[i % len(rarity)]
        unlock = ("free" if r == "common"
                  else f"runs({[3, 5, 8, 10, 15][i % 5]}, 'Finish {[3, 5, 8, 10, 15][i % 5]} runs')"
                  if r == "rare" else f"level({[12, 20, 30][i % 3]})")
        bulky = ", bulky: true" if o["tall"] else ""
        lines.append(
            f"  {{ id: 'hs{i + 1}', label: '{o['label']}', art: [{art}], "
            f"layout: {{ {lay} }}{bulky}, rarity: '{r}', unlock: {unlock} }},")

    hdr = '''// GENERATED — silhouette hair sheets (scripts/install-hair-sheets.py).
//
// Cut from three sheets of black hairstyle silhouettes. The source art carried
// white highlight strokes of wildly different weights; those are filled so
// every style reads as one flat mass, matching the rest of the slot. Any jaw
// outline drawn around the face was stripped — the rig draws its own head.
//
// Colourable: `art` is the 10 HAIR_COLORS variants, same as the hand-authored
// hair. Placement was solved per style off the face opening (or off the skull
// width, for cuts that sit on the head rather than framing it).

const free = null;
const runs = (n, label) => ({ stat: 'runs_count', value: n, label });
const level = (n) => ({ stat: 'level', value: n, label: `Reach level ${n}` });

export const HAIR_SHEETS = [
''' + "\n".join(lines) + "\n];\n"
    cfg = os.path.join(os.path.dirname(SCRATCH), "src", "config", "hairSheetItems.js")
    open(cfg, "w", encoding="utf-8").write(hdr)

    caps = sum(1 for o in out if not o["hole"])
    print(f"\n{n} styles -> {n * 10} files ({caps} placed off skull width, "
          f"{n - caps} off the face opening)")
    print(f"  catalogue -> {cfg}")


if __name__ == "__main__":
    main()
