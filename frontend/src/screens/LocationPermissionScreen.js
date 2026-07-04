// Pre-permission explainer. Shown BEFORE the OS location prompt ever fires:
// explains why we need location, then triggers the real (When In Use) prompt.
// If the user has already denied at the OS level, this becomes a helpful
// recovery screen with a deep link to Settings — never a dead end.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space, type } from '../theme';
import { PressableScale } from '../ui/motion';

function RadarIllustration({ accent }) {
  const r0 = useRef(new Animated.Value(0)).current;
  const r1 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, {
            toValue: 1,
            duration: 2000,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
    const anims = [make(r0, 0), make(r1, 900)];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [r0, r1]);

  const ring = (v) => ({
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: accent,
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.0] }) }],
  });

  return (
    <View style={styles.illo}>
      <Animated.View style={ring(r0)} />
      <Animated.View style={ring(r1)} />
      <Svg width={70} height={84} viewBox="0 0 24 28">
        <Path
          d="M12 0C6.5 0 2 4.5 2 10c0 7 10 18 10 18s10-11 10-18C22 4.5 17.5 0 12 0z"
          fill={accent}
        />
        <Circle cx={12} cy={10} r={3.6} fill={colors.bg} />
      </Svg>
    </View>
  );
}

export default function LocationPermissionScreen({ onDone }) {
  const insets = useSafeAreaInsets();
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  // If OS-level permission was already denied before (e.g. user returned
  // to the app), open straight into the recovery view.
  useEffect(() => {
    (async () => {
      try {
        const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
        if (status === 'denied' && !canAskAgain) setDenied(true);
      } catch {}
    })();
  }, []);

  const request = async () => {
    setBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        onDone(true);
      } else {
        setDenied(true);
      }
    } catch {
      setDenied(true);
    } finally {
      setBusy(false);
    }
  };

  if (denied) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + space.xxl }]}>
        <RadarIllustration accent={colors.warn} />
        <Text style={styles.title}>Location is off</Text>
        <Text style={styles.body}>
          Territory Run can't record a run without it. Turn on location for
          Territory Run in Settings — we only track during an active run.
        </Text>
        <PressableScale
          style={styles.primaryBtn}
          onPress={() => Linking.openSettings().catch(() => {})}
          accessibilityRole="button"
          accessibilityLabel="Open Settings"
        >
          <Text style={styles.primaryBtnText}>Open Settings</Text>
        </PressableScale>
        <TouchableOpacity
          style={styles.skip}
          onPress={() => onDone(false)}
          accessibilityRole="button"
        >
          <Text style={styles.skipText}>Explore the app first</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.xxl }]}>
      <RadarIllustration accent={colors.ok} />
      <Text style={styles.title}>Your route is the game</Text>
      <Text style={styles.body}>
        Territory Run uses your location to trace the loop you run and turn
        the ground inside it into your territory.{'\n\n'}Tracking happens only
        during an active run — never in the background while you're not
        running.
      </Text>
      <PressableScale
        style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
        onPress={request}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Enable location"
      >
        <Text style={styles.primaryBtnText}>Enable location</Text>
      </PressableScale>
      <TouchableOpacity
        style={styles.skip}
        onPress={() => onDone(false)}
        accessibilityRole="button"
      >
        <Text style={styles.skipText}>Not now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    padding: space.xl,
  },
  illo: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xl,
  },
  title: { ...type.title, textAlign: 'center', marginBottom: space.md },
  body: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: space.xl,
  },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 16,
    paddingHorizontal: space.xxl,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  primaryBtnText: { ...type.button },
  skip: { marginTop: space.lg },
  skipText: { ...type.bodyMedium, color: colors.textMuted },
});
