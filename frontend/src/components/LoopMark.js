// LoopMark — the brand mark as an inline SVG: a single closed glowing loop
// with a start-dot seam. Reused in the auth header, empty states, and the
// share-card watermark so the identity stays consistent.

import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

import { withAlpha } from '../theme';

const GLOW = '#7dd3fc';
const CORE = '#f0f9ff';

export default function LoopMark({ size = 28, color = CORE, glowColor = GLOW, glow = true }) {
  const c = size / 2;
  const r = size * 0.34;
  const w = Math.max(size * 0.1, 2);
  // Arc from -80° sweeping 340° (a near-closed loop; the gap is the seam).
  const start = -80 * (Math.PI / 180);
  const end = (-80 + 340) * (Math.PI / 180);
  const x0 = c + r * Math.cos(start);
  const y0 = c + r * Math.sin(start);
  const x1 = c + r * Math.cos(end);
  const y1 = c + r * Math.sin(end);
  const d = `M ${x0} ${y0} A ${r} ${r} 0 1 1 ${x1} ${y1}`;

  return (
    <Svg width={size} height={size}>
      {glow && <Path d={d} stroke={withAlpha(glowColor, 0.35)} strokeWidth={w * 2.4} fill="none" strokeLinecap="round" />}
      <Path d={d} stroke={color} strokeWidth={w} fill="none" strokeLinecap="round" />
      <Circle cx={c} cy={c - r} r={w * 0.85} fill={color} />
    </Svg>
  );
}
