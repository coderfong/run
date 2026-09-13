// A plot's outline at thumbnail size: the shape you would find on the map.
//
// On white paper, like the route thumbnail whose projection it borrows
// (RouteThumb). This is a drawing on a page and the outline is the runner's
// colour, which on a dark card or a pale clan hue would be a blank box. So the
// paper is fixed, the ink is judged against the paper, and the box's edge is
// the fixed dark ink that white paper always carries.

import React from 'react';
import { View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { NB, radius, readableInk, toon, withAlpha } from '../../theme';
import { THUMB_W, makeProjection, svgPoints } from '../RouteThumb';

const PAPER = '#FFFFFF';
// In the square virtual box RouteThumb projects into (THUMB_W on a side).
const PAD = 28;
const STROKE = 16;

export default function PlotShape({ rings, color, size = 48, style }) {
  const drawn = (rings || []).filter((r) => Array.isArray(r) && r.length >= 3);
  const ink = readableInk(PAPER, { prefer: color });
  const project = drawn.length ? makeProjection(drawn, PAD, THUMB_W) : null;
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          backgroundColor: PAPER,
          borderRadius: radius.sm,
          borderWidth: NB.strokeThin,
          borderColor: toon.ink,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {project ? (
        <Svg width="100%" height="100%" viewBox={`0 0 ${THUMB_W} ${THUMB_W}`}>
          {drawn.map((ring, i) => (
            <Polygon
              key={i}
              points={svgPoints(project(ring))}
              fill={withAlpha(ink, 0.25)}
              stroke={ink}
              strokeWidth={STROKE}
              strokeLinejoin="round"
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}
