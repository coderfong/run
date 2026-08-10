import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { brand, darkColors, radius, shadow, space, type } from '../../theme';
import { useReduceMotion } from '../../ui/motion';
import GameLottie from '../GameLottie';

const EVENT_COPY = {
  kilometre: (event) => ({ title: `${event.value} KM`, body: 'Split secured', lottie: 'kilometre' }),
  claimReady: () => ({ title: 'CLAIM READY', body: 'This run can secure territory', lottie: 'claimReady' }),
  rivalEntry: () => ({ title: 'RIVAL TURF', body: 'You crossed into contested ground', lottie: 'rivalEntry' }),
};

export function RunStartOverlay({ value, trigger }) {
  const reduced = useReduceMotion();
  if (value == null) return null;
  const go = value === 'GO';

  return (
    <View pointerEvents="none" style={styles.fullOverlay}>
      {go ? <GameLottie name="runStart" size={260} trigger={trigger} style={styles.startLottie} /> : null}
      <Animated.View
        key={`${value}:${trigger}`}
        entering={reduced ? undefined : ZoomIn.duration(220)}
        exiting={reduced ? undefined : FadeOut.duration(120)}
        style={[styles.countBubble, go && styles.goBubble]}
      >
        <Text style={[styles.countText, go && styles.goText]}>{value}</Text>
      </Animated.View>
      <Text style={styles.readyLabel}>{go ? 'RUN!' : 'GET READY'}</Text>
    </View>
  );
}

export function RunEventOverlay({ event, onDone }) {
  const reduced = useReduceMotion();
  useEffect(() => {
    if (!event) return undefined;
    const id = setTimeout(() => onDone?.(), reduced ? 750 : 1550);
    return () => clearTimeout(id);
  }, [event, onDone, reduced]);

  if (!event) return null;
  const copy = EVENT_COPY[event.kind]?.(event);
  if (!copy) return null;

  return (
    <View pointerEvents="none" style={styles.eventHost}>
      <GameLottie name={copy.lottie} size={220} trigger={event.token} style={styles.eventLottie} />
      <Animated.View
        key={event.token}
        entering={reduced ? undefined : FadeIn.duration(160)}
        exiting={reduced ? undefined : FadeOut.duration(180)}
        style={[styles.eventCard, event.kind === 'rivalEntry' && styles.rivalCard]}
      >
        <Text style={styles.eventTitle}>{copy.title}</Text>
        <Text style={styles.eventBody}>{copy.body}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7,9,13,0.42)',
  },
  startLottie: { position: 'absolute' },
  countBubble: {
    minWidth: 112,
    height: 112,
    paddingHorizontal: 20,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: darkColors.card,
    borderWidth: 4,
    borderColor: '#ffffff',
    ...shadow.raised,
  },
  goBubble: { minWidth: 146, borderColor: brand.teal, backgroundColor: '#0b302b' },
  countText: { ...type.display, color: '#ffffff', fontSize: 58, lineHeight: 64 },
  goText: { color: brand.teal, fontSize: 46 },
  readyLabel: { ...type.label, color: '#ffffff', marginTop: space.md, letterSpacing: 2 },
  eventHost: {
    position: 'absolute',
    zIndex: 45,
    left: 0,
    right: 0,
    top: '19%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventLottie: { position: 'absolute' },
  eventCard: {
    minWidth: 210,
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.card,
    backgroundColor: 'rgba(17,24,39,0.92)',
    borderWidth: 2,
    borderColor: brand.teal,
    ...shadow.raised,
  },
  rivalCard: { borderColor: darkColors.danger },
  eventTitle: { ...type.heading, color: '#ffffff', letterSpacing: 1.2 },
  eventBody: { ...type.caption, color: 'rgba(255,255,255,0.78)', marginTop: 2 },
});
