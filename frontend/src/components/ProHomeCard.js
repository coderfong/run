// The Home PRO card — the most restrained surface in the whole monetisation.
//
// THREE RULES, and they are the reason this is a separate component rather
// than six lines inside HomeScreen:
//
//   1. NOT AT THE TOP. Home opens on the runner's own board and their feed.
//      A subscription banner above that is the thing every free-to-play app
//      does and the thing everybody scrolls past with their jaw set. This
//      renders partway DOWN the feed, after real content.
//
//   2. NOT UNTIL THEY HAVE PLAYED. Gated on finished runs
//      (MIN_RUNS_BEFORE_HOME_CARD). Somebody on their first day does not know
//      what territory intelligence would even be FOR, so showing it to them
//      is noise that also teaches them the app sells things.
//
//   3. NO INVENTED STATS. The brief this was built from suggested a
//      contextual version — "You're #72 this week, you have climbed 18
//      places". The second half of that needs rank history nothing stores
//      (see docs/PRO_BACKEND.md), and a card that says a true thing next to
//      a made-up thing is a card that is lying. So it names the features,
//      which are real, and nothing else.
//
// It is one tap, it is skippable by scrolling, and it never covers anything.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { EVENTS, track } from '../analytics';
import { GOLD } from '../config/pro';
import { MIN_RUNS_BEFORE_HOME_CARD } from '../config/proExposure';
import { useProEntitlement } from '../pro/ProProvider';
import { radius, space, useTheme, useThemedType } from '../theme';
import { PressableScale, haptic } from '../ui/motion';

export default function ProHomeCard() {
  const { colors } = useTheme();
  const type = useThemedType();
  const { isPro, canShowPro, openPaywall, runCount } = useProEntitlement();
  const fired = useRef(false);

  // `runCount` is null until /me/stats lands. Null means NOT eligible, same as
  // everywhere else in this system: a card that flashes in a beat after the
  // feed has settled is worse than one that waits for the next visit.
  const eligible =
    canShowPro && !isPro && runCount != null && runCount >= MIN_RUNS_BEFORE_HOME_CARD;

  useEffect(() => {
    if (!eligible || fired.current) return;
    fired.current = true;
    track(EVENTS.TEASER_IMPRESSION, {
      source: 'home',
      context: 'home',
      feature: 'home_card',
    });
  }, [eligible]);

  if (!eligible) return null;

  return (
    <PressableScale
      onPress={() => {
        haptic.light();
        track(EVENTS.TEASER_TAP, { source: 'home', context: 'home', feature: 'home_card' });
        openPaywall('home');
      }}
      accessibilityRole="button"
      accessibilityLabel="Paser Pro. More stats and styles. Tap to explore"
      style={[styles.card, { backgroundColor: colors.card, borderColor: GOLD }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[type.captionMedium, { color: GOLD }]}>PASER PRO</Text>
        <Text style={[type.bodySmBold, { marginTop: 2 }]}>More stats. More styles.</Text>
        <Text style={[type.caption, { color: colors.textMuted, marginTop: 2 }]}>
          Planner, run stats and gear
        </Text>
      </View>
      <ChevronRight size={18} color={GOLD} strokeWidth={3} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 2,
    borderRadius: radius.card,
    padding: space.md,
    marginBottom: space.md,
  },
});
