/**
 * Hair under a hat, as set in the Fit Studio (src/config/hairUnderHat.json):
 * painted covers and with-hat hair positions, and which one wins.
 */

const SQUARE = [[[0.2, -3], [0.8, -3], [0.8, 0.2], [0.2, 0.2]]];
const PAIR = [[[0.1, -3], [0.9, -3], [0.9, 0.3], [0.1, 0.3]]];

jest.mock('../src/config/hairUnderHat.json', () => ({
  cover: {
    cap: { '*': [[[0.2, -3], [0.8, -3], [0.8, 0.2], [0.2, 0.2]]], sleeklong: [[[0.1, -3], [0.9, -3], [0.9, 0.3], [0.1, 0.3]]] },
    runvisor: { '*': [] },
  },
  layout: {
    sleeklong: { '*': { w: 0.8, top: 0.01, dx: 0 }, runvisor: { w: 0.9, cy: 0.1, dx: 0.02 } },
  },
}));

const { getHairLayout, getHairOcclusion } = require('../src/config/headwearFit');
const { getItem } = require('../src/config/cosmetics');

const hat = (id) => getItem('headwear', id);
const hair = (id) => getItem('hair', id);

describe('painted covers', () => {
  it("uses the pair's own cover over the hat's cover for every hairstyle", () => {
    expect(getHairOcclusion(hat('cap'), hair('sleeklong'))).toEqual({ cover: PAIR });
    expect(getHairOcclusion(hat('cap'), hair('bluntbob'))).toEqual({ cover: SQUARE });
  });

  it('still drops a crown-gathered style under a closed hat with only a hat-wide cover', () => {
    expect(getHairOcclusion(hat('cap'), hair('highbun'))).toEqual({ hide: true });
  });

  it('applies to open-top pieces too, where an empty cover shows all the hair', () => {
    expect(getHairOcclusion(hat('runvisor'), hair('sleeklong'))).toEqual({ cover: [] });
  });

  it('leaves unpainted hats on the measured shape', () => {
    expect(getHairOcclusion(hat('knitbeanie'), hair('sleeklong'))).toHaveProperty('crownY');
  });
});

describe('with-hat hair position', () => {
  it('moves the hair under every crown-covering hat', () => {
    const lay = getHairLayout(hat('cap'), hair('sleeklong'));
    expect(lay).toMatchObject({ w: 0.8, top: 0.01, dx: 0 });
    expect(lay.cy).toBeUndefined();
  });

  it("uses the hat's own entry, even on an open-top piece, and drops the other anchor", () => {
    const lay = getHairLayout(hat('runvisor'), hair('sleeklong'));
    expect(lay).toMatchObject({ w: 0.9, cy: 0.1, dx: 0.02 });
    expect(lay.top).toBeUndefined();
  });

  it('keeps the plain layout bare-headed, under open-top pieces with no entry, and for other styles', () => {
    expect(getHairLayout(hat('none'), hair('sleeklong'))).toBe(hair('sleeklong').layout || null);
    expect(getHairLayout(hat('headphones'), hair('sleeklong'))).toBe(hair('sleeklong').layout || null);
    expect(getHairLayout(hat('cap'), hair('bluntbob'))).toBe(hair('bluntbob').layout || null);
  });
});
