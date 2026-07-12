// Button — the one button. Variants: primary (accent fill), secondary
// (neutral surface), destructive (desaturated danger), ghost (text only),
// gradient (the PACER pink→purple brand CTA), outline (thin brand border).
// Press feedback = scale 0.97 + light haptic.

import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { brand, colors, radius, space, type } from '../../theme';
import { haptic, PressableScale } from '../../ui/motion';

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  accent = colors.primary,
  loading = false,
  disabled = false,
  icon = null,
  full = true,
  style,
}) {
  const height = size === 'sm' ? 44 : 52;
  const textStyle = size === 'sm' ? type.buttonSm : type.button;

  let bg = accent;
  // Primary fills with `accent` (white by default) — so its text must be the
  // dark ink, not white-on-white.
  let fg = accent === colors.primary ? colors.primaryInk : '#ffffff';
  let border = null;
  if (variant === 'secondary') {
    bg = colors.cardAlt;
    fg = colors.text;
  } else if (variant === 'destructive') {
    bg = colors.danger;
    fg = '#ffffff';
  } else if (variant === 'ghost') {
    bg = 'transparent';
    fg = accent;
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

  if (variant === 'gradient') {
    return (
      <PressableScale
        onPress={handlePress}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={[{ alignSelf: full ? 'stretch' : 'flex-start', opacity: disabled ? 0.5 : 1 }, style]}
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
