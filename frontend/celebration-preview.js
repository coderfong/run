// Dev only: plays LevelUpCelebration in a browser. Not imported by the app.
// Served by a scratch proxy in front of Metro (see the session notes).

import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Image as RNImage, Platform, Pressable, Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';
import { getAssetByID as webAsset } from 'react-native-web/dist/modules/AssetRegistry';
import { getAssetByID as nativeAsset } from '@react-native/assets-registry/registry';

import LevelUpCelebration from './src/components/LevelUpCelebration';
import { DEFAULT_EQUIPPED } from './src/config/cosmetics';
import { FONT_FILES } from './src/theme/fontFiles';
import { ThemeProvider } from './src/theme';
import { Image as AppImage } from './src/ui/image';
import { MotionProvider } from './src/ui/motion';

// react-native-web has no Image.resolveAssetSource, and the rig reads every
// layer's intrinsic size through it. ui/image copies the (missing) function at
// load, so both get patched. Render-time callers only, so patching here is in time.
function resolveAssetSource(source) {
  if (typeof source !== 'number') return source;
  const asset = webAsset(source) || nativeAsset(source);
  if (!asset) return null;
  const scale = asset.scales?.[0] ?? 1;
  return {
    uri: `${asset.httpServerLocation}/${asset.name}${scale === 1 ? '' : `@${scale}x`}.${asset.type}`,
    width: asset.width,
    height: asset.height,
    scale,
  };
}
if (Platform.OS === 'web') {
  if (!RNImage.resolveAssetSource) RNImage.resolveAssetSource = resolveAssetSource;
  if (!AppImage.resolveAssetSource) AppImage.resolveAssetSource = resolveAssetSource;
}

// Scriptable from the URL, so a screenshot does not have to race a click:
//   ?level=12&from=11   open that case on load
//   &hold=1             replay instead of closing
//   &reduced=1          force Reduce Motion (a still pose, reliable to capture)
const PARAMS = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
if (PARAMS.get('reduced') === '1') {
  AccessibilityInfo.isReduceMotionEnabled = () => Promise.resolve(true);
}
const HOLD = PARAMS.get('hold') === '1';
const AUTO = PARAMS.get('level')
  ? { level: Number(PARAMS.get('level')), from: PARAMS.get('from') ? Number(PARAMS.get('from')) : undefined }
  : null;

const CASES = [
  { label: 'Level 2', level: 2, from: 1 },
  { label: 'Level 5 (band)', level: 5, from: 4 },
  { label: 'Level 12', level: 12, from: 11 },
  { label: '10 to 12', level: 12, from: 10 },
  { label: 'Level 25', level: 25, from: 24 },
  { label: 'Level 50', level: 50, from: 49 },
];

function Preview() {
  const [loaded] = useFonts(FONT_FILES);
  const [shown, setShown] = useState(null);
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    if (loaded && AUTO) setShown(AUTO);
  }, [loaded]);
  if (!loaded) return null;
  return (
    <View style={{ flex: 1, backgroundColor: '#10141A', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
      <View style={{ width: 300, height: 220, borderRadius: 12, backgroundColor: '#1B2230', borderWidth: 3, borderColor: '#f5f1e6' }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 340 }}>
        {CASES.map((c) => (
          <Pressable
            key={c.label}
            accessibilityRole="button"
            onPress={() => {
              setRuns((n) => n + 1);
              setShown(c);
            }}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 2, borderColor: '#2dd4bf' }}
          >
            <Text style={{ color: '#2dd4bf', fontFamily: 'Inter_600SemiBold' }}>{c.label}</Text>
          </Pressable>
        ))}
      </View>
      <LevelUpCelebration
        key={runs}
        visible={shown != null}
        level={shown?.level ?? null}
        from={shown?.from}
        equipped={DEFAULT_EQUIPPED}
        accent="#ec4899"
        onClose={() => (HOLD ? setRuns((n) => n + 1) : setShown(null))}
      />
    </View>
  );
}

function Root() {
  return (
    <ThemeProvider>
      <MotionProvider>
        <Preview />
      </MotionProvider>
    </ThemeProvider>
  );
}

registerRootComponent(Root);
