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
//
// THE CLOSE BUTTON IS NOT OPTIONAL. App Review rejected 2.1.0 (build 59) under
// guideline 4 for exactly this: opening the PRO paywall on an iPad Air left no
// visible way back. Everything that dismissed a sheet before was invisible or
// untrue — the dim backdrop reads as page, not as a button, and the handle
// advertised a drag this sheet never implemented. So the sheet now draws a
// real, labelled Close control in its own corner, on every sheet in the app,
// and it is drawn by THIS component rather than by call sites: a paywall whose
// dismissal depends on somebody remembering to add a button is the rejection
// waiting to happen again.
//
// AND IT CANNOT BE PUSHED OFF SCREEN. The sheet grew from the bottom with no
// ceiling, so a tall body (the paywall: pitch, perks, two plans, the 3.1.2
// disclosure, restore) simply ran off the top edge on a short window — an
// iPad in landscape or a phone at large text — taking the header, and now the
// Close button, with it. The body scrolls inside a capped height instead, so
// the top of the sheet is always on screen.

import React, { useEffect } from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { NB, darkColors, nbInk, nbRadius, radius, space, useTheme } from '../../theme';
import { spring } from '../../theme/motion';
import { useReduceMotion } from '../../ui/motion';

// There is deliberately no prop to turn the button off. A sheet that wants a
// different word for it can pass `closeLabel`; nothing can ship without it.
export default function Sheet({ visible, onClose, children, dark = false, closeLabel = 'Close' }) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
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

  // The tallest the sheet may be. The top inset keeps it clear of the status
  // bar and the notch; the extra gutter leaves enough dimmed page above it to
  // still read as a sheet over something rather than as a new screen.
  const maxHeight = Math.max(240, height - insets.top - space.xl);

  // On a tablet the same sheet was 1100 points wide: two plan cards the size
  // of playing cards, a heading with a hand's width of empty paper after it,
  // and body text running the full width of an iPad — which is the other half
  // of what guideline 4 was pointing at. Past phone width it stops growing and
  // sits centred, which also puts the Close button where a thumb and an eye
  // both expect it rather than out at the far bezel.
  const wide = width >= 640;
  const maxWidth = wide ? 560 : undefined;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      // Android's hardware back and iPadOS's Escape key both arrive through
      // onRequestClose; this tells VoiceOver the page behind is unreachable,
      // which is what makes the Close button the only exit worth announcing.
      accessibilityViewIsModal
      supportedOrientations={['portrait', 'landscape']}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
      />
      {/* box-none so the backdrop underneath stays pressable in the margins
          this leaves either side of a centred sheet. */}
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}
      >
        <Animated.View
          style={[
            {
              width: '100%',
              maxWidth,
              maxHeight,
              backgroundColor: fill,
              borderTopLeftRadius: radius.sheet,
              borderTopRightRadius: radius.sheet,
              borderTopWidth: NB.stroke,
              borderTopColor: ink,
              // Stroke the edge that is actually an edge. Full bleed on a
              // phone that is the top only; centred on a tablet the sides
              // become real edges too and get the same line.
              borderLeftWidth: wide ? NB.stroke : 0,
              borderRightWidth: wide ? NB.stroke : 0,
              borderLeftColor: ink,
              borderRightColor: ink,
              paddingHorizontal: space.gutter,
              paddingTop: space.md,
              paddingBottom: insets.bottom + space.lg,
            },
            sheetStyle,
          ]}
        >
          {/* The handle stays centred on the sheet, not on the space left over
              beside the button, so it is measured against the whole width and
              the Close control is laid over the right end of the same row. */}
          <View style={{ minHeight: 32, justifyContent: 'center', marginBottom: space.sm }}>
            {/* A solid ink bar, not a wash. The handle was `colors.border` on
                light and 18% white on dark — the hairline token doing a job
                that is not a hairline's. It is the sheet's grab line, and at 38
                by 5 points there is no room for it to be subtle and still be
                seen. */}
            <View
              style={{
                alignSelf: 'center',
                width: 38,
                height: 5,
                borderRadius: 3,
                backgroundColor: ink,
              }}
            />
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              style={({ pressed }) => [
                {
                  position: 'absolute',
                  right: 0,
                  // A 32 point target with 12 points of slop clears the 44
                  // point minimum without a button big enough to compete with
                  // the sheet's own heading.
                  width: 32,
                  height: 32,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: nbRadius.pill,
                  borderWidth: NB.stroke,
                  borderColor: ink,
                  backgroundColor: fill,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <X size={18} color={ink} strokeWidth={3} />
            </Pressable>
          </View>
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            // flexShrink is 0 by default in React Native, which would let this
            // grow to its content and straight back off the top of the screen,
            // cap or no cap. Allowed to shrink, it takes the height the cap
            // leaves it and scrolls the rest — and a short sheet is still only
            // as tall as its body.
            style={{ flexShrink: 1 }}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}
