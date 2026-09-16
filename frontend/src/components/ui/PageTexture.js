// PageTexture — the night page's dot grid.
//
// The dark palette is a saturated indigo now (theme/dark.js), and this is the
// other half of what makes it read as neo-brutalist rather than as a dark mode:
// a regular grid of dots behind everything, the ground the reference boards
// stand their boxes on. It paints the palette's `grid` token, which the light
// palette sets to null, so on paper this renders nothing at all.
//
// ONE PATH, NOT A PATTERN. Every dot is a subpath of a single <Path>, so the
// whole grid is one shape with one fill: the same primitive the sticker marks
// in Shapes.js already draw with on both platforms, rather than SVG <Pattern>,
// which nothing else in the app leans on. The path is built once per window
// size and cached, so a page mounting costs a lookup, not a rebuild.
//
// ANCHORED TO THE WINDOW, NOT THE CONTENT. The grid does not scroll: it sits
// behind the ScrollView the way a painted backdrop does, which keeps it free
// (nothing redraws on scroll) and keeps every page's dots on the SAME lattice,
// so a pushed screen slides in over a grid that lines up with the one it covers.
//
// Absolutely positioned and non-interactive: drop it as the FIRST child of a
// page that paints `colors.bg`, and it can never add height or take a tap.

import React, { memo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { darkColors, useTheme } from '../../theme';

// Centre-to-centre spacing and dot radius, in points. Wide enough that the grid
// reads as a texture rather than a tone, tight enough that every card has dots
// on all four sides of it.
export const GRID_PITCH = 22;
export const GRID_DOT = 1.3;

const PATHS = new Map();

// Every dot as two half arcs, so the grid is one path however many dots it has.
export function gridPath(width, height, pitch = GRID_PITCH, r = GRID_DOT) {
  const key = `${Math.ceil(width)}x${Math.ceil(height)}:${pitch}:${r}`;
  let d = PATHS.get(key);
  if (d) return d;
  const parts = [];
  const half = pitch / 2;
  for (let y = half; y < height + half; y += pitch) {
    for (let x = half; x < width + half; x += pitch) {
      parts.push(`M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`);
    }
  }
  d = parts.join('');
  PATHS.set(key, d);
  return d;
}

/**
 * `dark`  force the night grid whatever the scheme, for the pages that are dark
 *         on purpose in both (the same prop Screen and Card take).
 */
function PageTexture({ dark = false }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const color = dark ? darkColors.grid : colors.grid;
  if (!color || !width || !height) return null;
  return (
    <View pointerEvents="none" style={styles.fill}>
      <Svg width={width} height={height}>
        <Path d={gridPath(width, height)} fill={color} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
});

export default memo(PageTexture);
