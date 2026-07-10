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

const SLIDES = [
  {
    key: 'claim',
    art: require('../../assets/art/onboarding-loop.png'),
    headline: ['Run.', 'Turn distance'],
    accentLine: 'into territory.',
    accent: brand.pink,
    body: 'Every run earns a claim zone as big as your distance — place it anywhere along your route.',
  },
  {
    key: 'clans',
    art: require('../../assets/art/onboarding-clans.png'),
    headline: ['Clubs fight.'],
    accentLine: 'Defend your land.',
    accent: brand.purple,
    body: 'Other clubs will try to take over your territory. Hold it together.',
  },
  {
    key: 'safety',
    art: require('../../assets/art/onboarding-safety.png'),
    headline: ['Territory can wait.'],
    accentLine: "Traffic can't.",
    accent: brand.teal,
    body: 'Run smart and come back strong.',
    bullets: [
      { icon: ShieldCheck, title: 'Stay alert', body: 'Eyes up at crossings — a claim is never worth a red light.' },
      { icon: Route, title: 'Use safe routes', body: 'Pick paths and park connectors over traffic.' },
      { icon: Flag, title: 'Follow the rules', body: 'Claims are validated server-side. No prize for cutting corners.' },
    ],
  },
];

function Slide({ item, index, scrollX, insets, last, onDone, reduced }) {
  const range = [(index - 1) * width, index * width, (index + 1) * width];

  // Art: gentle pan-and-zoom against the swipe direction.
  const artStyle = useAnimatedStyle(() => {
    if (reduced) return {};
    return {
      transform: [
        { translateX: interpolate(scrollX.value, range, [width * 0.14, 0, -width * 0.14], Extrapolation.CLAMP) },
        { scale: 1.14 },
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
    <View style={{ width, flex: 1, overflow: 'hidden', backgroundColor: colors.bg }}>
      <Animated.Image source={item.art} style={[StyleSheet.absoluteFill, { width, height: '100%' }, artStyle]} resizeMode="cover" />
      <LinearGradient
        colors={['rgba(11,13,16,0.72)', 'rgba(11,13,16,0.05)', 'rgba(11,13,16,0.88)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* the copy band: fixed offsets clear of the top + bottom chrome */}
      <View style={[styles.slideInner, { paddingTop: insets.top + 76, paddingBottom: insets.bottom + 92 }]}>
        <Animated.View style={headStyle}>
          {item.headline.map((line) => (
            <Text key={line} style={styles.headline}>{line}</Text>
          ))}
          <Text style={[styles.headline, { color: item.accent }]}>{item.accentLine}</Text>
        </Animated.View>

        <Animated.View style={lowerStyle}>
          {item.bullets ? (
            <View style={{ gap: space.lg, marginBottom: space.xl }}>
              {item.bullets.map(({ icon: Icon, title, body }) => (
                <View key={title} style={styles.bullet}>
                  <View style={[styles.bulletIcon, { borderColor: item.accent }]}>
                    <Icon size={20} color={item.accent} strokeWidth={2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyBold, { color: '#fff' }]}>{title}</Text>
                    <Text style={[type.bodySm, { color: 'rgba(255,255,255,0.72)', marginTop: 2 }]}>{body}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.body}>{item.body}</Text>
          )}

          {last ? (
            <PressableScale onPress={onDone} accessibilityRole="button" accessibilityLabel="Get started">
              <LinearGradient
                colors={brand.gradientTeal}
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
        <Text style={styles.progress}>
          <Text style={{ color: SLIDES[index].accent }}>{index + 1}</Text> / {SLIDES.length}
        </Text>
        <TouchableOpacity onPress={finish} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip intro">
          <Text style={[type.bodyMedium, { color: 'rgba(255,255,255,0.8)' }]}>Skip</Text>
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
            style={styles.nextBtn}
            onPress={() => { haptic.light(); next(); }}
            accessibilityRole="button"
            accessibilityLabel="Next slide"
          >
            <ArrowRight size={22} color="#fff" />
          </PressableScale>
        )}
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  slideInner: { flex: 1, justifyContent: 'space-between', paddingHorizontal: space.gutter },
  headline: { ...type.hero, color: '#ffffff', lineHeight: 46 },
  body: {
    ...type.body,
    color: 'rgba(255,255,255,0.82)',
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
