// PlayerShowcaseCard — a runner presented socially: who, how far they have
// climbed, and the whole outfit.
//
// Visual priority, top to bottom of importance: the character, the name, the
// rank, then any numbers. So the runner gets the height, the name sits above
// it in the display face, rank is a crest (never a ring round the figure), and
// stats are one quiet line at the foot.
//
// Every slot beyond the runner is optional. A rival card might want the name
// and the crest, a club MVP a title and one stat; nothing is forced.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import Framed from '../ui/Framed';
import { INK, framePose, frameVariant } from '../../ui/frameRegistry';
import RunnerFigure from './RunnerFigure';
import RankCrest from './RankCrest';
import { fonts, space, useTheme, useThemedType, withAlpha } from '../../theme';

/**
 * @param {string} name        username
 * @param {string} title       optional eyebrow ("CLUB MVP", "YOUR RIVAL")
 * @param {object} equipped    loadout (nullable)
 * @param {object} standing    from `standingFrom()`, for the crest
 * @param {string} rankKey     or just a tier key
 * @param {string[]} stats     short strings, joined with " · "
 * @param {number} runnerHeight
 * @param {string} color       player colour: the frame ink and a wash behind the runner
 * @param {string} pose        see poses.js
 * @param {node}   background  drawn behind the runner (a scene, tier art)
 * @param {node}   footer      anything under the stats (a button row)
 */
function PlayerShowcaseCard({
  name,
  title,
  equipped,
  standing,
  rankKey,
  stats,
  runnerHeight = 200,
  color,
  pose,
  animate = false,
  background,
  footer,
  seed,
  style,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const ink = color || colors.text;
  const frameSeed = seed || `showcase:${name || ''}`;
  const line = (stats || []).filter(Boolean).join(' · ');
  const showRank = !!(standing || rankKey);

  return (
    <Framed
      frame={frameVariant('card', frameSeed)}
      pose={framePose(frameSeed)}
      tint={ink}
      fill={colors.card}
      weight={INK.medium}
      inset={false}
      style={style}
      contentStyle={styles.content}
    >
      {title ? (
        <Text style={[type.labelSm, styles.title, { color: colors.textMuted }]} numberOfLines={1}>
          {String(title).toUpperCase()}
        </Text>
      ) : null}
      {name ? (
        <Text style={[type.title, styles.name, { color: colors.text }]} numberOfLines={1}>
          {name}
        </Text>
      ) : null}
      {showRank ? (
        <RankCrest
          standing={standing}
          tierKey={rankKey}
          size={26}
          label
          textColor={colors.text}
          subColor={colors.textMuted}
          style={styles.crest}
        />
      ) : null}

      <View style={[styles.stage, { height: runnerHeight + space.sm }]}>
        {background ? <View style={StyleSheet.absoluteFill}>{background}</View> : (
          <View
            style={[styles.floor, { backgroundColor: withAlpha(color || colors.text, 0.1) }]}
            pointerEvents="none"
          />
        )}
        <RunnerFigure
          equipped={equipped}
          height={runnerHeight}
          pose={pose}
          animate={animate}
          accessibilityLabel={name ? `${name}'s runner` : 'Runner'}
        />
      </View>

      {line ? (
        <Text style={[type.captionMedium, styles.stats, { color: colors.textMuted }]} numberOfLines={1}>
          {line}
        </Text>
      ) : null}
      {footer}
    </Framed>
  );
}

export default React.memo(PlayerShowcaseCard);

const styles = StyleSheet.create({
  content: { padding: space.md, alignItems: 'center' },
  title: { letterSpacing: 1.2 },
  name: { textAlign: 'center', fontFamily: fonts.hero },
  crest: { marginTop: 4 },
  stage: { width: '100%', alignItems: 'center', justifyContent: 'flex-end', marginTop: space.sm },
  // An oval of shadow for the runner to stand on, so the figure is ON the
  // card rather than floating in it.
  floor: {
    position: 'absolute',
    bottom: -6,
    width: '52%',
    height: 14,
    borderRadius: 7,
  },
  stats: { marginTop: space.sm, textAlign: 'center' },
});
