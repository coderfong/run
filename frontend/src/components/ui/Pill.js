// Pill — a small chip. Variants: tint, solid, outline. Optional leading
// colored dot. Used for clan tags, league chips, filters.
//
// IT IS A DRAWN BOX NOW, not a rounded rectangle. Every other surface in the
// app went over to the hand-drawn nine-slice frames — cards, buttons, headings,
// the rail tiles, the stat tiles — and the chips were the last thing still
// wearing a `borderRadius: pill` with a 2pt border on it. Next to a framed
// anything they read as UI that had been pasted in from a different app, which
// is exactly the mismatch the pack exists to remove.
//
// Each chip is DEALT its drawing and its pose off its own label (or `seed`), so
// a row of five chips is five boxes rather than one box copied five times —
// same rule as the rail tiles and the stat tiles. See `frameVariant`.
//
// The line is `INK.thin`. A chip is about 26pt tall and the pack's base 5pt
// stroke at that size closes up the counters in the label.
//
// EVERY variant carries a stroke, and `tint` IS `solid`. The neo-brutalist
// badge is a flat block with a hard edge round it, and `tint` used to be a 14%
// wash of the colour with no edge at all — the single softest thing in the app.
// On paper it read as a faint smudge, and it was doing most of the work of
// making clan tags and league chips look tentative. The two variants are kept
// separate only so the fourteen call sites do not all have to change; if one
// ever needs to be quiet again it should say `outline`.
//
// A pill with NO colour deals itself one from the deck. That is the other half
// of the change: most metadata chips (a level, a member count, a paser total)
// used to pass `colors.textMuted` and came out grey, which is exactly the chip
// the reference boards make brightest.

import React from 'react';
import { Text, View } from 'react-native';

import Framed from './Framed';
import { INK, frameVariant, framePose } from '../../ui/frameRegistry';
import { nbAccentFor, nbTextOn, space, useTheme, useThemedType } from '../../theme';

export default function Pill({
  label,
  color,
  variant = 'tint',
  dot = false,
  textColor,
  // Seeds the dealt colour AND the dealt drawing when the label is not
  // distinctive enough — two chips both reading "Solo" would otherwise always
  // land on the same hue and the same box.
  seed,
  style,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const col = color ?? nbAccentFor(seed ?? label);
  const outline = variant === 'outline';
  // `outline` has no paper of its own — that IS the variant — so its line sits
  // on the page and is judged against the page.
  const fill = outline ? undefined : col;
  // Judged against the fill, not fixed white: the deck runs from yellow to
  // purple, and white on yellow is the failure this exists to prevent.
  const fg = textColor || (outline ? col : nbTextOn(col));
  const deal = String(seed ?? label ?? '');

  return (
    <Framed
      frame={frameVariant('chip', deal)}
      // The chip's own colour is the ink it WANTS; `Framed` keeps it wherever
      // it stays legible on what it is drawn on and swaps in the scheme's ink
      // where it would not. That is the same judgement the old `nbInk` call
      // made, made in one place for every framed thing in the app.
      tint={col}
      on={outline ? colors.bg : col}
      fill={fill}
      weight={INK.thin}
      pose={framePose(`pill:${deal}`)}
      // The frame's own measured ink clearance, plus a little air on top of it.
      // Not a fixed padding: the three chip drawings do not carry the same line
      // depth, and a number picked off one of them lets the text touch the
      // stroke on the other two.
      inset={3}
      style={[{ alignSelf: 'flex-start' }, style]}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: fg }} /> : null}
      {/* The air either side is on the TEXT, not on the content row: the row's
          padding is the frame's measured ink clearance and `Framed` owns it, so
          a `paddingHorizontal` written here would either be ignored (a specific
          paddingLeft wins over it) or wipe out the clearance entirely. */}
      <Text
        style={[
          type.labelSm,
          { color: fg, textTransform: 'none', letterSpacing: 0.2, paddingHorizontal: space.xs },
        ]}
      >
        {label}
      </Text>
    </Framed>
  );
}
