// Haptics — restrained (constitution): success notification on loop close +
// run finish; light impact on tab switch and primary buttons; nowhere else.
// All fire-and-forget.
//
// `heavy` is the one deliberate addition to that list, and it is reserved for
// the impact frame of a capture cutscene — a meteor landing, a flagpole driven
// into the ground. Five capture styles were already ASKING for it, and because
// the player calls `haptic[name]?.()` those five silently felt nothing at their
// climax for as long as they have shipped. `HAPTIC_STYLES` below is exported so
// choreography validation can reject an unknown name at test time rather than
// letting the next one fail the same silent way.

import * as Haptics from 'expo-haptics';

export const haptic = {
  light() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  medium() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
  heavy() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  },
  success() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  warning() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
};

/** Every name `haptic[name]()` will actually answer to. */
export const HAPTIC_STYLES = Object.freeze(Object.keys(haptic));
