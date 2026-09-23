// RankCrest — rank as a small emblem, separate from the character.
//
// In a portrait the rank frame IS the avatar's border, and that is right when
// the avatar is 40pt and has nowhere else to put it. On a full body runner the
// same ring would have to go round the whole figure or round nothing; wrapping
// only the head swallows the thing the player dressed. So in bust and full
// contexts rank is stated BESIDE the runner, by this: the tier's own ring art
// (config/borderArt.js, the frame every portrait already wears) around a disc
// in the tier's colour carrying the division numeral. Same asset, same colour,
// same numeral as the rest of the ladder, so the crest, a portrait border and
// the ladder's plaque can never disagree about what somebody is. No new art.
//
// Optional label to its right: the tier name ("MYTHIC III") and a points line.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import PortraitBorder from '../PortraitBorder';
import { BORDER_ART } from '../../config/borderArt';
import { numeral, tierByKey } from '../../config/rankLadder';
import { fonts, withAlpha } from '../../theme';

// PortraitBorder's `size` is the ring's OPENING and it grows the footprint up
// to 1.5 times that. To make a crest a given size overall, size the opening
// back down by the same factor.
function openingFor(tierKey, size) {
  const artTier = BORDER_ART[tierKey];
  if (!artTier) return size;
  return size / Math.min(1 / artTier.hole, 1.5);
}

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
  const key = tier.key || tierKey || 'wood';
  const div = standing ? standing.division : division;
  const name = standing ? standing.name : (div ? `${tier.label} ${numeral(div)}` : tier.label);
  const pts = points ?? (standing ? standing.points : null);
  const hole = openingFor(key, size);
  const disc = hole * 0.9;

  const emblem = (
    <PortraitBorder borderKey={key} size={hole}>
      <View
        style={[
          styles.disc,
          { width: disc, height: disc, borderRadius: disc / 2, backgroundColor: tier.color },
        ]}
      >
        {div ? (
          <Text
            allowFontScaling={false}
            style={[styles.numeral, { color: tier.ink, fontSize: Math.max(8, disc * 0.44) }]}
          >
            {numeral(div)}
          </Text>
        ) : null}
      </View>
    </PortraitBorder>
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
  disc: { alignItems: 'center', justifyContent: 'center' },
  numeral: { fontFamily: fonts.display, includeFontPadding: false, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { flexShrink: 1 },
  name: { fontFamily: fonts.display, fontSize: 13, letterSpacing: 1, lineHeight: 16 },
  points: { fontFamily: fonts.displayMedium, fontSize: 11, lineHeight: 14 },
});
