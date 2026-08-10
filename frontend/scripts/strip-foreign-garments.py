"""strip-foreign-garments.py — take the OTHER slots' clothes out of each cut.

Second pass after strip-body-parts.py, which removed the model. What is left is
still not one garment: the cuts were sliced out of whole outfits, so a top
carries the shorts that were worn under it, a bottom carries the shirt above it
and the trainers below it, and a shoe carries the trouser cuff it was worn with.
Each of those doubles up with whatever the player actually has equipped in that
slot — two pairs of shorts, a shirt through a jacket, a cuff floating over bare
shins.

How a foreign garment is identified — without guessing where a waist is:

  Every source render was cut into a matching set (`o12t` / `o12b` / `o12f`, or
  `o53o` / `o53f`), so the shorts baked into a top ARE the sibling bottom, drawn
  in the same paint at the same place on the same body. So a region is foreign
  when it matches a SIBLING's own garment colour and sits in the rig-space band
  that sibling occupies. Nothing here depends on a hem height, which is what
  makes it safe for a long coat: the coat is the top's own main garment, it does
  not match the sibling bottom's colour, and it is not removed for hanging low.

Run order — this reads what strip-body-parts.py wrote and writes over it, so:

    python scripts/strip-body-parts.py
    python scripts/strip-foreign-garments.py

Re-running strip-body-parts.py re-reads the pristine _src and undoes this pass;
re-run this one after it. Suits are deliberately left alone: their boots read as
part of the costume, not as leakage.
"""

import argparse
import collections
import importlib.util
import json
import os
import re

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location(
    "sbp", os.path.join(HERE, "strip-body-parts.py"))
sbp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sbp)

BODY_H = sbp.BODY_H
BODY_W = sbp.BODY_W
QA = os.path.join(HERE, "qa-foreign")

# A region has to be a real garment part to count as evidence of what a slot
# shows. The bar for being REMOVED is lower, because a pair of shorts arrives
# as two regions, one per leg — at the evidence bar each half is too small to
# be seen at all, which is how baked-on shorts were surviving.
MIN_FRAC = 0.03
# Low on purpose: what is left of a removed jacket is its trim — a strap end, a
# cuff, a button placket — each a fraction of a percent, and each one enough to
# leave hooks floating over the garment that survived.
TARGET_MIN_FRAC = 0.002
COLOUR_TOL = 20          # looser than the skin pass: this compares two separate
                         # cuts of the same paint, which drift by a few levels
BAND_OVERLAP = 0.70      # of the region, inside the sibling's own band
# Where the rig starts drawing the equipped shoe (footwear layout top, in rig
# rows). Anything below this in a top or bottom cut is on the foot.
SHOE_LINE = sbp.BASE_LAYOUT["footwear"]["top"] * BODY_H
MAX_STRIP_FRAC = 0.93     # only a guard against blanking an item entirely
CLEAR_OF_OWN = 0.90      # a region this far outside the garment's own band is
                         # not part of it, whatever it is painted

# Which slots can leak into which. A top can pick up the bottom and the shoes,
# never the other way round for its own kind.
FOREIGN_OF = {"top": ("bottom", "footwear"),
              "bottom": ("top", "footwear"),
              "footwear": ("bottom", "top")}


def rig_band(item, ys, shape):
    """Convert a row range in item pixels to its y band on the 248x640 rig."""
    ih, iw = shape
    layout = dict(sbp.BASE_LAYOUT[item["fit"]])
    layout.update(item["layout"])
    w = layout["w"] * BODY_W
    h = w * (ih / iw)
    top = layout["top"] * BODY_H
    return top + ys[0] / ih * h, top + ys[-1] / ih * h


def profile(item):
    """Every surviving garment region of one item: colour, size, rig band."""
    path = os.path.join(sbp.CHAR, item["rel"])
    a = np.array(Image.open(path).convert("RGBA"))
    lab, n, ink, opaque = sbp.seg_regions(a)
    stats = sbp.region_stats(a, lab, n)
    tot = max(1, int(opaque.sum()))
    out = []
    for d in stats:
        if d["n"] < TARGET_MIN_FRAC * tot:
            continue
        ys = np.nonzero((lab == d["id"]).any(axis=1))[0]
        lo, hi = rig_band(item, ys, a.shape[:2])
        out.append(dict(id=d["id"], rgb=list(d["rgb"]),
                        frac=d["n"] / tot, lo=lo, hi=hi))
    return a, lab, opaque, ink, out


# Where each slot's garment actually lives on the rig, as rows of 640. These
# are cores, not extents — deliberately clear of the overlap zones, so a shirt
# hanging into the top of a bottom cut cannot claim to be the trousers.
SLOT_CORE = {"top": (210, 360), "bottom": (430, 580), "footwear": (600, 640)}
CORE_HIT = 0.35
CORE_GUARD = 0.10


