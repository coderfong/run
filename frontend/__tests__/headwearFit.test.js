/**
 * Headwear fit: the hat is anchored to the skull and the hair is what the hat
 * leaves showing (src/config/headwearFit.js).
 *
 * The visual judgement lives in scripts/headwear-fit-qa.py, which renders the
 * real art. These pin the contract that makes that judgement hold for every
 * pair rather than the ones that were looked at.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

import CharacterRig from '../src/components/character/CharacterRig';
import { ITEMS, getItem } from '../src/config/cosmetics';
import FIT from '../src/config/headwearFit.json';
import UNDER_HAT from '../src/config/hairUnderHat.json';
import { getHairOcclusion, getHeadwearCategory } from '../src/config/headwearFit';
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
const CLOSED = ['closed_hat', 'wide_brim_hat', 'beanie', 'helmet', 'headwrap'];

describe('headwear fit data', () => {
  it('has a measured seat for every headwear item', () => {
    const missing = ITEMS.headwear.filter((h) => h.id !== 'none' && !FIT.hats[h.id]).map((h) => h.id);
    // A new hat still fits from its category defaults, but should be measured:
    // python scripts/measure-headwear-fit.py
    expect(missing).toEqual([]);
  });

  it('seats every closed hat on the skull, below the crown', () => {
    for (const h of ITEMS.headwear) {
      if (!CLOSED.includes(getHeadwearCategory(h))) continue;
      const occ = getHairOcclusion(h, hair('sleeklong'));
      // Above 0 would leave crown hair showing; past 0.45 of the head is the
      // eyes, where only a strap or a drape reaches.
      expect([h.id, occ.y >= 0 && occ.y <= 0.45]).toEqual([h.id, true]);
      expect(occ.x1).toBeGreaterThan(occ.x0);
    }
  });

  it('never clips under open-top pieces', () => {
    for (const id of ['visor', 'runvisor', 'cur_racingvisor', 'headphones', 'puffmuffs', 'sweatband', 'catears', 'none']) {
      expect([id, getHairOcclusion(hat(id), hair('sleeklong'))]).toEqual([id, null]);
    }
  });

  it('uses the same seat whatever hair is under the hat', () => {
    // The seat comes from the hat alone: bulky, long and tied styles do not push it.
    for (const id of ['cap', 'cur_truckercap', 'beanie', 'cur_knitbeanie', 'cur_buckethat', 'cur_beret']) {
      const seats = new Set(
        ['curtains', 'bluntbob', 'sleeklong', 'bigafro', 'hs26', 'braids', 'spacebuns', 'highpony']
          // A pair painted in the Fit Studio is the one deliberate exception.
          .filter((hid) => !(UNDER_HAT.cover[id] || {})[hid])
          .map((hid) => JSON.stringify(getHairOcclusion(hat(id), hair(hid))))
      );
      expect([id, seats.size]).toEqual([id, 1]);
    }
  });

  it('drops a style gathered entirely on the crown under a closed hat, keeps it under a visor', () => {
    expect(getHairOcclusion(hat('cap'), hair('highbun'))).toEqual({ hide: true });
    expect(getHairOcclusion(hat('visor'), hair('highbun'))).toBeNull();
  });
});

describe('the rig under a closed hat', () => {
  const frameOf = (tree, pred) =>
    tree.root.findAllByType(Image).filter((n) => pred(n.props)).map((n) => StyleSheet.flatten(n.props.style));

  it('keeps the hat at the same place for every hairstyle', () => {
    const hatSrc = hat('cap').img;
    const positions = new Set(
      ['curtains', 'bigafro', 'hs26', 'sleeklong', 'highbun'].map((hid) => {
        const tree = render(<CharacterRig equipped={{ hair: hid, headwear: 'cap' }} size={120} animate={false} />);
        const [f] = frameOf(tree, (p) => p.source === hatSrc);
        act(() => tree.unmount());
        return JSON.stringify([f.left, f.top, f.width, f.height]);
      })
    );
    expect(positions.size).toBe(1);
  });

  it('draws the hair through windows, and inks only the seams', () => {
    const tree = render(<CharacterRig equipped={{ hair: 'hs26', hairColor: 5, headwear: 'cap' }} size={120} animate={false} />);
    const hairSrc = hair('hs26').art[5];
    const hairLayers = tree.root.findAllByType(Image).filter((n) => n.props.source === hairSrc);
    expect(hairLayers.length).toBe(6);
    expect(hairLayers.filter((n) => n.props.tintColor).length).toBe(3);
    act(() => tree.unmount());
  });

  it('draws the plain hair layer with no hat', () => {
    const tree = render(<CharacterRig equipped={{ hair: 'hs26', hairColor: 5, headwear: 'none' }} size={120} animate={false} />);
    const hairSrc = hair('hs26').art[5];
    expect(tree.root.findAllByType(Image).filter((n) => n.props.source === hairSrc).length).toBe(1);
    act(() => tree.unmount());
  });
});
