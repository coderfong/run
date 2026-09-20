// The runner's portrait, rendered on the phone and sent to the Apple Watch.
//
// The watch cannot draw the character itself: the rig is a stack of a dozen
// PNGs from a 294 item catalogue, and shipping that art (and the layout rules
// that place it) into a watch target would be a second copy of the whole
// paper doll to keep in step. So the phone draws the portrait it already
// knows how to draw, rasterises it once, and hands the watch a picture.
//
// It is sent as a FILE, not as part of the run state: WatchConnectivity's
// live messages are small and the run state is re-sent every ten seconds
// while a run is on, so a portrait riding along with it would be tens of
// kilobytes on the wire per heartbeat. A file transfer is queued by the
// system, survives the app being closed, and arrives even when the watch app
// is not running, which is what a standalone recorder needs: the wrist may
// well see the portrait before it next sees the phone.
//
// Sent once per LOOK, never per launch. `avatarKey` is a hash of the equipped
// loadout, the watch keeps the last key it was given, and the phone remembers
// the last key it sent. Changing a hat re-sends; opening the app does not.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import CharacterRig, { WATCH_BUST } from '../components/character/CharacterRig';
import { avatarKey } from './avatarKey';
import { syncAvatarToWatch, watchAppInstalled } from './watchLink';

// Re-exported so the portrait has one import site, even though the rule for
// when to send one is kept clear of the art (see avatarKey.js).
export { avatarKey };

// Capture size, in POINTS. The snapshot comes out at the phone's own screen
// scale, so this is 256px on a 2x phone and 384px on a 3x one. The largest
// watch draws the portrait about 73pt across, which is 146px on its 2x
// screen, so even the smaller of those is comfortably past retina on the
// wrist while staying a small PNG to carry and a small bitmap to decode
// there.
export const WATCH_AVATAR_SIZE = 128;

// One beat for the rig's layers to be on screen before the snapshot. The rig
// is drawn `captureSafe`, which puts every layer back on React Native's own
// synchronous Image rather than expo-image's async decode, so this is
// insurance against a slow first decode rather than the mechanism.
const SETTLE_MS = 350;

/**
 * Rasterise a rig that is already mounted. Split out from the component so
 * the capture library is only reached for at the moment it is needed: it is
 * missing from Android, jest and the web preview, and a bare import at module
 * scope would take those down on load.
 *
 * Returns base64 PNG bytes, or null if anything at all went wrong. Nothing
 * here throws: the watch portrait is a decoration, and it must never be able
 * to cost a runner the app.
 */
export async function captureRig(ref) {
  try {
    const viewShot = require('react-native-view-shot');
    const capture = viewShot.captureRef || viewShot.default?.captureRef;
    if (!capture || !ref?.current) return null;
    const base64 = await capture(ref, {
      format: 'png',
      quality: 1,
      result: 'base64',
      // `drawViewHierarchyInRect`, which is the default, is documented by the
      // library itself as reporting success for a blank image, and off screen
      // views are exactly where it does that. `renderInContext` draws the
      // layer tree wherever it happens to be. Its trade offs (gradients, a
      // scroll view's content past the fold) do not apply to a stack of flat
      // PNGs. No width or height with it: it renders the layer at its own
      // size rather than into the rect, so asking for one would only pad the
      // portrait out with transparency.
      useRenderInContext: true,
    });
    return typeof base64 === 'string' && base64.length > 0 ? base64 : null;
  } catch (err) {
    return null;
  }
}

/**
 * The portrait itself: the same head and shoulders as the profile picture
 * everywhere else in the app, cropped closer for a wrist (WATCH_BUST, which
 * lives beside CharacterBust's own framing so the two cannot drift), drawn
 * capture safe and on transparency.
 *
 * No circle and no background here. The watch clips it and draws its own
 * ring, so the square that travels keeps the corners of a tall hairstyle and
 * the wrist decides what to show of them.
 */
export function WatchAvatarPortrait({ equipped, size = WATCH_AVATAR_SIZE }) {
  const bodyW = size * WATCH_BUST.bodyScale;
  return (
    <View style={{ width: size, height: size, overflow: 'hidden', alignItems: 'center' }}>
      <CharacterRig
        equipped={equipped}
        size={bodyW}
        animate={false}
        captureSafe
        crisp
        style={{ position: 'absolute', left: (size - bodyW) / 2, top: WATCH_BUST.top * size }}
      />
    </View>
  );
}

/**
 * Mounted once, at the root of the app. Draws the portrait off screen and
 * sends it to the watch whenever the look changes, and does nothing at all on
 * a phone with no PASER on a paired watch.
 *
 * The rig is only mounted while a capture is actually pending, so the usual
 * case (nothing has changed since last time) costs one hash and no views.
 */
export default function WatchAvatarSync({ equipped }) {
  const key = avatarKey(equipped);
  const viewRef = useRef(null);
  // The look being captured right now, or null when there is nothing to do.
  const [pending, setPending] = useState(null);
  const sentRef = useRef(null);
  // Re-checked rather than read once: PASER can be installed on the watch
  // while the phone app is open, and the answer changes underneath us.
  const [linked, setLinked] = useState(() => Platform.OS === 'ios' && watchAppInstalled());

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setLinked(watchAppInstalled());
    });
    return () => sub?.remove?.();
  }, []);

  useEffect(() => {
    if (!linked || !equipped) return;
    if (sentRef.current === key) return;
    setPending((current) => (current?.key === key ? current : { key, equipped }));
  }, [linked, key, equipped]);

  const capture = useCallback(async (look) => {
    const base64 = await captureRig(viewRef);
    // A failed capture leaves `sentRef` alone, so the next change (or the
    // next launch) tries again rather than leaving the wrist on a stale face
    // for good.
    if (base64 && (await syncAvatarToWatch(base64, look.key))) {
      sentRef.current = look.key;
    }
    setPending((current) => (current?.key === look.key ? null : current));
  }, []);

  useEffect(() => {
    if (!pending) return undefined;
    const look = pending;
    const timer = setTimeout(() => {
      capture(look).catch(() => setPending(null));
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pending, capture]);

  if (!pending) return null;
  return (
    <View style={styles.offscreen} pointerEvents="none" collapsable={false}>
      <View ref={viewRef} collapsable={false}>
        <WatchAvatarPortrait equipped={pending.equipped} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Off screen rather than transparent: `captureRef` rasterises what is drawn,
  // and a view at zero opacity captures as nothing.
  offscreen: {
    position: 'absolute',
    left: -WATCH_AVATAR_SIZE * 2,
    top: -WATCH_AVATAR_SIZE * 2,
    width: WATCH_AVATAR_SIZE,
    height: WATCH_AVATAR_SIZE,
  },
});
