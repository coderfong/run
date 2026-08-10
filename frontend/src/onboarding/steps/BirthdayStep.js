// "When's your birthday?" — month/day/year wheel with a live summary chip.
// The birthday is the store-required age gate (13+); it is stored locally and
// never shown to other runners.

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Cake } from 'lucide-react-native';

import { space } from '../../theme';
import { ToonButton } from '../../components/ui';
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

export default function BirthdayStep({ value, onChange, onContinue, bottomInset = 0 }) {
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

        <Text style={[toonType.body, styles.note]}>
          {tooYoung
            ? `You need to be ${MIN_AGE} or older to use PASER.`
            : 'Only used to check your age. Never shown to other runners.'}
        </Text>

        {/* Continue sits with the step, under the date it confirms. The wheel
            stays docked below because it is the INPUT — a spinner you have to
            reach is a thumb-height control, not a read. */}
        <ToonButton
          title="Continue"
          onPress={onContinue}
          disabled={tooYoung}
          style={{ marginTop: space.xl }}
        />
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
  footer: { paddingHorizontal: space.gutter, backgroundColor: 'rgba(0,0,0,0.25)', paddingTop: space.lg },
});
