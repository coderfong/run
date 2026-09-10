// One cell of a stat wall — a drawn box with a number in it.
//
// Drawn boxes. A stat wall is the one place in the app where the same shape
// repeats six times, so the hand-drawn edge does the most work here: six
// identical rounded rects read as a spreadsheet, six drawn boxes read as a page
// out of a notebook.
//
// The chip group, not `panel`. A tile is about 105pt across and `panel` is a
// 152pt drawing whose left corner alone is 39 of those — drawn on a tile it
// filled a third of the width with one corner and squeezed the label into a
// column so narrow that "Distance" broke across two lines. The chip frames are
// drawn at 44pt, so at tile size their corners are corners.
//
// Dealt from the group by LABEL, so the six tiles are not six prints of one
// drawing — which is the thing that gives a hand-drawn look away. Two walls
// showing the same six stats therefore also deal the same six frames, which is
// what makes your profile and somebody else's read as the same object.
//
// It lives here rather than in either screen because You and RunnerProfile are
// the same wall: the read-only twin used to build its tiles out of bare Cards,
// and a bare Card is the one thing that cannot carry a percentage width (its
// hard-shadow wrapper is what gets laid out — see components/ui/Card.js), so
// that wall collapsed into six black columns with the labels set vertically.

import React from 'react';
import { StyleSheet, View } from 'react-native';

import AppIcon from './AppIcon';
import { Card, StatValue } from './ui';
import { frameVariant } from '../ui/frameRegistry';

// Two ways a tile can carry a sticker, and they are not interchangeable.
//
// `icon` sits INSIDE, in the bottom right — the corner the value leaves empty
// on a tile whose number is short ("2 runs", "1 wk"). It is positioned against
// the frame's padding edge, so it lands just inside the drawn line whatever
// frame the label deals.
//
// `badge` HANGS OFF the top right corner instead, for the tile whose number
// fills the box. A tile is about 84pt of content across and `0.62 km²` at the
// stat size is most of that, so an inside sticker would be printed over the
// unit — the headline tile wears its crown above the box, the way a prize is
// worn, and the frame's ink crosses its foot.
const ICON = 22;
const BADGE = 26;

export default function StatTile({ label, value, unit, accent, countTo, format, icon, badge, style }) {
  return (
    <Card frame={frameVariant('chip', label)} frameTint={accent} style={style} padded>
      <StatValue
        size="md"
        label={label}
        value={value}
        unit={unit}
        color={accent}
        countTo={countTo}
        format={format}
      />
      {icon ? (
        <View style={styles.icon} pointerEvents="none">
          <AppIcon name={icon} size={ICON} />
        </View>
      ) : null}
      {badge ? (
        <View style={styles.badge} pointerEvents="none">
          <AppIcon name={badge} size={BADGE} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  icon: { position: 'absolute', right: 0, bottom: 0 },
  badge: { position: 'absolute', right: -2, top: -BADGE * 0.62 },
});
