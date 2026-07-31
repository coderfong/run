// OutlinedText — display text with a hard ink outline (the mobile-game look).
//
// React Native's Text supports exactly ONE textShadow, so a real outline is
// drawn by stacking 8 offset copies of the string behind the fill copy. The
// copies are absolutely positioned over the fill's own box, so they wrap and
// align identically as long as they share `textAlign` (they do).
//
// Only the fill copy is exposed to screen readers.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const RING = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

export default function OutlinedText({
  children,
  style,
  outline = '#0C0C10',
  width = 3,
  align = 'center',
  numberOfLines,
  containerStyle,
  ...rest
}) {
  const shared = [style, { textAlign: align }];
  return (
    <View style={containerStyle}>
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {RING.map(([x, y]) => (
          <Text
            key={`${x}:${y}`}
            numberOfLines={numberOfLines}
            style={[
              StyleSheet.absoluteFill,
              shared,
              { color: outline, transform: [{ translateX: x * width }, { translateY: y * width }] },
            ]}
          >
            {children}
          </Text>
        ))}
      </View>
      <Text numberOfLines={numberOfLines} style={shared} {...rest}>
        {children}
      </Text>
    </View>
  );
}
