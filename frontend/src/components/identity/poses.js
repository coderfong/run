// Poses for the full body runner.
//
// THERE IS NO POSE ART. The runner is one standing paper doll (CharacterRig):
// one body PNG, garments laid over it. A real "arms crossed" or "peace sign"
// needs a second body drawn in that pose AND every top re-cut to fit it, which
// is an asset pass across the whole wardrobe, not a prop. So this file does not
// pretend. Each pose names what the rig can honestly do today:
//
//   neutral    standing, as drawn
//   celebrate  the rig's own hop with the laughing face (`play('celebrate')`)
//   thumbs     the rig's short nod (`play('thumbs')`)
//
// A pose is data so the component API is already the one poses will need: a
// caller asks for `pose="victory"` today and gets `neutral`, and the day a
// victory body exists it is added HERE (with the art it needs) and every caller
// already asking for it picks it up. Unknown names fall back rather than throw,
// because a pose is decoration and must never take a screen down.

export const POSES = {
  neutral: { play: null },
  celebrate: { play: 'celebrate' },
  thumbs: { play: 'thumbs' },
};

// Names callers may already ask for, mapped to the closest thing that exists.
// Kept explicit so it is obvious which ones are stand ins.
const ALIASES = {
  victory: 'celebrate',
  cheer: 'celebrate',
  wave: 'celebrate',
  'thumbs-up': 'thumbs',
  thumbsup: 'thumbs',
};

/** The pose to actually draw for a requested name. */
export function resolvePose(name) {
  if (!name) return 'neutral';
  if (POSES[name]) return name;
  if (ALIASES[name] && POSES[ALIASES[name]]) return ALIASES[name];
  return 'neutral';
}
