// The signed-in user's accent color — used for the tab tint, the Record
// button ring, trails, and stat highlights. This is the ONE place accent is
// derived, so Phase 5 swaps "hash team color" for "clan color" here without
// touching any screen.

import { useAuth } from '../auth/AuthContext';
import { regionForUser } from '../data/regions';
import { colors } from '../theme';

// Clanless / signed-out fallback — a neutral slate, never a saturated hue.
export const NEUTRAL_ACCENT = '#64748b';

export function useAccent() {
  const { user } = useAuth();
  if (!user?.username) return NEUTRAL_ACCENT;
  // v1 behaviour: hash the username to one of the four team colors.
  // Phase 5 replaces this body with the user's clan color.
  return regionForUser(user.username).stroke || colors.primary;
}
