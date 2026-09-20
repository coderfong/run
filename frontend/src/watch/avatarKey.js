// What names a look, for the Apple Watch portrait.
//
// Pure, and in its own file for the same reason watchState.js is: the picture
// of the runner is a React component that reaches the whole 294 item cosmetics
// catalogue and every PNG in it, and the rule for WHEN a picture needs sending
// should be testable without any of that. src/watch/watchAvatar.js draws the
// portrait and re-exports this.

// The slots that change what the portrait LOOKS like. Anything else on the
// loadout (and any key added later that does not draw) leaves the picture
// alone, so it must not cost a re-send.
const DRAWN = [
  'face',
  'hair',
  'hairColor',
  'headwear',
  'headwearColor',
  'glasses',
  'glassesColor',
  'top',
  'topColor',
  'bottom',
  'bottomColor',
  'footwear',
  'footwearColor',
  'accessory',
  'accessoryColor',
];

/**
 * A short, stable name for a look. FNV-1a over the drawn slots in a fixed
 * order, so the same outfit always produces the same key on every device and
 * across launches, which is the whole point: it is compared against the key
 * the watch says it already has.
 */
export function avatarKey(equipped) {
  const worn = equipped || {};
  const source = DRAWN.map((slot) => `${slot}=${worn[slot] ?? ''}`).join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    // FNV prime, in the 32 bit arithmetic JavaScript can actually do.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export default avatarKey;
