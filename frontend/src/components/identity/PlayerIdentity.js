// PlayerIdentity — one component for "draw this player", in three sizes.
//
// PLAYER IDENTITY IS NOT PLAYER RANK. Identity is what the runner looks like:
// the outfit somebody earned, bought and put together. Rank is how far they
// have climbed. They are shown together, and neither is allowed to swallow the
// other. The old default — a head in a circle inside a rank ring — let the
// ring do both jobs and hid most of the wardrobe (tops were a collar, bottoms,
// shoes and most accessories were not drawn at all).
//
// THE RULE (use the smallest mode that does the job; never go bigger in a
// long list):
//
//   portrait  TINY: notifications, reactions, chat, compact rows, far map
//             markers, small activity headers. Head in a circle, and the RANK
//             RING stays as its border, because at 30 to 50pt there is nowhere
//             else to put rank. This is the old CharacterBust + PortraitBorder
//             pairing, unchanged.
//
//   bust      MEDIUM: bigger headers, club member previews, rival summaries,
//             compact profile cards. Hat to hips in a rounded window, so the
//             top reads. Rank is a small RankCrest on the corner, not a ring.
//
//   full      SHOWCASE: the You page, a runner's profile, podiums, rank
//             progression, claim/defend/rank up payoffs, the share card. The
//             whole outfit, shoes included, fitted contain style (nothing
//             cropped). Rank is a RankCrest beside the runner or its name.
//
// Performance: a full rig is ~10 image layers. Featured surfaces only — a
// podium of three, one hero, one payoff. Rows in a FlatList stay portrait (or
// bust where there is room and few rows).
//
// Usage:
//   <PlayerIdentity mode="portrait" equipped={a} rankKey="gold" size={40} />
//   <PlayerIdentity mode="bust" equipped={a} standing={s} size={96} />
//   <PlayerIdentity mode="full" equipped={a} size={220} pose="celebrate" />

import React from 'react';
import { View } from 'react-native';

import { CharacterBust } from '../character/CharacterRig';
import PortraitBorder from '../PortraitBorder';
import RunnerBust from './RunnerBust';
import RunnerFigure from './RunnerFigure';
import RankCrest from './RankCrest';

export { default as RunnerFigure, figureLayout, figureWidthFor } from './RunnerFigure';
export { default as RunnerBust, bustLayout } from './RunnerBust';
export { default as RankCrest } from './RankCrest';
export { POSES, resolvePose } from './poses';

export const IDENTITY_MODES = ['portrait', 'bust', 'full'];

/**
 * @param {'portrait'|'bust'|'full'} mode
 * @param {object}  equipped  the loadout (nullable)
 * @param {string}  rankKey   tier key, for the ring (portrait) or crest
 * @param {object}  standing  from `standingFrom()`, adds the division numeral
 * @param {number}  size      portrait diameter / bust height / figure height
 * @param {number}  width     bust or figure box width (optional)
 * @param {boolean} showRank  ring (portrait) or corner crest (bust, full)
 * @param {string}  pose      full only; see poses.js
 * @param {string}  bg        portrait disc / bust window fill
 */
export default function PlayerIdentity({
  mode = 'portrait',
  equipped,
  rankKey,
  standing,
  size = 44,
  width,
  showRank = true,
  pose,
  animate = false,
  bg,
  ring,
  crisp,
  style,
  accessibilityLabel,
}) {
  const key = standing?.key || rankKey || 'wood';

  if (mode === 'full') {
    const figure = (
      <RunnerFigure
        equipped={equipped}
        height={size}
        width={width}
        pose={pose}
        animate={animate}
        crisp={crisp}
        accessibilityLabel={accessibilityLabel}
      />
    );
    if (!showRank) return <View style={style}>{figure}</View>;
    const crest = Math.max(22, Math.round(size * 0.16));
    return (
      <View style={style}>
        {figure}
        <RankCrest
          standing={standing}
          tierKey={key}
          size={crest}
          style={{ position: 'absolute', left: 0, bottom: 0 }}
        />
      </View>
    );
  }

  if (mode === 'bust') {
    const crest = Math.max(18, Math.round(size * 0.3));
    return (
      <View style={style} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
        <RunnerBust equipped={equipped} height={size} width={width} bg={bg} ring={ring} crisp={crisp} />
        {showRank ? (
          <RankCrest
            standing={standing}
            tierKey={key}
            size={crest}
            style={{ position: 'absolute', right: -crest * 0.25, bottom: -crest * 0.2 }}
          />
        ) : null}
      </View>
    );
  }

  const bust = <CharacterBust equipped={equipped} size={size} bg={bg} ring={ring} crisp={crisp} />;
  return (
    <View style={style} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
      {showRank ? (
        <PortraitBorder borderKey={key} size={size}>
          {bust}
        </PortraitBorder>
      ) : (
        bust
      )}
    </View>
  );
}
