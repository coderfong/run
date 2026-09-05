// Segmented — a flat two-or-more option toggle.
//
// THE ACTIVE SEGMENT IS AN INK FILL, not a surface step. It used to be
// `colors.card` sitting in a `colors.bgElevated` trough, which is invisible:
// in the dark palette those two tokens are the SAME value (#15181D), and in
// the light one they are #FFFFFF on #EEF0F4 — a ~3% step. Either way you
// could not tell which option was selected. `primary`/`primaryInk` is the
// app's neutral high-contrast pairing (the same one Button uses when there is
// no clan accent yet), so this reads unmistakably in both themes without
// flooding the UI with an accent the map and clan colors own.
//
// The options are also deliberately loose inside the track: the segments used
// to sit 4pt apart in a 3pt trough, so Clubs/Solo and System/Light/Dark read
// as one crowded slab rather than as separate choices. `labelSuffix` qualifies
// the per-option screen-reader name ("Light theme" rather than a bare "Light").

import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { NB, nbInk, radius, useTheme, useThemedType } from '../../theme';
import { PressableScale, useReduceMotion } from '../../ui/motion';

export default function Segmented({ options, value, onChange, style, labelSuffix }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const [layouts, setLayouts] = useState({});
  const selection = layouts[value];
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const positioned = useRef(false);
  useEffect(() => {
    if (!selection) return;
    const move = (next) => reduced || !positioned.current ? next : withTiming(next, { duration: 220 });
    x.value = move(selection.x);
    y.value = move(selection.y);
    width.value = move(selection.width);
    height.value = move(selection.height);
    positioned.current = true;
  }, [selection, reduced, x, y, width, height]);
  const indicator = useAnimatedStyle(() => ({
    left: x.value, top: y.value, width: width.value, height: height.value,
  }));
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          backgroundColor: colors.bgElevated,
          borderRadius: radius.pill,
          padding: 5,
          gap: 10,
          // The track gets the stroke, the segments do not. A stroke on each
          // option would draw three or four boxes sitting in a fourth, which
          // reads as a table; the control is ONE object with a moving fill in
          // it, and the outline is what says so.
          borderWidth: NB.strokeThin,
          borderColor: nbInk(scheme, colors.bgElevated),
        },
        style,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', borderRadius: radius.pill, backgroundColor: colors.primary, opacity: selection ? 1 : 0 }, indicator]}
      />
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          // flex:1 belongs on this wrapper, NOT on PressableScale — that
          // forwards its style to an inner Animated.View, so flex there never
          // reached the pressable and every segment collapsed to text width,
          // bunching them at the left of the track. Same fix as TabBar.
          <View key={opt.key} style={{ flex: 1 }} onLayout={({ nativeEvent: { layout } }) => {
            setLayouts((previous) => {
              const old = previous[opt.key];
              if (old && ['x', 'y', 'width', 'height'].every((field) => old[field] === layout[field])) return previous;
              return { ...previous, [opt.key]: layout };
            });
          }}>
            <PressableScale
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: radius.pill,
                alignItems: 'center',
                backgroundColor: active && !selection ? colors.primary : 'transparent',
              }}
              onPress={() => onChange(opt.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={labelSuffix ? `${opt.label} ${labelSuffix}` : opt.label}
            >
              <Text
                style={[
                  type.bodySmBold,
                  { color: active ? colors.primaryInk : colors.textMuted },
                ]}
                numberOfLines={1}
              >
                {opt.label}
              </Text>
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}
