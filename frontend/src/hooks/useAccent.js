// The signed-in user's accent — their clan color, or a neutral slate when
// solo. This is the single place accent is derived; the whole app tints from
// it (tab bar, Record ring, trails, stat highlights).

import { useClan } from '../state/clan';

export { NEUTRAL as NEUTRAL_ACCENT } from '../state/clan';

// Full triple {fill, stroke, glow}.
export function useAccentColor() {
  return useClan().color;
}

// Just the stroke (most callers).
export function useAccent() {
  return useClan().accent;
}
