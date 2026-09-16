// "When's your birthday?" — month/day/year wheel with a live summary chip.
//
// OPTIONAL, and visibly so. A birthday is personal information PASER does not
// need to run: all it does is raise the privacy floor on a young account
// (backend app/privacy.py, is_minor) and hold the 13+ line for anyone who does
// tell us. App Review reads a step you cannot leave without answering as
// required information, so this one carries its own "Skip for now" as well as
// the one in the chrome, and nothing is written when it is skipped.
//
// A date that IS entered still has to clear 13+. Stored locally, never shown
// to other runners.

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Cake } from 'lucide-react-native';

import { space } from '../../theme';
import { ToonButton } from '../../components/ui';
import { haptic, PressableScale } from '../../ui/motion';
import { art } from '../../config/onboardingArt';
import { MIN_AGE } from '../../state/profile';
import { DateWheel } from '../pickers';
import { StepArt, StepHeadline } from '../ui';
import { toon, toonRadius, toonType } from '../toon';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// 1 → "1st", 22 → "22nd" …
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function ageOf({ y, m, d }) {
  const now = new Date();
  let age = now.getFullYear() - y;
  const md = now.getMonth() + 1 - m;
  if (md < 0 || (md === 0 && now.getDate() < d)) age -= 1;
  return age;
}

export default function BirthdayStep({ value, onChange, onContinue, onSkip, bottomInset = 0 }) {
  const age = useMemo(() => ageOf(value), [value]);
  const tooYoung = age < MIN_AGE;

  return (
    <View style={styles.fill}>
      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <StepArt
          source={art('cutBirthday')}
          fallback={<Cake size={54} color="#fff" strokeWidth={2.5} />}
        />
        <StepHeadline title="When's your birthday?" style={{ marginTop: space.lg }} />

        <View style={styles.chip}>
          <Text style={[toonType.sub, styles.chipText]}>
            {`${MONTHS[value.m - 1]} ${ordinal(value.d)}, ${value.y}`}
          </Text>
        </View>

        {/* Only speaks when there is something to say. "Skip for now" below
            already tells the runner the step is optional, and the reason a
            birthday is asked for at all belongs in the privacy policy, not
            under every wheel. */}
        {tooYoung ? (
          <Text style={[toonType.body, styles.note]}>
            {`You need to be ${MIN_AGE} or older to use PASER.`}
          </Text>
        ) : null}

        {/* Continue sits with the step, under the date it confirms. The wheel
            stays docked below because it is the INPUT — a spinner you have to
            reach is a thumb-height control, not a read. */}
        <ToonButton
          title="Continue"
          onPress={onContinue}
          disabled={tooYoung}
          style={{ marginTop: space.xl }}
        />

        {/* Under Continue, not hidden in the chrome: a runner who does not want
            to hand over a birthday has to be able to SEE the way past. */}
        {onSkip ? (
          <PressableScale
            onPress={() => { haptic.light(); onSkip(); }}
            hitSlop={12}
            style={styles.skip}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
          >
            <Text style={[toonType.label, styles.skipText]}>Skip for now</Text>
          </PressableScale>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomInset + space.md }]}>
        <DateWheel value={value} onChange={onChange} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // flexGrow + centred content: the step sits in the middle of whatever room
  // it has, and scrolls instead of clipping when it doesn't have enough. The
  // Continue button lives INSIDE this column now, which is exactly the height
  // a small phone did not have spare.
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: space.lg,
    paddingHorizontal: space.gutter,
  },
  chip: {
    marginTop: space.xl,
    height: 58,
    borderRadius: toonRadius.cell,
    backgroundColor: toon.sheet,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { color: '#fff', fontSize: 19 },
  note: { color: 'rgba(255,255,255,0.6)', marginTop: space.md, paddingHorizontal: space.sm },
  skip: { alignSelf: 'center', marginTop: space.md, paddingVertical: space.sm },
  skipText: { color: 'rgba(255,255,255,0.75)' },
  footer: { paddingHorizontal: space.gutter, backgroundColor: 'rgba(0,0,0,0.25)', paddingTop: space.lg },
});
