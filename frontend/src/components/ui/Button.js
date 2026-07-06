// Button — the one button. Variants: primary (accent fill), secondary
// (neutral surface), destructive (desaturated danger), ghost (text only).
// Press feedback = scale 0.97 + light haptic (constitution).

import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { colors, radius, space, type } from '../../theme';
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
  let fg = '#ffffff';
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
  }

  const handlePress = () => {
    if (disabled || loading) return;
    haptic.light();
    onPress?.();
  };

  return (
    <PressableScale
      onPress={handlePress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[
        {
          height,
          borderRadius: radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: space.xl,
          backgroundColor: bg,
          ...(border ? { borderWidth: 1, borderColor: border } : {}),
          alignSelf: full ? 'stretch' : 'flex-start',
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <View>{icon}</View> : null}
          <Text style={[textStyle, { color: fg }]}>{title}</Text>
        </>
      )}
    </PressableScale>
  );
}
