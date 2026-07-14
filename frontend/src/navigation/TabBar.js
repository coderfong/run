// Custom bottom tab bar. Flat (constitution: the tab bar has no signature
// effects), 64pt + safe area. Four real tabs with a raised circular Record
// button injected in the middle. Active tint = accent; inactive = #9CA3AF.

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { space, type, useTheme } from '../theme';
import { haptic, PressableScale, useReduceMotion } from '../ui/motion';
import { useAccent } from '../hooks/useAccent';
import { useRecording } from '../state/recording';
import AppIcon from '../components/AppIcon';

const INACTIVE = '#9ca3af';
// route name → generated sticker-icon key (assets/icons/*).
const ICON_KEY = { Home: 'tab-home', Map: 'tab-map', Club: 'tab-club', You: 'tab-you' };
const LABELS = { Home: 'Home', Map: 'Map', Club: 'Club', You: 'You' };

function TabItem({ route, isFocused, accent, onPress }) {
  const key = ICON_KEY[route.name] || 'tab-home';
  // Colour icons aren't tinted — inactive reads as faded + a hair smaller.
  const color = isFocused ? accent : INACTIVE;
  // The flex:1 lives on this wrapper View, not on PressableScale — PressableScale
  // forwards its style prop to an inner Animated.View, so flex there wouldn't
  // stretch the pressable and every item would collapse to content width.
  return (
    <View style={styles.slot}>
      <PressableScale
        style={styles.item}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: isFocused }}
        accessibilityLabel={LABELS[route.name]}
      >
        <AppIcon name={key} size={isFocused ? 30 : 26} faded={!isFocused} />
        <Text style={[styles.label, { color }]}>{LABELS[route.name]}</Text>
      </PressableScale>
    </View>
  );
}

function RecordButton({ accent, onPress }) {
  const { colors } = useTheme();
  const { isRecording } = useRecording();
  const reduce = useReduceMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (isRecording && !reduce) {
      pulse.value = withRepeat(withTiming(1.35, { duration: 700 }), -1, true);
    } else {
      pulse.value = 1;
    }
  }, [isRecording, reduce, pulse]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <View style={styles.recordSlot}>
      <PressableScale
        style={styles.record}
        scaleTo={0.94}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={isRecording ? 'Recording in progress' : 'Start a run'}
      >
        <AppIcon name="tab-record" size={60} />
        {isRecording && (
          <Animated.View style={[styles.recBadge, { backgroundColor: accent, borderColor: colors.card }, badgeStyle]} />
        )}
      </PressableScale>
    </View>
  );
}

export default function TabBar({ state, navigation }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const accent = useAccent();

  const go = (route, isFocused) => {
    haptic.light();
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
  };

  const routes = state.routes;
  // Split the four tabs around the raised Record button: [0,1] [rec] [2,3].
  const left = routes.slice(0, 2);
  const right = routes.slice(2);

  return (
    <View style={[styles.bar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: insets.bottom, height: 64 + insets.bottom }]}>
      {left.map((route) => (
        <TabItem
          key={route.key}
          route={route}
          isFocused={state.index === state.routes.indexOf(route)}
          accent={accent}
          onPress={() => go(route, state.index === state.routes.indexOf(route))}
        />
      ))}

      <RecordButton accent={accent} onPress={() => { haptic.light(); navigation.navigate('Record'); }} />

      {right.map((route) => (
        <TabItem
          key={route.key}
          route={route}
          isFocused={state.index === state.routes.indexOf(route)}
          accent={accent}
          onPress={() => go(route, state.index === state.routes.indexOf(route))}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
  },
  slot: { flex: 1 },
  item: { alignItems: 'center', justifyContent: 'flex-start', gap: 3, paddingTop: 2 },
  label: { ...type.labelSm, fontSize: 11, letterSpacing: 0.2, textTransform: 'none' },

  recordSlot: { width: 72, alignItems: 'center' },
  record: {
    width: 60,
    height: 60,
    marginTop: -22, // raised above the bar
    alignItems: 'center',
    justifyContent: 'center',
  },
  recBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
});
