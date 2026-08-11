// The emote vocabulary — the reactions you can leave on somebody else's run,
// and the one-shot emote played when one is left.
//
// Every entry points at a sheet from the `tiny_rpg` package (Tiny RPG Emoji
// Pack I, CC0), so nothing here can be blocked out from under the feature the
// way a pack with no licence file can.
//
// `key` is what the SERVER stores, and the two sides of this file are
// deliberately separable: keys name the GESTURE ("love", "wow"), values name
// the art. Swapping the whole pack — which has happened once already — is then
// a change to the right hand column and nobody's stored reactions move.

export const REACTIONS = Object.freeze({
  love: 'reaction_love',
  happy: 'reaction_happy',
  wow: 'reaction_wow',
  respect: 'reaction_respect',
  brutal: 'reaction_brutal',
  rival: 'reaction_rival',
  vibes: 'reaction_vibes',
  idea: 'reaction_idea',
  // Not on the picker, but valid to RECEIVE and render. Some of these are
  // keys a previous build sent and some are simply retired, and every one of
  // them is already sitting in somebody's reaction row on the server — so they
  // keep resolving to the nearest sheet in the current pack rather than
  // becoming a blank box on the card.
  surprise: 'reaction_wow',
  exclamation: 'reaction_exclamation',
  angry: 'reaction_rival',
  heartbreak: 'reaction_crying',
  flowers: 'reaction_respect',
  tear: 'reaction_crying',
  question: 'reaction_question',
  dots: 'reaction_speechless',
  sleeping: 'reaction_sleepy',
  despair: 'reaction_frustrated',
});

// The picker, in the order it is drawn. Eight is what fits across a popover
// that stays narrower than a card on the smallest phone we support, and a
// popover that has to wrap is a panel again.
export const REACTION_PICKER = Object.freeze([
  'love', 'happy', 'wow', 'respect',
  'brutal', 'rival', 'vibes', 'idea',
]);

// Labels are read aloud by screen readers and shown under the tiles. No dashes,
// per the app's copy rule.
export const REACTION_LABELS = Object.freeze({
  love: 'Love it',
  happy: 'Nice one',
  wow: 'No way',
  respect: 'Respect',
  brutal: 'Brutal',
  rival: 'Rivalry',
  vibes: 'Vibes',
  idea: 'Smart line',
  surprise: 'No way',
  exclamation: 'No way',
  angry: 'Rivalry',
  heartbreak: 'Heartbreak',
  flowers: 'Respect',
  tear: 'Feel that',
  question: 'How',
  dots: 'Speechless',
  sleeping: 'Steady',
  despair: 'Rough one',
});

// Which frame EmoteIcon holds when it draws a reaction as a still chip.
//
// Every sheet in this pack runs the same shape on a 5x4 grid of 32x32 cells:
// a dot at frame 0, the bubble popping open over frames 1 to 4, a long hold
// through the middle, then a shrink and a trailing dot at 15. Cells 16 to 19
// are blank padding.
//
// So ONE index is right for all of them, and 7 is the middle of the hold —
// bubble fully open, emote at full size, nothing mid-transition. That is why
// this is a single constant rather than the per-emote table the previous pack
// needed, where each sheet timed its own pop differently.
export const REACTION_STILL_FRAME_INDEX = 7;

export const isReaction = (reaction) => Object.prototype.hasOwnProperty.call(REACTIONS, reaction);

export const getReactionEffect = (reaction) => REACTIONS[reaction] || null;

export const getReactionLabel = (reaction) => REACTION_LABELS[reaction] || 'Reaction';
