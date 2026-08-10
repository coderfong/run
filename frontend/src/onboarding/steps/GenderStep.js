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
import { ToonButton } from '../../components/ui';
import { haptic, PressableScale } from '../../ui/motion';
import { CharacterBust } from '../../components/character/CharacterRig';
import { useAvatar } from '../../state/avatar';
import { NIGHT_HAIR, StepHeadline } from '../ui';
import { toonRadius, toonType } from '../toon';

// `seed` is applied to the avatar the moment the option is tapped, so the
// runner carried into the next step IS the one that was picked. Every id here
// is a free item — a seed that lands on a locked piece would be dropped by the
// creator's own filter and leave the slot empty. The colour is NIGHT_HAIR
// because this whole flow plays against a night sky.
export const GENDER_OPTIONS = [
  { key: 'man', label: 'Man', seed: { hair: 'twoblock', hairColor: NIGHT_HAIR } },
  { key: 'woman', label: 'Woman', seed: { hair: 'sleeklong', hairColor: NIGHT_HAIR } },
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
              <PressableScale
                key={opt.key}
                onPress={() => pick(opt)}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                accessibilityState={{ selected: on }}
                style={[styles.option, on && styles.optionOn]}
              >
                {/* The runner's OWN loadout wearing this seed, not a stock
                    portrait — whatever they change later, these two stay a
                    preview of the same person. */}
                <CharacterBust
                  equipped={{ ...equipped, ...opt.seed }}
                  size={BUST}
                  bg="rgba(255,255,255,0.07)"
                />
                <Text style={[toonType.sub, styles.optionLabel]}>{opt.label}</Text>
              </PressableScale>
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
  // reads as a form to work down.
  options: { flexDirection: 'row', gap: space.md, marginTop: space.xl },
  option: {
    flex: 1,
    borderRadius: toonRadius.cell,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 2.5,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
  optionOn: { borderColor: '#fff', backgroundColor: '#3A3B47' },
  optionLabel: { color: '#fff' },
  cta: { marginTop: space.xl },
});
