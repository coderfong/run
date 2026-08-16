// Everything that hands a finished run to another app. Kept apart from the
// card that gets shared so the visual stays a pure component and the messy
// per-platform rules live in one place.
//
// Four destinations:
//   * Instagram Stories — a direct handoff (react-native-share → the
//     `instagram-stories://` pasteboard flow on iOS, an ADD_TO_STORY intent on
//     Android). This is the Strava-style path: the card lands in the story
//     composer as a sticker, over the runner's own background.
//   * the camera roll (expo-media-library)
//   * the clipboard, as an image (expo-clipboard)
//   * the system share sheet (expo-sharing) — everything else: Instagram
//     feed, WhatsApp, Messages, Files.
//
// NATIVE MODULES: react-native-share, expo-media-library and expo-clipboard all
// ship native code, so each only works in a binary built after it was added.
// Old binaries (and OTA updates onto them) throw on the first call — every
// entry point here is required lazily and reports "not available" rather than
// throwing, so the share sheet always works with whatever the binary has.

import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Sharing from 'expo-sharing';

import { shareCrumb } from './shareDebugFlags';

const IG_ANDROID_PACKAGE = 'com.instagram.android';
const IG_STORIES_PROBE = 'instagram-stories://share';

// react-native-share resolves its native module with `getEnforcing`, which
// THROWS AT IMPORT TIME when the binary predates it. A top-level import would
// therefore take the whole result screen down on an old build, so it is
// required lazily and the failure is treated as "no Instagram destination".
let shareModule;
function nativeShare() {
  if (shareModule === undefined) {
    shareCrumb('require react-native-share: start');
    try {
      shareModule = require('react-native-share').default;
      shareCrumb('require react-native-share: ok');
    } catch {
      shareModule = null;
      shareCrumb('require react-native-share: threw');
    }
  }
  return shareModule;
}

// Instagram wants the sharing app identified. A Meta (Facebook) app id is the
// documented value — set `extra.facebookAppId` once one exists. Until then the
// bundle id goes out, which Instagram accepts for the background-image flow.
function sourceAppId() {
  const cfg = Constants.expoConfig || {};
  return (
    cfg.extra?.facebookAppId ||
    (Platform.OS === 'ios' ? cfg.ios?.bundleIdentifier : cfg.android?.package) ||
    'com.pacerrun.app'
  );
}

// react-native-share wants a file:// URI; view-shot hands back a bare path on
// iOS and a file:// URI on Android.
function fileUri(uri) {
  if (!uri) return uri;
  return uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('data:')
    ? uri
    : `file://${uri}`;
}

/**
 * Is the direct Instagram Stories handoff worth offering?
 *
 * iOS answers honestly (LSApplicationQueriesSchemes carries `instagram-stories`,
 * so a missing app — or a binary built before this feature — reads false).
 * Android's package check needs manifest `<queries>` visibility, which the
 * react-native-share config plugin adds; anything unexpected there resolves to
 * "offer it" and lets the share itself fall back.
 */
export async function canShareToInstagramStories() {
  const Share = nativeShare();
  if (!Share) return false;
  try {
    if (Platform.OS === 'ios') return await Linking.canOpenURL(IG_STORIES_PROBE);
    if (Platform.OS === 'android') {
      const res = await Share.isPackageInstalled(IG_ANDROID_PACKAGE);
      return res?.isInstalled !== false;
    }
    return false;
  } catch {
    // The check itself failing is not evidence Instagram is missing.
    return Platform.OS === 'android';
  }
}

/**
 * Open the Instagram story composer with `imageUri`.
 *
 * Two shapes, and the difference matters:
 *
 *   * background (default) — the image IS the story. `background` paints the
 *     canvas around it, which shows wherever Instagram letterboxes a card that
 *     is not the exact aspect of the device's story canvas.
 *   * `asSticker` — the image goes ON TOP as a movable sticker, so whatever the
 *     runner puts behind it (a selfie, a photo, a plain colour) is the story.
 *     This needs a TRANSPARENT PNG: a sticker with an opaque background is
 *     just a background that the runner has to drag around.
 *
 * Resolves `{ ok: true }` when Instagram took it, `{ ok: false, reason }` when
 * it could not — the caller decides whether to fall back.
 */
