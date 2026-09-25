// Core Motion activity (walking / running / cycling / automotive /
// stationary), through the PaserMotion native module (modules/paser-motion).
//
// ONE SIGNAL AMONG SEVERAL. The session classifier weighs it against GPS,
// cadence and stride; it is never a verdict on its own. And it is optional in
// every direction: a build without the module, an Android phone, a runner who
// refused Motion & Fitness, or a device without the coprocessor all get an
// empty list, and classification carries on with what it has.
//
// Core Motion keeps seven days of activity history, so the whole run can be
// queried after the fact — including the stretches the app spent suspended in
// a pocket, which is exactly when the live view saw nothing.

import { Platform } from 'react-native';

let cached;
function native() {
  if (cached !== undefined) return cached;
  cached = null;
  if (Platform.OS !== 'ios') return cached;
  try {
    const { requireOptionalNativeModule } = require('expo-modules-core');
    cached = requireOptionalNativeModule('PaserMotion') || null;
  } catch {
    cached = null;
  }
  return cached;
}

const KINDS = new Set(['stationary', 'walking', 'running', 'cycling', 'automotive', 'unknown']);

export function motionAvailable() {
  try {
    return !!native()?.isAvailable?.();
  } catch {
    return false;
  }
}

/** [{ t, kind, conf }] for [fromMs, toMs], oldest first; [] when unavailable. */
export async function queryMotion(fromMs, toMs) {
  const mod = native();
  if (!mod?.queryActivities || !(toMs > fromMs)) return [];
  try {
    const rows = await mod.queryActivities(fromMs, toMs);
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => r && Number.isFinite(r.t) && KINDS.has(r.kind))
      .map((r) => ({ t: Math.round(r.t), kind: r.kind, conf: Number(r.conf) || 0 }))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}
