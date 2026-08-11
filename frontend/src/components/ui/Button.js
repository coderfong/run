// Button — the one button. Variants: primary (accent fill), secondary
// (neutral surface), destructive (desaturated danger), ghost (text only),
// gradient (the PASER pink→purple brand CTA), outline (thin brand border).
// Press feedback = scale 0.97 + light haptic.

import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { brand, radius, space, useTheme, useThemedType } from '../../theme';
import { haptic, PressableScale } from '../../ui/motion';
import { framePose as poseFor, frameVariant } from '../../ui/frameRegistry';
import Framed from './Framed';

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
  // Full-width actions use the hand-drawn pack by default. Compact row actions
  // stay quiet (and cheap); pass a frame name to opt one in, or false to opt a
  // prominent CTA out.
  frame = 'auto',
  frameTint,
  framePose,
  frameBoil = false,
  style,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const acc = accent ?? colors.primary;
  const height = size === 'sm' ? 44 : 52;
  const textStyle = size === 'sm' ? type.buttonSm : type.button;
  const autoFrame = full && size !== 'sm' && variant !== 'ghost';
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
    const content = variant === 'gradient' ? (
      <LinearGradient
        colors={brand.gradient}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={shape}
      >
        {inner}
      </LinearGradient>
    ) : (
      <View style={shape}>{inner}</View>
    );

    return (
      <PressableScale
        onPress={handlePress}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled || loading }}
        style={rootStyle}
      >
        <Framed
          frame={resolvedFrame}
          tint={ink}
          fill={variant === 'gradient' ? brand.gradient[0] : bg}
          pose={pose}
          boil={frameBoil}
          inset={false}
          style={{ height }}
          contentStyle={{ flex: 1 }}
        >
          {content}
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
