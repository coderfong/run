// Process-of-elimination controls for the share-screen crash — see
// shareDebugFlags.js for why this exists instead of one suspect per rebuild.
//
// Lives on ResultScreen, ABOVE the Continue button that opens the crashing
// screen: the crash reproduces before anyone can touch a control on the share
// screen itself, so the toggles have to be set from the screen before it.
// Same gate as DevRunSimulator — reachable in every build, shown to nobody
// until the server names an account via `dev_tools` on /me.

import React, { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { SHARE_DEBUG_FLAGS, setShareDebugFlag } from '../utils/shareDebugFlags';
import { radius, space, useTheme, useThemedType } from '../theme';

const LABELS = {
  checkerboard: 'Checkerboard SVG',
  cardSvg: 'Route/territory SVG',
  paserMark: 'Brand mark image',
  runner: 'Runner avatar',
  icons: 'Destination icons',
  gradient: 'Instagram gradient',
  postEditor: 'Post editor',
  nativeShareProbe: 'Native share probe',
  card: 'Card (mount at all)',
  sheetBody: 'Sheet body (everything below title)',
  mountSheet: 'Mount sheet at all',
};

export default function DevShareDebugPanel({ style }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const type = useThemedType();
  const [flags, setFlags] = useState({ ...SHARE_DEBUG_FLAGS });

  if (!__DEV__ && !user?.dev_tools) return null;

  const toggle = (key) => {
    const next = !flags[key];
    setShareDebugFlag(key, next);
    setFlags((f) => ({ ...f, [key]: next }));
  };

  return (
    <View style={[styles.box, { borderColor: colors.border }, style]}>
      <Text style={[type.labelSm, { color: colors.textDim, marginBottom: space.xs }]}>
        SHARE CRASH — process of elimination
      </Text>
      {Object.keys(LABELS).map((key) => (
        <View key={key} style={styles.row}>
          <Text style={[type.bodySm, { color: colors.text, flex: 1 }]}>{LABELS[key]}</Text>
          <Switch value={!!flags[key]} onValueChange={() => toggle(key)} />
        </View>
      ))}
      <Text style={[type.caption, { color: colors.textDim, marginTop: space.xs }]}>
        Flip one, force-quit, relaunch, run through to Share. If it stops
        crashing with a flag off, that's the cause.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
});
