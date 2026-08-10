"""strip-body-parts.py — take the drawn BODY out of the outfit art.

The ofT / ofB / ofS / shoe art was cut out of full-body character renders, so
every piece still carries the model wearing it: arms and hands hanging out of
the sleeves, a neck above the collar, bare legs and feet under the hem. Once
the rig composites the piece over its own body those baked limbs sit on top of
the real ones in a slightly different cream, at a slightly different shape.

This pass deletes them, leaving the garment alone.

How it decides what is body:

  * The art is flat cartoon fill bounded by black ink, so it segments cleanly
    into ink-bounded REGIONS (`seg_regions`). Skin is always its own region —
    the sleeve hem, the collar and the trouser hem are drawn strokes.
  * Every item carries the `layout` it was measured at, so the rig's own body
    art can be mapped back into the item's pixel grid exactly (`body_in_item`).
    That gives the limb zones — where an arm, a leg, a neck can possibly be.
  * A region is body if its colour sits in the skin window AND it lands in a
    zone where skin is possible. Colour alone is not enough (a cream tee is as
    light and as warm as an arm) and position alone is not enough (a sleeve
    fills the arm zone) — it takes both.
  * The winning skin colour is then fixed PER IMAGE: one render has one skin
    tone, so once the best-scoring cluster is picked every other region of that
    colour goes too. That is what catches the small stuff — knuckles, an ear of
    midriff, a sliver of ankle — which is too small to score on its own.

Ink is removed by ownership, not by colour: an ink pixel goes if the nearest
surviving garment fill is further away than the nearest deleted skin fill. The
sleeve hem has garment on one side, so it stays; an arm outline has skin on
both sides, so it goes.

Originals live in assets/character/_src/ and are never written to, so this is
re-runnable. Overrides for the handful the score gets wrong are in
BODY_OVERRIDES / KEEP_OVERRIDES at the bottom.

Usage:
    python scripts/strip-body-parts.py            # write assets + QA sheets
    python scripts/strip-body-parts.py --qa-only  # QA sheets only
    python scripts/strip-body-parts.py --only o12t,o3b
"""

import argparse
import colorsys
import json
import os
import re
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.dirname(HERE)
CHAR = os.path.join(FRONTEND, "assets", "character")
SRC = os.path.join(CHAR, "_src")
QA = os.path.join(HERE, "qa-strip")

# --- rig geometry (mirrors CharacterRig.js) --------------------------------
BODY_W, BODY_H = 248, 640
SHOULDER_Y = 214          # shoulders, from build-body-2.py
CROTCH_Y = 450            # legs split below here
CHIN_Y = 213              # HEAD_CHIN in the rig
BASE_LAYOUT = {
    "top": {"w": 0.9718, "top": 0.3169},
    "bottom": {"w": 0.62, "top": 0.554},
    "onepiece": {"w": 0.62, "top": 0.4197},
    "footwear": {"w": 0.66, "top": 0.9297},
}
FIT_OF_SUFFIX = {"t": "top", "b": "bottom", "o": "onepiece", "f": "footwear"}

# --- skin window -----------------------------------------------------------
# Measured off the hands, forearms and calves across the batch: light, warm,
# weakly saturated. The renders are not one consistent character — the tone
# runs from a near-white cream (253,246,235) to a tan (253,200,154) — so the
# window has to be wide, and position does the rest of the work.
SKIN_HUE = (14.0, 48.0)       # degrees
SKIN_SAT = (0.045, 0.42)
SKIN_VAL = 0.85
# Only the black CORE of a stroke counts as outline. This has to stay low: the
# art's blacks are drawn at luma ~40 (a black tee is (40,40,40), a navy jacket
# (49,58,76)) and the outline itself at 0-5, so a threshold anywhere near the
# garment values turns every dark garment into "outline" and the ink-ownership
# pass then deletes the whole thing. The 1-2px anti-aliased ramp either side of
# a stroke lands in fill, which is harmless — the black core still separates
# the two sides, and region colours are taken as medians.
INK_THR = 32
INK_RAMP = 120                # the stroke's soft edge, only next to a core
INK_RAMP_PX = 3


def hsv(rgb):
    r, g, b = [v / 255.0 for v in rgb]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    return h * 360.0, s, v


