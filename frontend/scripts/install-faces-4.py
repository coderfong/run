"""Rebuild the face slot from C:\\Users\\user\\Desktop\\face.

The old face art was features-only, drawn small and bunched into the middle of
the head with no eyebrows. The new art is the reference style: brows high,
eyes below them, a long nose, mouth low — a feature block that spans most of
the face.

PLACEMENT is the point of this script. Every face is anchored the same way,
measured off the reference head rather than eyeballed per item:

    feature block width  = 0.59 x head width   (outer brow to outer brow)
    feature block top    = 0.34 x head height  (top of the eyebrows)

Because the art is trimmed to its ink, a face's bounding box IS that feature
block, so pinning the box's top edge (`top`, not `cy`) keeps the eyebrows on
the same line for every expression while a long mouth or a tear is free to
hang lower. Centring on `cy` instead would see-saw the brows up and down as
the mouth changed.

Sources are white-background RGB: 20 single expressions plus two 5x2 contact
sheets that carry the special faces (blush, sparkle eyes, dizzy, crying).

Writes faceN.png + faces4.json; delete-and-replace of the old art is handled
by the caller.
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = r"C:\Users\user\Desktop\face"
CH = r"C:\Users\user\Desktop\run\frontend\assets\character"
SCRATCH = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(CH, "face")

# --- rig geometry, measured off body.png (248x640) -------------------------
# The head's skin oval — ears are separate components, so this is the face
# itself: x 45..204, y 9..204.
BODY_W, BODY_H = 248, 640
HEAD_TOP, HEAD_H, HEAD_W = 9, 196, 160

# --- proportions read off the reference head -------------------------------
FEATURE_W = 0.59      # outer brow to outer brow, as a fraction of head width
BROW_TOP = 0.34       # top of the brows, as a fraction of head height
EYE_LINE = 0.46       # eye centres — used to re-seat the glasses layer

CANVAS = 512          # long edge of the saved art


def to_alpha(im):
    """Black ink on white -> black ink on transparency.

    Alpha comes from luminance so the antialiasing survives, and the ramp
    starts well below white to kill the faint grey cell rules on the contact
    sheets. RGB is forced to black: leaving the grey ramp in the colour
    channels makes edges read washed-out over the cream head.
    """
    a = np.asarray(im.convert("L")).astype(float)
    alpha = np.clip((235.0 - a) / (235.0 - 40.0), 0, 1) * 255
    out = np.zeros(a.shape + (4,), np.uint8)
    out[..., 3] = alpha.astype(np.uint8)
    return out


def trim(a, thr=8):
    ys, xs = np.where(a[..., 3] > thr)
    if len(ys) == 0:
        return None
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def despeckle(a, min_frac=0.0004):
    """Drop stray dust so it can't inflate the bounding box (the box is the
    measurement everything else keys off)."""
    lab, n = ndimage.label(a[..., 3] > 40)
    if n <= 1:
        return a
    keep = np.zeros(n + 1, bool)
    big = min_frac * a.shape[0] * a.shape[1]
    for i in range(1, n + 1):
        if (lab == i).sum() >= big:
            keep[i] = True
    a[..., 3] = np.where(keep[lab] | (lab == 0) & False, a[..., 3], 0)
    return a


def cells(path, cols=5, rows=2):
    """Slice a contact sheet into its cells."""
    a = to_alpha(Image.open(path))
    H, W = a.shape[:2]
    out = []
    for r in range(rows):
        for c in range(cols):
            sub = a[round(r * H / rows):round((r + 1) * H / rows),
                    round(c * W / cols):round((c + 1) * W / cols)].copy()
            sub = trim(despeckle(sub))
            if sub is not None and sub.shape[0] > 40 and sub.shape[1] > 40:
                out.append(sub)
    return out


def fit(a):
    im = Image.fromarray(a.astype(np.uint8), "RGBA")
    w, h = im.size
    s = CANVAS / max(w, h)
    if s < 1:
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    return np.asarray(im).copy()


def sig(a, n=16):
    """Coarse alpha signature for de-duping the repeated contact sheet."""
    im = Image.fromarray(a[..., 3].astype(np.uint8), "L").resize((n, n), Image.LANCZOS)
    v = np.asarray(im).astype(float)
    return (v > v.mean()).ravel()


def main():
    files = sorted(os.listdir(SRC))
    sheets = [f for f in files if f.endswith((".png",))]
    singles, grids = [], []
    for f in sheets:
        a = trim(despeckle(to_alpha(Image.open(os.path.join(SRC, f)))))
        if a is None:
            continue
        # A 5x2 contact sheet has a wide empty band between its two rows;
        # a single expression never has more than a fifth of its height blank
        # (measured: sheets 0.48, singles <= 0.19). Size alone does NOT
        # separate them — the single expressions fill the canvas too.
        rows_empty = (a[..., 3] > 40).sum(1) == 0
        best = cur = 0
        for e in rows_empty:
            cur = cur + 1 if e else 0
            best = max(best, cur)
        (grids if best / a.shape[0] > 0.35 else singles).append((f, a))

    faces, seen = [], []
    for f, a in singles:
        faces.append((f, a))
    for f, _ in grids:
        for sub in cells(os.path.join(SRC, f)):
            faces.append((f + " cell", sub))

    kept = []
    for f, a in faces:
        s = sig(a)
        if any((s == o).mean() > 0.94 for o in seen):
            continue
        seen.append(s)
        kept.append((f, fit(a)))

    os.makedirs(OUT, exist_ok=True)
    meta = []
    for i, (f, a) in enumerate(kept, start=1):
        stem = f"faceN{i}"
        Image.fromarray(a.astype(np.uint8), "RGBA").save(
            os.path.join(OUT, stem + ".png"), optimize=True)
        meta.append(dict(idx=i, stem=stem, src=f,
                         w=int(a.shape[1]), h=int(a.shape[0])))

    # the one layout every face shares
    w_frac = FEATURE_W * HEAD_W / BODY_W
    top_frac = (HEAD_TOP + BROW_TOP * HEAD_H) / BODY_H
    eye_frac = (HEAD_TOP + EYE_LINE * HEAD_H) / BODY_H
    layout = dict(w=round(w_frac, 4), top=round(top_frac, 4))
    json.dump(dict(layout=layout, glasses_cy=round(eye_frac, 4), faces=meta),
              open(os.path.join(SCRATCH, "faces4.json"), "w"), indent=1)

    print(f"{len(singles)} singles + {len(grids)} sheets -> {len(kept)} unique faces")
    print(f"face layout  {layout}   (was w=0.34, cy=0.1813)")
    print(f"glasses cy   {eye_frac:.4f}  (was 0.166)")


if __name__ == "__main__":
    main()
