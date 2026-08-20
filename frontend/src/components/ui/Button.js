// Button — the one button. Variants: primary (accent fill), secondary
// (neutral surface), destructive (danger fill), ghost (text only), gradient
// (the PASER brand CTA), outline (paper fill, accent stroke).
//
// Press feedback is now the NEO-BRUTALIST PRESS on every variant that has a
// box: the button sits above the page on a hard offset shadow and slides down
// into it under the thumb, landing flush. See `PressableShift`. Only `ghost`
// and the framed path keep the old scale-and-haptic, because neither of them
// has a shadow to press into.

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { brand, nbAccentFor, nbTextOn, radius, space, toonSurface, useTheme, useThemedType } from '../../theme';
import { haptic, PressableScale, PressableShift } from '../../ui/motion';
import { INK, framePose as poseFor, frameVariant } from '../../ui/frameRegistry';
import Framed from './Framed';
import HardShadow from './HardShadow';

// A framed button's fill is the frame's PAPER — the outline's own silhouette,
// wobble and all. Anything the button paints for itself is a rounded rectangle,
// and a rounded rectangle behind a hand-drawn box pokes out at every place the
// line wanders inward: that is the pink creeping past the edge of Create
// account, and the second, paler red behind Delete account.
//
// So when a frame is on, every background the caller supplied is dropped. It is
// done by flattening rather than by asking call sites to behave, because the
// caller that broke it was passing `style={{ backgroundColor: … }}` — a
// perfectly reasonable thing to write, and invisible from in here otherwise.
function withoutBackground(flat) {
  if (flat.backgroundColor == null) return flat;
  const { backgroundColor, ...rest } = flat;
  return rest;
}