def in_skin_window(rgb):
    h, s, v = hsv(rgb)
    return (SKIN_HUE[0] <= h <= SKIN_HUE[1] and SKIN_SAT[0] <= s <= SKIN_SAT[1]
            and v >= SKIN_VAL)


# --- segmentation ----------------------------------------------------------
def seg_regions(a):
    """Ink = the stroke's black core plus its anti-aliased ramp.

    The ramp has to be counted as ink. Left in `fill` it becomes a hairline
    region of its own, one that is neither skin-coloured nor garment, and it
    then keeps the whole outline alive — a leg comes out and its contour stays
    behind as a filament hanging off the hem. Reaching outward from the core
    catches the ramp while leaving a dark garment (which is dark everywhere,
    not just beside a stroke) as fill.
    """
    rgb = a[..., :3].astype(int)
    opaque = a[..., 3] > 128
    luma = rgb @ [0.299, 0.587, 0.114]
    core = (luma < INK_THR) & opaque
    ramp = (luma < INK_RAMP) & opaque
    ink = core | (ramp & ndimage.binary_dilation(core, iterations=INK_RAMP_PX))
    fill = opaque & ~ink
    lab, n = ndimage.label(fill)
    return lab, n, ink, opaque


def region_stats(a, lab, n):
    if n == 0:
        return []
    rgb = a[..., :3].astype(int)
    counts = np.bincount(lab.ravel(), minlength=n + 1)[1:]
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None or counts[i - 1] == 0:
            continue
        sub = lab[sl] == i
        med = np.median(rgb[sl][sub], axis=0)
        ys, xs = np.nonzero(sub)
        y0, x0 = sl[0].start, sl[1].start
        out.append(dict(id=i, n=int(counts[i - 1]),
                        rgb=tuple(int(v) for v in med),
                        bbox=(x0 + int(xs.min()), y0 + int(ys.min()),
                              x0 + int(xs.max()), y0 + int(ys.max()))))
    out.sort(key=lambda d: -d["n"])
    return out


# --- body zones ------------------------------------------------------------
_BODY = None


def body_art():
    global _BODY
    if _BODY is None:
        _BODY = np.array(Image.open(os.path.join(CHAR, "body", "body.png"))
                         .convert("RGBA"))
    return _BODY


def body_zones():
    """Masks in rig space for where bare skin can appear on the rig's body.

    `arms` is the silhouette outside the torso column below the shoulders —
    the only place a hand or forearm can be. `legs` is everything below the
    crotch, `neck` the sliver between chin and shoulders, `torso` the rest.
    """
    al = body_art()[..., 3] > 128
    ys, xs = np.nonzero(al)
    zones = {}
    torso_half = 62  # half-width of the trunk, measured off the art
    cx = BODY_W // 2
    col = np.zeros_like(al)
    col[:, cx - torso_half:cx + torso_half] = True
    zones["arms"] = al & ~col
    zones["arms"][:SHOULDER_Y] = False
    zones["arms"][CROTCH_Y:] = False
    zones["legs"] = al.copy()
    zones["legs"][:CROTCH_Y] = False
    zones["neck"] = al.copy()
    zones["neck"][:CHIN_Y - 24] = False
    zones["neck"][SHOULDER_Y + 16:] = False
    zones["torso"] = al & col
    zones["torso"][:SHOULDER_Y] = False
    zones["torso"][CROTCH_Y:] = False
    zones["body"] = al
    return zones


def to_item_space(mask, size, layout):
    """Resample a rig-space (248x640) mask into an item's pixel grid."""
    iw, ih = size
    w = layout["w"] * BODY_W
    h = w * (ih / iw)
    left = BODY_W / 2 - w / 2 + layout.get("dx", 0) * BODY_W
    top = layout["top"] * BODY_H
    pad = 1000
    src = Image.fromarray((mask * 255).astype(np.uint8))
    padded = Image.new("L", (BODY_W + 2 * pad, BODY_H + 2 * pad), 0)
    padded.paste(src, (pad, pad))
    crop = padded.crop((int(round(left)) + pad, int(round(top)) + pad,
                        int(round(left + w)) + pad, int(round(top + h)) + pad))
    return np.array(crop.resize((iw, ih), Image.BILINEAR)) > 100


# --- catalogue -------------------------------------------------------------
ITEM_RE = re.compile(
    r"\{\s*id:\s*'([^']+)'.*?img:\s*require\('([^']+)'\).*?layout:\s*\{([^}]*)\}",
    re.S)


