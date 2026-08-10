// CROSSED PATHS — the last beat of the post-run sequence.
//
// It runs AFTER the territory reveal, the payoff and the standings, and only
// when the run actually turned somebody up. Nothing above it is touched: this
// is a separate overlay that opens when the celebration is otherwise finished,
// so a run with no crossings ends exactly the way it always did.
//
// The stage is the plaza (PlazaScene) — the place the running paths meet, with
// its clouds drifting and its butterflies out. The characters walk on one at a
// time in their real cosmetics and wave, standing on the plaza's own ground
// circles. Under Reduce Motion they are simply there, all at once, with no
// stagger and no wave, and the plaza holds still behind them — the same rule
// the rest of the app follows (see ui/motion.js).
//
// Deliberately short: three characters at ~420 ms apart is a beat and a half,
// and the buttons are live from the moment the last one lands.
//
// EVERY piece of copy here sits on painted art, so it is white with an ink
// outline rather than a themed text colour: `colors.text` is near-black in
// light mode and would vanish into the plaza's paving.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { brand, space, toon, toonType } from '../../theme';
import { PressableScale, haptic, useReduceMotion } from '../../ui/motion';
import { OutlinedText, ToonButton } from '../ui';
import CharacterRig from '../character/CharacterRig';
import PlazaScene from './PlazaScene';
import { COPY, crossedPathsLine, familiarityLabel, moreLine, revealCast } from '../../config/paserby';

// One character per beat. Three of them is ~1.3 s, which is a moment of
// arrival rather than a cutscene.
const STEP_MS = 420;
const RIG_SIZE = 84;

function Encountered({ encounter, index, reduced }) {
  const rig = useRef(null);

  // The wave lands as they arrive, not before.
  useEffect(() => {
    if (reduced) return undefined;
    const id = setTimeout(() => rig.current?.play('wave'), index * STEP_MS + 220);
    return () => clearTimeout(id);
  }, [index, reduced]);

  return (
    <Animated.View
      style={styles.cast}
      entering={reduced ? undefined : FadeInDown.delay(index * STEP_MS).duration(300)}
    >
      {/* The rig, not a bust: this is the whole runner walking on, wearing
          exactly what they have equipped. */}
      <View style={styles.rigWrap}>
        <CharacterRig ref={rig} equipped={encounter.avatar} size={RIG_SIZE} animate />
      </View>
      {/* No plate under the name — the ink outline is what makes white type
          read on the plaza's pale paving, and a translucent chip behind every
          character turned the stage into three labels. */}
      <OutlinedText
        style={[toonType.sub, styles.castName]}
        outline={toon.ink}
        width={2.5}
        numberOfLines={1}
      >
        {encounter.username}
      </OutlinedText>
      <OutlinedText
        style={[toonType.label, styles.castLabel]}
        outline={toon.ink}
        width={2}
        numberOfLines={1}
      >
        {familiarityLabel(encounter)}
      </OutlinedText>
    </Animated.View>
  );
}