def core_overlap(item, r):
    core = SLOT_CORE.get(item["fit"])
    if not core:
        return 1.0
    return (max(0.0, min(r["hi"], core[1]) - max(r["lo"], core[0]))
            / max(1.0, r["hi"] - r["lo"]))


def own_regions(item, regs):
    """The item's own garment: the biggest cluster sitting where it belongs.

    Both halves matter. Colour clustering has to come first, because a pair of
    shorts is two regions (one per leg) while the shirt above it is one, and on
    raw region area the shirt wins the bottom cut. And the winner has to be
    anchored anatomically, because in a bottom cut the shirt above is often
    simply BIGGER than the shorts — picked on area alone the pass would keep
    the shirt and strip the garment the item exists to show.
    """
    if not regs:
        return []
    # Cluster by colour BEFORE picking the winner. A pair of shorts is two
    # regions (one per leg) and the shirt above it is one, so on raw area the
    # shirt wins the bottom cut and the pass then strips the actual garment.
    clusters = []
    for r in sorted((r for r in regs if r["frac"] >= MIN_FRAC),
                    key=lambda r: -r["frac"]):
        for c in clusters:
            if max(abs(np.array(r["rgb"]) - np.array(c["rgb"]))) <= COLOUR_TOL:
                c["frac"] += r["frac"]
                c["regs"].append(r)
                break
        else:
            clusters.append(dict(rgb=r["rgb"], frac=r["frac"], regs=[r]))
    if not clusters:
        # Nothing clears the evidence bar — a cut made entirely of small parts.
        # Fall back to the largest region so the item still has an anchor.
        return [max(regs, key=lambda r: r["frac"])]
    core = SLOT_CORE.get(item["fit"])
    if core:
        def in_core(c):
            lo = min(r["lo"] for r in c["regs"])
            hi = max(r["hi"] for r in c["regs"])
            return max(0.0, min(hi, core[1]) - max(lo, core[0])) / max(1.0, hi - lo)
        anchored = [c for c in clusters if in_core(c) >= CORE_HIT]
        if anchored:
            clusters = anchored
    return max(clusters, key=lambda c: c["frac"])["regs"]


# A garment part standing where this slot's limb isn't. Sleeves in a bottom
# cut are the case that needs it: a lilac sleeve beside lilac joggers is the
# same paint as the garment and overlaps its band, so neither colour nor the
# rig-space band can tell them apart — but only one of them is on an arm.
WRONG_LIMB = {"top": "legs", "bottom": "arms"}
WRONG_LIMB_HIT = 0.80


