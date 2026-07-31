// Shared first-run building blocks: the step chrome (back · progress · skip),
// the night stage the character stands on, and the comic panel / speech
// bubble / thumbnail used to frame illustration.
//
// Anything that takes a `source` degrades to a code-drawn panel when the art
// has not been generated yet (see config/onboardingArt.js).

import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from 'lucide-react-native';

import { brand, space } from '../theme';
import { haptic, PressableScale } from '../ui/motion';
import { art } from '../config/onboardingArt';
import OutlinedText from '../components/ui/OutlinedText';
import { toon, toonRadius, toonType } from './toon';

// ---------------------------------------------------------------------------
// Step chrome — circular back button, progress track, right-hand text action.
// ---------------------------------------------------------------------------

export function StepChrome({ step, total, onBack, onSkip, skipLabel = 'Skip', top = 0 }) {
  const pct = total > 0 ? Math.max(0.04, (step + 1) / total) : 0;
  const w = useSharedValue(pct);
  React.useEffect(() => {
    w.value = withTiming(pct, { duration: 320 });
  }, [pct, w]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));

  return (
    <View style={[styles.chrome, { paddingTop: top + space.sm }]}>
      <View style={styles.chromeSide}>
        {onBack ? (
          <PressableScale
            onPress={() => { haptic.light(); onBack(); }}
            style={styles.roundBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft size={24} color="#fff" />
          </PressableScale>
        ) : null}
      </View>

      <View style={styles.track}>
        <Animated.View style={[styles.trackFill, fillStyle]}>
          <LinearGradient
            colors={[brand.pink, '#F97CBB']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>

      <View style={[styles.chromeSide, { alignItems: 'flex-end' }]}>
        {onSkip ? (
          <PressableScale
            onPress={() => { haptic.light(); onSkip(); }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={skipLabel}
          >
            <Text style={[toonType.label, { color: 'rgba(255,255,255,0.75)' }]}>{skipLabel}</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// StageBackdrop — the lit night ground the character is previewed on. Uses
// `stage.png` when it exists, otherwise draws the gradient + horizon in code.
// ---------------------------------------------------------------------------

export function StageBackdrop({ children, style }) {
  const bg = art('stage');
  return (
    <View style={[styles.stage, style]}>
      <LinearGradient colors={toon.stage} style={StyleSheet.absoluteFill} />
      {bg ? (
        <Image source={bg} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <>
          {/* horizon + ground band */}
          <View style={styles.ground} />
          <View style={styles.groundEdge} />
          {/* two roadside bushes, mirrored */}
          <View style={[styles.bush, { left: -18 }]} />
          <View style={[styles.bush, { right: -18 }]} />
        </>
      )}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ComicPanel — a rounded, ink-outlined illustration panel. `fit="contain"`
// keeps art with a baked background whole; `bg` fills the letterbox.
// ---------------------------------------------------------------------------

export function ComicPanel({
  source,
  bg = '#241B2E',
  fit = 'contain',
  aspect = 4 / 3,
  fallback = null,
  style,
  children,
}) {
  return (
    <View style={[styles.panel, { aspectRatio: aspect, backgroundColor: bg }, style]}>
      {source ? (
        <Image source={source} style={StyleSheet.absoluteFill} resizeMode={fit} />
      ) : (
        <>
          <LinearGradient
            colors={[bg, '#0C0C10']}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.fallback}>{fallback}</View>
        </>
      )}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// SpeechBubble — comic bubble with a tail, for panels drawn in code.
// ---------------------------------------------------------------------------

export function SpeechBubble({ children, style, tail = 'left' }) {
  return (
    <View style={[styles.bubbleWrap, style]}>
      <View style={styles.bubble}>
        <Text style={[toonType.sub, { color: toon.ink }]}>{children}</Text>
      </View>
      <View
        style={[
          styles.tail,
          tail === 'left' ? { left: 26 } : { right: 26 },
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// StepThumb — the small squircle illustration above a form step's headline.
// Falls back to a gradient tile holding whatever node you pass as `fallback`.
// ---------------------------------------------------------------------------

export function StepThumb({ source, fallback, size = 132, bg = '#F26A3A' }) {
  return (
    <View style={[styles.thumb, { width: size, height: size, backgroundColor: bg }]}>
      {source ? (
        <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <>
          <LinearGradient
            colors={['#F9A03F', '#F2542D']}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.fallback}>{fallback}</View>
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// StepHeadline — the outlined headline + optional sub-line used by every step.
// ---------------------------------------------------------------------------

export function StepHeadline({ title, sub, color = '#FFFFFF', style }) {
  return (
    <View style={style}>
      <OutlinedText style={[toonType.headline, { color }]} outline={toon.ink} width={2.5}>
        {title}
      </OutlinedText>
      {sub ? (
        <OutlinedText
          style={[toonType.sub, { color: 'rgba(255,255,255,0.85)', marginTop: 4 }]}
          outline={toon.ink}
          width={2}
        >
          {sub}
        </OutlinedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingBottom: space.sm,
  },
  chromeSide: { width: 56, justifyContent: 'center' },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    flex: 1,
    height: 12,
    borderRadius: toonRadius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  trackFill: { height: '100%', borderRadius: toonRadius.pill, overflow: 'hidden' },

  stage: { flex: 1, overflow: 'hidden' },
  ground: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '26%',
    backgroundColor: toon.ground,
  },
  groundEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '26%',
    height: 2,
    backgroundColor: toon.groundLine,
  },
  bush: {
    position: 'absolute',
    bottom: '20%',
    width: 120,
    height: 64,
    borderRadius: 40,
    backgroundColor: 'rgba(8,26,24,0.75)',
  },

  panel: {
    width: '100%',
    borderRadius: toonRadius.panel,
    borderWidth: 3,
    borderColor: toon.ink,
    overflow: 'hidden',
  },
  fallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  bubbleWrap: { alignSelf: 'flex-start' },
  bubble: {
    backgroundColor: '#fff',
    borderRadius: 22,
    borderWidth: 3,
    borderColor: toon.ink,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    maxWidth: 240,
  },
  tail: {
    width: 22,
    height: 22,
    backgroundColor: '#fff',
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderColor: toon.ink,
    transform: [{ rotate: '45deg' }],
    marginTop: -12,
  },

  thumb: {
    borderRadius: 28,
    borderWidth: 3,
    borderColor: toon.ink,
    overflow: 'hidden',
    alignSelf: 'center',
  },
});
