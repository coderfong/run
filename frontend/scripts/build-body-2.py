"""Compose a new body.png from the head + body reference art.

Sources (RGB, white/checkerboard background — no real alpha):
  head : "...01_26_21 AM.png"  two bald heads WITH face features drawn in
  body : "...01_10_19 AM.png"  a headless body on a painted checkerboard

Both are lifted the same way: find the drawing's OUTLINE (the largest ink
component), fill its interior, and keep only ink that falls inside that
silhouette. That sidesteps the checkerboard entirely — no colour-keying, and
the cream fill is painted by us so it matches the palette exactly.

The head's six feature strokes (2 brows, 2 eyes, nose, mouth) are dropped:
the face is a separate rig layer, so the head ships bald.

The two are then stacked with the head's chin overlapping the shoulders, which
is the whole point of the exercise — the old art had a visible neck.

Run from frontend/:  python scripts/build-body-2.py [--preview]
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

SRC = r"C:\Users\user\Desktop\New folder (2)"
HEAD_SRC = os.path.join(SRC, "ChatGPT Image Aug 1, 2026, 01_26_21 AM.png")
BODY_SRC = os.path.join(SRC, "ChatGPT Image Aug 1, 2026, 01_10_19 AM.png")

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(FE, "assets", "character", "body")
QA = os.path.join(FE, "scripts", "qa4")

CREAM = (250, 247, 242)
INK_T = 110          # luminance below this is ink
CANVAS_W, CANVAS_H = 248, 640

# Neck: how much skin shows below the chin before the shoulder line. The
# collar of every top is drawn AT that shoulder line, so this is exactly how
# much neck pokes out of a shirt.
NECK_PX = 1
NECK_TUCK = 14                # shoulders overlap the neck's base by this much
NECK_W_OF_SKULL = 0.42        # neck width as a fraction of the skull

# Skin tones, read off the bodies this replaces so the ladder is unchanged.
SKINS = {
    "body.png": (252, 248, 245),
    "body_0.png": (255, 228, 200),
    "body_1.png": (244, 208, 169),
    "body_2.png": (232, 184, 138),
    "body_3.png": (209, 154, 107),
    "body_4.png": (181, 126, 81),
    "body_5.png": (148, 96, 58),
    "body_6.png": (110, 68, 39),
    "body_7.png": (77, 46, 25),
}


def lift(path, crop=None, drop_features=False):
    """Outline -> filled silhouette -> RGBA sprite (ink + cream, clear outside)."""
    g = np.asarray(Image.open(path).convert("L")).astype(int)
    if crop:
        x0, y0, x1, y1 = crop
        g = g[y0:y1, x0:x1]
    ink = g < INK_T
    lab, n = ndimage.label(ink)
    sizes = ndimage.sum(ink, lab, range(1, n + 1))
    outline = int(np.argmax(sizes)) + 1
    body = ndimage.binary_fill_holes(lab == outline)

    keep = lab == outline
    for i in range(1, n + 1):
        if i == outline:
            continue
        comp = lab == i
        inside = (comp & body).sum() > 0.9 * comp.sum()
        # The head's brows/eyes/nose/mouth are exactly this: ink islands inside
        # the outline. Drop them (the face is its own rig layer). On the body
        # the same test keeps the arm and leg creases.
        if inside and comp.sum() > 40 and not drop_features:
            keep |= comp

    h, w = g.shape
    out = np.zeros((h, w, 4), np.uint8)
    out[body] = (*CREAM, 255)
    # Anti-aliased ink, but ONLY from strokes we kept — deriving it from the
    # raw luminance instead put the dropped face strokes straight back.
    a = np.clip((INK_T + 40 - g) / float(INK_T + 40 - 40), 0, 1)
    a = np.where(ndimage.binary_dilation(keep, np.ones((3, 3))), a, 0)
    for c in range(3):
        out[..., c] = (out[..., c] * (1 - a)).astype(np.uint8)
    out[..., 3] = np.where(body | keep, 255, 0)
    return out


def trim(a):
    ys, xs = np.where(a[..., 3] > 16)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def skull_box(sprite):
    """Head width EXCLUDING the ears, and the full head height.

    The ears show up as extra runs on a row; the skull is the innermost pair,
    so a row with 2 runs is ear-free and its span is real skull width.
    """
    m = sprite[..., 3] > 16
    h, w = m.shape
    widths = []
    for y in range(h):
        r = np.where(m[y])[0]
        if len(r) == 0:
            continue
        runs = np.split(r, np.where(np.diff(r) > 6)[0] + 1)
        if len(runs) <= 2:
            widths.append((y, r.max() - r.min() + 1))
    return (max(x[1] for x in widths) if widths else w), h


def main():
    preview = "--preview" in sys.argv

    # --- head: left of the two, features removed -------------------------
    head = trim(lift(HEAD_SRC, crop=(120, 190, 710, 845), drop_features=True))
    hw, hh = skull_box(head)
    print(f"head sprite {head.shape[1]}x{head.shape[0]}  skull w={hw} h={hh}")

    # --- body ------------------------------------------------------------
    body = trim(lift(BODY_SRC))
    print(f"body sprite {body.shape[1]}x{body.shape[0]}")
    bm = body[..., 3] > 16
    shoulder_w = max((np.where(bm[y])[0].max() - np.where(bm[y])[0].min() + 1)
                     for y in range(0, int(bm.shape[0] * 0.25))
                     if bm[y].any())
    print(f"body shoulder width {shoulder_w}px "
          f"({shoulder_w / body.shape[1]:.2f} of its own width)")
    print(f"head skull / shoulders = {hw / shoulder_w:.3f}")

    # The two references were drawn on separate canvases, so their relative
    # scale is not given — pick it deliberately. SKULL is the ear-free width
    # measured off the outline profile (see the row scan in the commit notes).
    SKULL_SRC = 457.0

    def compose(head_h_frac, neck=NECK_PX):
        """Stack head over body on a 248x640 canvas, with a neck between them.

        The head must NOT sit straight on the shoulders. A shirt's collar is
        drawn at the shoulder line, so with no gap the collar rides over the
        chin and the character reads as a head glued to a jumper. Leaving
        `neck` pixels of skin below the chin is what lets the neck poke out of
        every top.

        The neck is drawn BEHIND the head and behind the body, so the chin's
        own outline caps it from above and the collar covers its base — no
        seam to blend, and nothing to redraw per skin tone (it is filled with
        the same cream the recolour pass swaps).
        """
        hs = (head_h_frac * CANVAS_H) / head.shape[0]
        hw_px, hh_px = round(head.shape[1] * hs), round(head.shape[0] * hs)
        h_im = Image.fromarray(head, "RGBA").resize((hw_px, hh_px), Image.LANCZOS)

        head_top = 8
        chin = head_top + hh_px
        body_top = chin + neck - NECK_TUCK
        avail_h = CANVAS_H - 4 - body_top
        bs = min(avail_h / body.shape[0], CANVAS_W / float(body.shape[1]))
        bw_px, bh_px = round(body.shape[1] * bs), round(body.shape[0] * bs)
        b_im = Image.fromarray(body, "RGBA").resize((bw_px, bh_px), Image.LANCZOS)

        c = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))

        skull = SKULL_SRC * hs
        nw = round(skull * NECK_W_OF_SKULL)
        nx = (CANVAS_W - nw) // 2
        d = ImageDraw.Draw(c)
        d.rectangle([nx, chin - 26, nx + nw, body_top + 14], fill=(*CREAM, 255))
        for x in (nx, nx + nw):                       # side strokes
            d.line([(x, chin - 26), (x, body_top + 14)], fill=(20, 20, 22, 255),
                   width=max(2, round(3 * hs / 0.35)))

        head_layer = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
        head_xy = ((CANVAS_W - hw_px) // 2, head_top)

        c.alpha_composite(b_im, ((CANVAS_W - bw_px) // 2, body_top))
        c.alpha_composite(h_im, head_xy)
        # Keep the exact head sprite as a separate foreground plate. The body
        # and shoulders overlap for 14px, so a rectangular crop of body.png
        # cannot recover the whole chin without also repainting the shoulders
        # over the shirt. CharacterRig replays this transparent plate after
        # torso wearables instead.
        head_layer.alpha_composite(h_im, head_xy)
        return c, head_layer, round(skull), hh_px

    if not preview:
        # Option B — chosen from the four rendered candidates.
        canvas, head_layer, skull_w, head_h = compose(0.34)
        arr = np.asarray(canvas).copy()
        head_arr = np.asarray(head_layer).copy()
        fill = np.all(np.abs(arr[..., :3].astype(int) - np.array(CREAM)) <= 6, -1)
        fill &= arr[..., 3] > 200
        head_fill = np.all(
            np.abs(head_arr[..., :3].astype(int) - np.array(CREAM)) <= 6, -1
        )
        head_fill &= head_arr[..., 3] > 200
        os.makedirs(OUT, exist_ok=True)
        for name, tone in SKINS.items():
            v = arr.copy()
            hv = head_arr.copy()
            for c in range(3):
                v[..., c] = np.where(fill, tone[c], v[..., c])
                hv[..., c] = np.where(head_fill, tone[c], hv[..., c])
            Image.fromarray(v, "RGBA").save(os.path.join(OUT, name), optimize=True)
            head_name = name.replace("body", "head")
            Image.fromarray(hv, "RGBA").save(
                os.path.join(OUT, head_name), optimize=True
            )
        m = arr[..., 3] > 16
        ys, xs = np.where(m)
        hm = m[:head_h + 8]
        hys, hxs = np.where(hm)
        print(f"\nwrote {len(SKINS)} body files + {len(SKINS)} head plates")
        print(f"  figure  x {xs.min()}..{xs.max()}  y {ys.min()}..{ys.max()}")
        print(f"  HEAD    skull w={skull_w}  h={head_h}  top={hys.min()}")
        print(f"  -> CharacterRig HEAD = {{ w: {skull_w}, h: {head_h}, "
              f"top: {hys.min()} }}")
        return

    if preview:
        Image.fromarray(head, "RGBA").save(os.path.join(QA, "_lift_head.png"))
        Image.fromarray(body, "RGBA").save(os.path.join(QA, "_lift_body.png"))
        # NB: no local `from PIL import ImageDraw` here — a function-scoped
        # import makes ImageDraw local to main() for the WHOLE function, so
        # compose() above would fail on the module-level name.
        opts = [("A  head 30% (today's proportion)", 0.306),
                ("B  head 34%", 0.34),
                ("C  head 38%", 0.38),
                ("D  head 42% (references' own)", 0.42)]
        cur = Image.open(os.path.join(OUT, "body.png")).convert("RGBA")
        sheet = Image.new("RGB", (5 * 300, 760), (240, 240, 243))
        d = ImageDraw.Draw(sheet)
        cur_s = cur.resize((int(CANVAS_W * 1.05), int(CANVAS_H * 1.05)), Image.LANCZOS)
        bg = Image.new("RGBA", cur_s.size, (255, 255, 255, 255))
        sheet.paste(Image.alpha_composite(bg, cur_s), (20, 40))
        d.text((20, 18), "CURRENT", fill=(150, 30, 30))
        for i, (lbl, f) in enumerate(opts):
            im, _, sw, hh = compose(f)
            im_s = im.resize((int(CANVAS_W * 1.05), int(CANVAS_H * 1.05)), Image.LANCZOS)
            bg = Image.new("RGBA", im_s.size, (255, 255, 255, 255))
            sheet.paste(Image.alpha_composite(bg, im_s), (20 + (i + 1) * 300, 40))
            d.text((20 + (i + 1) * 300, 18), lbl, fill=(20, 110, 50))
            d.text((20 + (i + 1) * 300, 720), f"skull {sw}px  head {hh}px",
                   fill=(40, 40, 40))
        sheet.save(os.path.join(QA, "_body_options.png"))
        print("wrote qa4/_body_options.png")
        return


if __name__ == "__main__":
    main()