export async function shareToInstagramStories(
  imageUri,
  { background = '#0B0D10', asSticker = false } = {}
) {
  const Share = nativeShare();
  if (!Share) return { ok: false, reason: 'Instagram sharing needs a newer build of PASER.' };
  const uri = fileUri(imageUri);
  const opts = {
    social: Share.Social.INSTAGRAM_STORIES,
    appId: sourceAppId(),
    ...(asSticker ? { stickerImage: uri } : { backgroundImage: uri }),
    // Instagram wants a canvas colour either way; for a sticker it is only what
    // sits behind it until the runner chooses their own background.
    backgroundTopColor: background,
    backgroundBottomColor: background,
  };
  try {
    await Share.shareSingle(opts);
    return { ok: true };
  } catch (e) {
    const msg = String(e?.message || e || '');
    // Backing out of the composer is a normal outcome, not a failure to fall
    // back from — the runner already saw Instagram.
    if (/cancel|dismiss/i.test(msg)) return { ok: true, cancelled: true };
    return { ok: false, reason: msg };
  }
}

// Same lazy-require shape as `nativeShare`: a binary built before the module
// was added must lose the button, not crash on import.
function lazy(name, load) {
  let mod;
  return () => {
    if (mod === undefined) {
      shareCrumb(`require ${name}: start`);
      try {
        mod = load();
        shareCrumb(`require ${name}: ok`);
      } catch {
        mod = null;
        shareCrumb(`require ${name}: threw`);
      }
    }
    return mod;
  };
}

const mediaLibrary = lazy('expo-media-library', () => require('expo-media-library'));
const clipboard = lazy('expo-clipboard', () => require('expo-clipboard'));

export function canSaveToPhotos() {
  return !!mediaLibrary();
}

export function canCopyImage() {
  // Only the image API matters here; the text one has always existed.
  return typeof clipboard()?.setImageAsync === 'function';
}

/**
 * Save the card to the camera roll. Asks for the add-only permission the first
 * time — PASER never reads the library, so it requests write access only.
 */
export async function saveToPhotos(imageUri) {
  const Media = mediaLibrary();
  if (!Media) return { ok: false, reason: 'Saving needs a newer build of PASER.' };
  try {
    const perm = await Media.requestPermissionsAsync(true);
    if (!perm?.granted) {
      return { ok: false, reason: 'PASER needs permission to save to your photos.' };
    }
    await Media.saveToLibraryAsync(fileUri(imageUri));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) || 'Could not save the image.' };
  }
}

/**
 * Put the card on the clipboard AS AN IMAGE, so it can be pasted straight into
 * a message or a story. Takes base64 rather than a file URI: that is what
 * `expo-clipboard` wants, and `captureRef` can hand it over directly, which
 * saves reading the file back off disk.
 */
export async function copyImageToClipboard(base64) {
  const Clipboard = clipboard();
  if (!Clipboard?.setImageAsync) {
    return { ok: false, reason: 'Copying an image needs a newer build of PASER.' };
  }
  try {
    await Clipboard.setImageAsync(base64);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) || 'Could not copy the image.' };
  }
}

/**
 * The system share sheet. Works on every binary and every platform, and is
 * where Instagram feed / WhatsApp / Messages / Files come from.
 */
export async function shareToSystemSheet(imageUri, { dialogTitle = 'Share your run' } = {}) {
  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, reason: 'Sharing is not available on this device.' };
  }
  await Sharing.shareAsync(fileUri(imageUri), {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle,
  });
  return { ok: true };
}
