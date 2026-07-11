// Pre-permission explainer (PACER dark). Shown BEFORE the OS location prompt:
// purple radar glow, why-we-need-it bullets, gradient Allow Location. If the
// user already denied at the OS level, becomes a Settings recovery screen.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { LocateFixed, MapPin, ShieldCheck, Timer } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { brand, colors, radius, space, type, withAlpha } from '../theme';
import { PressableScale } from '../ui/motion';

const BULLETS = [
  { icon: Timer, text: "GPS stays on only while you're running." },
  { icon: ShieldCheck, text: 'We never sell your data.' },
  { icon: MapPin, text: 'You can change this anytime.' },
];

function Radar({ color = brand.purple }) {
  const r0 = useRef(new Animated.Value(0)).current;
  const r1 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 2200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ])
      );
    const anims = [make(r0, 0), make(r1, 1000)];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [r0, r1]);

  const ring = (v) => ({
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: color,
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.1] }) }],
  });

  return (
    <View style={styles.radar}>
      <Animated.View style={ring(r0)} />
      <Animated.View style={ring(r1)} />
      <View style={[styles.radarCore, { backgroundColor: withAlpha(color, 0.25) }]}>
        <View style={[styles.radarDot, { backgroundColor: color }]}>
          <LocateFixed size={22} color="#fff" strokeWidth={2} />
        </View>
      </View>
    </View>
  );
}

export default function LocationPermissionScreen({ onDone }) {
  const insets = useSafeAreaInsets();
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

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
      if (status === 'granted') onDone(true);
      else setDenied(true);
    } catch {
      setDenied(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + space.huge, paddingBottom: insets.bottom + space.xl }]}>
      <Radar color={denied ? colors.warn : brand.purple} />

      <View style={{ alignItems: 'center' }}>
        <Text style={styles.title}>
          {denied ? 'Location is off' : 'We use your location to track runs and close loops.'}
        </Text>
        {denied ? (
          <Text style={styles.body}>
            PASER can't record a run without it. Turn on location for PASER in
            Settings — we only track during an active run.
          </Text>
        ) : (
          <View style={styles.bullets}>
            {BULLETS.map(({ icon: Icon, text }) => (
              <View key={text} style={styles.bullet}>
                <View style={styles.bulletIcon}>
                  <Icon size={17} color={colors.textMuted} strokeWidth={2} />
                </View>
                <Text style={[type.bodySm, { color: colors.textMuted, flex: 1 }]}>{text}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={{ alignSelf: 'stretch', gap: space.md }}>
        {denied ? (
          <PressableScale
            onPress={() => Linking.openSettings().catch(() => {})}
            accessibilityRole="button"
            accessibilityLabel="Open Settings"
          >
            <LinearGradient colors={brand.gradient} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={styles.cta}>
              <Text style={[type.button, { color: '#fff' }]}>Open Settings</Text>
            </LinearGradient>
          </PressableScale>
        ) : (
          <PressableScale
            onPress={request}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Allow location"
            style={busy && { opacity: 0.6 }}
          >
            <LinearGradient
              colors={['#60a5fa', brand.purple]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.cta}
            >
              <Text style={[type.button, { color: '#fff' }]}>Allow location</Text>
            </LinearGradient>
          </PressableScale>
        )}
        <TouchableOpacity
          onPress={() => onDone(false)}
          style={{ alignItems: 'center', paddingVertical: space.sm }}
          accessibilityRole="button"
          accessibilityLabel={denied ? 'Explore the app first' : 'Not now'}
        >
          <Text style={[type.bodyMedium, { color: colors.textMuted }]}>
            {denied ? 'Explore the app first' : 'Not now'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
  },
  radar: { width: 220, height: 220, alignItems: 'center', justifyContent: 'center' },
  radarCore: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center' },
  radarDot: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },

  title: { ...type.title, textAlign: 'center', marginBottom: space.lg, lineHeight: 30 },
  body: { ...type.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },

  bullets: { gap: space.md, alignSelf: 'stretch' },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  bulletIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cta: { height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