def find_foreign(item, regs, own, sibling_own, lab=None, zones=None):
    """Regions that are some other slot's garment, seen from this cut."""
    mine = [tuple(r["rgb"]) for r in own]
    own_lo = min(o["lo"] for o in own) if own else 0.0
    own_hi = max(o["hi"] for o in own) if own else float(BODY_H)
    foreign = set()
    for r in regs:
        span = max(1.0, r["hi"] - r["lo"])
        # Anything sitting on the foot is footwear whatever it is painted, and
        # whether or not the sibling shoe happens to match it. The equipped
        # pair is drawn here, so a baked-in shoe can only ever double up. This
        # runs BEFORE the own-garment check on purpose: mint trainers under
        # mint joggers cluster into the joggers' own colour and would otherwise
        # be waved through as part of them.
        if item["fit"] != "footwear":
            if max(0.0, r["hi"] - SHOE_LINE) / span >= BAND_OVERLAP:
                foreign.add(r["id"])
                continue
        limb = WRONG_LIMB.get(item["fit"])
        if limb and zones is not None and zones[limb].any():
            m = lab == r["id"]
            if (m & zones[limb]).sum() / max(1, m.sum()) >= WRONG_LIMB_HIT:
                foreign.add(r["id"])
                continue
        if any(r["id"] == o["id"] for o in own):
            continue
        inside = max(0.0, min(r["hi"], own_hi) - max(r["lo"], own_lo)) / span
        # Clear of the garment altogether — the shirt above a pair of jeans,
        # the shorts under a cropped tee, the socks below either. Whatever it
        # is, this slot is not what draws it, so colour need not be consulted.
        if inside <= 1.0 - CLEAR_OF_OWN:
            foreign.add(r["id"])
            continue
        for sr in sibling_own:
            if max(abs(np.array(r["rgb"]) - np.array(sr["rgb"]))) > COLOUR_TOL:
                continue
            share = max(0.0, min(r["hi"], sr["hi"]) - max(r["lo"], sr["lo"]))
            if share / span < BAND_OVERLAP:
                continue
            # Normally, do not pull out something painted like this garment —
            # a tracksuit top and its bottoms are the same colour, and the
            # top's hem legitimately hangs into the bottom's band. But that
            # protection only applies where the garment actually lives: a
            # lilac sleeve floating beside lilac joggers has no business in a
            # bottom cut whatever it shares with them.
            if (core_overlap(item, r) >= CORE_GUARD
                    and any(max(abs(np.array(r["rgb"]) - np.array(c))) <= COLOUR_TOL
                            for c in mine)):
                continue
            foreign.add(r["id"])
            break
    return foreign


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--qa-only", action="store_true")
    args = ap.parse_args()
    os.makedirs(QA, exist_ok=True)
    items = {i["id"]: i for i in sbp.catalogue()}

    sets = collections.defaultdict(dict)
    for iid in items:
        n, slot = re.match(r"o(\d+)([tbfo])$", iid).groups()
        sets[int(n)][slot] = iid
    slot_fit = {"t": "top", "b": "bottom", "f": "footwear", "o": "onepiece"}

    print("profiling %d items..." % len(items))
    prof, owns = {}, {}
    for iid, it in items.items():
        _, _, _, _, regs = profile(it)
        prof[iid] = regs
        owns[iid] = own_regions(it, regs)

    wanted = set(args.only.split(",")) if args.only else None
    report, qa = [], collections.defaultdict(list)
    for n, group in sorted(sets.items()):
        for slot, iid in group.items():
            fit = slot_fit[slot]
            if fit not in FOREIGN_OF:
                continue          # suits keep their boots
            if wanted and iid not in wanted:
                continue
            sib_own = []
            for other in FOREIGN_OF[fit]:
                sid = group.get({"top": "t", "bottom": "b",
                                 "footwear": "f"}[other])
                if sid and sid != iid:
                    sib_own += owns[sid]
            it = items[iid]
            a, lab, opaque, ink, regs = profile(it)
            layout = dict(sbp.BASE_LAYOUT[it["fit"]])
            layout.update(it["layout"])
            zones = {k: sbp.to_item_space(v, (a.shape[1], a.shape[0]), layout)
                     for k, v in sbp.body_zones().items()}
            foreign = find_foreign(it, regs, owns[iid], sib_own, lab, zones)
            out, removed, keep = sbp.strip(a, lab, ink, opaque, foreign, it["fit"])
            frac = 1.0 - (out[..., 3] > 128).sum() / max(1, int(opaque.sum()))
            # A high share is normal here and not a symptom: a bottom cut that
            # is mostly the tee hanging over it legitimately loses most of its
            # pixels. The guard is only against blanking an item outright.
            flagged = frac > MAX_STRIP_FRAC
            if flagged:
                out, removed, keep = sbp.strip(a, lab, ink, opaque, set(), it["fit"])
                print("  FLAGGED (left untouched):", iid, round(frac, 3))
            elif foreign and not args.qa_only:
                Image.fromarray(out).save(os.path.join(sbp.CHAR, it["rel"]))
            report.append(dict(id=iid, n_foreign=len(foreign),
                               stripped=round(float(frac), 3),
                               flagged=bool(flagged)))
            qa[fit].append(dict(id=iid, src=a, out=out, skin=removed,
                                flagged=bool(flagged)))

    for fit, rs in qa.items():
        for i in range(0, len(rs), 40):
            sbp.QA_DIR = QA
            _sheet(rs[i:i + 40], os.path.join(QA, "qa-%s-%02d.png" % (fit, i // 40)),
                   mark=True)
            _sheet(rs[i:i + 40], os.path.join(QA, "after-%s-%02d.png" % (fit, i // 40)),
                   mark=False)
    json.dump(report, open(os.path.join(QA, "report.json"), "w"), indent=1)
    hit = sum(1 for r in report if r["n_foreign"])
    print("%d items, %d had another slot's clothing removed, %d flagged"
          % (len(report), hit, sum(1 for r in report if r["flagged"])))


def _sheet(rows, path, mark, cols=8, cell=190):
    sh = Image.new("RGB", (cols * cell, ((len(rows) + cols - 1) // cols) * cell),
                   (204, 209, 219))
    dr = ImageDraw.Draw(sh)
    for i, r in enumerate(rows):
        img = r["src"] if mark else r["out"]
        base = np.full(img.shape[:2] + (3,), 255, np.uint8)
        al = img[..., 3:4] / 255.0
        base = (base * (1 - al) + img[..., :3] * al).astype(np.uint8)
        if mark:
            base[r["skin"]] = (255, 0, 220)
        im = Image.fromarray(base)
        im.thumbnail((cell - 24, cell - 26))
        x, y = i % cols * cell, i // cols * cell
        sh.paste(im, (x + (cell - im.width) // 2, y + 18))
        dr.text((x + 6, y + 4), r["id"] + (" FLAG" if r["flagged"] else ""),
                fill=(20, 20, 20))
    sh.save(path)


if __name__ == "__main__":
    main()