def catalogue():
    src = open(os.path.join(FRONTEND, "src", "config", "outfitItems.js"),
               encoding="utf8").read()
    items = []
    for m in ITEM_RE.finditer(src):
        iid, rel, lay = m.groups()
        rel = rel.replace("../../assets/character/", "").replace("/", os.sep)
        layout = {k: float(v) for k, v in re.findall(r"(\w+):\s*(-?[\d.]+)", lay)}
        items.append(dict(id=iid, rel=rel, layout=layout,
                          fit=FIT_OF_SUFFIX[iid[-1]]))
    return items


# --- the pass --------------------------------------------------------------
def analyse(item):
    path = os.path.join(SRC, item["rel"])
    a = np.array(Image.open(path).convert("RGBA"))
    lab, n, ink, opaque = seg_regions(a)
    stats = region_stats(a, lab, n)
    layout = dict(BASE_LAYOUT[item["fit"]])
    layout.update(item["layout"])
    ih, iw = a.shape[:2]
    zones = {k: to_item_space(v, (iw, ih), layout)
             for k, v in body_zones().items()}
    return a, lab, ink, opaque, stats, zones


# A seed has to sit almost entirely in one limb zone. The neck bar is short and
# a collar overlaps it, so it gets a looser bar than a whole arm or leg.
SEED_ZONES = {"arms": 0.80, "legs": 0.80, "neck": 0.55}
SEED_MIN_FRAC = 0.004      # of the item's opaque area
# The torso is the one zone a garment legitimately fills, so bare skin there —
# the midriff under a crop top, the chest inside an open jacket — only counts
# as a seed while it stays a patch. A cream tee covers half the item; a strip
# of stomach never does.
TORSO_SEED_MAX_FRAC = 0.14
TORSO_SEED_ZONE = 0.90
SPREAD_MAX_FRAC = 0.10     # colour-match alone may only carry off small patches
FOOT_STUMP_H = 0.30        # an ankle stump's height, as a share of the cut
FOOT_STUMP_FRAC = 0.20
COLOUR_TOL = 14            # max per-channel distance to the winning skin tone
MAX_STRIP_FRAC = 0.72      # refuse to gut an item; flag it for review instead


def seed_ok(item, m, area, zones, shape, frac=0.0, biggest=False):
    """Is this region sitting somewhere only bare skin can be?

    Footwear is its own case. A shoe cut lives entirely inside the leg zone, so
    the zone test passes for the shoe itself and a cream trainer scores as an
    ankle. What is actually true of the skin in these cuts is that it is a
    STUMP — the leg was severed by the crop, so bare ankle always runs off the
    top edge of the frame. A shoe never does.
    """
    if item["fit"] == "footwear":
        h = shape[0]
        ys = np.nonzero(m.any(axis=1))[0]
        # A bare ankle in a shoe cut is a STUMP: it runs off the top edge of
        # the frame (the crop severed the leg) and it is short and small. A
        # shoe's upper also reaches the top of a tightly-cropped frame, which
        # is why touching the edge cannot be the whole test — without the size
        # and height bounds every white trainer reads as an ankle and the pass
        # deletes the shoe instead of the leg.
        return (ys[0] <= max(2, 0.04 * h)
                and (ys[-1] - ys[0]) <= FOOT_STUMP_H * h
                and frac <= FOOT_STUMP_FRAC)
    if any((m & zones[z]).sum() / area >= bar for z, bar in SEED_ZONES.items()):
        return True
    return (not biggest and frac <= TORSO_SEED_MAX_FRAC
            and (m & zones["torso"]).sum() / area >= TORSO_SEED_ZONE)


