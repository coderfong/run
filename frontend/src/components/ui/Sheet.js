// Sheet — a bottom sheet surface over a dim backdrop. Controlled via
// `visible`. radius.sheet top corners, drag handle, tap-backdrop to close.
// Springs in when Reduce Motion is off.
//
// THE TOP EDGE ONLY, which is the rule for every full-bleed surface in the app:
// stroke the edge that is actually an edge. A sheet is pinned to the left,
// right and bottom of the screen, so a full box would run a line down both
// bezels and another one below the home indicator — three lines that are not
// boundaries between anything. The top is where the sheet stops and the dimmed
// page behind it starts, and that is the line worth drawing. A `panel`
// ToonHeader takes the same treatment upside down, for the same reason.
//
// No hard drop, either. The sheet's depth cue is the backdrop: it is already
// unmistakably in front of a page that has been dimmed to make room for it,
// and an offset block behind a surface that reaches three screen edges would
// have nowhere to fall except off them.

import React, { useEffect } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { NB, darkColors, nbInk, radius, space, useTheme } from '../../theme';
import { spring } from '../../theme/motion';
import { useReduceMotion } from '../../ui/motion';

export default function Sheet({ visible, onClose, children, dark = false }) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      progress.value = reduce ? 1 : withSpring(1, spring.soft);
    } else {
      progress.value = reduce ? 0 : withTiming(0, { duration: 180 });
    }
  }, [visible, reduce, progress]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * 40 }],
    opacity: progress.value,
  }));

  // Judged against the sheet's OWN fill rather than the scheme, because `dark`
  // lets a sheet disagree with the page it opened over: a dark sheet in the
  // light scheme needs the cream stroke the scheme would never have picked.
  const fill = dark ? darkColors.card : colors.card;
  const ink = nbInk(scheme, fill);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: fill,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            borderTopWidth: NB.stroke,
            borderTopColor: ink,
            paddingHorizontal: space.gutter,
            paddingTop: space.md,
            paddingBottom: insets.bottom + space.lg,
          },
          sheetStyle,
        ]}
      >
        {/* A solid ink bar, not a wash. The handle was `colors.border` on light
            and 18% white on dark — the hairline token doing a job that is not
            a hairline's. It is the sheet's one affordance, the thing that says
            this surface is draggable, and at 38 by 5 points there is no room
            for it to be subtle and still be seen. */}
        <View
          style={{
            alignSelf: 'center',
            width: 38,
            height: 5,
            borderRadius: 3,
            backgroundColor: ink,
            marginBottom: space.md,
          }}
        />
        {children}
      </Animated.View>
    </Modal>
  );
}
