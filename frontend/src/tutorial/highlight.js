// "This is *YOUR TERRITORY*." → the words that matter, in the game's colour.
//
// A one-character markup rather than call sites assembling <Text> children by
// hand, because the copy is the part that gets rewritten: a writer changing
// which two words are emphasised should be editing a string in steps.js, not
// a JSX tree.
//
// Pure and exported separately from the component that renders it so the
// parse can be tested without a renderer.

const TOKEN = /\*([^*]+)\*/g;

/**
 * Split copy into `{ text, strong }` runs.
 *
 * Unbalanced markers are left alone rather than swallowed: a stray asterisk in
 * a string should render as an asterisk, which is visible and obviously wrong,
 * instead of silently eating the rest of the sentence.
 *
 * @param {string} copy
 * @returns {{text: string, strong: boolean}[]}
 */
export function parseHighlights(copy) {
  const source = typeof copy === 'string' ? copy : '';
  if (!source) return [];

  const runs = [];
  let last = 0;
  TOKEN.lastIndex = 0;
  let match = TOKEN.exec(source);
  while (match) {
    if (match.index > last) runs.push({ text: source.slice(last, match.index), strong: false });
    runs.push({ text: match[1], strong: true });
    last = match.index + match[0].length;
    match = TOKEN.exec(source);
  }
  if (last < source.length) runs.push({ text: source.slice(last), strong: false });
  return runs.filter((run) => run.text.length > 0);
}

/** The same string with the markup taken out — what a screen reader hears. */
export function plainText(copy) {
  return parseHighlights(copy).map((run) => run.text).join('');
}