def find_skin(item, a, lab, opaque, stats, zones):
    """Return (skin_region_ids, winning_rgb, seed_ids).

    Two steps, and the order matters. SEEDS are regions confident enough on
    their own — right colour, and sitting wholly inside a zone where only bare
    skin can be (an arm below the shoulder, a leg, the neck bar). The largest
    seed colour becomes THE skin tone for this render, and every other region
    within COLOUR_TOL of it goes too, wherever it sits. That second step is
    what removes the midriff under a crop top and the knuckles poking past a
    cuff — patches far too small, or too central, to trust on their own.
    """
    opaque_n = max(1, int(opaque.sum()))
    biggest_id = stats[0]["id"] if stats else None
    seeds = []
    for d in stats:
        if d["n"] < SEED_MIN_FRAC * opaque_n or not in_skin_window(d["rgb"]):
            continue
        m = lab == d["id"]
        area = m.sum()
        # Footwear has no limb zones of its own — the whole cut sits inside the
        # leg zone — so it goes straight to its own stump test.
        limb = (item["fit"] != "footwear"
                and any((m & zones[z]).sum() / area >= bar
                        for z, bar in SEED_ZONES.items()))
        if limb or seed_ok(item, m, area, zones, a.shape[:2],
                           frac=d["n"] / opaque_n, biggest=d["id"] == biggest_id):
            seeds.append(dict(d, limb=limb))
    if not seeds:
        return set(), None, []

    # Cluster the seeds by colour and let the biggest cluster win.
    clusters = []
    for d in sorted(seeds, key=lambda d: -d["n"]):
        for c in clusters:
            if max(abs(np.array(d["rgb"]) - np.array(c["rgb"]))) <= COLOUR_TOL:
                c["n"] += d["n"]
                c["ids"].append(d["id"])
                c["limb"] = c["limb"] or d["limb"]
                break
        else:
            clusters.append(dict(rgb=d["rgb"], n=d["n"], ids=[d["id"]],
                                 limb=d["limb"]))
    # A cluster with a limb behind it beats a torso-only one however big the
    # torso patch is — an open jacket showing a lot of shirt should never
    # outvote a pair of hands.
    win = max(clusters, key=lambda c: (c["limb"], c["n"]))

    body = zones["body"]
    skin = set(win["ids"])
    for d in stats:
        if d["id"] in skin:
            continue
        if max(abs(np.array(d["rgb"]) - np.array(win["rgb"]))) > COLOUR_TOL:
            continue
        m = lab == d["id"]
        area = m.sum()
        if (m & body).sum() / max(1, area) < 0.6:
            continue          # off the body entirely — not a limb
        # Spreading may only pick up patches, or regions that would have
        # qualified as a seed themselves. Without this a cream skirt over cream
        # legs, or beige jeans under a beige cuff, gets swallowed by the tone
        # its own wearer happens to share — the item loses its garment and
        # keeps the body, exactly backwards.
        if not (d["n"] <= SPREAD_MAX_FRAC * opaque_n
                or seed_ok(item, m, area, zones, a.shape[:2],
                           frac=d["n"] / opaque_n, biggest=d["id"] == biggest_id)):
            continue
        skin.add(d["id"])
    return skin, win["rgb"], win["ids"]


def stroke_radius(ink):
    """Half the outline width, from the distance transform inside the ink."""
    if not ink.any():
        return 4.0
    dt = ndimage.distance_transform_edt(ink)
    return float(np.percentile(dt[ink], 96))


def drop_orphan_outlines(keep, garment_fill, min_fill=0.12):
    """Bin surviving pieces that are outline and nothing else.

    Taking a leg out leaves its drawn contour behind wherever a scrap of the
    limb's shading survived the region split — a pair of long thin strokes
    hanging under the hem. A real garment part always carries fill inside its
    contour, so a component that is nearly all stroke is a leftover.
    """
    lab, n = ndimage.label(keep)
    if n == 0:
        return keep
    tot = np.bincount(lab.ravel(), minlength=n + 1)[1:]
    filled = np.bincount(lab[garment_fill].ravel(), minlength=n + 1)[1:]
    bad = [i + 1 for i in range(n) if filled[i] / max(1, tot[i]) < min_fill]
    if bad:
        keep = keep & ~np.isin(lab, bad)
    return keep


def drop_stranded_parts(keep, min_share=0.15, speck=0.02):
    """Drop pieces the body was the only thing holding on.

    A bottom cut carries the socks and shoes the model was wearing; they hung
    off the garment only through the legs, so once the legs go they float in
    mid-air over whatever footwear the player has equipped.

    Position matters, not just size: only debris left BELOW the garment counts.
    An inner layer — the white tee inside an open jacket — is often joined to
    the rest of the item solely through the patch of chest between the lapels,
    and it must survive losing that patch.
    """
    lab, n = ndimage.label(keep)
    if n <= 1:
        return keep
    sizes = np.bincount(lab.ravel(), minlength=n + 1)[1:]
    main = int(sizes.argmax()) + 1
    main_bottom = np.nonzero(lab == main)[0].max()
    bad = []
    for i in range(1, n + 1):
        if i == main:
            continue
        share = sizes[i - 1] / sizes[main - 1]
        if share < speck:
            bad.append(i)
        elif share < min_share and np.nonzero(lab == i)[0].min() >= main_bottom:
            bad.append(i)
    if bad:
        keep = keep & ~np.isin(lab, bad)
    return keep


