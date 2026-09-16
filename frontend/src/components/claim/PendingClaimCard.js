// Home's way back to a claim the runner chose to plan later.
//
// The post-run claim screen can be left without placing the land ("Plan
// later"), and that land then waits for a while. Without something on Home
// saying so, "later" would quietly mean "never": nothing else in the app
// points back at an unplaced run. One card, for the newest run still waiting,
// with a count when there are more. Each is its own claim, placed one at a
// time, so a list would only be a longer way to reach the first.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import AppIcon from '../AppIcon';
import { HardShadow } from '../ui';
import { useAccentColor } from '../../hooks/useAccent';
import { NB, nbInk, nbRadius, space, useTheme, useThemedStyles, withAlpha } from '../../theme';
import { PressableScale } from '../../ui/motion';
import { claimTimeLeft } from '../../utils/claimWindow';

function formatArea(m2) {
  return `${(m2 / 1e6).toFixed(m2 >= 1e5 ? 2 : 3)} km²`;
}

// "5.02 km run covering 0.38 km², 21h left". The time goes last and drops out when
// there is no deadline.
export function pendingClaimLine(claim, now = Date.now()) {
  let line = `${((claim?.distance_m || 0) / 1000).toFixed(2)} km run`;
  if (claim?.claim_area_m2 > 0) line += ` covering ${formatArea(claim.claim_area_m2)}`;
  const left = claimTimeLeft(claim?.claim_expires_at, now).label;
  if (left) line += `, ${left}`;
  return line;
}

export default function PendingClaimCard({ claim, count = 1, onPress, style }) {
  const { colors, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const accent = useAccentColor().glow;
  if (!claim) return null;
  const ink = nbInk(scheme, colors.card);
  return (
    <HardShadow radius={nbRadius.sm} accent={accent} on={colors.bg} style={[styles.shadow, style]}>
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Plan your attack. Your land is waiting"
        style={[styles.card, { borderColor: ink }]}
      >
        <View style={[styles.icon, { backgroundColor: withAlpha(accent, 0.25), borderColor: ink }]}>
          <AppIcon name="claim" size={28} />
        </View>
        <View style={styles.text}>
          <Text style={[styles.eyebrow, { color: accent }]} numberOfLines={1}>
            {count > 1 ? `${count} RUNS HAVE LAND WAITING` : 'LAND WAITING'}
          </Text>
          <Text style={styles.title} numberOfLines={1}>Plan your attack</Text>
          <Text style={styles.line} numberOfLines={1}>{pendingClaimLine(claim)}</Text>
        </View>
        <ChevronRight size={22} color={colors.text} strokeWidth={3} />
      </PressableScale>
    </HardShadow>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  // Room for the drop, which HardShadow insets out of the wrapper by its own
  // offset; without it the block lands under whatever is below.
  shadow: { marginRight: NB.offset, marginBottom: NB.offset },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: nbRadius.sm,
    borderWidth: NB.stroke,
    padding: space.md,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: nbRadius.sm,
    borderWidth: NB.strokeThin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
  eyebrow: { ...type.captionMedium, letterSpacing: 0.8 },
  title: { ...type.bodySmBold, fontSize: 18, color: colors.text, marginTop: 1 },
  line: { ...type.caption, color: colors.textMuted, marginTop: 2 },
});
