"""Headwear-fit QA — mirror CharacterRig's head stack (plate, face, hair,
glasses, headwear) over the real assets, WITH the hair occlusion from
src/config/headwearFit.js, so hat + hair pairs can be judged offline.

    node scripts/dump-hair-headwear.js > scripts/qa-headwear-fit/catalog.json
    python scripts/headwear-fit-qa.py                 # the problem-case grid
    python scripts/headwear-fit-qa.py --swap cap      # one hat over every hair
    python scripts/headwear-fit-qa.py --mode legacy   # the first pass's single line

The occlusion maths below ports `getHairOcclusion` and `getHairLayout` in
headwearFit.js, including the Fit Studio's painted covers and with-hat hair
positions from hairUnderHat.json. Change them together. Output: scripts/qa-headwear-fit/*.png
"""
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'scripts', 'qa-headwear-fit')
CAT = json.load(open(os.path.join(OUT, 'catalog.json')))
FIT = json.load(open(os.path.join(ROOT, 'src', 'config', 'headwearFit.json')))
UNDER_HAT = json.load(open(os.path.join(ROOT, 'src', 'config', 'hairUnderHat.json')))

S = 2                        # render scale over the 248x640 body art
BW, BH = 248 * S, 640 * S
HEAD = dict(w=157, h=218, top=8)
HAIR_LIFT = -0.02
INK_OF_BODY = 0.006   # the seam line's weight, body-height fraction (matches the art's ink)
FACE_W_OF_HEAD, FACE_TOP_OF_HEAD, EYE_LINE_OF_HEAD, GLASSES_W_OF_HEAD = 0.59, 0.34, 0.46, 0.86


def head_frac(f):
    return (HEAD['top'] + f * HEAD['h']) / 640


FACE_W = FACE_W_OF_HEAD * HEAD['w'] / 248
LAYOUT = {
    'face': dict(w=FACE_W, top=head_frac(FACE_TOP_OF_HEAD), maxH=FACE_W * 248 * (494 / 512) / 640),
    'glasses': dict(w=GLASSES_W_OF_HEAD * HEAD['w'] / 248, cy=head_frac(EYE_LINE_OF_HEAD)),
    'hair': dict(w=0.92, top=-0.025),
    'headwear': dict(w=0.85, top=-0.07),
}
# Crop window of the rendered head (body-height fractions).
Y0, Y1, MX = -0.14, 0.40, 0.25


def by_id(slot, i):
    for it in CAT[slot]:
        if it['id'] == i:
            return it
    raise KeyError(f'{slot}:{i}')


def art(it, color):
    p = it.get('img') or (it.get('art') or [None])[min(color, len(it.get('art') or [0]) - 1)]
    return Image.open(os.path.join(ROOT, p)).convert('RGBA') if p else None


def place(img, slot, layout):
    spec = dict(LAYOUT[slot]); spec.update(layout or {})
    w = spec['w'] * BW
    h = w * img.height / img.width
    if spec.get('maxH') is not None and h > spec['maxH'] * BH:
        h = spec['maxH'] * BH; w = h * img.width / img.height
    top = spec['cy'] * BH - h / 2 if spec.get('cy') is not None else spec['top'] * BH
    if slot == 'hair':
        top += HAIR_LIFT * BH
    left = BW / 2 - w / 2 + spec.get('dx', 0) * BW
    return left, top, w, h


# ---- port of headwearFit.js -------------------------------------------------

def category(hat):
    if not hat or hat['id'] == 'none':
        return None
    return FIT['overrides'].get(hat['id']) or (
        'beanie' if hat['hideHair'] else 'closed_hat' if hat['hidesBulky'] else 'open_headwear')


def hair_cut(hat, hair):
    """Port of `getHairOcclusion` in headwearFit.js. Returns None, or the
    seat in HEAD fractions: hair above `y` between `l` and `r` is tucked
    under the hat; outside them the cut falls away at `fall` degrees."""
    cat = category(hat)
    if not cat:
        return None
    prof = dict(FIT['profiles'][cat]); prof.update(FIT['hatTweaks'].get(hat['id'], {}))
    if not prof.get('occlude') or hair['id'] == 'none':
        return None
    if (FIT['hairRegions'].get(hair['id']) or {}).get('gathered') == 'crown':
        return dict(hide=True)
    m = FIT['hats'].get(hat['id']) or {}
    edge = m.get('edgeY') if m.get('edgeY') is not None else prof['defaultEdgeY']
    y = min(edge, prof['maxEdgeY']) - prof['edgeInset']
    return dict(y=y, l=m.get('x0', -0.08), r=m.get('x1', 1.08), fall=prof['sideFall'])


