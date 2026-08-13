// The signed-in user's accent — their clan color, or a neutral slate when
// solo. This is the single place accent is derived; the whole app tints from
// it (tab bar, Record ring, trails, stat highlights).

import { useClan } from '../state/clan';
import { useSettings } from '../state/settings';
import { withAlpha } from '../theme';

export { NEUTRAL as NEUTRAL_ACCENT } from '../state/clan';

// Full triple {fill, stroke, glow}.
export function useAccentColor() {
  const base = useClan().color;
  const { trailGlowColor } = useSettings();
  if (!trailGlowColor) return base;
  return { fill: withAlpha(trailGlowColor, 0.2), stroke: trailGlowColor, glow: trailGlowColor };
}

// Just the stroke (most callers).
export function useAccent() {
  const { accent } = useClan();
  return useSettings().trailGlowColor || accent;
}
