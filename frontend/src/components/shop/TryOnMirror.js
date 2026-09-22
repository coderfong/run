// TryOnMirror — the standing mirror beside the counter.
//
// REUSES THE EXISTING CHARACTER RIG, not a bespoke preview. This used to be
// a rectangular card under the scene (ShopScreen's SelectedProductPanel);
// it is a physical object in the Water Point now, but it is drawing the
// exact same runner the old panel did — `equipped` merged with the
// candidate slot — because the thing being judged (does this look right on
// MY runner) has not changed, only where it stands.
//
// IDLE VS TRYING ON. With nothing selected the mirror shows the player's own
// current loadout, softly — it is furniture, not a call to action. The
// moment an item is picked the candidate slides in wearing it, on the same
// spring the rest of the scene uses for "something just changed" (Pop).

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import CharacterRig, { BODY_RATIO, HEADROOM } from '../character/CharacterRig';
import GameAnimation from '../GameAnimation';
import { Pop, useReduceMotion } from '../../ui/motion';
import { nbInk, useTheme, useThemedType, withAlpha } from '../../theme';
import { RARITY_COLOR } from '../RewardArt';

// Matches seedanceMirrorSparkle's real encoded duration (config/gameAnimations.js) —
// see that file for why this is a caller-timed one-shot rather than something
// the clip hides itself: same pattern every other reaction in this app uses
// (ProductPlacard's purchase burst, RewardReveal's card twinkles).
const SPARKLE_MS = 1375;

export default function TryOnMirror({ mirror, scale, cropTop, equipped, item, itemTick }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const width = mirror.width * scale;
  const height = width * 1.7; // a standing oval, taller than it is wide
  const runnerSize = width / (BODY_RATIO * (1 + HEADROOM)) * 0.86;

  const worn = useMemo(
    () => (item ? { ...(equipped || {}), [item.slot]: item.item_id } : equipped),
    [equipped, item]
  );

  // The sparkle plays once whenever a DIFFERENT item lands in the mirror —
  // "something new just went on" — and hides itself on a timer rather than
  // waiting for the clip's own last frame, same as every other reaction in
  // this app. Deselecting (itemTick -> falsy) never triggers it: there is
  // nothing new to celebrate about the mirror going back to idle.
  const [sparkling, setSparkling] = useState(false);
  useEffect(() => {
    if (!itemTick || reduced) return undefined;
    setSparkling(true);
    const t = setTimeout(() => setSparkling(false), SPARKLE_MS);
    return () => clearTimeout(t);
  }, [itemTick, reduced]);

  const tint = item ? (RARITY_COLOR[item.rarity] || colors.border) : colors.border;
  const ink = nbInk(scheme, colors.cardAlt);

  const left = mirror.centerX * scale - width / 2;
  const top = (mirror.bottom - cropTop) * scale - height;

  return (
    <View pointerEvents="none" style={[styles.wrap, { position: 'absolute', left, top, width }]}>
      <View
        style={[
          styles.glass,
          { width, height, borderColor: item ? tint : ink, backgroundColor: withAlpha(tint, item ? 0.14 : 0.06) },
        ]}
      >
        <Pop trigger={itemTick} from={0.85} style={styles.rigWrap}>
          <CharacterRig equipped={worn} size={runnerSize} animate animateSwaps />
        </Pop>
        {sparkling ? (
          <View style={[StyleSheet.absoluteFill, styles.sparkleLayer]} pointerEvents="none">
            <GameAnimation name="seedanceMirrorSparkle" size={width * 0.95} trigger={itemTick} />
          </View>
        ) : null}
      </View>
      <View style={[styles.label, { backgroundColor: colors.cardAlt, borderColor: ink }]}>
        <Text style={[type.caption, { fontSize: 10, color: colors.textMuted }]}>
          {item ? 'TRY IT ON' : 'YOUR PASER'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  glass: {
    borderWidth: 3,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  rigWrap: { alignItems: 'center' },
  sparkleLayer: { alignItems: 'center', justifyContent: 'center' },
  label: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1.5,
  },
});
