/**
 * Headwear fit: the hat is anchored to the skull and the hair is what the hat
 * leaves showing (src/config/headwearFit.js), with the hair + headwear
 * compatibility rules (hairHeadwearCompat.json) on top.
 *
 * The visual judgement lives in scripts/hair-headwear-qa (render.py draws
 * what resolveHairClip answers over the real art). These pin the contract
 * that makes that judgement hold for every pair rather than the ones that
 * were looked at.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { Image as SvgImage } from 'react-native-svg';

import CharacterRig from '../src/components/character/CharacterRig';
import { ITEMS, getItem } from '../src/config/cosmetics';
import COMPAT from '../src/config/hairHeadwearCompat.json';
import UNDER_HAT from '../src/config/hairUnderHat.json';
import UNDERSIDES from '../src/config/hatUndersides.json';
import {
  HEADWEAR_FAMILY,
  getHairFeaturePolicy,
  getHairOcclusion,
  getHeadwearFamily,
  resolveHairClip,
} from '../src/config/headwearFit';
import { Image } from '../src/ui/image';

const render = (element) => {
  let tree;
  act(() => {
    tree = renderer.create(element);
  });
  return tree;
};

const hat = (id) => getItem('headwear', id);
const hair = (id) => getItem('hair', id);
const HATS = ITEMS.headwear.filter((h) => h.id !== 'none');
const HAIRS = ITEMS.hair.filter((h) => h.id !== 'none');
const HAIR_TYPES = ['SHORT', 'TEXTURED_TOP', 'CREST', 'CURLY_VOLUME', 'BOB', 'LONG_LOOSE', 'TOP_BUN', 'SIDE_BUNS', 'PONYTAIL', 'BRAIDS', 'COVERING'];
const FEATURES = ['topBun', 'sideBuns', 'tail'];
const POLICIES = ['keep', 'hide', 'cover'];
const OPEN_FAMILIES = ['OPEN', 'VISOR', 'SIDE_ACCESSORY'];

// A point is hidden when an odd number of the clip's rings contain it (the
// rig cuts the rings out of the art rectangle even-odd).
function inside([x, y], ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const hidden = (clip, pt) => clip === 'hide' || (!!clip && clip.rings.filter((r) => inside(pt, r)).length % 2 === 1);

// Boxes in HEAD fractions (x 0..1 across the skull, y 0 skull top, 1 chin),
// close to where the rig draws a typical hairstyle and hat. Scale-free, so
// these stand in for any rig size.
const HAIR_BOX = { x: -0.25, y: -0.5, w: 1.5, h: 1.5 };
const HAT_BOX = { x: -0.2, y: -0.45, w: 1.4, h: 0.75 };
// Art-fraction point in HAIR_BOX for a head-fraction point.
const art = ([hx, hy]) => [(hx - HAIR_BOX.x) / HAIR_BOX.w, (hy - HAIR_BOX.y) / HAIR_BOX.h];

describe('compatibility data', () => {
  it('classifies every headwear item, hidden ones included, into a known family', () => {
    const bad = HATS.filter((h) => {
      const e = COMPAT.headwear[h.id];
      const family = typeof e === 'string' ? e : e && e.family;
      return !family || !HEADWEAR_FAMILY[family];
    }).map((h) => h.id);
    // New headwear: add it to hairHeadwearCompat.json `headwear` by eye.
    expect(bad).toEqual([]);
  });

  it('names no headwear or hairstyle that no longer exists', () => {
    const hatIds = new Set(HATS.map((h) => h.id));
    const hairIds = new Set(HAIRS.map((h) => h.id));
    expect(Object.keys(COMPAT.headwear).filter((id) => !hatIds.has(id))).toEqual([]);
    expect(Object.keys(COMPAT.hair).filter((id) => !hairIds.has(id))).toEqual([]);
    for (const key of Object.keys(COMPAT.pairs)) {
      const [hid, tid] = key.split(':');
      expect([key, hairIds.has(hid) && hatIds.has(tid)]).toEqual([key, true]);
    }
  });

  it('gives every hairstyle a behaviour type and well-formed feature regions', () => {
    for (const h of HAIRS) {
      const e = COMPAT.hair[h.id];
      expect([h.id, !!e && HAIR_TYPES.includes(e.type)]).toEqual([h.id, true]);
      for (const [name, polys] of Object.entries(e.regions || {})) {
        expect([h.id, name, FEATURES.includes(name)]).toEqual([h.id, name, true]);
        for (const poly of polys) expect(poly.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('only uses known feature policies', () => {
    const entries = [
      ...Object.values(COMPAT.families),
      ...Object.values(COMPAT.headwear).filter((e) => typeof e === 'object'),
      ...Object.values(COMPAT.pairs),
    ];
    for (const e of entries) {
      for (const f of FEATURES) if (e[f] != null) expect(POLICIES).toContain(e[f]);
    }
  });

  it('has a measured underside for every crown-covering hat', () => {
    // python scripts/measure-hat-underside.py
    const missing = HATS.filter((h) => COMPAT.families[getHeadwearFamily(h)].sky && !UNDERSIDES.hats[h.id]).map((h) => h.id);
    expect(missing).toEqual([]);
  });
});

describe('family rules', () => {
  it('never clips under open pieces with nothing painted', () => {
    for (const h of HATS) {
      if (!OPEN_FAMILIES.includes(getHeadwearFamily(h)) || UNDER_HAT.cover[h.id]) continue;
      expect([h.id, getHairOcclusion(h, hair('sleeklong'))]).toEqual([h.id, null]);
    }
  });

  it('never cuts into the hijab: every hat sits on top of it', () => {
    for (const h of HATS) {
      if ((UNDER_HAT.cover[h.id] || {}).hijab) continue; // a pair painted by hand
      expect([h.id, getHairOcclusion(h, hair('hijab'))]).toEqual([h.id, null]);
    }
  });

  it('hides all hair inside a full enclosure', () => {
    for (const id of ['cur_astronauthelmet', 'cur_knighthelmet', 'swimcap']) {
      for (const hid of ['sleeklong', 'roundfro', 'spacebuns', 'highpony']) {
        expect([id, hid, getHairOcclusion(hat(id), hair(hid))]).toEqual([id, hid, { hide: true }]);
      }
    }
  });

  it('keeps a top bun through a cap and a beanie, hides it under rigid hats and helmets', () => {
    const bun = art([0.5, -0.35]); // well above every seat, over the crown
    const clip = (id) => resolveHairClip(hat(id), hair('topknot'), HAIR_BOX, HAT_BOX);
    for (const id of ['cur_snapback', 'dadcap', 'cur_knitbeanie', 'headwrap']) expect([id, hidden(clip(id), bun)]).toEqual([id, false]);
    for (const id of ['tophat', 'cur_cowboyhat', 'bowler', 'vikinghelm', 'santahat']) expect([id, hidden(clip(id), bun)]).toEqual([id, true]);
  });

  it('keeps space buns beside hats, hides them under side-covering pieces', () => {
    expect(getHairFeaturePolicy(hat('bowler'), hair('spacebuns')).sideBuns).toBe('keep');
    expect(getHairFeaturePolicy(hat('vikinghelm'), hair('spacebuns')).sideBuns).toBe('keep');
    for (const id of ['ushanka', 'aviatorcap', 'headscarf', 'cur_desertflapcap']) {
      expect([id, getHairFeaturePolicy(hat(id), hair('spacebuns')).sideBuns]).toEqual([id, 'hide']);
    }
  });

  it('lets a high tail hang below a rigid brim but not rise through it', () => {
    const occ = getHairOcclusion(hat('tophat'), hair('highpony'));
    expect(occ.features.hide.length).toBeGreaterThan(0);
    const clip = resolveHairClip(hat('tophat'), hair('highpony'), HAIR_BOX, HAT_BOX);
    const seat = occ.features.seatY;
    const tail = COMPAT.hair.highpony.regions.tail[0];
    const tx = (Math.max(...tail.map((p) => p[0])) + 0.74) / 2 - 0.02; // inside the tail's right column
    const ax = HAIR_BOX.x + tx * HAIR_BOX.w;
    expect(hidden(clip, art([ax, -0.4]))).toBe(true);
    expect(hidden(clip, art([ax, Math.max(seat, 0.3) + 0.3]))).toBe(false);
  });

  it('drops a crown-gathered style where its bun is hidden, keeps it where the bun is kept', () => {
    expect(getHairOcclusion(hat('tophat'), hair('highbun'))).toEqual({ hide: true });
    expect(getHairOcclusion(hat('vikinghelm'), hair('highbun'))).toEqual({ hide: true });
    expect(getHairOcclusion(hat('dadcap'), hair('highbun'))).not.toEqual({ hide: true });
    expect(getHairOcclusion(hat('headphones'), hair('highbun'))).toBeNull();
  });

  it('never shows hair above a crown-covering hat, even where its painted cover is empty', () => {
    expect(UNDER_HAT.cover.tophat['*']).toEqual([]); // the case this guards
    const clip = resolveHairClip(hat('tophat'), hair('roundfro'), HAIR_BOX, HAT_BOX);
    // Straight above the hat's middle, and well below the brim.
    expect(hidden(clip, art([0.5, -0.3]))).toBe(true);
    expect(hidden(clip, art([-0.1, 0.8]))).toBe(false);
  });

  it('uses the same scalp answer whatever featureless hair is under the hat', () => {
    for (const id of ['dadcap', 'cur_truckercap', 'cur_knitbeanie', 'cur_buckethat', 'cur_beret', 'tophat']) {
      const answers = new Set(
        ['curtains', 'bluntbob', 'sleeklong', 'bigafro', 'hs26', 'braids']
          .filter((hid) => !(UNDER_HAT.cover[id] || {})[hid])
          .map((hid) => JSON.stringify(getHairOcclusion(hat(id), hair(hid))))
      );
      expect([id, answers.size]).toEqual([id, 1]);
    }
  });
});

describe('the rig under headwear', () => {
  const frameOf = (tree, pred) =>
    tree.root.findAllByType(Image).filter((n) => pred(n.props)).map((n) => StyleSheet.flatten(n.props.style));

  it('keeps the hat at the same place for every hairstyle', () => {
    const hatSrc = hat('dadcap').img;
    const positions = new Set(
      ['curtains', 'bigafro', 'hs26', 'sleeklong', 'highbun', 'hijab'].map((hid) => {
        const tree = render(<CharacterRig equipped={{ hair: hid, headwear: 'dadcap' }} size={120} animate={false} />);
        const [f] = frameOf(tree, (p) => p.source === hatSrc);
        act(() => tree.unmount());
        return JSON.stringify([f.left, f.top, f.width, f.height]);
      })
    );
    expect(positions.size).toBe(1);
  });

  it('draws clipped hair as one SVG image cut by one even-odd path', () => {
    const tree = render(<CharacterRig equipped={{ hair: 'hs26', hairColor: 5, headwear: 'dadcap' }} size={120} animate={false} />);
    const hairSrc = hair('hs26').art[5];
    expect(tree.root.findAllByType(Image).filter((n) => n.props.source === hairSrc).length).toBe(0);
    expect(tree.root.findAllByType(SvgImage).filter((n) => n.props.href === hairSrc).length).toBe(1);
    act(() => tree.unmount());
  });

  it('draws the plain hair layer with no hat, and under the hijab rule', () => {
    for (const [hid, tid] of [['hs26', 'none'], ['hijab', 'tophat']]) {
      const tree = render(<CharacterRig equipped={{ hair: hid, hairColor: 1, headwear: tid }} size={120} animate={false} />);
      const src = hair(hid).img || hair(hid).art[1];
      expect([hid, tid, tree.root.findAllByType(Image).filter((n) => n.props.source === src).length]).toEqual([hid, tid, 1]);
      act(() => tree.unmount());
    }
  });

  it('draws no hair inside a full enclosure', () => {
    const tree = render(<CharacterRig equipped={{ hair: 'sleeklong', hairColor: 1, headwear: 'cur_astronauthelmet' }} size={120} animate={false} />);
    const src = hair('sleeklong').art[1];
    expect(tree.root.findAllByType(Image).filter((n) => n.props.source === src).length).toBe(0);
    expect(tree.root.findAllByType(SvgImage).filter((n) => n.props.href === src).length).toBe(0);
    act(() => tree.unmount());
  });
});