def hair_cover(hat, hair):
    """Hand-painted cover from the Fit Studio (hairUnderHat.json `cover`), as
    getHairOcclusion picks it: the pair's own, else the hat's '*' unless a
    crown-gathered style is dropped by a closed hat. None when not painted."""
    covers = UNDER_HAT['cover'].get(hat['id']) or {}
    if hair['id'] in covers:
        return covers[hair['id']]
    cat = category(hat)
    gathered = (FIT['hairRegions'].get(hair['id']) or {}).get('gathered') == 'crown'
    if '*' in covers and not (cat and FIT['profiles'][cat].get('occlude') and gathered):
        return covers['*']
    return None


def hair_layout(hat, hair):
    """Port of `getHairLayout`: where the hair sits while this hat is worn."""
    by = UNDER_HAT['layout'].get(hair['id']) if hat and hat['id'] != 'none' else None
    cat = category(hat) if by else None
    own = by and (by.get(hat['id']) or (by.get('*') if cat and FIT['profiles'][cat].get('occlude') else None))
    if not own:
        return hair['layout']
    base = dict(hair['layout'] or {})
    if own.get('top') is not None:
        base.pop('cy', None)
    if own.get('cy') is not None:
        base.pop('top', None)
    base.update(own)
    return base


def head_to_px(x, y):
    hx0 = (BW - HEAD['w'] * S) / 2
    return hx0 + x * HEAD['w'] * S, (HEAD['top'] + y * HEAD['h']) * S


# ---- compositor ------------------------------------------------------------

def compose(hair_id, hat_id, hair_c=5, hat_c=0, glasses_id='none', mode='new'):
    pad_x = int(BW * MX)
    canvas = Image.new('RGBA', (BW + 2 * pad_x, int(BH * (Y1 - Y0))), (246, 232, 190, 255))
    oy = -Y0 * BH

    def paste(img, box, mask=None):
        l, t, w, h = box
        im = img.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS)
        if mask is not None:
            a = im.getchannel('A')
            m = mask.crop((round(l) + pad_x, round(t + oy), round(l) + pad_x + im.width, round(t + oy) + im.height))
            a = Image.composite(a, Image.new('L', a.size, 0), m)
            im.putalpha(a)
        canvas.alpha_composite(im, (round(l) + pad_x, round(t + oy)))

    hair, hat = by_id('hair', hair_id), by_id('headwear', hat_id)
    body = Image.open(os.path.join(ROOT, 'assets/character/body/body.png')).convert('RGBA').resize((BW, BH), Image.LANCZOS)
    headp = Image.open(os.path.join(ROOT, 'assets/character/body/head.png')).convert('RGBA').resize((BW, BH), Image.LANCZOS)
    hb = hat.get('backImg')
    if hb:
        im = Image.open(os.path.join(ROOT, hb)).convert('RGBA'); paste(im, place(im, 'headwear', hat['layout']))
    canvas.alpha_composite(body, (pad_x, round(oy)))
    canvas.alpha_composite(headp, (pad_x, round(oy)))
    face = Image.open(os.path.join(ROOT, 'assets/character/face/faceN9.png')).convert('RGBA')
    paste(face, place(face, 'face', None))

    himg = art(hair, hair_c)
    hlay = hair_layout(hat, hair)
    cover = hair_cover(hat, hair) if mode != 'legacy' else None
    if himg:
        mask = None
        if cover is not None:
            # Painted in the studio: everything but the cover polygons, even-odd.
            hidden = np.zeros((canvas.height, canvas.width), dtype=np.uint8)
            for poly in cover:
                one = Image.new('L', canvas.size, 0)
                ImageDraw.Draw(one).polygon([(x + pad_x, y + oy) for x, y in (head_to_px(*p) for p in poly)], fill=255)
                hidden ^= np.asarray(one)
            mask = Image.fromarray(255 - hidden)
        elif mode == 'legacy':
            f = hat.get('fit') or {}
            if f.get('cropHair'):
                y = f['crownCoverYBulky'] if hair['bulky'] else f['crownCoverY']
                mask = Image.new('L', canvas.size, 0)
                ImageDraw.Draw(mask).rectangle((0, head_frac(y) * BH + oy, canvas.width, canvas.height), fill=255)
        else:
            cut = hair_cut(hat, hair)
            if cut is not None and cut.get('hide'):
                himg = None
            elif cut is not None:
                import math
                t = math.tan(math.radians(cut['fall'])) * HEAD['w'] / HEAD['h']   # screen angle -> head-fraction slope
                ink = INK_OF_BODY * 640 / HEAD['h']                               # in head fractions
                def boundary(dy):
                    far = 3.0
                    pts = [(-far, cut['y'] + dy + t * (cut['l'] + far)), (cut['l'], cut['y'] + dy),
                           (cut['r'], cut['y'] + dy), (1 + far, cut['y'] + dy + t * (far + 1 - cut['r']))]
                    return [head_to_px(x, yy) for x, yy in pts]
                def poly(dy, bottom=None):
                    top = boundary(dy)
                    low = [(x, y + 10 * S * 64) for x, y in reversed(top)] if bottom is None else [(x, y) for x, y in reversed(boundary(bottom))]
                    return [(x + pad_x, y + oy) for x, y in top + low]
                mask = Image.new('L', canvas.size, 0)
                ImageDraw.Draw(mask).polygon(poly(ink), fill=255)
                seam = Image.new('L', canvas.size, 0)
                ImageDraw.Draw(seam).polygon(poly(0, ink), fill=255)
                inked = Image.new('RGBA', himg.size, (0, 0, 0, 255)); inked.putalpha(himg.getchannel('A'))
                paste(inked, place(himg, 'hair', hlay), seam)
        if himg:
            paste(himg, place(himg, 'hair', hlay), mask)
    if glasses_id != 'none':
        g = by_id('glasses', glasses_id); gi = art(g, 0)
        paste(gi, place(gi, 'glasses', g['layout']))
    if hat_id != 'none':
        ti = art(hat, hat_c)
        paste(ti, place(ti, 'headwear', hat['layout']))
    return canvas


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, im.width, 18), fill=(255, 255, 255, 220))
    d.text((4, 3), text, fill=(0, 0, 0, 255))
    return im


