// Sheet — a bottom sheet surface over a dim backdrop. Controlled via
// `visible`. radius.sheet top corners, drag handle, tap-backdrop to close.
// Springs in when Reduce Motion is off.

import React, { useEffect } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { darkColors, radius, space, useTheme } from '../../theme';
import { spring } from '../../theme/motion';
import { useReduceMotion } from '../../ui/motion';

export default function Sheet({ visible, onClose, children, dark = false }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      progress.value = reduce ? 1 : withSpring(1, spring.soft);
    } else {
      progress.value = reduce ? 0 : withTiming(0, { duration: 180 });
    }
  }, [visible, reduce, progress]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * 40 }],
    opacity: progress.value,
  }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: dark ? darkColors.card : colors.card,
            borderTopLeftRadius: radius.sheet,
            borderTopRightRadius: radius.sheet,
            paddingHorizontal: space.gutter,
            paddingTop: space.md,
            paddingBottom: insets.bottom + space.lg,
          },
          sheetStyle,
        ]}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 38,
            height: 5,
            borderRadius: 3,
            backgroundColor: dark ? 'rgba(255,255,255,0.18)' : colors.border,
            marginBottom: space.md,
          }}
        />
        {children}
      </Animated.View>
    </Modal>
  );
}
