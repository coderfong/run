// SectionHeader — a section title with an optional trailing action link.
// Standard section rhythm: 24 above (apply via margin at the call site).
//
// `accessory` sits BESIDE the title — a small flourish that belongs to the
// section, not a second row above it. Trophies uses it for the medal clip: as
// its own centred block the animation was 88pt of mostly-empty air between the
// heading and the shelf, which read as a hole rather than as decoration.
// Baseline alignment is dropped when one is present, because a View has no
// text baseline to sit on.

import React from 'react';
import { Text, View } from 'react-native';

import { nbAccentFor, nbTextOn, space, useTheme, useThemedType } from '../../theme';
import { framePose, frameVariant } from '../../ui/frameRegistry';
import Framed from './Framed';
import { PressableScale } from '../../ui/motion';

/**
 * `framed` draws the hand-drawn label box around the TITLE only, not around
 * the whole row. The row is a title on the left and a text link on the right
 * with a gap between them, and a box around all of that would enclose the gap
 * as well — which reads as an empty panel with two things stuck to its inside
 * edges rather than as a heading.
 */
/**
 * SectionLabel — the drawn label box on its own, without the row around it.
 *
 * Pulled out of SectionHeader because a section heading is now two things
 * depending on where it sits: a title with a text link beside it, and the
 * tappable head of a folded-away section (see Accordion). Both have to be the
 * SAME label or a page carrying both reads as two competing kinds of section.
 */
export function SectionLabel({ title, framed = true, frameTint, frame, style }) {
  const type = useThemedType();
  const frameName = frame || frameVariant('heading', title);
  // A framed heading is a COLOURED drawn label now, not a hollow one: deal it a
  // deck colour off its title (stable across renders) and paint the frame's
  // paper with it, so section headers read as nice bright boxes rather than
  // muted outlines. A caller that forces `frameTint` still gets the old hollow
  // box in exactly the ink it asked for.
  const accent = nbAccentFor(title);
  if (!framed) return <Text style={[type.heading, style]}>{title}</Text>;
  return (
    // No `inset` override: the label's own measured line depth is the right
    // clearance, and the flat 8 that used to be here was less than the ink is
    // thick, so the box drew straight through the title.
    <Framed
      frame={frameName}
      tint={frameTint || nbTextOn(accent)}
      fill={frameTint ? undefined : accent}
      opacity={frameTint ? 0.8 : 1}
      pose={framePose(title)}
      style={[{ flexShrink: 1 }, style]}
    >
      <Text style={[type.heading, frameTint ? null : { color: nbTextOn(accent) }]}>{title}</Text>
    </Framed>
  );
}

export default function SectionHeader({
  title,
  action,
  onAction,
  accessory,
  framed = true,
  frameTint,
  frame,
  style,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const heading = (
    <SectionLabel title={title} framed={framed} frameTint={frameTint} frame={frame} />
  );
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: accessory ? 'center' : 'baseline',
          justifyContent: 'space-between',
        },
        style,
      ]}
    >
      {accessory ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 }}>
          {heading}
          {accessory}
        </View>
      ) : (
        heading
      )}
      {action ? (
        <PressableScale onPress={onAction} hitSlop={10} accessibilityRole="button" accessibilityLabel={action}>
          <Text style={[type.captionMedium, { color: colors.textMuted }]}>{action}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}
