// Mirrors the Run screen onto the Apple Watch and lets the watch drive it.
//
// The watch's buttons call the very same functions as the phone's (the
// handlers passed in), but only in the phase each makes sense in, checked
// against the screen's state at the moment the command lands rather than the
// state the watch was looking at (commandAllowed). And Start is refused unless
// the phone has the app in front: iOS only lets location be switched on in the
// foreground, so a run started for a phone in a pocket would record nothing.

import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { addWatchCommandListener, publishToWatch } from './watchLink';
import { buildWatchState, commandAllowed, PHASE, watchStateKey } from './watchState';

// A running state is re-sent this often even when nothing shown has changed.
// The watch counts the clock on by itself, so this only corrects drift and
// keeps the application context fresh for a watch that opens PASER mid run.
export const WATCH_HEARTBEAT_MS = 10000;

export default function useWatchRun(input, handlers) {
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub?.remove?.();
  }, []);

  const phase = input.phase === PHASE.READY && !appActive ? PHASE.IDLE : input.phase;
  const live = { ...input, phase };
  const liveRef = useRef(live);
  liveRef.current = live;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const sub = addWatchCommandListener((command) => {
      const cmd = command?.cmd;
      if (cmd === 'start' && AppState.currentState !== 'active') return;
      if (!commandAllowed(command, liveRef.current.phase)) return;
      const run = handlersRef.current?.[cmd];
      if (typeof run !== 'function') return;
      // Called bare, never with the event: pauseRun and friends take no
      // arguments and should not start taking one by accident.
      Promise.resolve()
        .then(() => run())
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  const key = watchStateKey(buildWatchState(live));
  useEffect(() => {
    publishToWatch(liveRef.current);
  }, [key]);

  useEffect(() => {
    if (phase !== PHASE.RUNNING) return undefined;
    const id = setInterval(() => publishToWatch(liveRef.current), WATCH_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [phase]);

  // Leaving the Run screen leaves nothing on the wrist to press.
  useEffect(
    () => () => {
      publishToWatch({ phase: PHASE.IDLE });
    },
    []
  );
}
