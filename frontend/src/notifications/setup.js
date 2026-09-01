// The device-level notification wiring: how a push behaves while the app is
// OPEN, the Android channels the backend addresses by id, and the tap handler
// for when the app was closed or backgrounded.
//
// The in-app *presentation* of specific events (the land-loss cutscene, the
// Crossroads banner, the defense-held banner) lives in their own hosts. This
// module is the plumbing under all of them: without the channels, Android
// silently drops every push onto the default channel and the urgent ones stop
// being urgent; without the tap handler, opening the app from a capture
// notification lands on whatever screen it happened to be on.

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';

import { routeNotification } from './route';

// Matches backend/app/notifications.py: URGENT_CATEGORIES → "territory-alerts",
// everything else → "game-events".
const CHANNELS = [
  {
    id: 'territory-alerts',
    name: 'Territory under attack',
    importance: Notifications.AndroidImportance?.MAX ?? 5,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
    description: 'Someone is contesting your land right now.',
  },
  {
    id: 'game-events',
    name: 'Captures, kudos & reminders',
    importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
    sound: 'default',
    enableVibrate: true,
    description: 'Captures you make, club goals, kudos, and run reminders.',
  },
];

let channelsReady = false;

export async function ensureNotificationChannels() {
  if (channelsReady || Platform.OS !== 'android') return;
  try {
    await Promise.all(
      CHANNELS.map((c) => Notifications.setNotificationChannelAsync(c.id, c))
    );
    channelsReady = true;
  } catch (error) {
    if (__DEV__) console.warn('[push] channel setup failed', error);
    Sentry.captureException(error);
  }
}

// A push that arrives while the app is foregrounded is handed to the listeners
// and, by default, drawn as nothing. The specialised hosts turn the ones worth
// interrupting for into their own UI; this still lets the system draw the
// banner + list entry so a foreground capture is not completely silent, and
// keeps the app-icon badge in step with the unread count Expo put in the push.
let handlerConfigured = false;

export function configureForegroundHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
      // Legacy keys for older expo-notifications runtimes.
      shouldShowAlert: true,
    }),
  });
}

/**
 * Route notification taps for every category, cold start included.
 *
 * `navigationRef` is App.js's container ref; `ready` gates the cold-start
 * replay until the navigator can actually take a `navigate`. The per-event
 * hosts (Crossroads, land capture) own their OWN in-app banners, but tap
 * routing is centralised here so there is one answer to "where does this
 * open" and no two listeners fighting over the same tap.
 */
export function useNotificationTaps(navigationRef, ready) {
  const pending = useRef(null);

  useEffect(() => {
    configureForegroundHandler();
    ensureNotificationChannels();

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data;
      if (!routeNotification(navigationRef, data)) pending.current = data;
    });

    // The tap that launched the app from a cold start is not delivered to the
    // listener above — it has to be pulled once, after the tree is up.
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        const data = last?.notification?.request?.content?.data;
        if (data) pending.current = data;
      } catch {
        // Not every runtime implements it; a missing cold-start route is a far
        // smaller problem than a throw here.
      }
    })();

    return () => sub.remove();
  }, [navigationRef]);

  // Flush whatever could not route yet (cold start, or a tap that beat the
  // navigator) as soon as the tree is ready.
  useEffect(() => {
    if (!ready || !pending.current) return;
    if (routeNotification(navigationRef, pending.current)) pending.current = null;
  }, [ready, navigationRef]);
}
