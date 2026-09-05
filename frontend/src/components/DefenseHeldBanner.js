// The in-app half of "someone attacked your land and it held".
//
// The backend sends a `defended` push the moment a claim runs your border but
// fails to take ground (backend/app/routes/runs.py). While the app is shut
// that lands on the lock screen; with it open, Expo draws nothing, so the one
// beat that makes defending feel earned — you were attacked and you WON — went
// unseen unless the runner later opened the bell.
//
// This is that sentence in a banner, over whatever screen is up. It is
// deliberately NOT the LandCaptureAlert treatment: losing land is a full-screen
// cutscene, a defense that held is a line you can tap to the map or ignore.
// The event stays an inbox row either way.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { ShieldCheck } from 'lucide-react-native';

import { invalidateAfterLandLoss } from '../api/cache';
import { subscribeNotificationEvents } from '../notifications/events';
import { NB, nbInk, radius, space, useTheme, useThemedType } from '../theme';
import { PressableScale, haptic } from '../ui/motion';
import HardShadow from './ui/HardShadow';

const DWELL_MS = 6000;
const DUPLICATE_TTL_MS = 45_000;

// A hold, not an alarm — the app's own green.
const HOLD_GREEN = '#2FBF71';

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function focusFrom(data) {
  const lat = finite(data?.lat);
  const lon = finite(data?.lon);
  return lat != null && lon != null ? { focus: { lat, lon } } : undefined;
}

export function DefenseHeldBanner({ onOpen }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const [alert, setAlert] = useState(null);
  const timer = useRef(null);
  const seen = useRef(new Map());

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setAlert(null);
  }, []);

  const raise = useCallback((item) => {
    const now = Date.now();
    for (const [key, at] of seen.current) {
      if (now - at > DUPLICATE_TTL_MS) seen.current.delete(key);
    }
    const key = item.id || `${item.body || ''}`;
    if (seen.current.has(key)) return;
    seen.current.set(key, now);
    // Rank boards, rivalries and the feed all moved behind this fight too.
    invalidateAfterLandLoss();
    haptic.light();
    clearTimeout(timer.current);
    setAlert({
      id: item.id || now,
      body: item.body || 'A rival ran your border and your territory held.',
      focus: focusFrom(item.data),
    });
    timer.current = setTimeout(() => setAlert(null), DWELL_MS);
  }, []);

  useEffect(
    () => subscribeNotificationEvents((item) => {
      if (item.category === 'defended' || item.data?.category === 'defended') raise(item);
    }),
    [raise]
  );

  if (!alert) return null;

  const ink = nbInk(scheme, HOLD_GREEN);

  return (
    <Animated.View
      key={alert.id}
      entering={FadeInUp.duration(240)}
      exiting={FadeOutUp.duration(180)}
      style={[styles.wrap, { top: insets.top + space.xs }]}
      pointerEvents="box-none"
    >
      <HardShadow radius={radius.card} on={HOLD_GREEN}>
        <PressableScale
          onPress={() => {
            dismiss();
            onOpen?.(alert.focus);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Your defense held. ${alert.body}`}
          style={[styles.card, { backgroundColor: HOLD_GREEN, borderColor: ink }]}
        >
          <View style={styles.badge}>
            <ShieldCheck size={22} color={ink} strokeWidth={3} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[type.labelSm, { color: ink }]}>DEFENSE HELD</Text>
            <Text style={[type.bodySm, { color: ink }]} numberOfLines={2}>
              {alert.body}
            </Text>
          </View>
        </PressableScale>
      </HardShadow>
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
  badge: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  dismiss: { alignSelf: 'center', paddingTop: space.sm, paddingHorizontal: space.md },
});

export default DefenseHeldBanner;
