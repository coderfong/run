// Card — the one elevated surface. Light: white + soft card shadow, no
// border. Dark: raised surface step, no shadow, no border (constitution:
// never border + shadow together; dark uses surface steps for depth).

import React from 'react';
import { View } from 'react-native';

import { darkColors, radius, shadow, space, useTheme } from '../../theme';
import { PressableScale } from '../../ui/motion';

export default function Card({ children, dark = false, padded = true, onPress, style, ...rest }) {
  const { colors, scheme } = useTheme();
  const isDark = dark || scheme === 'dark';
  const surface = {
    backgroundColor: dark ? darkColors.card : colors.card,
    borderRadius: radius.card,
    padding: padded ? space.lg : 0,
    ...(isDark ? {} : shadow.card),
  };

  if (onPress) {
    return (
      <PressableScale style={[surface, style]} onPress={onPress} {...rest}>
        {children}
      </PressableScale>
    );
  }
  return (
    <View style={[surface, style]} {...rest}>
      {children}
    </View>
  );
}
