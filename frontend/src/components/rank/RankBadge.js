// The rank badge and its nameplate — the two marks the whole ladder is built
// from.
//
// THE BADGE IS THE PLAYER, NOT AN EMBLEM. Every rung of the ladder shows YOUR
// runner wearing that tier's frame, which is why the ladder reads as somewhere
// you are standing rather than as a price list. The frames are the border art
// the app already ships and already puts round every portrait
// (config/borderArt.js), so a badge here, a portrait on the feed and a rank
// filter on the map are guaranteed to agree about what a tier looks like — and
// it costs no new assets, which matters while the bundle is over the OTA
// ceiling.
//
// STARS ARE THE DIVISION. One filled star per division reached, three hollow
// ones on a tier you have not touched. It is the same information as the
// numeral on the plaque, said twice on purpose: the numeral is exact and the
// stars are countable at a glance while scrolling past.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import RankedAvatar from '../identity/RankedAvatar';
import { DIVISIONS } from '../../config/rankLadder';
import { fonts, space, withAlpha } from '../../theme';

/** One star. Filled at the tier's colour, hollow when the division is unearned. */
function Star({ size = 16, filled, color }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2.6 L15 9.2 L22 10 L16.9 14.8 L18.3 21.6 L12 18.2 L5.7 21.6 L7.1 14.8 L2 10 L9 9.2 Z"
        fill={filled ? color : 'transparent'}
        stroke={filled ? 'rgba(0,0,0,0.35)' : withAlpha('#ffffff', 0.45)}
        strokeWidth={filled ? 1.2 : 1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * The nameplate: an angled ribbon carrying "GOLD II".
 *
 * Drawn as one polygon rather than a rounded box because the angled ends are
 * what stop a row of these reading as a stack of buttons. The text sits over
 * the SVG rather than inside it — RN's <Text> hyphenates, wraps and scales
 * with the system font setting, and none of that is true of SVG <Text>.
 */
export function RankPlaque({ name, color, ink, width = 200, height = 42, dim, style }) {
  const w = 200;
  const h = 42;
  const cut = 15;
  const id = `plaque-${String(color).replace('#', '')}`;
  return (
    <View style={[{ width, height }, styles.plaque, style]}>
      <Svg width={width} height={height} viewBox={`0 0 ${w} ${h}`}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={withAlpha(color, dim ? 0.5 : 1)} />
            <Stop offset="1" stopColor={withAlpha(color, dim ? 0.32 : 0.72)} />
          </LinearGradient>
        </Defs>
        <Path
          d={`M 0 ${h / 2} L ${cut} 2 L ${w - cut} 2 L ${w} ${h / 2} L ${w - cut} ${h - 2} L ${cut} ${h - 2} Z`}
          fill={`url(#${id})`}
          stroke="rgba(0,0,0,0.35)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </Svg>
      <Text
        numberOfLines={1}
        style={[
          styles.plaqueText,
          { color: dim ? withAlpha('#ffffff', 0.75) : (ink || '#1a1206'), fontSize: height * 0.4 },
        ]}
      >
        {String(name).toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * A tier badge: the runner in that tier's frame, with its division stars.
 *
 * `division` fills that many stars. Pass 0 for a tier not yet reached — the
 * stars go hollow and `dim` fades the whole badge, which is how the rungs
 * above you are drawn.
 */
export default function RankBadge({
  tierKey,
  equipped,
  size = 96,
  division = 0,
  color,
  showStars = true,
  dim = false,
  style,
}) {
  return (
    <View style={[styles.badge, dim && styles.dim, style]}>
      <RankedAvatar equipped={equipped} rankKey={tierKey} size={size} />
      {showStars ? (
        <View style={styles.stars}>
          {Array.from({ length: DIVISIONS }, (_, i) => (
            <Star key={i} size={Math.max(12, size * 0.17)} filled={i < division} color={color} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center' },
  dim: { opacity: 0.55 },
  stars: { flexDirection: 'row', gap: 2, marginTop: -space.xs },

  plaque: { alignItems: 'center', justifyContent: 'center' },
  plaqueText: {
    position: 'absolute',
    fontFamily: fonts.display,
    letterSpacing: 1.4,
    textAlign: 'center',
  },
});
