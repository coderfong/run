// Global offline banner. Sits above the navigator; every screen gets it for
// free. GPS recording is unaffected by connectivity — the Running screen
// keeps recording and reconciles at /end-run.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';

import { colors, space, type } from '../theme';

export function useIsOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      // isInternetReachable can be null while probing — treat null as online.
      setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    });
    return unsub;
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useIsOnline();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View style={[styles.banner, { paddingTop: insets.top + 4 }]} pointerEvents="none">
      <Text style={styles.text}>
        You're offline. Runs keep recording, and we'll sync when you're back.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99,
    backgroundColor: colors.warn,
    paddingBottom: 6,
    paddingHorizontal: space.lg,
    alignItems: 'center',
  },
  text: { ...type.captionMedium, color: '#fff', textAlign: 'center' },
});
