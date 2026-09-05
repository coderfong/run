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
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';

import { api } from '../api/client';
import { fetchAndCache, getCached } from '../api/cache';
import { isRecentNotification } from '../utils/landCaptureAlerts';
import { publishNotificationEvent } from './events';
import { routeNotification } from './route';

const POLL_MS = 12_000;
const FIRST_FETCH_GRACE_MS = 3_000;

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
// and, by default, drawn as nothing. Specialised events use PASER's own richer
// presentation; ordinary events use the system banner. Every one remains in
// the notification list and keeps the app-icon badge in step.
let handlerConfigured = false;

export function configureForegroundHandler() {
  if (handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification?.request?.content?.data || {};
      // These have richer in-app presentation. Keep the notification-centre
      // entry and badge, but do not stack a system banner on top of the custom
      // cutscene/banner while PASER is foregrounded.
      const customPresentation =
        data.category === 'stolen' ||
        data.category === 'defended' ||
        (data.category === 'paserby' && data.kind === 'paserby_arrival');
      return {
        shouldShowBanner: !customPresentation,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
        // Legacy key for older expo-notifications runtimes.
        shouldShowAlert: !customPresentation,
      };
    },
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
  const handled = useRef(new Set());

  useEffect(() => {
    configureForegroundHandler();
    ensureNotificationChannels();

    const handleResponse = (response) => {
      const identifier = response?.notification?.request?.identifier;
      if (identifier && handled.current.has(identifier)) return;
      if (identifier) handled.current.add(identifier);
      const data = response?.notification?.request?.content?.data;
      if (!routeNotification(navigationRef, data)) pending.current = data;
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener(handleResponse);

    // One foreground listener feeds every custom presentation and refreshes
    // the durable inbox/badge shortly after the backend has written its row.
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification?.request?.content || {};
      const data = content.data || {};
      publishNotificationEvent({
        ...data,
        data,
        category: data.category,
        title: content.title,
        body: content.body,
        created_at: new Date().toISOString(),
      });
      setTimeout(() => {
        fetchAndCache('notifications', api.notifications)
          .then((inbox) => Notifications.setBadgeCountAsync?.(Number(inbox?.unread || 0)))
          .catch(() => {});
      }, 500);
    });

    // The tap that launched the app from a cold start is not delivered to the
    // listener above — it has to be pulled once, after the tree is up.
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last) handleResponse(last);
        await Notifications.clearLastNotificationResponseAsync?.();
      } catch {
        // Not every runtime implements it; a missing cold-start route is a far
        // smaller problem than a throw here.
      }
    })();

    return () => {
      responseSub.remove();
      receivedSub.remove();
    };
  }, [navigationRef]);

  // A single active-app poll keeps the bell and custom in-app alerts working
  // on simulators, denied notification permission, and transient push-delivery
  // failures. It also replaces the separate capture/defense pollers.
  useEffect(() => {
    if (!ready) return undefined;
    const cached = getCached('notifications');
    const known = new Set((cached?.items || []).map((item) => item.id));
    const mountedAt = Date.now();
    let alive = true;
    let active = AppState.currentState === 'active';
    let first = true;

    const sync = async () => {
      if (!alive || !active) return;
      try {
        const inbox = await fetchAndCache('notifications', api.notifications);
        if (!alive) return;
        const fresh = [];
        for (const item of inbox?.items || []) {
          if (!item?.id || known.has(item.id)) continue;
          known.add(item.id);
          if (!first || isRecentNotification(item, mountedAt - FIRST_FETCH_GRACE_MS)) {
            fresh.push(item);
          }
        }
        // The API is newest-first; presentations should replay oldest-first.
        fresh.reverse().forEach(publishNotificationEvent);
        first = false;
        await Notifications.setBadgeCountAsync?.(Number(inbox?.unread || 0));
      } catch {
        // Next foreground transition, poll, or remote push retries.
      }
    };

    sync();
    const timer = setInterval(sync, POLL_MS);
    const appStateSub = AppState.addEventListener('change', (state) => {
      active = state === 'active';
      if (active) sync();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      appStateSub.remove();
    };
  }, [ready]);

  // Flush whatever could not route yet (cold start, or a tap that beat the
  // navigator) as soon as the tree is ready.
  useEffect(() => {
    if (!ready || !pending.current) return;
    if (routeNotification(navigationRef, pending.current)) pending.current = null;
  }, [ready, navigationRef]);
}
