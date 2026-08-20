// ProLock — the one way to put a padlock on an EXISTING free feature.
//
// The rule this enforces, and why it is a component and not a pattern copied
// into six screens: a gate is three states, not one, and the two that are not
// "locked" are the ones a hand-rolled padlock always gets wrong.
//
//   canShowPro && !isPro   LOCKED. The feature is replaced by an affordance
//                          that names it, wears a PASER PRO padlock, and opens
//                          the paywall when tapped. Nobody is shown a value
//                          they did not pay for — see the note in ProTeaser on
//                          why a teaser must never invent a number.
//   isPro                  UNLOCKED. Render the real feature. They paid; show
//                          them what they paid for, with no chrome around it.
//   !canShowPro            UNLOCKED. PRO does not exist in this build (the
//                          store is off, the release switch is down). There is
//                          nothing to sell, so gating here would just hide a
//                          feature from EVERYONE for no reason. Render it.
//
// The middle and last states look identical from the outside — the feature is
// simply there — and that is correct. A build that cannot sell PRO must behave
// as though PRO was never invented.
//
// DEPTH, NOT POWER. Only wrap richer VIEWS and EXPRESSION: a splits table, an
// elevation read, a colour swatch. Never anything that changes what a run
// earns or where it stands — that line is the whole of config/pro.js, and a
// padlock on the wrong thing is pay-to-win however pretty the lock.
//
// The entitlement read and the impression/tap analytics are ProTeaser's
// `useProTeaser`, unchanged: a locked splits panel and a locked map layer are
// the same event in the funnel, and should stay one code path.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';

import { GOLD } from '../config/pro';
import { useProTeaser } from './ProTeaser';
import { PressableShift } from '../ui/motion';
import { HardShadow } from './ui';
import { NB, nbRadius, space, useTheme, useThemedType } from '../theme';

/**
 * Gate a whole feature behind PRO, swapping it for a lock card when locked.
 *
 * @param {string}   context  key from config/proContexts.js — decides the
 *                            paywall pitch and the analytics `source`.
 * @param {string}   [feature] finer-grained analytics name when one context
 *                            gates several things (the run has splits AND
 *                            elevation, both under `run_detail`).
 * @param {string}   title    the feature's own name. What they are missing,
 *                            not "Go PRO" — "Splits", "Elevation & pace depth".
 * @param {string}   [blurb]  one line of what it is.
 * @param {node}     children the real feature. Rendered whenever NOT locked.
 */
export function ProLockedSection({ context, feature, title, blurb, children, style }) {
  const { open, hidden } = useProTeaser(context, feature);
  const { colors } = useTheme();
  const type = useThemedType();

  // hidden === (!canShowPro || isPro) === "not locked". See the header: both of
  // those states render the real feature, and only those two.
  if (hidden) return children;

  return (
    <HardShadow accent={GOLD} radius={nbRadius.sm} style={style}>
      <PressableShift
        offset={NB.offset}
        onPress={() => open()}
        accessibilityRole="button"
        accessibilityLabel={`${title}, PASER PRO. Tap to unlock.`}
        style={[styles.card, { backgroundColor: colors.card, borderColor: GOLD }]}
      >
        <View style={styles.kicker}>
          <Lock size={14} color={GOLD} strokeWidth={2.5} />
          <Text style={[type.captionMedium, { color: GOLD }]}>PASER PRO</Text>
        </View>
        <Text style={[type.bodySmBold, { marginTop: 4 }]}>{title}</Text>
        {blurb ? (
          <Text style={[type.caption, { color: colors.textMuted, marginTop: 4 }]}>{blurb}</Text>
        ) : null}
        <Text style={[type.caption, { color: GOLD, marginTop: space.sm }]}>Tap to unlock ›</Text>
      </PressableShift>
    </HardShadow>
  );
}

/**
 * The slim variant, for gating a feature that lives INSIDE another surface
 * where a whole card would be too loud — a row of secondary stats on the
 * result card, a control in a settings block. Names the feature, wears the
 * padlock, opens the paywall.
 */
export function ProInlineLock({ context, feature, label, style }) {
  const { open, hidden } = useProTeaser(context, feature);
  const { colors } = useTheme();
  const type = useThemedType();

  if (hidden) return null;

  return (
    <PressableShift
      offset={NB.offsetSm}
      onPress={() => open()}
      accessibilityRole="button"
      accessibilityLabel={`${label}, PASER PRO. Tap to unlock.`}
      style={[styles.inline, { backgroundColor: colors.card, borderColor: GOLD }, style]}
    >
      <Text style={[type.caption, { color: colors.textMuted, flex: 1 }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.captionMedium, { color: GOLD }]}>PASER PRO</Text>
      <Lock size={13} color={GOLD} strokeWidth={2.5} />
    </PressableShift>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: NB.stroke,
    borderRadius: nbRadius.sm,
    padding: space.md,
  },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: NB.strokeThin,
    borderRadius: nbRadius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
});

export default ProLockedSection;
