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
  // Shrink the type until the string fits the box it was given, instead of
  // wrapping or running under the edge. Applied to EVERY copy: the ring is
  // eight separate Texts, and letting only the fill shrink leaves the outline
  // drawn at the original size around a smaller word.
  fit = false,
  minimumFontScale = 0.7,
  onLayout,
  ...rest
}) {
  const shared = [style, { textAlign: align }];
  // Fitting is a single-line operation — a string allowed to wrap always
  // "fits" and never shrinks.
  const lines = fit ? numberOfLines || 1 : numberOfLines;
  const fitProps = fit ? { adjustsFontSizeToFit: true, minimumFontScale } : null;
  return (
    <View style={containerStyle}>
      {/* width 0 means NO outline — skip the ring entirely rather than stacking
          eight ink copies at zero offset behind the fill. Those still showed:
          the fill's anti-aliased edges let the ink beneath bleed through as a
          dark fringe, which reads as a drop shadow on the word. */}
      {width > 0 ? (
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {RING.map(([x, y]) => (
          <Text
            key={`${x}:${y}`}
            numberOfLines={lines}
            {...fitProps}
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
      ) : null}
      <Text numberOfLines={lines} {...fitProps} style={shared} onLayout={onLayout} {...rest}>
        {children}
      </Text>
    </View>
  );
}
