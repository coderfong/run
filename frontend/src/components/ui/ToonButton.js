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

import { NB, shadow } from '../../theme';
import { ctaFills, toon, toonType } from '../../onboarding/toon';
import { haptic, PressableScale } from '../../ui/motion';
import { INK, framePose, frameVariant } from '../../ui/frameRegistry';
import Framed from './Framed';
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
  containerStyle,
  labelColor = '#FFFFFF',
  // Defaults to the title, which is right for almost every button here — the
  // label IS the affordance. Overridable for the few whose visible word is
  // shorter than what it does: "Continue" at the end of the result screen is
  // continuing TO SHARING, and a screen reader landing on it deserves to be
  // told which of the several Continues in this flow it found.
  accessibilityLabel,
  // Escape hatch for buttons that have to wear a colour the app decides at
  // runtime rather than one of the four brand variants — the claim CTA is
  // painted in the runner's clan colour. Shape: { colors: [a, b, c], border }.
  fill: fillOverride,
}) {
  const fill = fillOverride || ctaFills[variant] || ctaFills.primary;
  // One flat fill. The frame and hard shadow already supply the depth; the old
  // gradient, top sheen and highlight blob read as multiple button colours.
  const fillColor = fill.color || fill.colors?.[1] || fill.colors?.[0] || '#EC4899';
  const height = size === 'sm' ? 48 : 60;
  // A small button is usually also a NARROW one — it shares a row with a ghost
  // action rather than spanning the card. Starting it a couple of points down
  // means a two-word label lands at its natural size instead of arriving
  // already shrunk by the fit below.
  const fontSize = size === 'sm' ? 16 : toonType.button.fontSize;
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
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: off }}
      containerStyle={containerStyle}
      style={[styles.shadow, { opacity: disabled ? 0.55 : 1 }, style]}
    >
      <Framed
        frame={frameVariant('action', title)}
        tint={fill.border || toon.ink}
        fill={fillColor}
        weight={size === 'sm' ? INK.thin : INK.base}
        pose={framePose(title)}
        inset={false}
        style={{ height }}
        contentStyle={styles.fill}
      >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.row}>
              {icon}
              {/* The label owns the leftover width and shrinks into it. A long
                  CTA ("EXPAND YOUR LEAD") used to run under the pill's rim,
                  because the row had no padding, no width limit, and the clip
                  simply cut whatever hung out. */}
              <OutlinedText
                style={[toonType.button, { fontSize, color: labelColor }]}
                outline={toon.ink}
                width={2}
                fit
                minimumFontScale={0.62}
                containerStyle={styles.label}
              >
                {title}
              </OutlinedText>
            </View>
          )}
      </Framed>
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
  // Was shadowOpacity 0.35 at offset {0,3} with elevation 4 — a half-hard
  // shadow: no blur, but translucent, straight down, and paired with an Android
  // elevation that blurred it anyway. The drop is now the real thing, offset on
  // both axes at full opacity. It stays here as a style rather than moving to
  // HardShadow because this button is FRAMED, so its silhouette is a wobbly
  // drawn box and a hard rectangle behind it would show at every corner where
  // the ink wanders in.
  shadow: shadow.hard(NB.ink, NB.offsetSm),
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // maxWidth is what makes the label shrinkable at all: without it the row
  // sizes to its content and simply overflows the pill it sits in.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
    paddingHorizontal: 18,
  },
  label: { flexShrink: 1 },
  ghost: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16 },
});
