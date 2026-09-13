// SUPERSEDED (2026-07-27) — the first run now uses `src/onboarding/`
// (OnboardingFlow: name · birthday · character · PRO) and the story slides
// below live on as the in-app coach marks in `onboarding/TutorialOverlay.js`.
// Kept for reference; nothing imports this screen.
//
// PACER onboarding — three full-bleed art slides (assets/art/*):
// 1 the claim mechanic · 2 clubs + defending land · 3 the safety contract.
// Top: "1 / 3" + Skip. Bottom: dots + circular next (slide 3: gradient CTA).
//
// Motion: the art pans/zooms and the copy parallaxes against the swipe
// (headline leads, body trails), dots stretch as you pass them. Everything
// collapses to static under Reduce Motion. The copy sits in a fixed band —
// headline just below the top chrome, body/CTA just above the bottom chrome.

import React, { useRef, useState } from 'react';
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Flag, Route, ShieldCheck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { brand, colors, radius, space, type } from '../theme';
import { PressableScale, Reveal, haptic, useReduceMotion } from '../ui/motion';

const { width } = Dimensions.get('window');

// Each slide carries its own background (matching the art's baked background,
// so a `contain` image never letterboxes against a mismatched colour) and a
// `dark` flag that drives text/chrome colour. The claim art is transparent, so
// its slide is a light cream with dark text.
const SLIDES = [
  {
    key: 'claim',
    art: require('../../assets/art/claim-explainer.png'),
    bg: '#F4EEE1',
    dark: false,
    headline: ['Run.', 'Turn distance'],
    accentLine: 'into territory.',
    accent: brand.pink,
    body: 'Run, then place your claim on the route.',
  },
  {
    key: 'clans',
    art: require('../../assets/art/onboarding-clans.png'),
    bg: '#261742',
    dark: true,
    headline: ['Clubs fight.'],
    accentLine: 'Defend your land.',
    accent: brand.purple,
    body: 'Other clubs can take your land. Defend it together.',
  },
  {
    key: 'safety',
    art: require('../../assets/art/onboarding-safety.png'),
    bg: '#0B322A',
    dark: true,
    headline: ['Territory can wait.'],
    accentLine: "Traffic can't.",
    accent: brand.teal,
    body: 'Run smart and come back strong.',
    bullets: [
      { icon: ShieldCheck, title: 'Stay alert', body: 'Eyes up at crossings. A claim is never worth a red light.' },
      { icon: Route, title: 'Use safe routes', body: 'Pick paths and park connectors over traffic.' },
      { icon: Flag, title: 'Play fair', body: 'Runs are checked for fair play.' },
    ],
  },
];

