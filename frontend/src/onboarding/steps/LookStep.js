// "Pick your starting look" — the step between the birthday and the character
// creator.
//
// IT USED TO ASK FOR A GENDER. Two options, Man and Woman, and a headline that
// made the screen about which one you were. It never needed to: nothing in
// PASER reads `profile.gender` — not the server, not the map, not a single
// other screen — and the only thing the answer bought was a seeded HAIRSTYLE
// you change on the very next step. So the screen was asking a personal
// question to save the runner one tap, and putting a gender decision in front
// of a game about running.
//
// Now it shows four starting looks and no labels at all. The choice previews
// itself: each card is the runner's own loadout wearing that seed, so tapping
// one is the whole explanation. Adding "Other" under Man and Woman would have
// kept the screen about gender; removing the question is what stops it being.
//
// Still OPTIONAL. Pick nothing and the button reads "Skip for now" and carries
// you through with the default head. Only hair is seeded — every top and
// bottom in the catalogue is available to everyone, and pre-picking one would
// just be a guess to undo on the next step.

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { space } from '../../theme';
import { Framed, ToonButton } from '../../components/ui';
import { haptic, PressableScale } from '../../ui/motion';
import { INK, framePose, frameVariant } from '../../ui/frameRegistry';
import { CharacterBust } from '../../components/character/CharacterRig';
import { useAvatar } from '../../state/avatar';
import { FIRST_RUN_HAIR, FIRST_RUN_SKY, StepHeadline } from '../ui';

// `seed` is applied to the avatar the moment a card is tapped, so the runner
// carried into the next step IS the one that was picked. Every id here is a
// FREE item — a seed landing on a locked piece would be dropped by the
// creator's own filter and leave the slot empty. The colour is FIRST_RUN_HAIR,
// so every preview opens on the same blonde the flow starts everyone at.
export const LOOK_OPTIONS = [
  { key: 'a', seed: { hair: 'twoblock', hairColor: FIRST_RUN_HAIR } },
  { key: 'b', seed: { hair: 'sleeklong', hairColor: FIRST_RUN_HAIR } },
  { key: 'c', seed: { hair: 'curls', hairColor: FIRST_RUN_HAIR } },
  { key: 'd', seed: { hair: 'pixie', hairColor: FIRST_RUN_HAIR } },
];

const BUST = 118;

export default function LookStep({ value, onChange, onContinue, onSkip }) {
  const { equipped, setPart } = useAvatar();

  const pick = (opt) => {
    haptic.light();
    onChange(opt.key);
    if (opt.seed) setPart(opt.seed);
  };

  return (
    <View style={styles.fill}>
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <StepHeadline
          title="Pick your starting look"
          sub="You can change everything next."
        />

        <View style={styles.grid}>
          {LOOK_OPTIONS.map((opt, i) => {
            const on = opt.key === value;
            return (
              // The `flex: 1` lives on this wrapper, NOT on PressableScale.
              // PressableScale forwards its style prop to an inner
              // Animated.View, so flex there stretches the box INSIDE the
              // pressable and leaves the pressable itself at content width.
              // TabBar.js documents the same trap.
              <View key={opt.key} style={styles.slot}>
                <PressableScale
                  onPress={() => pick(opt)}
                  accessibilityRole="button"
                  accessibilityLabel={`Starting look ${i + 1}`}
                  accessibilityState={{ selected: on }}
                  style={styles.option}
                >
                  <Framed
                    frame={frameVariant('box', `look:${opt.key}`)}
                    // The card's fill is a translucent white, so left to judge
                    // itself the frame would read the surface as WHITE and pick
                    // dark ink. What the line is really over is the scene.
                    on={FIRST_RUN_SKY}
                    tint={on ? '#ffffff' : 'rgba(255,255,255,0.45)'}
                    fill={on ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'}
                    weight={on ? INK.bold : INK.thin}
                    pose={framePose(`look:${opt.key}`)}
                    inset={space.sm}
                    contentStyle={styles.optionInner}
                  >
                    {/* The runner's OWN loadout wearing this seed, not a stock
                        portrait — whatever they change later, these stay a
                        preview of the same person. No caption: the picture is
                        the label, which is the entire point of the screen. */}
                    <CharacterBust
                      equipped={{ ...equipped, ...opt.seed }}
                      size={BUST}
                      bg="transparent"
                    />
                  </Framed>
                </PressableScale>
              </View>
            );
          })}
        </View>

        {/* Picking nothing is a valid answer — the seed is a convenience, not
            information PASER needs — so the button carries you past instead of
            greying out and making the step look like a wall. */}
        <ToonButton
          title={value ? 'Continue' : 'Skip for now'}
          onPress={value ? onContinue : (onSkip || onContinue)}
          style={styles.cta}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: space.lg,
    paddingHorizontal: space.gutter,
  },
  // Two by two. Four choices in a row would leave each bust too small to tell
  // apart, which would put the labels back.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.xl,
  },
  slot: { width: '47%', flexGrow: 1 },
  // No radius, no border, no fill: the drawn box brings all three, and the
  // selected state is the same box with a heavier, whiter line.
  option: { alignSelf: 'stretch' },
  optionInner: { alignItems: 'center', paddingVertical: space.md },
  cta: { marginTop: space.xl },
});
