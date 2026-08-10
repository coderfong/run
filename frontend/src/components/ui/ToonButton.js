// ToonButton — the glossy pill CTA used by onboarding and the tutorial
// overlay: 3-stop gradient fill, a specular sheen across the top half, a
// small highlight blob, an ink outline and a hard drop shadow. Label is
// OutlinedText so it reads on any fill.
//
// This is the ONE button for the first-run experience; the rest of the app
// keeps the flat `Button` primitive. Variants map to `ctaFills` in
// ../../onboarding/toon.js: primary (PASER pink) · gold (premium) ·
// teal · neutral (white).

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { ctaFills, toon, toonRadius, toonType } from '../../onboarding/toon';
import { haptic, PressableScale } from '../../ui/motion';
import OutlinedText from './OutlinedText';

export default function ToonButton({
  title,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  icon = null,
  style,
  labelColor = '#FFFFFF',
  // Escape hatch for buttons that have to wear a colour the app decides at
  // runtime rather than one of the four brand variants — the claim CTA is
  // painted in the runner's clan colour. Shape: { colors: [a, b, c], border }.
  fill: fillOverride,
}) {
  const fill = fillOverride || ctaFills[variant] || ctaFills.primary;
  const height = size === 'sm' ? 48 : 60;
  const off = disabled || loading;

  const press = () => {
    if (off) return;
    haptic.light();
    onPress?.();
  };

  return (
    <PressableScale
      onPress={press}
      disabled={off}
      scaleTo={0.96}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off }}
      style={[styles.shadow, { opacity: disabled ? 0.55 : 1 }, style]}
    >
      <View style={[styles.clip, { height, borderColor: fill.border }]}>
        <LinearGradient
          colors={fill.colors}
          locations={[0, 0.5, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.fill}
        >
          {/* specular sheen across the top half + a soft highlight blob */}
          <View pointerEvents="none" style={[styles.sheen, { height: height * 0.46 }]} />
          <View pointerEvents="none" style={styles.blob} />

          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.row}>
              {icon}
              <OutlinedText style={[toonType.button, { color: labelColor }]} outline={toon.ink} width={2}>
                {title}
              </OutlinedText>
            </View>
          )}
        </LinearGradient>
      </View>
    </PressableScale>
  );
}

// A quiet text-only action (Skip / Not now / Maybe later).
export function ToonGhostButton({ title, onPress, color = 'rgba(255,255,255,0.72)', style }) {
  return (
    <PressableScale
      onPress={() => { haptic.light(); onPress?.(); }}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[styles.ghost, style]}
    >
      <Text style={[toonType.label, { color }]}>{title}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  clip: {
    borderRadius: toonRadius.pill,
    borderWidth: 2.5,
    overflow: 'hidden',
  },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheen: {
    position: 'absolute',
    top: 2,
    left: 6,
    right: 6,
    borderRadius: toonRadius.pill,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },
  blob: {
    position: 'absolute',
    top: 6,
    left: 18,
    width: 26,
    height: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.55)',
    transform: [{ rotate: '-8deg' }],
  },
  ghost: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 },
});
