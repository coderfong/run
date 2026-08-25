// The in-app half of a Crossed Paths arrival.
//
// The push already existed and already worked — while the app is SHUT. With it
// open, Expo hands the notification to the foreground listener and draws
// nothing, so the one moment somebody is most likely to act on "a new PASER is
// waiting" was the one moment the app said nothing at all. The badge on Home's
// rail is not that: it is a number you find, not a thing that arrives.
//
// So this is the same sentence, in a banner, over whatever screen is up. It is
// deliberately NOT the LandCaptureAlert treatment — losing land is an event
// worth a full-screen cutscene, somebody turning up at the plaza is worth a
// line you can tap or ignore. No modal, no scrim, nothing blocked.
//
// It also carries the push TAP: opening the app from the notification lands on
// the plaza rather than wherever the app happened to be.
//
// Wording lives in config/paserby.js and mirrors the server, so the banner and
// the push a runner may have already seen on the lock screen say one thing.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import * as Notifications from 'expo-notifications';

import { invalidate } from '../api/cache';
import { art } from '../config/onboardingArt';
import { crossroadsWaitingLine } from '../config/paserby';
import { NB, nbInk, radius, space, useTheme, useThemedType } from '../theme';
import { Image } from '../ui/image';
import { PressableScale, haptic } from '../ui/motion';
import HardShadow from './ui/HardShadow';

// Long enough to read twice, short enough that it is gone before it is in the
// way of anything.
const DWELL_MS = 6000;

// The plaza's own yellow, so the banner reads as the Crossroads arriving rather
// than as a system message. Same constant the header panel and the intro card
// take (config/onboardingArt.js ART_BG.panelCrossroads) — see CrossroadsScreen.
const PLAZA_YELLOW = '#FDC302';

const ART = art('panelCrossroads');

// Set by CrossroadsScreen while it is the focused screen. Telling somebody who
// is standing in the plaza that somebody is waiting in the plaza is noise, and
// the arrival animation on that screen is the better answer anyway.
let atCrossroads = false;
export function setAtCrossroads(value) {
  atCrossroads = !!value;
}

/**
 * Was this notification raised for a Crossed Paths ARRIVAL? High fives ride the
 * same `paserby` category and are somebody reacting to you, not somebody
 * turning up — they keep the ordinary push and no banner.
 */
function arrivalCount(data) {
  if (!data || data.category !== 'paserby') return 0;
  if (data.kind !== 'paserby_arrival') return 0;
  const n = Number(data.count);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function CrossroadsAlertHost({ onOpen }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const [alert, setAlert] = useState(null);
  const timer = useRef(null);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setAlert(null);
  }, []);

  const raise = useCallback((count) => {
    // The badge and the plaza both read `me:paserby` / the encounter list, and
    // both are now out of date by exactly this arrival. Dropping them means the
    // rail's count is right the moment the banner appears, whether or not the
    // banner is tapped.
    invalidate('me:paserby');
    haptic.light();
    clearTimeout(timer.current);
    setAlert({ id: Date.now(), body: crossroadsWaitingLine(count) });
    timer.current = setTimeout(() => setAlert(null), DWELL_MS);
  }, []);

  useEffect(() => {
    let received = null;
    let responded = null;
    try {
      received = Notifications.addNotificationReceivedListener((notification) => {
        const count = arrivalCount(notification?.request?.content?.data);
        if (count && !atCrossroads) raise(count);
      });
      // Tapping the push (or the notification centre entry) while the app is
      // backgrounded: no banner, straight to the plaza.
      responded = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response?.notification?.request?.content?.data;
        if (!arrivalCount(data)) return;
        invalidate('me:paserby');
        onOpen?.();
      });
    } catch {
      // Expo web and a few development runtimes have no foreground listeners.
      // The push itself, the inbox row and the rail badge all still work.
    }
    return () => {
      clearTimeout(timer.current);
      received?.remove?.();
      responded?.remove?.();
    };
  }, [onOpen, raise]);

  if (!alert) return null;

  const ink = nbInk(scheme, PLAZA_YELLOW);

  return (
    <Animated.View
      key={alert.id}
      entering={FadeInUp.duration(240)}
      exiting={FadeOutUp.duration(180)}
      style={[styles.wrap, { top: insets.top + space.xs }]}
      pointerEvents="box-none"
    >
      <HardShadow radius={radius.card} on={PLAZA_YELLOW}>
        <PressableScale
          onPress={() => {
            dismiss();
            onOpen?.();
          }}
          accessibilityRole="button"
          accessibilityLabel={alert.body}
          style={[styles.card, { backgroundColor: PLAZA_YELLOW, borderColor: ink }]}
        >
          {ART ? (
            <Image source={ART} style={styles.art} resizeMode="contain" accessible={false} />
          ) : null}
          <View style={{ flex: 1 }}>
            <Text style={[type.labelSm, { color: ink }]}>CROSSROADS</Text>
            <Text style={[type.bodySm, { color: ink }]} numberOfLines={2}>
              {alert.body}
            </Text>
          </View>
        </PressableScale>
      </HardShadow>
      {/* A separate, larger target than the card, so dismissing never opens the
          plaza by accident. */}
      <PressableScale
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.dismiss}
      >
        <Text style={[type.labelSm, { color: colors.textMuted }]}>DISMISS</Text>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.gutter, right: space.gutter, alignItems: 'stretch' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.card,
    borderWidth: NB.stroke,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  art: { width: 52, height: 40 },
  dismiss: { alignSelf: 'center', paddingTop: space.sm, paddingHorizontal: space.md },
});

export default CrossroadsAlertHost;
