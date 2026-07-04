// Tiny global toast. One subscriber (rendered at the root) listens for
// `toast.show(message, opts)` calls and animates a banner.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../theme';

let listener = null;

export const toast = {
  show(message, { type = 'info', durationMs = 3200 } = {}) {
    if (listener) listener({ message, type, durationMs, id: Date.now() });
    else if (__DEV__) console.log(`[toast/${type}]`, message);
  },
  error(message, opts = {}) {
    this.show(message, { ...opts, type: 'error' });
  },
  success(message, opts = {}) {
    this.show(message, { ...opts, type: 'success' });
  },
};

export function ToastHost() {
  const [current, setCurrent] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    listener = (msg) => setCurrent(msg);
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(() => setCurrent(null));
    }, current.durationMs);
    return () => clearTimeout(t);
  }, [current, opacity]);

  if (!current) return null;
  const bg =
    current.type === 'error'
      ? colors.danger
      : current.type === 'success'
      ? colors.ok
      : colors.cardAlt;
  const fg =
    current.type === 'success' || current.type === 'error'
      ? '#fff'
      : colors.text;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.host, { opacity }]}
    >
      <View style={[styles.bubble, { backgroundColor: bg }]}>
        <Text style={[styles.text, { color: fg }]} numberOfLines={3}>
          {current.message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 56,
    left: space.lg,
    right: space.lg,
    alignItems: 'center',
  },
  bubble: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    minWidth: 180,
    maxWidth: '100%',
  },
  text: { ...type.bodySm, textAlign: 'center' },
});
