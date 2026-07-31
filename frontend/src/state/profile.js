// Player profile collected during the first-run flow: the runner's real name
// (used to greet them and to label their card), their birthday (age gate —
// the stores require 13+), and the one-time flags that drive the intro flow
// and the in-app tutorial.
//
// Stored locally per user (AsyncStorage). Nothing here is server-side yet:
// `users` has no name/birthday columns, so a migration + PATCH /me is the
// follow-up if this ever needs to be shared between devices.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../auth/AuthContext';

const keyFor = (user) =>
  `paser:profile:v1:${user?.id || user?.user_id || user?.username || 'anon'}`;

export const MIN_AGE = 13;

const EMPTY = {
  firstName: '',
  lastName: '',
  birthday: null, // 'YYYY-MM-DD'
  introDone: false,
  tutorialPending: false,
};

const ProfileContext = createContext({
  profile: EMPTY,
  displayName: '',
  loading: true,
  saveProfile: async () => {},
  completeIntro: async () => {},
  completeTutorial: async () => {},
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

  const displayName = profile.firstName || user?.username || '';

  const value = useMemo(
    () => ({
      profile,
      displayName,
      loading,
      saveProfile: write,
      completeIntro,
      completeTutorial,
    }),
    [profile, displayName, loading, write, completeIntro, completeTutorial]
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