def strip(a, lab, ink, opaque, skin_ids, fit=None):
    """Delete the skin fills and the outlines that belong to them.

    Ink is kept by ownership rather than by colour: an outline survives if a
    surviving garment fill is within a stroke's reach of it. The sleeve hem has
    garment on one side so it stays; an arm's own outline has skin on both
    sides and nothing else nearby, so it goes with the arm.
    """
    fill = opaque & ~ink
    skin_fill = np.isin(lab, list(skin_ids)) if skin_ids else np.zeros_like(fill)
    garment_fill = fill & ~skin_fill
    r = max(3.0, stroke_radius(ink))
    dist_g = ndimage.distance_transform_edt(~garment_fill)
    dist_s = (ndimage.distance_transform_edt(~skin_fill) if skin_fill.any()
              else np.full(dist_g.shape, 1e6, np.float32))
    # Nearer-owner wins, with a one-stroke grace band so a garment's own
    # contour is never thinned. A plain radius alone left the arm contour
    # hanging off the sleeve as a hook, because that contour runs right
    # alongside the garment it was drawn against.
    keep_ink = ink & (dist_g <= r * 1.6) & ((dist_g <= r * 1.15) | (dist_g < dist_s))
    keep = garment_fill | keep_ink

    # Close pinholes the region split leaves along anti-aliased edges, then
    # feather so the new silhouette is not stair-stepped.
    keep = ndimage.binary_closing(keep, np.ones((3, 3)))
    keep = drop_orphan_outlines(keep, garment_fill)
    # Not for footwear: a pair is already two separate components, and the far
    # shoe in a three-quarter view is small enough to look like debris.
    if skin_fill.any() and fit != "footwear":
        keep = drop_stranded_parts(keep)
    soft = ndimage.gaussian_filter(keep.astype(np.float32), 0.7)
    out = a.copy()
    out[..., 3] = np.clip(a[..., 3].astype(np.float32) * np.clip(soft * 1.35, 0, 1),
                          0, 255).astype(np.uint8)
    return out, skin_fill, keep


# The handful the score gets wrong, corrected by eye off the QA sheets. Each
# entry is a list of (x, y) points in the ORIGINAL art's pixels: whichever
# region contains that pixel is forced to body (BODY_OVERRIDES) or protected as
# garment (KEEP_OVERRIDES). Points rather than region numbers — labels are
# assigned by scan order and would silently point somewhere else the next time
# a threshold moves.
BODY_OVERRIDES = {
    # Cream-on-cream cuts, where the model's tone and the garment's are the
    # same paint. The vote lands on whichever is larger, so these say which is
    # which by hand.
    "o11b": [(51, 132), (440, 132)],          # hands beside the cargo pants
    "o33b": [(48, 150), (438, 150)],          # hands beside the chinos
    "o42b": [(51, 198), (409, 199)],          # hands beside the chinos
    "o82b": [(170, 247), (339, 247)],         # bare thighs under the skirt
    "o83b": [(160, 250), (330, 250)],         # bare thighs under the skirt
}
KEEP_OVERRIDES = {
    "o75t": [(226, 195), (321, 152), (132, 152)],  # the shirt inside the varsity
}


def region_at(lab, pt):
    x, y = pt
    if 0 <= y < lab.shape[0] and 0 <= x < lab.shape[1]:
        v = int(lab[y, x])
        if v:
            return v
    return None


