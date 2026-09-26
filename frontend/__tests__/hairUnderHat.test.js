/**
 * Hair under a hat, as set in the Fit Studio (src/config/hairUnderHat.json):
 * painted covers and with-hat hair positions, and which one wins against the
 * compatibility rules (hairHeadwearCompat.json).
 */

const SQUARE = [[[0.2, -3], [0.8, -3], [0.8, 0.2], [0.2, 0.2]]];
const PAIR = [[[0.1, -3], [0.9, -3], [0.9, 0.3], [0.1, 0.3]]];

jest.mock('../src/config/hairUnderHat.json', () => ({
  cover: {
    dadcap: { '*': [[[0.2, -3], [0.8, -3], [0.8, 0.2], [0.2, 0.2]]], sleeklong: [[[0.1, -3], [0.9, -3], [0.9, 0.3], [0.1, 0.3]]] },
    cur_racingvisor: { '*': [] },
    cur_astronauthelmet: { hijab: [[[0, -3], [1, -3], [1, 0], [0, 0]]] },
  },
  layout: {
    sleeklong: { '*': { w: 0.8, top: 0.01, dx: 0 }, cur_racingvisor: { w: 0.9, cy: 0.1, dx: 0.02 } },
  },
}));
// No measured undersides: the unpainted-hat fallback is the measured notch.
jest.mock('../src/config/hatUndersides.json', () => ({ hats: {} }));

const { getHairLayout, getHairOcclusion } = require('../src/config/headwearFit');
const { getItem } = require('../src/config/cosmetics');

const hat = (id) => getItem('headwear', id);
const hair = (id) => getItem('hair', id);

describe('painted covers', () => {
  it("uses the pair's own cover over the hat's cover for every hairstyle", () => {
    expect(getHairOcclusion(hat('dadcap'), hair('sleeklong'))).toEqual({ cover: PAIR });
    expect(getHairOcclusion(hat('dadcap'), hair('bluntbob'))).toEqual({ cover: SQUARE });
  });

  it("lets a pair's own cover win over the compatibility rules too", () => {
    expect(getHairOcclusion(hat('cur_astronauthelmet'), hair('hijab'))).toEqual({ cover: [[[0, -3], [1, -3], [1, 0], [0, 0]]] });
    expect(getHairOcclusion(hat('cur_astronauthelmet'), hair('sleeklong'))).toEqual({ hide: true });
  });

  it("keeps a top knot's bun out of a hat-wide cover under a cap", () => {
    const occ = getHairOcclusion(hat('dadcap'), hair('topknot'));
    expect(occ.cover).toEqual(SQUARE);
    expect(occ.features.keep.length).toBeGreaterThan(0);
  });

  it('applies to open-top pieces too, where an empty cover shows all the hair', () => {
    expect(getHairOcclusion(hat('cur_racingvisor'), hair('sleeklong'))).toEqual({ cover: [] });
  });

  it('leaves an unpainted, unmeasured hat on the measured shape', () => {
    expect(getHairOcclusion(hat('wolfears'), hair('sleeklong'))).toHaveProperty('crownY');
  });
});

describe('with-hat hair position', () => {
  it('moves the hair under every crown-covering hat', () => {
    const lay = getHairLayout(hat('dadcap'), hair('sleeklong'));
    expect(lay).toMatchObject({ w: 0.8, top: 0.01, dx: 0 });
    expect(lay.cy).toBeUndefined();
  });

  it("uses the hat's own entry, even on an open-top piece, and drops the other anchor", () => {
    const lay = getHairLayout(hat('cur_racingvisor'), hair('sleeklong'));
    expect(lay).toMatchObject({ w: 0.9, cy: 0.1, dx: 0.02 });
    expect(lay.top).toBeUndefined();
  });

  it('keeps the plain layout bare-headed, under open-top pieces with no entry, and for other styles', () => {
    expect(getHairLayout(hat('none'), hair('sleeklong'))).toBe(hair('sleeklong').layout || null);
    expect(getHairLayout(hat('headphones'), hair('sleeklong'))).toBe(hair('sleeklong').layout || null);
    expect(getHairLayout(hat('dadcap'), hair('bluntbob'))).toBe(hair('bluntbob').layout || null);
  });
});
