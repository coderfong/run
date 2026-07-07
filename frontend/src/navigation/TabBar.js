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
import { Footprints, Home, Map, Shield, User } from 'lucide-react-native';

import { colors, space, type } from '../theme';
import { haptic, PressableScale, useReduceMotion } from '../ui/motion';
import { useAccent } from '../hooks/useAccent';
import { useRecording } from '../state/recording';

const INACTIVE = '#9ca3af';
const ICONS = { Home, Map, Club: Shield, You: User };
const LABELS = { Home: 'Home', Map: 'Map', Club: 'Club', You: 'You' };

function TabItem({ route, isFocused, accent, onPress }) {
  const Icon = ICONS[route.name] || Home;
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
        <Icon size={24} color={color} strokeWidth={isFocused ? 2.4 : 2} />
        <Text style={[styles.label, { color }]}>{LABELS[route.name]}</Text>
      </PressableScale>
    </View>
  );
}

function RecordButton({ accent, onPress }) {
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
        style={[styles.record, { borderColor: accent }]}
        scaleTo={0.94}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={isRecording ? 'Recording in progress' : 'Start a run'}
      >
        <Footprints size={26} color={accent} strokeWidth={2.4} />
        {isRecording && (
          <Animated.View style={[styles.recBadge, { backgroundColor: accent }, badgeStyle]} />
        )}
      </PressableScale>
    </View>
  );
}

export default function TabBar({ state, navigation }) {
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
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: 64 + insets.bottom }]}>
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
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.sm,
  },
  slot: { flex: 1 },
  item: { alignItems: 'center', justifyContent: 'flex-start', gap: 3, paddingTop: 2 },
  label: { ...type.labelSm, fontSize: 11, letterSpacing: 0.2, textTransform: 'none' },

  recordSlot: { width: 72, alignItems: 'center' },
  record: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -20, // raised above the bar
    borderWidth: 2.5,
    backgroundColor: colors.card,
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
    borderColor: colors.card,
  },
});