def process(item, write=True):
    a, lab, ink, opaque, stats, zones = analyse(item)
    skin_ids, rgb, seed_ids = find_skin(item, a, lab, opaque, stats, zones)
    skin_ids = set(skin_ids)
    for pt in KEEP_OVERRIDES.get(item["id"], []):
        skin_ids.discard(region_at(lab, pt))
    for pt in BODY_OVERRIDES.get(item["id"], []):
        r = region_at(lab, pt)
        if r:
            skin_ids.add(r)
    out, skin_fill, keep = strip(a, lab, ink, opaque, skin_ids, item["fit"])
    # Judge on what actually disappears, not on the skin fill alone — the ink
    # and stranded-part passes remove more than they were handed, and an item
    # that loses most of itself is a misread, not a naked model.
    stripped = 1.0 - float((out[..., 3] > 128).sum()) / max(1, int(opaque.sum()))
    flagged = stripped > MAX_STRIP_FRAC
    if flagged:
        skin_ids = set()
        out, skin_fill, keep = strip(a, lab, ink, opaque, skin_ids, item["fit"])
    if write and not flagged:
        Image.fromarray(out).save(os.path.join(CHAR, item["rel"]))
    return dict(id=item["id"], rgb=rgb, n_skin=len(skin_ids),
                stripped=round(stripped, 3), flagged=bool(flagged),
                src=a, out=out, skin=skin_fill)


def qa_sheet(results, name, cols=8, cell=190):
    """Contact sheet: what goes (magenta) and what the item becomes.

    Magenta rather than red — a fair number of these garments ARE red, and a
    red overlay on a red shoe is unreadable.
    """
    from PIL import ImageDraw
    rows = (len(results) + cols - 1) // cols
    sh = Image.new("RGB", (cols * cell, rows * cell), (204, 209, 219))
    dr = ImageDraw.Draw(sh)
    for i, r in enumerate(results):
        a, sk = r["src"], r["skin"]
        base = np.full(a.shape[:2] + (3,), 255, np.uint8)
        al = a[..., 3:4] / 255.0
        base = (base * (1 - al) + a[..., :3] * al).astype(np.uint8)
        base[sk] = (255, 0, 220)
        im = Image.fromarray(base)
        im.thumbnail((cell - 24, cell - 26))
        x, y = i % cols * cell, i // cols * cell
        sh.paste(im, (x + (cell - im.width) // 2, y + 18))
        dr.text((x + 6, y + 4), "%s%s" % (r["id"], " FLAG" if r["flagged"] else ""),
                fill=(20, 20, 20))
    sh.save(os.path.join(QA, name))


def qa_after(results, name, cols=8, cell=190):
    """The same items as they will ship — garment only, over a neutral card."""
    from PIL import ImageDraw
    rows = (len(results) + cols - 1) // cols
    sh = Image.new("RGB", (cols * cell, rows * cell), (204, 209, 219))
    dr = ImageDraw.Draw(sh)
    for i, r in enumerate(results):
        o = r["out"]
        base = np.full(o.shape[:2] + (3,), 255, np.uint8)
        al = o[..., 3:4] / 255.0
        base = (base * (1 - al) + o[..., :3] * al).astype(np.uint8)
        im = Image.fromarray(base)
        im.thumbnail((cell - 24, cell - 26))
        x, y = i % cols * cell, i // cols * cell
        sh.paste(im, (x + (cell - im.width) // 2, y + 18))
        dr.text((x + 6, y + 4), r["id"], fill=(20, 20, 20))
    sh.save(os.path.join(QA, name))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--qa-only", action="store_true")
    args = ap.parse_args()
    os.makedirs(QA, exist_ok=True)
    items = catalogue()
    if args.only:
        want = set(args.only.split(","))
        items = [i for i in items if i["id"] in want]
    by_fit = {}
    report = []
    for it in items:
        r = process(it, write=not args.qa_only)
        by_fit.setdefault(it["fit"], []).append(r)
        report.append({k: v for k, v in r.items() if k not in ("src", "out", "skin")})
        if r["flagged"]:
            print("  FLAGGED (left untouched):", it["id"], r["stripped"])
    for fit, rs in by_fit.items():
        for i in range(0, len(rs), 40):
            qa_sheet(rs[i:i + 40], "qa-%s-%02d.png" % (fit, i // 40))
            qa_after(rs[i:i + 40], "after-%s-%02d.png" % (fit, i // 40))
    json.dump(report, open(os.path.join(QA, "report.json"), "w"), indent=1)
    n_hit = sum(1 for r in report if r["n_skin"])
    print("%d items, %d had body art removed, %d flagged"
          % (len(report), n_hit, sum(1 for r in report if r["flagged"])))


if __name__ == "__main__":
    main()
