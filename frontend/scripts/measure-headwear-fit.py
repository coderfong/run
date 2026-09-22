"""Measure every headwear item's SEAT on the skull from its own art, for the
headwear-fit occlusion (src/config/headwearFit.js reads the output).

For each hat, placed exactly where CharacterRig puts it (its layout never
depends on the hairstyle), per skull column, the
lowest ink is the hat's lower edge in that column (a hat is drawn as one
filled silhouette, so there is nothing of it below that). The hat's `edgeY` is the HIGHEST of those edges across the skull
(10th percentile, so a stray notch can't win): cutting hair there hides the
cut under the hat everywhere the hat is, and beside it the hair starts at
the hat's own lower edge, which is what "tucked under the hat" looks like.
`x0`/`x1` are the hat's horizontal extent: beyond them the hair cut falls
away (headwearFit.js `fall`). `cover` is the share of skull columns the hat
reaches at all, for spotting clips and bows that were mis-categorised. All values are HEAD fractions
(x: 0..1 across the 157px skull, y: 0 = skull top, 1 = chin).

    python scripts/measure-headwear-fit.py   # rewrites the "hats" block of src/config/headwearFit.json
"""
import json, os
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CAT = json.load(open(os.path.join(ROOT, 'scripts', 'qa-headwear-fit', 'catalog.json')))
FIT_PATH = os.path.join(ROOT, 'src', 'config', 'headwearFit.json')
BW, BH = 248 * 4, 640 * 4
HEAD = dict(w=157, h=218, top=8)
BASE = dict(w=0.85, top=-0.07)

def measure(it):
    p = it.get('img') or (it.get('art') or [None])[0]
    im = Image.open(os.path.join(ROOT, p)).convert('RGBA')
    spec = dict(BASE); spec.update(it.get('layout') or {})
    w = spec['w'] * BW; h = w * im.height / im.width
    top = spec['cy'] * BH - h / 2 if spec.get('cy') is not None else spec['top'] * BH
    left = BW / 2 - w / 2 + spec.get('dx', 0) * BW
    a = np.asarray(im.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS).getchannel('A')) > 128
    sx = BW / 248; hx0 = (248 - HEAD['w']) / 2 * sx
    hx = lambda px: (px - hx0) / (HEAD['w'] * sx)
    hy = lambda py: (py / sx - HEAD['top']) / HEAD['h']
    cols = np.where(a.any(axis=0))[0]
    x0, x1 = hx(left + cols.min()), hx(left + cols.max() + 1)
    edges = []
    for fx in np.linspace(0.08, 0.92, 43):
        c = int(round(hx0 + fx * HEAD['w'] * sx - left))
        if c < 0 or c >= a.shape[1] or not a[:, c].any():
            continue
        r1 = len(a[:, c]) - int(np.argmax(a[::-1, c]))   # lowest ink in the column
        edges.append(hy(top + r1))
    cover = len(edges) / 43
    edge = float(np.percentile(edges, 10)) if edges else None
    r = lambda v: round(float(v), 3) if v is not None else None
    return dict(edgeY=r(edge), x0=r(x0), x1=r(x1), cover=round(cover, 2))

fit = json.load(open(FIT_PATH))
fit['hats'] = {it['id']: measure(it) for it in CAT['headwear'] if it['id'] != 'none'}
open(FIT_PATH, 'w').write(json.dumps(fit, indent=1) + chr(10))
print('measured', len(fit['hats']), 'headwear items ->', FIT_PATH)
