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
  NB_DECK,
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
  tintOn,
  toRgb,
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

describe('the night palette', () => {
  const STEPS = [darkColors.bg, darkColors.card, darkColors.cardAlt];
  // Spread between the strongest and weakest channel. A grey has none.
  const chroma = (color) => {
    const { r, g, b } = toRgb(color);
    return Math.max(r, g, b) - Math.min(r, g, b);
  };

  // The dark scheme used to be three neutral greys, and that is the dull look
  // this replaced: every other surface in the style is a flat saturated fill,
  // and the page was the one thing with no colour in it.
  it('is a colour, not a grey, on every step', () => {
    STEPS.forEach((surface) => expect(chroma(surface)).toBeGreaterThanOrEqual(32));
  });

  it('keeps type readable on every step', () => {
    STEPS.forEach((surface) => {
      expect(contrastRatio(darkColors.text, surface)).toBeGreaterThanOrEqual(7);
    });
    // Muted is white at an alpha, so judge it the way it lands: composited.
    const muted = tintOn(darkColors.card, '#ffffff', toRgb(darkColors.textMuted).a);
    expect(contrastRatio(muted, darkColors.card)).toBeGreaterThanOrEqual(4.5);
  });

  // A saturated page is only an improvement while the deck still stands on it.
  it('lets every deck colour stand clear of the page', () => {
    NB_DECK.forEach((accent) => {
      expect(contrastRatio(accent, darkColors.bg)).toBeGreaterThanOrEqual(INK_MIN_CONTRAST);
    });
  });

  // The dot grid is texture, not line work. It has to be there, and it has to
  // sit well under the stroke floor, or it competes with the boxes it is meant
  // to set off.
  it('draws a dot grid that shows but stays quieter than any stroke', () => {
    const dot = tintOn(darkColors.bg, darkColors.grid, toRgb(darkColors.grid).a);
    const ratio = contrastRatio(dot, darkColors.bg);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(INK_MIN_CONTRAST);
  });

  it('leaves the paper plain', () => {
    expect(lightColors.grid).toBeNull();
  });
});
