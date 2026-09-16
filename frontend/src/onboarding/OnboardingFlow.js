// The PASER first-run flow.
//
//   what PASER is (×3) → name → birthday → look → face → hair → top → bottom
//   → hat → ready
//
// THE GAME COMES FIRST. The three intro cards (steps/IntroStep.js) answer what
// do I do, what happens when I do it, and why keep doing it, before the flow
// asks for a single thing. Everything after them is setup.
//
// PASER PRO IS NOT IN THIS FLOW ANY MORE. It used to sit between the character
// steps and Ready, where it was pitching planning, insights and rare styles to
// somebody with no runs, no territory, no rivals and no history — every one of
// which is meaningless on day zero. The subscription is pitched next to the
// feature it unlocks instead, by the rate-limited exposure system that already
// exists for exactly this (src/pro/exposure.js, config/proContexts.js), once
// the runner has enough runs for MIN_RUNS_BEFORE_AUTO to let it speak.
// steps/ProStep.js is kept and still works — re-add `{ key: 'pro', kind:
// 'pro', optional: true }` below to put it back.
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
import { shouldCollectName } from '../auth/onboardingIdentity';
import { ITEMS } from '../config/cosmetics';
import { useAvatar } from '../state/avatar';
import { useProfile } from '../state/profile';
import { useReduceMotion } from '../ui/motion';
import { FIRST_RUN_HAIR, StageBackdrop, StepChrome } from './ui';
import IntroStep, { INTRO_CARDS } from './steps/IntroStep';
import NameStep from './steps/NameStep';
import BirthdayStep from './steps/BirthdayStep';
import LookStep from './steps/LookStep';
import CharacterStep from './steps/CharacterStep';
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

export default function OnboardingFlow({ onDone, mode = 'full', onboardingIdentity = null }) {
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
    firstName: profile.firstName || onboardingIdentity?.firstName || '',
    lastName: profile.lastName || onboardingIdentity?.lastName || '',
  });
  const [birthday, setBirthday] = useState(() => {
    if (!profile.birthday) return defaultBirthday();
    const [y, m, d] = profile.birthday.split('-').map(Number);
    return { y, m, d };
  });
  // Which starting look was tapped. Local to the flow and never persisted —
  // the seed it applies lands on the avatar itself, which IS the saved thing.
  const [look, setLook] = useState('');
  const [finishing, setFinishing] = useState(false);
  // The wheel always has a date under it, so "what is showing" cannot answer
  // "did they tell us". This does. Nothing is written unless it is true, which
  // is what keeps the birthday OPTIONAL rather than merely pre-filled.
  const [gaveBirthday, setGaveBirthday] = useState(!!profile.birthday);

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
      // What the game is, before anything is asked for. Skippable as a group
      // via the chrome, like every other non-essential step here.
      ...INTRO_CARDS.map((c, i) => ({
        key: c.key,
        kind: 'intro',
        card: c,
        introLast: i === INTRO_CARDS.length - 1,
        optional: true,
      })),
      ...(shouldCollectName(mode, onboardingIdentity)
        ? [{ key: 'name', kind: 'name' }]
        : []),
      // Birthday and look are both SKIPPABLE. Neither is needed to run, claim
      // ground or hold an account: the birthday only raises the privacy floor
      // on a young account (backend app/privacy.py, is_minor), and the look
      // only seeds an opening hairstyle you change on the very next step. App
      // Review reads either one as required personal information the moment a
      // runner cannot get past the step without answering it.
      { key: 'birthday', kind: 'birthday', optional: true },
      { key: 'look', kind: 'look', optional: true },
      ...character,
      { key: 'ready', kind: 'ready' },
    ];
  }, [mode, onboardingIdentity]);

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
          birthday: gaveBirthday ? iso(birthday) : null,
        });
        await completeIntro();
      }
    } catch {
      // Never trap the runner in onboarding — a failed local write still lets
      // them into the app; the avatar re-syncs on the next edit.
    } finally {
      onDone?.();
    }
  }, [
    finishing, saveAvatar, saveProfile, completeIntro,
    name, birthday, gaveBirthday, mode, onDone,
  ]);

  const next = useCallback(() => {
    if (last) return finish();
    setStep((s) => Math.min(s + 1, steps.length - 1));
    return undefined;
  }, [last, finish, steps.length]);

  // Skipping is not just "go forward": it has to CLEAR whatever the step was
  // holding, or the pre-filled wheel would be saved as an answer the runner
  // deliberately declined to give.
  const skip = useCallback(() => {
    if (current?.kind === 'birthday') setGaveBirthday(false);
    if (current?.kind === 'look') setLook('');
    next();
  }, [current, next]);

  const back = step > 0 ? () => setStep((s) => Math.max(0, s - 1)) : null;

  const bottomInset = insets.bottom;
  let body = null;
  if (current.kind === 'intro') {
    body = (
      <IntroStep card={current.card} isLast={current.introLast} onContinue={next} />
    );
  } else if (current.kind === 'name') {
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
        onChange={(v) => { setBirthday(v); setGaveBirthday(true); }}
        onContinue={next}
        onSkip={skip}
        bottomInset={bottomInset}
      />
    );
  } else if (current.kind === 'look') {
    body = (
      <LookStep value={look} onChange={setLook} onContinue={next} onSkip={skip} />
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
          onSkip={current.optional ? skip : null}
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
