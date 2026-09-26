"""Hair + headwear QA sheets, drawn from what the APP resolves.

resolve.js runs the pairs through src/config/headwearFit.js (resolveHairClip)
and this script only rasterises the answer over the real art, in the rig's
own order: hat back half, body, head plate, face, clipped hair, hat. Nothing
here re-implements a rule, so a sheet cannot drift from the app.

    python scripts/hair-headwear-qa/render.py --reference              # the reference-sheet hats
    python scripts/hair-headwear-qa/render.py --hats tophat,dadcap     # one hat over every hairstyle
    python scripts/hair-headwear-qa/render.py --hairs topknot          # one hairstyle under every hat
    python scripts/hair-headwear-qa/render.py --pairs topknot:dadcap,hijab:tophat
    add --compare to draw the committed (HEAD) rules beside the working ones.

Sheets land in scripts/hair-headwear-qa/out/.
"""
import argparse
import json
import os
import subprocess

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')

# The production stand-ins for the hats on the reference sheets: cap, fedora,
# cowboy, top hat, witch, santa, beanie, viking, head wrap, headphones.
REFERENCE_HATS = ['dadcap', 'bowler', 'cur_cowboyhat', 'tophat', 'cur_wizardhat',
                  'santahat', 'cur_knitbeanie', 'vikinghelm', 'headwrap', 'headphones']

S = 2                              # render scale over the 248x640 body art
BW, BH = 248 * S, 640 * S
Y0, Y1, MX = -0.15, 0.42, 0.24     # crop window (body-height fractions), side margin
BG = (246, 236, 206, 255)


def resolve(pairs, legacy=False):
    cmd = ['node', os.path.join(HERE, 'resolve.js')] + (['--legacy'] if legacy else [])
    r = subprocess.run(cmd, input=json.dumps({'pairs': pairs}), capture_output=True,
                       text=True, cwd=ROOT, encoding='utf8')
    if r.returncode:
        raise SystemExit(r.stderr)
    return json.loads(r.stdout)


def load(rel):
    return Image.open(os.path.join(ROOT, rel)).convert('RGBA')


def art(it, colour=1):
    if it.get('img'):
        return load(it['img'])
    a = it.get('art') or []
    return load(a[min(colour, len(a) - 1)]) if a else None


def place(img, spec):
    w = spec['w'] * BW
    h = w * img.height / img.width
    if spec.get('maxH') is not None and h > spec['maxH'] * BH:
        h = spec['maxH'] * BH
        w = h * img.width / img.height
    top = spec['cy'] * BH - h / 2 if spec.get('cy') is not None else spec['top'] * BH
    return BW / 2 - w / 2 + (spec.get('dx') or 0) * BW, top, w, h


def compose(res, pair):
    cat = res['catalog']
    by = {s: {i['id']: i for i in cat[s]} for s in ('hair', 'headwear')}
    hair, hat = by['hair'][pair['hair']], by['headwear'][pair['hat']]
    pad = int(BW * MX)
    oy = -Y0 * BH
    cv = Image.new('RGBA', (BW + 2 * pad, int(BH * (Y1 - Y0))), BG)

    def paste(img, box, keep=None):
        l, t, w, h = box
        im = img.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS)
        if keep is not None:
            im.putalpha(Image.fromarray(np.minimum(np.asarray(im.getchannel('A')), keep)))
        cv.alpha_composite(im, (round(l) + pad, round(t + oy)))

    lay = res['layout']
    hat_spec = {**lay['headwear'], **(hat.get('layout') or {})}
    if hat.get('backImg'):
        b = load(hat['backImg'])
        paste(b, place(b, hat_spec))
    for plate in ('body', 'head'):
        cv.alpha_composite(load(f'assets/character/body/{plate}.png').resize((BW, BH), Image.LANCZOS), (pad, round(oy)))
    face = load('assets/character/face/faceN9.png')
    paste(face, place(face, lay['face']))

    clip = pair['clip']
    img = art(hair) if hair['id'] != 'none' else None
    if img is not None and clip != 'hide':
        f = pair['frame']
        box = (f['left'] * S, f['top'] * S, f['w'] * S, f['h'] * S)
        keep = None
        if clip:
            W, H = max(1, round(box[2])), max(1, round(box[3]))
            hidden = np.zeros((H, W), dtype=np.uint8)
            for ring in clip['rings']:
                one = Image.new('L', (W, H), 0)
                ImageDraw.Draw(one).polygon([(x * W, y * H) for x, y in ring], fill=255)
                hidden ^= np.asarray(one)          # even-odd, like the rig's path
            keep = 255 - hidden
        paste(img, box, keep)
    if hat['id'] != 'none':
        t = art(hat, 0)
        paste(t, place(t, hat_spec))
    return cv


def label(im, text, tint=(255, 255, 255, 230)):
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, im.width, 20), fill=tint)
    d.text((5, 4), text, fill=(0, 0, 0, 255))
    return im


def sheet(cells, cols, name):
    w, h = cells[0].size
    out = Image.new('RGB', (w * cols, h * ((len(cells) + cols - 1) // cols)), 'white')
    for i, c in enumerate(cells):
        out.paste(c.convert('RGB'), ((i % cols) * w, (i // cols) * h))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    out.save(path)
    print('wrote', path, out.size)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hats', help='comma list: each hat over every visible hairstyle')
    ap.add_argument('--hairs', help='comma list: each hairstyle under every visible hat')
    ap.add_argument('--pairs', help='hair:hat,...')
    ap.add_argument('--reference', action='store_true', help='the reference-sheet stand-in hats')
    ap.add_argument('--compare', action='store_true', help='committed rules beside the working ones')
    ap.add_argument('--scale', type=float, default=0.5, help='cell scale (default half size)')
    a = ap.parse_args()

    probe = resolve([['curtains', 'none']])
    hidden = set(probe['catalog']['hidden'])
    vis = {s: [i['id'] for i in probe['catalog'][s] if i['id'] != 'none' and i['id'] not in hidden]
           for s in ('hair', 'headwear')}

    jobs = []   # (sheet name, pairs, cols)
    for hat in REFERENCE_HATS if a.reference else (a.hats.split(',') if a.hats else []):
        jobs.append((f'hat-{hat}', [[h, hat] for h in vis['hair']], 8))
    for hair in a.hairs.split(',') if a.hairs else []:
        jobs.append((f'hair-{hair}', [[hair, t] for t in vis['headwear']], 10))
    if a.pairs:
        jobs.append(('pairs', [p.split(':') for p in a.pairs.split(',')], 6))

    for name, pairs, cols in jobs:
        now = resolve(pairs)
        before = resolve(pairs, legacy=True) if a.compare else None
        cells = []
        for i, p in enumerate(now['pairs']):
            if before:
                b = before['pairs'][i]
                cells.append(label(compose(before, b), f"BEFORE {p['hair']}+{p['hat']}", (255, 210, 210, 230)))
            cells.append(label(compose(now, p), f"{p['hair']}+{p['hat']} {p['family'] or ''}"))
        if a.scale != 1:
            cells = [c.resize((round(c.width * a.scale), round(c.height * a.scale)), Image.LANCZOS) for c in cells]
        sheet(cells, cols, f"{name}{'-compare' if before else ''}.png")


if __name__ == '__main__':
    main()
