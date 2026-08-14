// One door to expo-image-picker.
//
// The module is required lazily on purpose. It is a native module, so a
// JS-only update can land on a build that was compiled without it; a missing
// picker has to read as "this needs an app update" rather than crash the
// screen that asked for a photo.
//
// Photos travel as data URIs. That is what the API takes for run post media
// and for a club's photo, and it keeps uploads on the same authenticated JSON
// path as everything else instead of needing a second multipart route.

export const MAX_DATA_URI_LENGTH = 3_000_000;

let pickerModule;

export function imagePicker() {
  if (pickerModule === undefined) {
    try {
      pickerModule = require('expo-image-picker');
    } catch {
      pickerModule = null;
    }
  }
  return pickerModule;
}

export function dataUri(asset) {
  if (!asset?.base64) return null;
  const mime = ['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)
    ? asset.mimeType
    : 'image/jpeg';
  return `data:${mime};base64,${asset.base64}`;
}

/**
 * Pick a single photo and hand back its data URI, or null if the picker was
 * dismissed. Throws with a message the caller can toast as is.
 *
 * `source` is 'camera' or 'library'. `square` opens the system cropper locked
 * to 1:1, which is what an avatar wants.
 */
export async function pickPhoto(source, { square = false, maxLength = MAX_DATA_URI_LENGTH } = {}) {
  const Picker = imagePicker();
  if (!Picker) throw new Error('Adding photos needs the latest PASER app update.');

  const permission = source === 'camera'
    ? await Picker.requestCameraPermissionsAsync()
    : await Picker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      source === 'camera'
        ? 'PASER needs camera access to take a photo.'
        : 'PASER needs photo access to choose a picture.'
    );
  }

  const options = {
    mediaTypes: ['images'],
    base64: true,
    quality: 0.6,
    exif: false,
    allowsEditing: true,
    ...(square ? { aspect: [1, 1] } : null),
  };
  const result = source === 'camera'
    ? await Picker.launchCameraAsync(options)
    : await Picker.launchImageLibraryAsync(options);
  if (result?.canceled) return null;

  const uri = dataUri(result?.assets?.[0]);
  if (!uri) return null;
  if (uri.length > maxLength) {
    throw new Error('That photo is too large. Try a smaller one.');
  }
  return uri;
}
