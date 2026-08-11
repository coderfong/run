// Custom bottom tab bar — a floating outlined pill (game-style) sized by its
// content, plus safe area. Four real tabs with a circular Record button in the
// middle, sitting IN the row rather than breaking out above it. The active tab
// gets a filled pill behind it; the sticker icons are full-colour art, so
// state is shown with the pill + opacity, never a colour swap.

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { space, toonRadius, toonSurface, type, useTheme } from '../theme';
import { haptic, PressableScale, useReduceMotion } from '../ui/motion';
import { framePose } from '../ui/frameRegistry';
import { useAccent } from '../hooks/useAccent';
import { useRecording } from '../state/recording';
import AppIcon from '../components/AppIcon';
import Framed from '../components/ui/Framed';
import { preloadScreenImages } from '../config/screenAssets';

const INACTIVE = '#9ca3af';
// route name → generated sticker-icon key (assets/icons/*).
const ICON_KEY = { Home: 'tab-home', Map: 'tab-map', Club: 'tab-club', You: 'tab-you' };
const LABELS = { Home: 'Home', Map: 'Map', Club: 'Club', You: 'You' };

function TabItem({ route, isFocused, accent, onPress, onWarm }) {
  const { colors } = useTheme();
  const key = ICON_KEY[route.name] || 'tab-home';
  const color = isFocused ? accent : INACTIVE;
  // The flex:1 lives on this wrapper View, not on PressableScale — PressableScale
  // forwards its style prop to an inner Animated.View, so flex there wouldn't
  // stretch the pressable and every item would collapse to content width.
  return (
    <View style={styles.slot}>
      <PressableScale
        style={[styles.item, isFocused && { backgroundColor: colors.cardAlt }]}
        onPressIn={onWarm}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: isFocused }}
        accessibilityLabel={LABELS[route.name]}
      >
        <AppIcon name={key} size={isFocused ? 38 : 34} faded={!isFocused} />
        <Text style={[styles.label, { color }]}>{LABELS[route.name]}</Text>
      </PressableScale>
    </View>
  );
}

function RecordButton({ accent, onPress, onWarm }) {
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
        onPressIn={onWarm}
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
  const { colors, scheme } = useTheme();
  const surface = toonSurface(colors, scheme);
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

  const item = (route) => {
    const isFocused = state.index === routes.indexOf(route);
    return (
      <TabItem
        key={route.key}
        route={route}
        isFocused={isFocused}
        accent={accent}
        onWarm={() => preloadScreenImages(route.name)}
        onPress={() => go(route, isFocused)}
      />
    );
  };

  return (
    // The outer view keeps the safe-area gap so screen content never runs under
    // the floating pill.
    <View style={[styles.dock, { paddingBottom: insets.bottom ? insets.bottom - 4 : space.sm }]}>
      <Framed
        frame="panel"
        tint={accent}
        fill={colors.card}
        pose={framePose('main-navigation')}
        inset={false}
        style={[styles.bar, surface.shadow]}
        contentStyle={styles.barContent}
      >
        {left.map(item)}
        <RecordButton
          accent={accent}
          onWarm={() => preloadScreenImages('Record')}
          onPress={() => { haptic.light(); navigation.navigate('Record'); }}
        />
        {right.map(item)}
      </Framed>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { paddingHorizontal: space.md, paddingTop: space.sm, backgroundColor: 'transparent' },
  bar: {
    alignSelf: 'stretch',
  },
  barContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
  },
  slot: { flex: 1 },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
    borderRadius: toonRadius.cell,
  },
  label: { ...type.labelSm, fontSize: 11, letterSpacing: 0.2, textTransform: 'none' },

  recordSlot: { width: 72, alignItems: 'center' },
  record: {
    width: 60,
    height: 60,
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