export default function PaserbyReveal({
  visible,
  reveal,
  onHighFiveAll,
  onViewCrossroads,
  onContinue,
  highFiving = false,
  highFivedAll = false,
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const { shown, more } = useMemo(() => revealCast(reveal), [reveal]);
  // The buttons arrive with the last character, so nothing is tappable while
  // people are still walking on — and under Reduce Motion, immediately.
  const [ready, setReady] = useState(reduced);

  useEffect(() => {
    if (!visible) {
      setReady(reduced);
      return undefined;
    }
    haptic.success();
    if (reduced) {
      setReady(true);
      return undefined;
    }
    const id = setTimeout(() => setReady(true), shown.length * STEP_MS + 260);
    return () => clearTimeout(id);
  }, [visible, reduced, shown.length]);

  if (!visible || shown.length === 0) return null;

  const count = reveal?.new_count ?? shown.length;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onContinue}>
      {/* `active` is tied to the modal being up, so the clouds and the
          butterflies are not still running behind a dismissed screen. */}
      <PlazaScene active={visible}>
        {/* No scrims, no plates. The plaza is painted art and it stays at full
            strength: every word on it is white with an ink outline, and the two
            buttons carry their own ink-outlined fills. */}
        <View style={styles.layout}>
          <View style={[styles.headline, { paddingTop: insets.top + space.lg }]}>
            <OutlinedText
              style={[toonType.hero, { color: '#fff' }]}
              outline={toon.ink}
              width={3}
            >
              {COPY.revealHeading}
            </OutlinedText>
            <OutlinedText
              style={[toonType.sub, styles.subline]}
              outline={toon.ink}
              width={2}
            >
              {crossedPathsLine(count)}
            </OutlinedText>
          </View>

          {/* The cast stands in the lower half, which is where the plaza's own
              ground circles are once the art is covered into a phone's taller
              frame. */}
          <View style={styles.stageArea}>
            <View style={styles.stage}>
              {shown.map((e, i) => (
                <Encountered key={e.id} encounter={e} index={i} reduced={reduced} />
              ))}
            </View>
            {moreLine(more) ? (
              <OutlinedText
                style={[toonType.label, styles.more]}
                outline={toon.ink}
                width={2}
              >
                {moreLine(more)}
              </OutlinedText>
            ) : null}
          </View>

          <Animated.View
            style={[styles.actions, { paddingBottom: insets.bottom + space.lg }]}
            entering={reduced || !ready ? undefined : FadeIn.duration(220)}
            pointerEvents={ready ? 'auto' : 'none'}
          >
            {ready ? (
              <>
                <ToonButton
                  title={highFivedAll ? COPY.highFiveSent : COPY.highFiveAll}
                  variant={highFivedAll ? 'teal' : 'primary'}
                  loading={highFiving}
                  disabled={highFivedAll || highFiving}
                  onPress={onHighFiveAll}
                />
                <ToonButton
                  title={COPY.viewCrossroads}
                  variant="neutral"
                  labelColor={toon.ink}
                  size="sm"
                  onPress={onViewCrossroads}
                />
                {/* Outlined rather than the shared ghost button: a plain white
                    label has nothing to hold it off the plaza's planting, and
                    a plate under it is exactly what this screen does not do. */}
                <PressableScale
                  onPress={onContinue}
                  accessibilityRole="button"
                  accessibilityLabel={COPY.continue}
                  style={styles.continue}
                >
                  <OutlinedText style={[toonType.label, styles.continueLabel]} outline={toon.ink} width={2}>
                    {COPY.continue}
                  </OutlinedText>
                </PressableScale>
              </>
            ) : null}
          </Animated.View>
        </View>
      </PlazaScene>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layout: { flex: 1, justifyContent: 'space-between' },
  continue: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  continueLabel: { color: '#fff', fontSize: 14 },
  headline: { paddingHorizontal: space.gutter, alignItems: 'center' },
  subline: { color: '#fff', fontSize: 15, marginTop: space.xs, textAlign: 'center' },

  // Sits low on purpose: the plaza's paved circles are in its lower half, and
  // the characters should be standing ON them rather than floating over the
  // treeline. The top padding is the nudge that drops their feet from just
  // above the first row of circles onto it — measured against a 390x844 crop,
  // and forgiving either way because the deck is a band, not a line.
  stageArea: { alignItems: 'center', paddingTop: space.xl, paddingBottom: space.xs },
  stage: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.gutter,
  },
  cast: { alignItems: 'center', maxWidth: 118 },
  // The rig is taller than its width (BODY_RATIO) and overflows upward for
  // hair, so it gets its own box rather than being laid out inline.
  rigWrap: { height: RIG_SIZE * 2.9, justifyContent: 'flex-end', alignItems: 'center' },
  castName: { color: '#fff', fontSize: 14, marginTop: 2 },
  castLabel: { color: brand.teal, fontSize: 10 },

  more: { color: '#fff', marginTop: space.sm },
  actions: { paddingHorizontal: space.gutter, gap: space.sm },
});
