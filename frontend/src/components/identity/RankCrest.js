// RankCrest — rank as a small standalone badge, separate from the character.
//
// THE PORTRAIT FRAME IS NOT A BADGE. The tier's ring art (config/borderArt.js)
// is a player status frame: it belongs round the runner's FACE, and only there
// (identity/RankedAvatar). This crest used to reuse that frame round a disc
// carrying the division numeral, which put a portrait frame round "III" — the
// rank symbol dressed up as if it were the player. So the crest is now its own
// mark: a disc in the tier's colour, outlined in the tier's ink, carrying the
// numeral. Same colour and same numeral as the plaque and the ladder, so the
// crest and a frame can never disagree about what somebody is.
//
// Use it where the player is already drawn whole (a podium, a showcase card)
// and rank has to be stated BESIDE the runner. Where there is a face, use
// RankedAvatar instead.
//
// Optional label to its right: the tier name ("MYTHIC III") and a points line.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { numeral, tierByKey } from '../../config/rankLadder';
import { fonts, withAlpha } from '../../theme';

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

/**
 * @param {object} standing   from `standingFrom()` — preferred, carries tier,
 *                            division, name and points in one
 * @param {string} tierKey    or just a tier key (division then from `division`)
 * @param {number} division   1..3; omitted draws the disc without a numeral
 * @param {number} size       the crest's overall footprint
 * @param {boolean} label     draw the tier name beside it
 * @param {number} points     draw "2,484 RP" under the name
 * @param {string} textColor  label ink
 * @param {string} subColor   points ink
 */
function RankCrest({
  standing,
  tierKey,
  division,
  size = 30,
  label = false,
  points,
  textColor = '#ffffff',
  subColor,
  labelStyle,
  style,
}) {
  const tier = standing || tierByKey(tierKey || 'wood');
  const div = standing ? standing.division : division;
  const name = standing ? standing.name : (div ? `${tier.label} ${numeral(div)}` : tier.label);
  const pts = points ?? (standing ? standing.points : null);
  const stroke = Math.max(1.5, Math.round(size * 0.07 * 2) / 2);

  const emblem = (
    <View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tier.color,
          borderColor: tier.ink,
          borderWidth: stroke,
        },
      ]}
    >
      {/* A lighter upper half, so the disc reads as a struck badge rather
          than a flat dot. Clipped by the disc's own radius. */}
      <View
        pointerEvents="none"
        style={[styles.shine, { height: size / 2 - stroke, backgroundColor: withAlpha('#ffffff', 0.22) }]}
      />
      {div ? (
        <Text
          allowFontScaling={false}
          style={[styles.numeral, { color: tier.ink, fontSize: Math.max(8, size * 0.4) }]}
        >
          {numeral(div)}
        </Text>
      ) : null}
    </View>
  );

  if (!label) {
    return (
      <View style={style} accessible accessibilityRole="image" accessibilityLabel={`Rank ${name}`}>
        {emblem}
      </View>
    );
  }

  return (
    <View
      style={[styles.row, style]}
      accessible
      accessibilityLabel={pts != null ? `Rank ${name}, ${fmt(pts)} rank points` : `Rank ${name}`}
    >
      {emblem}
      <View style={styles.text}>
        <Text numberOfLines={1} style={[styles.name, { color: textColor }, labelStyle]}>
          {String(name).toUpperCase()}
        </Text>
        {pts != null ? (
          <Text numberOfLines={1} style={[labelStyle, styles.points, { color: subColor || withAlpha(textColor, 0.72) }]}>
            {`${fmt(pts)} RP`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default React.memo(RankCrest);

const styles = StyleSheet.create({
  disc: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  shine: { position: 'absolute', left: 0, right: 0, top: 0 },
  numeral: { fontFamily: fonts.display, includeFontPadding: false, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { flexShrink: 1 },
  name: { fontFamily: fonts.display, fontSize: 13, letterSpacing: 1, lineHeight: 16 },
  points: { fontFamily: fonts.displayMedium, fontSize: 11, lineHeight: 14 },
});
