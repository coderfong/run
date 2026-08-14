// Registers the device's Expo push token with the backend once, after
// sign-in, when notification permission is granted. Retention engine for
// Phase 6 (stolen land, clan goal, kudos, season, weekly recap).

import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';

import { api } from '../api/client';

export function usePushRegistration(signedIn) {
  useEffect(() => {
    if (!signedIn) return;
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        let granted = status === 'granted';
        if (!granted) {
          const req = await Notifications.requestPermissionsAsync();
          granted = req.status === 'granted';
        }
        if (!granted) return;
        const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
        const tokenResp = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined
        );
        if (tokenResp?.data) {
          await api.registerPushToken(tokenResp.data, Platform.OS);
        }
      } catch (error) {
        // Push is best-effort; failures never block the app. They used to be
        // swallowed outright, which is how a broken registration (missing
        // projectId, a token request that fails, a dead backend call) went
        // unnoticed indefinitely — every "stolen" alert downstream depends on
        // this call actually having succeeded.
        if (__DEV__) console.warn('[push] registration failed', error);
        Sentry.captureException(error);
      }
    })();
  }, [signedIn]);
}
