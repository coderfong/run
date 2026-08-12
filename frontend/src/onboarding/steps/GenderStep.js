// "Who is our paser?" — the step between the birthday and the character
// creator.
//
// It does two jobs. It records `gender` on the local profile (the age/gender
// pair is what a fitness app needs for any calorie or pace modelling later),
// and it seeds the HAIR slot so the runner opens the creator already looking
// roughly like the person picked instead of always the same default head.
//
// You pick a FACE, not a word. The two options are the actual runner wearing
// each seed, so the choice previews itself: the old version was a list of text
// pills beside a single preview that only updated once you had committed.
//
// Only hair is seeded. Clothing is not gendered here on purpose — every top
// and bottom in the catalogue is available to everyone, and pre-picking one
// would just be a guess the runner has to undo on the very next step.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { space } from '../../theme';
import { Framed, ToonButton } from '../../components/ui';
import { haptic, PressableScale } from '../../ui/motion';
import { INK, framePose, frameVariant } from '../../ui/frameRegistry';
import { CharacterBust } from '../../components/character/CharacterRig';
import { useAvatar } from '../../state/avatar';
import { FIRST_RUN_HAIR, StepHeadline } from '../ui';
import { toonType } from '../toon';

// `seed` is applied to the avatar the moment the option is tapped, so the
// runner carried into the next step IS the one that was picked. Every id here
// is a free item — a seed that lands on a locked piece would be dropped by the
// creator's own filter and leave the slot empty. The colour is FIRST_RUN_HAIR,
// so both previews open on the same blonde the flow starts everyone at.
export const GENDER_OPTIONS = [
  { key: 'man', label: 'Man', seed: { hair: 'twoblock', hairColor: FIRST_RUN_HAIR } },
  { key: 'woman', label: 'Woman', seed: { hair: 'sleeklong', hairColor: FIRST_RUN_HAIR } },
];

const BUST = 132;

export default function GenderStep({ value, onChange, onContinue }) {
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
          title="Who is our paser?"
          sub="Just a starting point. You can change everything next."
        />

        <View style={styles.options}>
          {GENDER_OPTIONS.map((opt) => {
            const on = opt.key === value;
            return (
              // The `flex: 1` lives on this wrapper, NOT on PressableScale.
              // PressableScale forwards its style prop to an inner
              // Animated.View, so flex there stretches the box INSIDE the
              // pressable and leaves the pressable itself at content width —
              // which is why the pair sat squashed against the left gutter
              // with a third of the row empty beside it instead of splitting
              // the width evenly. TabBar.js documents the same trap.
              <View key={opt.key} style={styles.slot}>
                <PressableScale
                  onPress={() => pick(opt)}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  accessibilityState={{ selected: on }}
                  style={styles.option}
                >
                  <Framed
                    frame={frameVariant('box', `gender:${opt.key}`)}
                    tint={on ? '#ffffff' : 'rgba(255,255,255,0.45)'}
                    fill={on ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)'}
                    weight={on ? INK.bold : INK.thin}
                    pose={framePose(`gender:${opt.key}`)}
                    inset={space.sm}
                    contentStyle={styles.optionInner}
                  >
                    {/* The runner's OWN loadout wearing this seed, not a stock
                        portrait — whatever they change later, these two stay a
                        preview of the same person. */}
                    <CharacterBust
                      equipped={{ ...equipped, ...opt.seed }}
                      size={BUST}
                      bg="transparent"
                    />
                    <Text style={[toonType.sub, styles.optionLabel]}>{opt.label}</Text>
                  </Framed>
                </PressableScale>
              </View>
            );
          })}
        </View>

        {/* With the step, not pinned to the bottom edge of the screen. */}
        <ToonButton
          title="Continue"
          onPress={onContinue}
          disabled={!value}
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
  // Side by side: two choices read as a pair to compare, where a stacked list
  // reads as a form to work down. Equal halves of the row, so the pair is
  // centred on the step by construction rather than by a margin someone has to
  // keep in step with the gutter.
  options: { flexDirection: 'row', gap: space.md, marginTop: space.xl },
  slot: { flex: 1 },
  // No radius, no border, no fill: the drawn box brings all three, and the
  // selected state is the same box with a heavier, whiter line. A rounded
  // rectangle behind the frame would show at every corner the wobble turns in.
  option: { alignSelf: 'stretch' },
  optionInner: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  optionLabel: { color: '#fff' },
  cta: { marginTop: space.xl },
});