def grid(cells, cols, name):
    w, h = cells[0].size
    sheet = Image.new('RGBA', (w * cols, h * ((len(cells) + cols - 1) // cols)), (255, 255, 255, 255))
    for i, c in enumerate(cells):
        sheet.alpha_composite(c, ((i % cols) * w, (i // cols) * h))
    sheet = sheet.convert('RGB')
    sheet.save(os.path.join(OUT, name))
    print('wrote', os.path.join(OUT, name), sheet.size)


PROBLEMS = [
    ('hs26', 'cur_truckercap', 'none'), ('hs26', 'cur_desertflapcap', 'none'), ('braids', 'ballcap', 'none'),
    ('sleeklong', 'cap', 'none'), ('longwaves', 'ballcap', 'rects'),
    ('bluntbob', 'beanie', 'none'), ('fringebob', 'cur_knitbeanie', 'none'), ('ravenlong', 'cur_knitbeanie', 'aviators'),
    ('messy', 'knitbeanie', 'cleargoggles'), ('sleeklong', 'cur_buckethat', 'none'), ('softwaves', 'bucket', 'none'),
    ('bangs', 'cur_beret', 'none'), ('longwaves', 'beret', 'none'), ('fringebob', 'flatberet', 'none'),
    ('sleeklong', 'visor', 'none'), ('longwaves', 'runvisor', 'none'),
    ('sleeklong', 'headphones', 'none'), ('softwaves', 'headphones', 'none'),
    ('bigafro', 'cap', 'none'), ('highpony', 'cap', 'none'), ('spacebuns', 'beanie', 'none'),
    ('sidepony', 'cur_runclubcap', 'none'), ('curls', 'cur_buckethat', 'none'), ('hs22', 'cur_snapback', 'none'),
]

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', default='new', choices=['new', 'legacy', 'both'])
    ap.add_argument('--swap', help='headwear id: draw it over every hairstyle')
    ap.add_argument('--pairs', help='hair:hat[:glasses],... to render instead of the problem list')
    a = ap.parse_args()
    modes = ['legacy', 'new'] if a.mode == 'both' else [a.mode]
    if a.swap:
        cells = [label(compose(h['id'], a.swap, mode=m), f"{m[0]} {h['id']}") for h in CAT['hair'] for m in modes]
        grid(cells, 8 * len(modes), f'swap-{a.swap}-{a.mode}.png')
    else:
        pairs = [tuple(p.split(':')) + ('none',) * (3 - len(p.split(':'))) for p in a.pairs.split(',')] if a.pairs else PROBLEMS
        cells = [label(compose(h, t, glasses_id=g, mode=m), f'{m[0]} {h}+{t}' + (f'+{g}' if g != 'none' else ''))
                 for h, t, g in pairs for m in modes]
        grid(cells, 6 if len(modes) == 1 else 6, f'problems-{a.mode}.png')
