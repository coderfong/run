// Button — the one button. Variants: primary (accent fill), secondary
// (neutral surface), destructive (desaturated danger), ghost (text only),
// gradient (the PASER pink→purple brand CTA), outline (thin brand border).
// Press feedback = scale 0.97 + light haptic.

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { brand, radius, space, useTheme, useThemedType } from '../../theme';
import { haptic, PressableScale } from '../../ui/motion';
import { INK, framePose as poseFor, frameVariant } from '../../ui/frameRegistry';
import Framed from './Framed';

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
  const { colors } = useTheme();
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

  let bg = acc;
  // Primary fills with `acc` (the neutral ink by default) — so its text must
  // be the contrasting ink, not white-on-white.
  let fg = acc === colors.primary ? colors.primaryInk : '#ffffff';
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
    bg = 'transparent';
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
          fill={variant === 'gradient' ? brand.gradient[0] : bg}
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

  return (
    <PressableScale
      onPress={handlePress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || loading }}
      style={[
        {
          ...shape,
          backgroundColor: bg,
          ...(border ? { borderWidth: 1.5, borderColor: border } : {}),
          alignSelf: full ? 'stretch' : 'flex-start',
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {inner}
    </PressableScale>
  );
}
