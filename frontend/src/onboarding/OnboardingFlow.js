// The PASER first-run flow.
//
//   name → birthday → gender → face → hair → top → bottom → hat → PASER PRO → ready
//
// One night stage runs behind every step so the runner you are building is
// always on screen; the chrome (back · progress · skip) is shared. The last
// step saves the avatar, writes the local profile, and arms the in-app
// tutorial (components/TutorialOverlay.js) that plays over the real home
// screen straight after.
//
// `mode="character"` runs only the character steps — used for accounts that
// predate the avatar system, which have already been through an intro.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import { ITEMS } from '../config/cosmetics';
import { IAP_ENABLED } from '../config/releaseFeatures';
import { useAvatar } from '../state/avatar';
import { useProfile } from '../state/profile';
import { useReduceMotion } from '../ui/motion';
import { FIRST_RUN_HAIR, StageBackdrop, StepChrome } from './ui';
import NameStep from './steps/NameStep';
import BirthdayStep from './steps/BirthdayStep';
import GenderStep from './steps/GenderStep';
import CharacterStep from './steps/CharacterStep';
import ProStep from './steps/ProStep';
import ReadyStep from './steps/ReadyStep';

// Slot steps, in the order the runner builds themselves. Copy carries the
// game's voice — keep it short, warm and a little cheeky.
const CHARACTER_STEPS = [
  {
    key: 'face',
    slotKey: 'face',
    title: 'Meet your Paser',
    sheetTitle: 'Choose your face',
  },
  {
    key: 'hair',
    slotKey: 'hair',
    title: 'Got hair? Add it!',
    sheetTitle: 'Choose your hair',
  },
  {
    key: 'top',
    slotKey: 'top',
    title: 'Earn new gear as you run',
    sheetTitle: 'Choose your top',
  },
  {
    key: 'bottom',
    slotKey: 'bottom',
    title: "Uh, let's put on some pants",
    sub: '…please',
    sheetTitle: 'Choose your bottoms',
  },
  {
    key: 'headwear',
    slotKey: 'headwear',
    title: 'Top it off',
    sheetTitle: 'Choose your hat',
    optional: true,
  },
];

const defaultBirthday = () => ({ y: new Date().getFullYear() - 25, m: 6, d: 15 });
const iso = ({ y, m, d }) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export default function OnboardingFlow({ onDone, mode = 'full' }) {
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const { save: saveAvatar, setPart } = useAvatar();
  const { profile, saveProfile, completeIntro } = useProfile();

  // Start the runner blonde, ONCE, before the first step draws — the default
  // loadout's hair is near-black, which reads as a bald head at bust size.
  // Mount-only on purpose: from the hair step onward the swatch the runner
  // picks is the one that sticks, whatever it is. App.js does not render this
  // flow until the saved loadout has hydrated, so there is nothing in flight
  // for it to race.
  useEffect(() => {
    setPart({ hairColor: FIRST_RUN_HAIR });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState(0);
  const [name, setName] = useState({
    firstName: profile.firstName || '',
    lastName: profile.lastName || '',
  });
  const [birthday, setBirthday] = useState(() => {
    if (!profile.birthday) return defaultBirthday();
    const [y, m, d] = profile.birthday.split('-').map(Number);
    return { y, m, d };
  });
  const [gender, setGender] = useState(profile.gender || '');
  const [finishing, setFinishing] = useState(false);

  const steps = useMemo(() => {
    // A slot with nothing in it but "None" has no choice to offer, and a step
    // headed "let's put on some pants" with an empty grid under it reads as a
    // broken screen. Skipping it is self-healing: the step comes back on its
    // own the moment that slot has art again.
    const character = CHARACTER_STEPS
      .filter((s) => (ITEMS[s.slotKey] || []).some((item) => item.id !== 'none'))
      .map((s) => ({ ...s, kind: 'character' }));
    if (mode === 'character') return [...character, { key: 'ready', kind: 'ready' }];
    return [
      { key: 'name', kind: 'name' },
      { key: 'birthday', kind: 'birthday' },
      { key: 'gender', kind: 'gender' },
      ...character,
      ...(IAP_ENABLED ? [{ key: 'pro', kind: 'pro', optional: true }] : []),
      { key: 'ready', kind: 'ready' },
    ];
  }, [mode]);

  const current = steps[step];
  const last = step === steps.length - 1;

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await saveAvatar();
      if (mode === 'full') {
        await saveProfile({
          firstName: name.firstName.trim(),
          lastName: name.lastName.trim(),
          birthday: iso(birthday),
          gender,
        });
        await completeIntro();
      }
    } catch {
      // Never trap the runner in onboarding — a failed local write still lets
      // them into the app; the avatar re-syncs on the next edit.
    } finally {
      onDone?.();
    }
  }, [finishing, saveAvatar, saveProfile, completeIntro, name, birthday, gender, mode, onDone]);

  const next = useCallback(() => {
    if (last) return finish();
    setStep((s) => Math.min(s + 1, steps.length - 1));
    return undefined;
  }, [last, finish, steps.length]);

  const back = step > 0 ? () => setStep((s) => Math.max(0, s - 1)) : null;

  const bottomInset = insets.bottom;
  let body = null;
  if (current.kind === 'name') {
    body = (
      <NameStep
        value={name}
        onChange={(patch) => setName((v) => ({ ...v, ...patch }))}
        onContinue={next}
      />
    );
  } else if (current.kind === 'birthday') {
    body = (
      <BirthdayStep
        value={birthday}
        onChange={setBirthday}
        onContinue={next}
        bottomInset={bottomInset}
      />
    );
  } else if (current.kind === 'gender') {
    body = (
      <GenderStep value={gender} onChange={setGender} onContinue={next} />
    );
  } else if (current.kind === 'character') {
    body = (
      <CharacterStep
        slotKey={current.slotKey}
        title={current.title}
        sub={current.sub}
        sheetTitle={current.sheetTitle}
        onContinue={next}
        bottomInset={bottomInset}
      />
    );
  } else if (current.kind === 'pro') {
    body = <ProStep onContinue={next} />;
  } else {
    body = (
      <ReadyStep name={name.firstName.trim()} onContinue={finish} />
    );
  }

  return (
    <View style={styles.root}>
      <StageBackdrop style={StyleSheet.absoluteFill} />

      <View style={styles.content}>
        <StepChrome
          step={step}
          total={steps.length}
          onBack={back}
          onSkip={current.optional ? next : null}
          top={insets.top}
        />
        <Animated.View
          key={current.key}
          style={styles.step}
          entering={reduced ? undefined : FadeIn.duration(240)}
        >
          {body}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
  step: { flex: 1 },
});
