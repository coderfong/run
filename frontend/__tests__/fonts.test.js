// Every family a style can ask for has to be one App.js actually loads.
//
// A family name that is not registered does not throw: iOS and Android both
// quietly fall back to the system font, so a typo here ships as a screen of
// San Francisco in the middle of the app.

import { fonts } from '../src/theme/tokens';
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

  // Each weight is imported by name from its own subpath, and a wrong name
  // imports undefined rather than failing, which loads no font at all.
  it('resolves every family to a font file', () => {
    for (const family of Object.keys(FONT_FILES)) {
      expect(FONT_FILES[family]).toBeDefined();
    }
  });
});
