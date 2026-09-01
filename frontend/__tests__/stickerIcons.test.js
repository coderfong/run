// PASER draws its own icons. A lucide line glyph next to them looks like a
// placeholder, because for most of this app's life that is exactly what it was.
//
// This is the rule, enforced: if a lucide icon means the same thing as a
// sticker in assets/icons, the sticker wins. Anything still importing the
// lucide version is either a miss or has to say why below.
//
// It is NOT a ban on lucide. Chevrons, locks, checks, close buttons and the
// like have no sticker and should not have one — they are chrome, they need to
// tint with the theme, and painted art at 14pt is a smudge.

import fs from 'fs';
import path from 'path';

import { ICONS } from '../src/components/AppIcon';

const SRC = path.join(__dirname, '..', 'src');

// lucide name → the sticker that says the same thing.
const EQUIVALENT = {
  Trophy: 'trophy',
  Flame: 'streak',
  Share2: 'share',
  Crown: 'crown',
  Timer: 'timer',
  Play: 'play',
  Pause: 'pause',
  Route: 'route',
  Sparkles: 'sparkles',
  Award: 'award',
  LocateFixed: 'locate',
  BadgeCheck: 'verified',
  Layers: 'layers',
};

// Deliberate exceptions, each with the reason it is not a miss.
//
// The shared rule behind most of them: a MIXED LIST is worse than a consistent
// one. One painted icon among two line icons in the same column reads as a
// mistake; all three as line icons reads as a deliberately quieter surface.
const ALLOWED = {
  // A three-row safety list. ShieldCheck and Flag have no sticker.
  'screens/OnboardingScreen.js': ['Route'],
  // A three-row reassurance list. ShieldCheck has no sticker.
  'screens/LocationPermissionScreen.js': ['Timer'],
  // A row of three destinations. Download and Copy have no sticker.
  'components/share/RunShareSheet.js': ['Share2'],

  // THE SET RULE. Both of these are a CHOOSER over a fixed set of glyphs — a
  // dozen clan emblems, a category per cosmetic slot — where two or three
  // members happen to have a sticker and the rest never will. Converting only
  // those would make the set look half-finished in the one place the whole
  // point is that the options are peers. A set converts entirely or not at
  // all, and these need art per member before they can.
  'components/ClanBadge.js': ['Crown', 'Flame'],
  'screens/AvatarStudioScreen.js': ['Crown', 'Layers', 'Sparkles'],

};

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const IMPORTS = /import\s*\{([^}]*)\}\s*from\s*'lucide-react-native'/g;
// LINE COMMENTS FIRST, then block comments — the order is load-bearing.
//
// Done the other way round, a `//` comment that happens to contain `/*` opens
// a block comment as far as this scan is concerned, and everything up to the
// next `*/` in the file disappears. That is not hypothetical: the onboarding
// screen's header says `assets/art/*`, which swallowed its own import line and
// quietly excluded the file from the scan.
const withoutComments = (source) =>
  source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

function offenders() {
  const found = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const source = withoutComments(fs.readFileSync(file, 'utf8'));
    let match;
    while ((match = IMPORTS.exec(source))) {
      for (const clause of match[1].split(',')) {
        const name = clause.trim().split(/\s+as\s+/)[0];
        if (!name || !EQUIVALENT[name]) continue;
        if ((ALLOWED[rel] || []).includes(name)) continue;
        found.push(`${name} in ${rel} → use <AppIcon name="${EQUIVALENT[name]}" />`);
      }
    }
  }
  return found;
}

describe('sticker icons beat line icons', () => {
  test('every sticker this maps to actually exists', () => {
    const missing = Object.values(EQUIVALENT).filter((name) => !ICONS[name]);
    expect(missing).toEqual([]);
  });

  test('no screen imports a lucide icon that has a sticker', () => {
    expect(offenders()).toEqual([]);
  });

  test('the allowlist has no stale entries', () => {
    // An exception that no longer describes real code is a note that has
    // stopped being true, and it would silently excuse a future miss.
    const stale = [];
    for (const [rel, names] of Object.entries(ALLOWED)) {
      if (!names.length) continue;
      const full = path.join(SRC, rel);
      const source = fs.existsSync(full) ? withoutComments(fs.readFileSync(full, 'utf8')) : '';
      // The import clause is the thing the main test scans, so an exception is
      // live exactly while that file still imports that name. Checked by
      // reading the same clauses rather than by searching the whole file, so a
      // name that merely appears in a string cannot keep an exception alive.
      const imported = new Set();
      let match;
      const clauses = new RegExp(IMPORTS.source, 'g');
      while ((match = clauses.exec(source))) {
        for (const clause of match[1].split(',')) {
          const name = clause.trim().split(/\s+as\s+/)[0];
          if (name) imported.add(name);
        }
      }
      for (const name of names) {
        if (!imported.has(name)) stale.push(`${name} in ${rel}`);
      }
    }
    expect(stale).toEqual([]);
  });
});
