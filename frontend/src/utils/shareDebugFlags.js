// A process-of-elimination harness for the share-screen EXC_BAD_ACCESS crash
// (see RunShareCard.js / RunShareSheet.js). Every JS-only change here needs a
// full TestFlight rebuild to reach a device — see [[paser-ota-blocked-asset-cap]]
// — so instead of one suspect per build, each suspect is a flag that can be
// flipped ON DEVICE (persisted, survives the crash and the relaunch) and the
// render sites below read it live. One build, many experiments.
//
// Gated the same way DevRunSimulator is: reachable in every build, but only
// shown to an account the server has named via `dev_tools` on /me (or a dev
// build) — see DevShareDebugPanel.js.
//
// FOUND IT, 2026-08-16: `icons`. lucide-react-native v1 dropped every brand
// icon, so `Instagram` imported as `undefined` and the destinations row threw
// `<undefined />` the instant the sheet went ready. RunShareSheet.js draws the
// mark itself now. The harness stays because it is what found it and it costs
// nothing switched on, but every flag is back to ON — including `runner`,
// which the bisect cleared along with the rest of the card (the crash outlived
// unmounting RunShareCard entirely).
//
// Default value of every flag is the real behaviour: nothing changes until
// someone opens the panel and flips one.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';

// v2 deliberately abandons what the bisect left behind. The flags persist, so
// the device that found this bug still has `icons`, `paserMark` and `runner`
// switched OFF in storage — and those stored values would beat the defaults
// below, hiding the fix and the avatar on the very build meant to prove them.
// A new key starts the fixed build from the real behaviour.
const STORAGE_KEY = 'debug.shareFlags.v2';

export const SHARE_DEBUG_FLAGS = {
  checkerboard: true, // RunShareSheet's transparency-grid <Svg>
  cardSvg: true, // RunShareCard's route + territory <Svg>
  // DEAD since the 2026-08-16 simplification: the signature is the wordmark
  // alone, so there is no brand-mark <Image> left on the card to gate. Kept as
  // a key because these flags persist on device and removing it here would not
  // remove it from anybody's stored set.
  paserMark: true,
  runner: true, // the LogoRunner avatar
  icons: true, // lucide-react-native icons on the destination discs
  gradient: true, // the Instagram disc's <LinearGradient>
  postEditor: true, // <RunPostEditor> (caption/photos) mounted in the sheet
  nativeShareProbe: true, // socialShare() required the instant the sheet is ready
  card: true, // mount RunShareCard at all
  sheetBody: true, // format switch + ScrollView (all rows) + destinations row
  mountSheet: true, // mount <RunShareSheet> from ResultScreen at all
};

let hydrated = false;

export async function hydrateShareDebugFlags() {
  if (hydrated) return SHARE_DEBUG_FLAGS;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(SHARE_DEBUG_FLAGS, JSON.parse(raw));
  } catch {
    // A corrupt or missing value just means "use the defaults".
  }
  return SHARE_DEBUG_FLAGS;
}

export async function setShareDebugFlag(key, value) {
  SHARE_DEBUG_FLAGS[key] = value;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(SHARE_DEBUG_FLAGS));
  } catch {}
}

// A crumb that survives an immediate native crash: Sentry's native layer
// writes breadcrumbs to disk as they're added, not just when an event is
// sent, so the trail up to the last one reached ships with the next captured
// crash even though nothing here could catch the crash itself.
export function shareCrumb(message, data) {
  try {
    Sentry.addBreadcrumb({ category: 'share-debug', message, data, level: 'info' });
  } catch {}
}
