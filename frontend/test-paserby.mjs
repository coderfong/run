// PASERBY — the client's own rules, tested where they actually live.
//
//     node test-paserby.mjs
//
// The app has no test runner (no jest, no babel-jest — see package.json), so
// this is a plain Node script in the same spirit as the backend's suites. It
// exercises `src/config/paserby.js`, which is deliberately pure and
// dependency-free precisely so it CAN be tested this way: the familiar-faces
// ladder, every piece of user-facing copy, the reveal's cast/overflow split,
// and the badge.
//
// The module is loaded through a data: URL rather than a plain import because
// the package has no "type": "module" — a `.js` file would be treated as
// CommonJS and its `export`s would be a syntax error. It has no imports of its
// own, so this is lossless.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = await readFile(join(here, 'src', 'config', 'paserby.js'), 'utf8');
const P = await import('data:text/javascript,' + encodeURIComponent(src));

const fails = [];
function check(label, cond, detail = '') {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (!cond && detail ? `   [${detail}]` : ''));
  if (!cond) fails.push(label);
}
const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

console.log('\n== familiar faces ==');
eq('1 crossing is Crossed Paths', P.familiarityFor(1).key, 'crossed_paths');
eq('2 is a Familiar Face', P.familiarityFor(2).label, 'Familiar Face');
eq('4 is still a Familiar Face', P.familiarityFor(4).label, 'Familiar Face');
eq('5 is a Running Regular', P.familiarityFor(5).label, 'Running Regular');
eq('10 is a Local Legend', P.familiarityFor(10).label, 'Local Legend');
eq('50 is still a Local Legend', P.familiarityFor(50).label, 'Local Legend');
eq('0 falls back rather than crashing', P.familiarityFor(0).key, 'crossed_paths');
eq('so does nonsense', P.familiarityFor(undefined).key, 'crossed_paths');
check(
  'the ladder is the four MVP rungs, in order',
  P.FAMILIARITY.map((f) => f.at).join(',') === '10,5,2,1'
);
eq(
  "the server's label wins over the local ladder",
  P.familiarityLabel({ times_crossed: 1, familiarity_label: 'Local Legend' }),
  'Local Legend'
);
eq(
  '...and the ladder covers a client ahead of a deploy',
  P.familiarityLabel({ times_crossed: 5 }),
  'Running Regular'
);

console.log('\n== copy ==');
eq('the plural case', P.crossedPathsLine(3), 'You crossed paths with 3 PASERs today.');
eq('the singular case', P.crossedPathsLine(1), 'You crossed paths with 1 PASER today.');
eq('zero still reads as a sentence', P.crossedPathsLine(0), 'You crossed paths with 0 PASERs today.');
eq('a repeat encounter names itself', P.repeatLine(4), 'Familiar face! You have crossed paths 4 times.');
eq('a first encounter has no repeat line', P.repeatLine(1), null);
eq('the overflow line', P.moreLine(4), '+4 more at the Crossroads');
eq('...and nothing when there is no overflow', P.moreLine(0), null);
eq('the empty state', P.COPY.empty, 'No crossed paths yet. Keep running and you may meet another PASER.');
eq('the reveal heading', P.COPY.revealHeading, 'CROSSED PATHS');
eq('the screen name', P.COPY.screen, 'Crossroads');
eq('the feature name', P.COPY.feature, 'PASERBY');

// The one naming rule the brief is explicit about.
const allCopy = JSON.stringify(P.COPY) + JSON.stringify(P.FAMILIARITY)
  + P.crossedPathsLine(2) + P.repeatLine(2) + P.moreLine(2);
check('no copy anywhere says "StreetPass"', !/street\s*pass/i.test(allCopy));

console.log('\n== the Home badge ==');
eq('nothing waiting means no badge', P.badgeLabel(0), null);
eq('...and neither does undefined', P.badgeLabel(undefined), null);
eq('three unseen', P.badgeLabel(3), '3 NEW');
eq('a lot of unseen is clamped', P.badgeLabel(1000), '99+ NEW');

console.log('\n== card subtitle ==');
eq('a first crossing shows only the broad date',
   P.encounterSubtitle({ when: 'Earlier today', times_crossed: 1 }), 'Earlier today');
eq('a repeat adds the count',
   P.encounterSubtitle({ when: 'Yesterday', times_crossed: 3 }), 'Yesterday · 3 times');
eq('a missing `when` never renders undefined', P.encounterSubtitle({}), 'Recently');

console.log('\n== the reveal ==');
const five = { encounters: [1, 2, 3, 4, 5].map((n) => ({ id: `e${n}` })), more_at_crossroads: 2 };
eq('at most three characters walk on', P.revealCast(five).shown.length, 3);
eq("...and the server's overflow count is what the +N line uses", P.revealCast(five).more, 2);
const two = { encounters: [{ id: 'a' }, { id: 'b' }] };
eq('a small reveal shows everyone', P.revealCast(two).shown.length, 2);
eq('...with nothing left over', P.revealCast(two).more, 0);
eq('a client-side overflow is derived when the server sent none',
   P.revealCast({ encounters: [1, 2, 3, 4, 5].map((n) => ({ id: n })) }).more, 2);
check('an empty run never opens the beat', P.shouldReveal({ encounters: [] }) === false);
check('...and neither does a failed request', P.shouldReveal(null) === false);
check('a run that met somebody does', P.shouldReveal(two) === true);
eq('the cast size matches the server default', P.REVEAL_CAST, 3);

console.log('\n' + '='.repeat(46));
console.log(fails.length ? `${fails.length} FAILED: ${fails.join(', ')}` : 'ALL PASSED');
process.exit(fails.length ? 1 : 0);
