"""Probe: cut the face out of wave-3 hair art, then composite over the body.

ChatGPT drew these hairstyles as whole heads — hair PLUS a filled face oval
and a pair of ears. Pasted straight onto the rig that oval covers the face,
so the piece has to become a wig: find the enclosed light fill, cut it, and
eat a couple of pixels past its edge so the art's own head outline goes with
it (the body already draws one, and two strokes never line up).
"""
import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SCRATCH, "out3", "items")
QA = os.path.join(SCRATCH, "qa3")
CH = r"C:\Users\user\Desktop\run\frontend\assets\character"

BODY_W, BODY_H = 248, 640
HEADROOM = 0.14 * BODY_H
HAIR_LIFT = -0.05


def load(idx):
    return np.asarray(Image.open(os.path.join(OUT, f"{idx:03d}.png"))
                      .convert("RGBA")).copy()


def trim(a):
    ys, xs = np.where(a[..., 3] > 16)
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def cut_face(a, tol=30):
    """Remove the face fill (and its outline) from a wig, by FLOOD FILL.

    Classifying the fill by colour fails on the blonde and silver styles —
    pale hair is light and low-chroma too, so a colour rule eats the hairstyle
    it was meant to preserve. The fill's real signature is positional: it is
    the flat region under the middle of the head. So seed a few points there,
    grow the connected run of near-identical colour, and take the largest
    plausible blob. Whatever colour the face happens to be, the hair around it
    differs by more than `tol` and stops the fill.
    """
    h, w = a.shape[:2]
    rgb = a[..., :3].astype(int)
    opaque = a[..., 3] > 100
    best = None
    for fy in (0.52, 0.62, 0.72):
        for fx in (0.5, 0.42, 0.58):
            y, x = int(h * fy), int(w * fx)
            if not opaque[y, x]:
                continue
            # The fill is always a pale cream/skin; a dark seed means the point
            # landed on a heavy fringe, and flooding from there eats the
            # hairstyle itself (this is what wrecked the dark bangs styles).
            s = rgb[y, x]
            if s.mean() < 155 or int(s.max() - s.min()) > 70:
                continue
            near = (np.abs(rgb - rgb[y, x]).max(2) <= tol) & opaque
            near = ndimage.binary_opening(near, np.ones((3, 3)))
            lab, n = ndimage.label(near)
            if n == 0 or lab[y, x] == 0:
                continue
            blob = lab == lab[y, x]
            frac = blob.mean()
            if not 0.04 < frac < 0.55:
                continue
            # a face is enclosed by hair: reject anything running off the edge
            edge = (blob[0, :].mean() + blob[-1, :].mean()) / 2
            if edge > 0.35:
                continue
            if best is None or blob.sum() > best.sum():
                best = blob
    if best is None:
        return a, 0
    mask = ndimage.binary_fill_holes(best)
    # grow past the fill so the art's own head outline leaves with it — the
    # body draws its own, and two strokes never line up
    grow = max(3, round(0.012 * min(h, w)))
    mask = ndimage.binary_dilation(mask, np.ones((3, 3)), iterations=grow)
    soft = np.clip(ndimage.gaussian_filter(mask.astype(float), 0.8), 0, 1)
    a[..., 3] = (a[..., 3] * (1 - soft)).astype(np.uint8)

    # Sweep the jaw: the drawn chin line sits just outside the fill, so the cut
    # leaves it stranded as its own little arc floating over the body's face.
    # Anything small left inside the opening is that stroke — bangs survive
    # because they stay attached to the hair mass above.
    inside = ndimage.binary_dilation(mask, np.ones((3, 3)), iterations=grow * 3)
    lab, n = ndimage.label(a[..., 3] > 100)
    if n > 1:
        drop = np.zeros(n + 1, bool)
        for i in range(1, n + 1):
            comp = lab == i
            if comp.sum() < 0.03 * h * w and (comp & inside).sum() > 0.7 * comp.sum():
                drop[i] = True
        if drop.any():
            a[..., 3] = np.where(drop[lab], 0, a[..., 3]).astype(np.uint8)
    return a, int(mask.sum())


def composite(hair_rgba, layout):
    """Mirror CharacterRig's Layer math: hair over the bare body."""
    canvas = Image.new("RGBA", (BODY_W + 120, round(BODY_H * 0.55) + 40),
                       (44, 46, 52, 255))
    body = Image.open(os.path.join(CH, "body", "body.png")).convert("RGBA") \
        .resize((BODY_W, BODY_H), Image.LANCZOS)
    canvas.alpha_composite(body, (60, round(HEADROOM) - 20))
    img = Image.fromarray(hair_rgba.astype(np.uint8), "RGBA")
    w = layout.get("w", 0.92) * BODY_W
    h = w * img.height / img.width
    top = layout.get("top", -0.025) * BODY_H + HAIR_LIFT * BODY_H
    left = BODY_W / 2 - w / 2 + layout.get("dx", 0) * BODY_W
    canvas.alpha_composite(
        img.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS),
        (round(left) + 60, round(top + HEADROOM) - 20))
    return canvas


def main():
    idxs = [int(x) for x in sys.argv[1:]] or [518, 27, 283, 362, 127, 123,
                                              515, 202, 507, 277, 470, 514]
    cell_w, cell_h = 380, 420
    cols = 6
    rows = (len(idxs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), (30, 32, 36))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for k, i in enumerate(idxs):
        a, cut = cut_face(trim(load(i)))
        av = composite(trim(a), {})
        av.thumbnail((cell_w - 16, cell_h - 34), Image.LANCZOS)
        x = (k % cols) * cell_w + (cell_w - av.width) // 2
        y = (k // cols) * cell_h + (cell_h - av.height) // 2 + 12
        sheet.paste(av, (x, y), av)
        d.text(((k % cols) * cell_w + 8, (k // cols) * cell_h + 6),
               f"{i}  cut={cut}", fill=(255, 210, 90))
    p = os.path.join(QA, "probe-hair.png")
    sheet.save(p)
    print("wrote", p)


if __name__ == "__main__":
    main()
