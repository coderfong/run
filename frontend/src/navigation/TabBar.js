// Custom bottom tab bar — a floating outlined pill (game-style) sized by its
// content, plus safe area. Four real tabs with a circular Record button in the
// middle, sitting IN the row rather than breaking out above it. The active tab
// gets a filled pill behind it; the sticker icons are full-colour art, so
// state is shown with the pill + opacity, never a colour swap.
//
// THE BAR IS FRAMED, so it takes no neo-brutalist stroke and no hard drop.
// Frames and NB strokes are alternatives, never layers — a drawn box with a
// machine-drawn box printed just inside it is the failure this rule exists to
// prevent, and Card.js applies the same rule to its own framed path.
//
// The ACTIVE PILL is the piece that needed the sweep. It was `cardAlt` sitting
// on the bar's `card` fill: one surface step, a few percent of lightness in
// either palette, so the thing marking which tab you are on was very nearly
// invisible. It cannot be fixed the way Segmented fixed it — an ink fill under
// a full-colour sticker icon would fight the art, which is the whole reason
// this bar shows state with a pill instead of a tint. So it keeps its quiet
// fill and gets a thin stroke, which is what makes a one-step surface read.
// Same fix, same reason, as the EnergyMeter track.

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  withSpring,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { NB, nbInk, space, toonRadius, type, useTheme } from '../theme';
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
  const { colors, scheme } = useTheme();
  const reduced = useReduceMotion();
  const focus = useSharedValue(isFocused ? 1 : 0);
  useEffect(() => {
    focus.value = reduced ? (isFocused ? 1 : 0) : withSpring(isFocused ? 1 : 0, { damping: 15, stiffness: 240 });
    return () => cancelAnimation(focus);
  }, [isFocused, reduced, focus]);
  const iconMotion = useAnimatedStyle(() => ({
    transform: [{ translateY: reduced ? 0 : -2 * focus.value }, { scale: 1 + 0.12 * focus.value }],
  }));
  const key = ICON_KEY[route.name] || 'tab-home';
  const color = isFocused ? accent : INACTIVE;
  // Thin: the pill is about 44pt tall and sits four across, and 3pt of ink on
  // each of them turns the bar into a row of boxes rather than one bar with a
  // current tab in it.
  //
  // The INACTIVE pill carries the same border width in transparent. A border is
  // part of the box in Yoga, so switching it on only for the focused tab would
  // grow that slot by two points a side and shove its neighbours along every
  // time you changed tabs.
  const pill = {
    backgroundColor: isFocused ? colors.cardAlt : 'transparent',
    borderWidth: NB.strokeThin,
    borderColor: isFocused ? nbInk(scheme, colors.cardAlt) : 'transparent',
  };
  // The flex:1 lives on this wrapper View, not on PressableScale — PressableScale
  // forwards its style prop to an inner Animated.View, so flex there wouldn't
  // stretch the pressable and every item would collapse to content width.
  return (
    <View style={styles.slot}>
      <PressableScale
        style={[styles.item, pill]}
        onPressIn={onWarm}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ selected: isFocused }}
        accessibilityLabel={LABELS[route.name]}
      >
        <Animated.View style={iconMotion}>
          <AppIcon name={key} size={34} faded={!isFocused} />
        </Animated.View>
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
    return () => cancelAnimation(pulse);
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
      {/* `label` and not `panel`. The panel is a SQUARISH drawing: stretched
          across a bar four times wider than it is tall, its corners kept their
          drawn size, which ate most of the height and left the bottom right —
          where that drawing's line curves in and stops — reading as a cropped
          corner rather than as a corner. The label is the pack's wide box and
          holds its shape at this ratio.

          The frame is the bar's own edge now, not a decal over it: `inset` is a
          real number, so the tabs are laid out INSIDE the measured line rather
          than underneath it.

          No hard drop under it. It used to spread `toonSurface().shadow`, which
          was wrong twice over: a frame already brings its own depth, and that
          is the iOS-only shadow form, so it was drawing nothing on Android at
          all. It could not have drawn the right thing on iOS either — the bar
          paints no background of its own (the frame's paper is the fill), and
          an iOS layer shadow on a transparent view is traced from the contents'
          alpha, so what it offered was a smear following the nine-slice art
          rather than a hard-edged block. */}
      <Framed
        frame="label"
        tint={accent}
        fill={colors.card}
        pose={framePose('main-navigation')}
        inset={space.xs}
        style={styles.bar}
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
  // No padding of its own: the frame's ink clearance (Framed's `inset`) is the
  // padding now, so the two cannot disagree about where the inside of the bar
  // starts.
  barContent: {
    flexDirection: 'row',
    alignItems: 'center',
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