// The colour the frame's paper should be painted, or nothing at all.
//
// `Framed` switches its paper layer on when `fill` is truthy, and the string
// 'transparent' is truthy — so an outline button would draw eight tinted paper
// slices with `tintColor: 'transparent'`, which is not a documented way to
// erase an Image and would leave a white silhouette behind a control whose
// whole point is being hollow. Undefined is how you say "no paper".
export function fillFor(variant, bg) {
  if (variant === 'gradient') return brand.gradient[0];
  if (!bg || bg === 'transparent') return undefined;
  return bg;
}

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  accent,
  loading = false,
  disabled = false,
  icon = null,
  full = true,
  // Every button that has a fill wears the hand-drawn pack. Compact row
  // actions used to be left out to save the eight slices, which is why
  // Customize runner and Add pasers sat on the You page as two plain grey
  // pills under a framed everything-else. Pass a frame name to force one, or
  // false to opt a control out.
  frame = 'auto',
  frameTint,
  framePose,
  frameBoil = false,
  style,
}) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const acc = accent ?? colors.primary;
  // A caller that has to line a button up with something beside it (the Join
  // button matching the invite-code input, say) sets its height in `style`.
  // The frame is a sibling of that style rather than a child of it, so it has
  // to be told, or the drawn box comes out the default height inside a taller
  // pressable and sits off-centre against its own row.
  const styled = StyleSheet.flatten(style) || {};
  const height = styled.height ?? (size === 'sm' ? 44 : 52);
  const textStyle = size === 'sm' ? type.buttonSm : type.button;
  const autoFrame = variant !== 'ghost';
  const resolvedFrame = frame === 'auto'
    ? (autoFrame ? frameVariant('action', title) : null)
    : frame;
  const pose = framePose ?? poseFor(title);

  // Primary with no explicit accent is DEALT a nice colour from the deck,
  // seeded off its label so it stays put across renders — the same "deal a
  // colour off a seed" idiom the frames and the feed cards use, rather than the
  // neutral brand ink it used to fill with. A caller that passes `accent` (a
  // clan colour, a danger red) still gets exactly that.
  const dealt = variant === 'primary' && accent == null ? nbAccentFor(title) : null;

  let bg = dealt || acc;
  // Text is the readable ink on whatever the fill turned out to be: the deck's
  // dealt colour, an explicit accent (white), or the neutral primary.
  let fg = dealt
    ? nbTextOn(dealt)
    : acc === colors.primary ? colors.primaryInk : '#ffffff';
  let border = null;
  if (variant === 'secondary') {
    bg = colors.cardAlt;
    fg = colors.text;
  } else if (variant === 'destructive') {
    bg = colors.danger;
    fg = '#ffffff';
  } else if (variant === 'ghost') {
    bg = 'transparent';
    fg = acc;
  } else if (variant === 'outline') {
    // Was a transparent box with a 1.5pt pink hairline, which sat next to a
    // filled button reading as a disabled input. The neo-brutalist secondary is
    // a PAPER-FILLED box wearing the same heavy stroke as its filled neighbour,
    // in the accent colour — same weight, different fill, unmistakably the
    // second option rather than a lesser one.
    //
    // It also has to be filled for a much more mechanical reason: the hard
    // shadow is a real rectangle sitting behind the button, so a transparent
    // button shows its own shadow straight through itself.
    bg = colors.card;
    fg = brand.pink;
    border = brand.pink;
  }

  const handlePress = () => {
    if (disabled || loading) return;
    haptic.light();
    onPress?.();
  };

  const inner = loading ? (
    <ActivityIndicator color={variant === 'gradient' ? '#fff' : fg} />
  ) : (
    <>
      {icon ? <View>{icon}</View> : null}
      <Text style={[textStyle, { color: variant === 'gradient' ? '#fff' : fg }]}>{title}</Text>
    </>
  );

  const shape = {
    height,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: space.xl,
  };

  const rootStyle = [
    { alignSelf: full ? 'stretch' : 'flex-start', opacity: disabled ? 0.5 : 1 },
    style,
  ];

  if (resolvedFrame) {
    const ink = frameTint || (variant === 'gradient' ? '#141414' : fg);
    // No radius and no fill on the inner box: the frame brings both, in the
    // right shape. `shape` is only the label's layout now.
    const { borderRadius, ...layout } = shape;

    return (
      <PressableScale
        onPress={handlePress}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || loading }}
        style={[
          { alignSelf: full ? 'stretch' : 'flex-start', opacity: disabled ? 0.5 : 1 },
          withoutBackground(styled),
        ]}
      >
        <Framed
          frame={resolvedFrame}
          tint={ink}
          // The brand CTA is a flat pink already (both gradient stops are the
          // same colour), so nothing is lost by letting the paper carry it —
          // and a gradient cannot be painted into a wobbly silhouette without
          // a mask layer this app does not ship.
          //
          // `outline` has no fill at all, and that has to reach Framed as
          // undefined rather than as the string 'transparent': the string is
          // truthy, so it would switch the paper layer on and hand
          // `tintColor: 'transparent'` to eight Images — which is not
          // guaranteed to erase them, and the failure mode is a white
          // silhouette sitting behind a button that is supposed to be a
          // hollow outline.
          fill={fillFor(variant, bg)}
          weight={size === 'sm' ? INK.thin : INK.base}
          pose={pose}
          boil={frameBoil}
          inset={false}
          style={{ height }}
          contentStyle={{ flex: 1 }}
        >
          <View style={layout}>{inner}</View>
        </Framed>
      </PressableScale>
    );
  }

  if (variant === 'gradient') {
    return (
      <PressableScale
        onPress={handlePress}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || loading }}
        style={rootStyle}
      >
        <LinearGradient
          colors={brand.gradient}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={shape}
        >
          {inner}
        </LinearGradient>
      </PressableScale>
    );
  }

  // The unframed button: the neo-brutalist control. `ghost` is the exception
  // and stays a bare label — the reference system sheet has the same three
  // rungs (filled, outlined, text) and the third one is deliberately chrome-
  // free, so giving it a stroke would flatten the hierarchy to two.
  const nb = toonSurface(colors, scheme, { on: bg, accent: acc });
  const hollow = variant === 'ghost';

  if (hollow) {
    return (
      <PressableScale
        onPress={handlePress}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || loading }}
        style={[{ ...shape, alignSelf: full ? 'stretch' : 'flex-start', opacity: disabled ? 0.5 : 1 }, style]}
      >
        {inner}
      </PressableScale>
    );
  }

  return (
    // HardShadow rather than `nb.shadow`, for two reasons. It is the only form
    // that renders on Android at all, and — the one that matters here — the
    // drop has to be a real view that STAYS PUT while the button slides into
    // it. An iOS layer shadow travels with the layer, so pressing would move
    // the button and its shadow together and nothing would ever land flush.
    <HardShadow
      offset={nb.offset}
      radius={shape.borderRadius}
      accent={acc}
      on={bg}
      style={{ alignSelf: full ? 'stretch' : 'flex-start' }}
    >
      <PressableShift
        onPress={handlePress}
        disabled={disabled || loading}
        offset={nb.offset}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || loading }}
        style={[
          {
            ...shape,
            backgroundColor: bg,
            borderWidth: nb.outline.borderWidth,
            // The accent stroke when a variant asked for one, otherwise the
            // scheme's ink judged against this button's own fill — so a pink
            // CTA and a paper secondary both get a stroke that shows.
            borderColor: border || nb.ink,
            opacity: disabled ? 0.5 : 1,
          },
          style,
        ]}
      >
        {inner}
      </PressableShift>
    </HardShadow>
  );
}