function Slide({ item, index, scrollX, insets, last, onDone, reduced }) {
  const range = [(index - 1) * width, index * width, (index + 1) * width];
  const fg = item.dark ? '#ffffff' : '#141414';
  const fgMuted = item.dark ? 'rgba(255,255,255,0.9)' : 'rgba(20,20,20,0.7)';

  // Art: gentle parallax pan against the swipe (no zoom — `contain` must show
  // the whole illustration; scaling would crop it).
  const artStyle = useAnimatedStyle(() => {
    if (reduced) return {};
    return {
      transform: [
        { translateX: interpolate(scrollX.value, range, [width * 0.08, 0, -width * 0.08], Extrapolation.CLAMP) },
      ],
    };
  });

  // Copy: headline leads the swipe, body trails it — classic parallax.
  const headStyle = useAnimatedStyle(() => {
    if (reduced) return {};
    return {
      opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(scrollX.value, range, [width * 0.3, 0, -width * 0.3], Extrapolation.CLAMP) },
      ],
    };
  });
  const lowerStyle = useAnimatedStyle(() => {
    if (reduced) return {};
    return {
      opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(scrollX.value, range, [width * 0.5, 0, -width * 0.5], Extrapolation.CLAMP) },
      ],
    };
  });

  return (
    <View style={{ width, flex: 1, overflow: 'hidden', backgroundColor: item.bg }}>
      {/* the full illustration, never cropped — the matching slide background
          fills the letterbox so it reads as edge-to-edge */}
      <Animated.Image
        source={item.art}
        style={[StyleSheet.absoluteFill, { width, height: '100%' }, artStyle]}
        resizeMode="contain"
      />
      {/* the copy band: fixed offsets clear of the top + bottom chrome */}
      <View style={[styles.slideInner, { paddingTop: insets.top + 76, paddingBottom: insets.bottom + 92 }]}>
        <Animated.View style={headStyle}>
          {item.headline.map((line) => (
            <Text key={line} style={[styles.headline, { color: fg }]}>{line}</Text>
          ))}
          <Text style={[styles.headline, { color: item.accent }]}>{item.accentLine}</Text>
        </Animated.View>

        <Animated.View style={lowerStyle}>
          {item.bullets ? (
            <View style={styles.bulletCard}>
              {item.bullets.map(({ icon: Icon, title, body }) => (
                <View key={title} style={styles.bullet}>
                  <View style={[styles.bulletIcon, { borderColor: item.accent }]}>
                    <Icon size={20} color={item.accent} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyBold, { color: '#fff' }]}>{title}</Text>
                    <Text style={[type.bodySm, { color: 'rgba(255,255,255,0.82)', marginTop: 2 }]}>{body}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.body, { color: fgMuted }]}>{item.body}</Text>
          )}

          {last ? (
            <PressableScale onPress={onDone} accessibilityRole="button" accessibilityLabel="Get started">
              <LinearGradient
                colors={brand.gradient}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.cta}
              >
                <Text style={[type.button, { color: '#fff' }]}>Get started</Text>
              </LinearGradient>
            </PressableScale>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

// A progress dot that stretches while its slide is active.
function Dot({ index, scrollX, accent, reduced, active }) {
  const range = [(index - 1) * width, index * width, (index + 1) * width];
  const style = useAnimatedStyle(() => {
    if (reduced) return {};
    return {
      width: interpolate(scrollX.value, range, [8, 22, 8], Extrapolation.CLAMP),
      opacity: interpolate(scrollX.value, range, [0.35, 1, 0.35], Extrapolation.CLAMP),
    };
  });
  return (
    <Animated.View
      style={[styles.dot, active && { backgroundColor: accent }, style]}
    />
  );
}

export default function OnboardingScreen({ onDone }) {
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const listRef = useRef(null);
  const [index, setIndex] = useState(0);
  const scrollX = useSharedValue(0);
  const last = index === SLIDES.length - 1;
  // Chrome (progress, skip, next) flips to dark ink on the light claim slide.
  const slide = SLIDES[index];
  const chromeFg = slide.dark ? '#ffffff' : '#141414';
  const chromeMuted = slide.dark ? 'rgba(255,255,255,0.7)' : 'rgba(20,20,20,0.6)';

  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const finish = () => { haptic.light(); onDone?.(); };
  const next = () => {
    if (last) return finish();
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Animated.FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: i }) => (
          <Slide
            item={item}
            index={i}
            scrollX={scrollX}
            insets={insets}
            last={i === SLIDES.length - 1}
            onDone={finish}
            reduced={reduced}
          />
        )}
      />

      {/* top chrome: progress + skip */}
      <Reveal from="down" style={[styles.topBar, { top: insets.top + space.sm }]}>
        <Text style={[styles.progress, { color: chromeMuted }]}>
          <Text style={{ color: slide.accent }}>{index + 1}</Text> / {SLIDES.length}
        </Text>
        <TouchableOpacity onPress={finish} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip intro">
          <Text style={[type.bodyMedium, { color: chromeMuted }]}>Skip</Text>
        </TouchableOpacity>
      </Reveal>

      {/* bottom chrome: dots + next (hidden on the CTA slide) */}
      <Reveal from="up" delay={120} style={[styles.bottomBar, { bottom: insets.bottom + space.xl }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <Dot key={s.key} index={i} scrollX={scrollX} accent={SLIDES[index].accent} reduced={reduced} active={i === index} />
          ))}
        </View>
        {!last && (
          <PressableScale
            style={[styles.nextBtn, { borderColor: chromeFg, backgroundColor: slide.dark ? 'rgba(11,13,16,0.4)' : 'rgba(255,255,255,0.55)' }]}
            onPress={() => { haptic.light(); next(); }}
            accessibilityRole="button"
            accessibilityLabel="Next slide"
          >
            <ArrowRight size={22} color={chromeFg} />
          </PressableScale>
        )}
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  slideInner: { flex: 1, justifyContent: 'space-between', paddingHorizontal: space.gutter },
  headline: {
    ...type.hero,
    lineHeight: 50,
    paddingVertical: 2,
  },
  bulletCard: {
    gap: space.lg,
    marginBottom: space.xl,
    backgroundColor: 'rgba(11,13,16,0.72)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: space.lg,
  },
  body: {
    ...type.body,
    lineHeight: 22,
    maxWidth: '86%',
  },

  bullet: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  bulletIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,13,16,0.5)',
  },

  cta: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  topBar: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progress: { ...type.bodyMedium, color: 'rgba(255,255,255,0.6)' },

  bottomBar: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dots: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
  nextBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,13,16,0.4)',
  },
});
