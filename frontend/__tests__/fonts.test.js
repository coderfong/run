// Every family a style can ask for has to be one App.js actually loads.
//
// A family name that is not registered does not throw: iOS and Android both
// quietly fall back to the system font, so a typo here ships as a screen of
// San Francisco in the middle of a hand-lettered app.

import { fonts, HEADING_CASE, type } from '../src/theme/tokens';
import { toonType } from '../src/theme/toon';
import { FONT_FILES } from '../src/theme/fontFiles';

describe('font tokens', () => {
  it('only names families that are loaded', () => {
    const loaded = Object.keys(FONT_FILES);
    for (const family of Object.values(fonts)) {
      expect(loaded).toContain(family);
    }
  });

  it('loads nothing no token uses', () => {
    const used = new Set(Object.values(fonts));
    for (const family of Object.keys(FONT_FILES)) {
      expect(used.has(family)).toBe(true);
    }
  });

  // Headings read lowercase, like the specimen sheet (the user's call,
  // 2026-09-13). One switch drives every heading style, so none can drift.
  it('sets every heading style in the one heading case', () => {
    expect(HEADING_CASE).toBe('lowercase');
    for (const key of ['hero', 'display', 'title', 'heading', 'label', 'labelSm']) {
      expect(type[key].textTransform).toBe(HEADING_CASE);
    }
    for (const key of ['hero', 'headline', 'sub', 'title', 'label']) {
      expect(toonType[key].textTransform).toBe(HEADING_CASE);
    }
  });
});
