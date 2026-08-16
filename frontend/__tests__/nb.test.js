// The neo-brutalist stroke and shadow rules.
//
// These are pure functions on purpose, and tested rather than eyeballed for the
// same reason `frameInkFor` is: the failure mode is INVISIBILITY. A stroke that
// comes out the same colour as what it is drawn on renders perfectly, passes
// every snapshot, and looks like a box that simply has no outline. The only way
// to catch it is to assert the contrast.

import {
  INK_MIN_CONTRAST,
  NB,
  NB_DROP_DARK,
  contrastRatio,
  darkColors,
  hardShadow,
  lightColors,
  nbAccents,
  nbDrop,
  nbInk,
  radius,
  shadow,
  toonSurface,
} from '../src/theme';

describe('nbInk', () => {
  it('takes the scheme when there is no surface to judge against', () => {
    expect(nbInk('light')).toBe(NB.ink);
    expect(nbInk('dark')).toBe(NB.inkLight);
  });

  it('is visible on its own scheme surfaces', () => {
    const onPaper = nbInk('light', lightColors.card);
    const onNight = nbInk('dark', darkColors.card);
    expect(contrastRatio(onPaper, lightColors.card)).toBeGreaterThanOrEqual(INK_MIN_CONTRAST);
    expect(contrastRatio(onNight, darkColors.card)).toBeGreaterThanOrEqual(INK_MIN_CONTRAST);
  });

  // The case the whole `on` parameter exists for: a box whose fill disagrees
  // with the page it is on. A `dark` Card in the light scheme, a chip on a
  // magenta panel. Picking off the scheme alone gets both of these wrong.
  it('follows the surface, not the scheme, when the two disagree', () => {
    expect(nbInk('light', darkColors.card)).toBe(NB.inkLight);
    expect(nbInk('dark', lightColors.card)).toBe(NB.ink);
  });

  it('stays visible on every accent it might be drawn over', () => {
    Object.values(nbAccents).forEach((accent) => {
      const ink = nbInk('light', accent);
      expect(contrastRatio(ink, accent)).toBeGreaterThanOrEqual(INK_MIN_CONTRAST);
    });
  });
});

describe('nbDrop', () => {
  it('is the reference near-black on light', () => {
    expect(nbDrop('light')).toBe(NB.ink);
    expect(nbDrop('light', { accent: nbAccents.magenta })).toBe(NB.ink);
  });

  it('moves to a saturated accent on dark, where black would be nothing', () => {
    expect(nbDrop('dark')).toBe(NB_DROP_DARK);
    expect(nbDrop('dark', { accent: nbAccents.magenta })).toBe(nbAccents.magenta);
  });

  it('is visible against the dark page it falls on', () => {
    expect(contrastRatio(nbDrop('dark'), darkColors.bg)).toBeGreaterThanOrEqual(INK_MIN_CONTRAST);
  });

  // A cream card or a yellow chip on the dark page still wants a black drop:
  // the shadow is read against the box it falls from as much as the page.
  it('goes back to black for a light box on the dark page', () => {
    expect(nbDrop('dark', { on: lightColors.card })).toBe(NB.ink);
    expect(nbDrop('dark', { on: nbAccents.yellow })).toBe(NB.ink);
  });
});

describe('hardShadow', () => {
  it('has zero blur and full opacity — the whole point of it', () => {
    const s = hardShadow('#000000');
    expect(s.shadowRadius).toBe(0);
    expect(s.shadowOpacity).toBe(1);
  });

  it('offsets on BOTH axes, equally, so the page is lit from one corner', () => {
    const s = hardShadow('#000000', 6);
    expect(s.shadowOffset).toEqual({ width: 6, height: 6 });
  });

  // Not an oversight. Android's elevation is always a blurred material shadow
  // pointing straight down; asking for one under a hard-edged card reads as the
  // style failing. Android gets its drop from the HardShadow component instead.
  it('asks Android for no elevation rather than for a blur', () => {
    expect(hardShadow('#000000').elevation).toBe(0);
  });

  it('is the same recipe as the shadow.hard token', () => {
    expect(hardShadow('#123456', 5)).toEqual(shadow.hard('#123456', 5));
  });
});

describe('toonSurface', () => {
  it('gives dark a real stroke and a real shadow, not the old opt-out', () => {
    const s = toonSurface(darkColors, 'dark');
    expect(s.outline.borderWidth).toBe(NB.stroke);
    expect(contrastRatio(s.outline.borderColor, darkColors.card)).toBeGreaterThanOrEqual(
      INK_MIN_CONTRAST
    );
    // The old version returned {} here, which is what made the app light-only.
    expect(s.shadow.shadowOpacity).toBe(1);
    expect(s.shadow.shadowRadius).toBe(0);
  });

  it('matches its shadow offset to the value callers press by', () => {
    const s = toonSurface(darkColors, 'dark');
    expect(s.shadow.shadowOffset).toEqual({ width: s.offset, height: s.offset });
  });

  it('honours a caller accent on dark and ignores it on light', () => {
    expect(toonSurface(darkColors, 'dark', { accent: nbAccents.coral }).shadow.shadowColor)
      .toBe(nbAccents.coral);
    expect(toonSurface(lightColors, 'light', { accent: nbAccents.coral }).shadow.shadowColor)
      .toBe(NB.ink);
  });
});

describe('radius scale', () => {
  // "Limited radii" is a rule, not a preference — the six-step scale this
  // replaced is what kept the app reading soft under any stroke weight.
  it('is limited to 0 / 12 / 24 (plus the pill)', () => {
    const distinct = new Set(Object.values(radius).filter((r) => r !== radius.pill));
    expect([...distinct].sort((a, b) => a - b)).toEqual([0, 12, 24]);
  });
});
