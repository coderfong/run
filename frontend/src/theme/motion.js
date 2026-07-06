// Motion presets. Reanimated springs, 150–350ms feel. One orchestrated
// moment per screen (list stagger OR hero count-up, never both). Reduce
// Motion is honored via the shared useReduceMotion hook (src/ui/motion.js).

export const spring = {
  // Standard press / enter spring.
  soft: { damping: 20, stiffness: 220 },
  // Snappier — buttons, chips.
  snappy: { damping: 20, stiffness: 300 },
  // Bouncy hero moment (loop-close bloom, count-up settle).
  bouncy: { damping: 14, stiffness: 180 },
};

export const timing = {
  fast: 150,
  base: 250,
  slow: 350,
};

// Standard list-stagger step (ms per item). Cap the multiplier so long
// lists don't crawl in.
export const STAGGER_MS = 30;
export const STAGGER_CAP = 12;

// Standard press-feedback scale.
export const PRESS_SCALE = 0.97;
