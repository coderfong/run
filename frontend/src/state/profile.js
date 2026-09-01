// Player profile collected during the first-run flow: the runner's real name
// (used to greet them and to label their card), their birthday, and the
// one-time flags that drive the intro flow and the in-app tutorial.
//
// The birthday is OPTIONAL and stays null when the runner skips the step, so
// every reader here has to cope with not knowing (backend is_minor() treats an
// unknown age as an adult on purpose). A date that IS given holds the 13+ line.
//
// Stored locally per user (AsyncStorage). The BIRTHDAY is the exception: when
// there is one it is mirrored to the server, because the server is what decides
// how much of a route gets published and it cannot protect a young account it
// does not know is young (see backend/app/privacy.py). Nothing else here leaves
// the phone.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const keyFor = (user) =>
  `paser:profile:v1:${user?.id || user?.user_id || user?.username || 'anon'}`;

export const MIN_AGE = 13;

const EMPTY = {
  firstName: '',
  lastName: '',
  birthday: null, // 'YYYY-MM-DD'
  // 'man' | 'woman' | 'nonbinary' | 'unspecified' — see onboarding/steps/
  // GenderStep.js. Optional everywhere: accounts created before this step
  // exists simply carry ''.
  gender: '',
  introDone: false,
  tutorialPending: false,
  // The Crossroads explainer. Unlike `tutorialPending` this one defaults false
  // for EVERY account, new or old: the plaza is a screen you can arrive at
  // years in, and nobody who has not read it once should be left guessing at
  // it. Set the first time the screen is dismissed.
  crossroadsIntroSeen: false,
  // Same idea for the "Ranked map" explainer on GlobalMapScreen. Rank (Wood →
  // Mythic, earned from taking and holding ground) is a completely different
  // ladder from level (XP from distance), and the sheet that explains the
  // difference used to be tap-to-open only — reachable, but nobody found it on
  // their own. Defaults false for every account for the same reason
  // `crossroadsIntroSeen` does.
  rankGuideSeen: false,
};

const ProfileContext = createContext({
  profile: EMPTY,
  displayName: '',
  loading: true,
  saveProfile: async () => {},
  completeIntro: async () => {},
  completeTutorial: async () => {},
  completeCrossroadsIntro: async () => {},
  completeRankGuide: async () => {},
});

export function ProfileProvider({ children }) {
  const { signedIn, user } = useAuth();
  const [profile, setProfile] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (!signedIn) {
      setProfile(EMPTY);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    AsyncStorage.getItem(keyFor(user))
      .then((raw) => {
        if (!alive) return;
        setProfile(raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [signedIn, user?.username]);

  const write = useCallback(
    async (patch) => {
      let next;
      setProfile((prev) => {
        next = { ...prev, ...patch };
        return next;
      });
      try {
        await AsyncStorage.setItem(keyFor(user), JSON.stringify(next));
      } catch {}
      // Age is the one thing the SERVER has to know: it sets the floor on how
      // much of a young runner's route may ever be published, and it cannot
      // apply a floor for an age it was never told. Best-effort — a failure
      // here must not block onboarding, and the protective defaults apply to
      // everyone regardless.
      if (patch.birthday) {
        api.setBirthday(patch.birthday).catch(() => {});
      }
      return next;
    },
    [user?.username]
  );

  // Finishing the intro arms the in-app tutorial (existing accounts never get
  // it — the flag only exists for users who ran the new flow).
  const completeIntro = useCallback(
    () => write({ introDone: true, tutorialPending: true }),
    [write]
  );
  const completeTutorial = useCallback(() => write({ tutorialPending: false }), [write]);
  const completeCrossroadsIntro = useCallback(
    () => write({ crossroadsIntroSeen: true }),
    [write]
  );
  const completeRankGuide = useCallback(() => write({ rankGuideSeen: true }), [write]);

  const displayName = profile.firstName || user?.username || '';

  const value = useMemo(
    () => ({
      profile,
      displayName,
      loading,
      saveProfile: write,
      completeIntro,
      completeTutorial,
      completeCrossroadsIntro,
      completeRankGuide,
    }),
    [
      profile,
      displayName,
      loading,
      write,
      completeIntro,
      completeTutorial,
      completeCrossroadsIntro,
      completeRankGuide,
    ]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  return useContext(ProfileContext);
}

// Whole years between an ISO date and today (null-safe).
export function ageFrom(iso) {
  if (!iso) return null;
  const b = new Date(iso);
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}
