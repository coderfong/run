// NPCSpeechBubble — a line of crew dialogue, anchored above whoever said it.
//
// Positioned by CENTRE-X and a bottom edge, not top-left: every anchor this
// draws against (PIT_STOP_LAYOUT's crew frames) already stores its x as the
// character's centre, and a speech bubble has to stay centred over a head
// while its own width changes with the line length. A fixed-width box
// centred on that x and internally center-aligned sidesteps measuring the
// bubble at all — see the width note below.
//
// NO EXIT ANIMATION. It enters on a spring (Pop, the same primitive the rest
// of the app uses for "something just changed") and is simply unmounted when
// the line is done — useShopDialogue owns that timing. A bubble that faded
// out on its own clock could still be fading when the NEXT one's entrance
// fires, and two speech bubbles overlapping is worse than one cutting clean.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Pop } from '../../ui/motion';
import { nbInk, space, useTheme, useThemedType } from '../../theme';

// Wide enough for the longest lines in shopDialogue.js ("Goes with most of
// what you have got.") at the type size below without wrapping past 2 lines.
const BOX_WIDTH = 260;
const GAP_ABOVE_HEAD = 22; // scene units, clearance above the crown

export default function NPCSpeechBubble({ text, tick, anchor, scale, cropTop = 0, tone = 'plain' }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  if (!text || !anchor) return null;

  const centerX = anchor.x * scale;
  const bottomY = (anchor.y - cropTop) * scale - GAP_ABOVE_HEAD * scale;
  const ink = nbInk(scheme, colors.card);
  // 'excited' (rare+ reactions) gets the pink accent border; everything else
  // is plain ink — a bubble that turned rainbow by rarity would fight the
  // brief's own "use rarity subtly" rule.
  const border = tone === 'excited' ? '#EC4899' : ink;

  return (
    <View
      pointerEvents="none"
      style={[styles.slot, { left: centerX - BOX_WIDTH / 2, top: bottomY - 74, width: BOX_WIDTH }]}
    >
      <Pop trigger={tick} from={0.6} style={styles.pop}>
        <View style={[styles.bubble, { backgroundColor: colors.card, borderColor: border }]}>
          <Text style={[type.captionMedium, { color: colors.text, textAlign: 'center' }]} numberOfLines={3}>
            {text}
          </Text>
        </View>
        <View style={[styles.tailOuter, { borderTopColor: border }]} />
        <View style={[styles.tailInner, { borderTopColor: colors.card }]} />
      </Pop>
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', alignItems: 'center' },
  pop: { alignItems: 'center' },
  bubble: {
    maxWidth: 220,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 2.5,
  },
  // Two stacked triangles (border colour, then fill colour a hair smaller and
  // offset up) is the classic outlined-speech-bubble tail: it reads as one
  // ink-edged shape rather than two triangles glued together.
  tailOuter: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
  tailInner: {
    position: 'absolute',
    top: -12,
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
