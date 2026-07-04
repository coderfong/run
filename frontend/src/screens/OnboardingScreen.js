import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space, type } from '../theme';

const { width } = Dimensions.get('window');
const BOX = 220; // illustration canvas size

// Three slides: the game, the rivalry, the safety contract. The last slide
// flows straight into the location pre-permission explainer.
const SLIDES = [
  {
    key: 'run',
    title: 'Run. Close the loop. Claim the land.',
    body:
      'Trace any route you like. Close it back near where you started and everything inside the loop becomes your territory.',
    accent: '#2563eb',
  },
  {
    key: 'compete',
    title: 'Four teams. One city.',
    body:
      'Singapore is split into North, East, South and West. Run over a rival’s land and the overlap becomes yours — captures are validated on our servers, so what you see is what you keep.',
    accent: '#9333ea',
  },
  {
    key: 'safety',
    title: 'Territory can wait. Traffic can’t.',
    body:
      'Obey every crossing, signal and barrier — a loop is never worth a red light. Runs are checked server-side, so there’s no prize for cutting corners. Heads up, eyes on the road.',
    accent: '#d97706',
  },
];

// ---------------------------------------------------------------------------
// Animated illustrations — one per slide, each demonstrating the step.
// Everything animates via transform/opacity so the native driver can be used.
// ---------------------------------------------------------------------------

// Step 1: a runner dot orbiting a dashed loop that closes on itself.
function IllustrationLoop({ accent }) {
  const spin = useRef(new Animated.Value(0)).current;
  const R = 78;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.illo}>
      <Svg width={BOX} height={BOX}>
        <Circle cx={BOX / 2} cy={BOX / 2} r={R} stroke={`${accent}26`} strokeWidth={16} fill="none" />
        <Circle
          cx={BOX / 2}
          cy={BOX / 2}
          r={R}
          stroke={accent}
          strokeWidth={3}
          strokeDasharray="1 11"
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      {/* start / finish marker at the top of the loop */}
      <View style={[styles.startDot, { borderColor: accent, top: BOX / 2 - R - 7 }]} />
      {/* orbiting runner */}
      <Animated.View
        style={[styles.orbit, { transform: [{ rotate }] }]}
        pointerEvents="none"
      >
        <View style={{ marginTop: BOX / 2 - R - 9 }}>
          <View style={[styles.runner, { backgroundColor: accent, shadowColor: accent }]} />
        </View>
      </Animated.View>
    </View>
  );
}

// Step 2: two overlapping territories; the captured overlap flips to your colour.
function IllustrationSteal() {
  const rival = '#9333ea';
  const you = '#2563eb';
  const capture = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(500),
        Animated.timing(capture, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(900),
        Animated.timing(capture, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [capture]);

  const lensOpacity = capture.interpolate({ inputRange: [0, 1], outputRange: [0, 0.95] });
  const lensScale = capture.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });

  return (
    <View style={styles.illo}>
      {/* rival territory (left) */}
      <View
        style={[
          styles.stealCircle,
          { backgroundColor: `${rival}66`, borderColor: rival, left: BOX / 2 - 88, top: BOX / 2 - 50 },
        ]}
      />
      {/* your territory (right) */}
      <View
        style={[
          styles.stealCircle,
          { backgroundColor: `${you}55`, borderColor: you, left: BOX / 2 - 12, top: BOX / 2 - 50 },
        ]}
      />
      {/* captured overlap */}
      <Animated.View
        style={{
          position: 'absolute',
          width: 50,
          height: 96,
          borderRadius: 25,
          backgroundColor: you,
          left: BOX / 2 - 25,
          top: BOX / 2 - 48,
          opacity: lensOpacity,
          transform: [{ scale: lensScale }],
        }}
      />
    </View>
  );
}

// Step 3: a crossing signal — the amber lamp pulses while a runner dot
// waits at the stop line. Safety is part of the game's contract.
function IllustrationSafety({ accent }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);

  const lampOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const lampScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });

  return (
    <View style={styles.illo}>
      {/* signal housing */}
      <View style={[styles.signalHousing, { borderColor: accent }]}>
        <View style={[styles.signalLamp, { backgroundColor: colors.bgElevated }]} />
        <Animated.View
          style={[
            styles.signalLamp,
            {
              backgroundColor: accent,
              opacity: lampOpacity,
              transform: [{ scale: lampScale }],
            },
          ]}
        />
        <View style={[styles.signalLamp, { backgroundColor: colors.bgElevated }]} />
      </View>
      {/* stop line + waiting runner dot */}
      <View style={styles.stopLine} />
      <View style={[styles.waitingRunner, { backgroundColor: accent }]} />
    </View>
  );
}

const ILLUSTRATIONS = {
  run: IllustrationLoop,
  compete: IllustrationSteal,
  safety: IllustrationSafety,
};

// ---------------------------------------------------------------------------

function Slide({ item, index, scrollX, height }) {
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
  const illoScale = scrollX.interpolate({
    inputRange,
    outputRange: [0.55, 1, 0.55],
    extrapolate: 'clamp',
  });
  const illoOpacity = scrollX.interpolate({
    inputRange,
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });
  const textTranslate = scrollX.interpolate({
    inputRange,
    outputRange: [width * 0.3, 0, -width * 0.3],
    extrapolate: 'clamp',
  });
  const textOpacity = scrollX.interpolate({
    inputRange,
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  const Illo = ILLUSTRATIONS[item.key];

  return (
    <View style={[styles.slide, { width, height }]}>
      <Animated.View style={{ opacity: illoOpacity, transform: [{ scale: illoScale }] }}>
        <Illo accent={item.accent} />
      </Animated.View>
      <Animated.View
        style={[styles.copy, { opacity: textOpacity, transform: [{ translateX: textTranslate }] }]}
      >
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.body}>{item.body}</Text>
      </Animated.View>
    </View>
  );
}

export default function OnboardingScreen({ onDone }) {
  const insets = useSafeAreaInsets();
  const ref = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const [index, setIndex] = useState(0);
  const [listH, setListH] = useState(Math.round(Dimensions.get('window').height * 0.68));

  const finish = () => onDone?.();
  const next = () => {
    if (index < SLIDES.length - 1) {
      ref.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      finish();
    }
  };
  const onMomentumEnd = (e) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const last = index === SLIDES.length - 1;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.listWrap} onLayout={(e) => setListH(e.nativeEvent.layout.height)}>
        <Animated.FlatList
          ref={ref}
          data={SLIDES}
          keyExtractor={(s) => s.key}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: true }
          )}
          onMomentumScrollEnd={onMomentumEnd}
          renderItem={({ item, index: i }) => (
            <Slide item={item} index={i} scrollX={scrollX} height={listH} />
          )}
        />
      </View>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => {
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          const scaleX = scrollX.interpolate({
            inputRange,
            outputRange: [1, 2.75, 1],
            extrapolate: 'clamp',
          });
          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.3, 1, 0.3],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={i}
              style={[styles.dot, { opacity, transform: [{ scaleX }] }]}
            />
          );
        })}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.xl }]}>
        <TouchableOpacity onPress={finish} hitSlop={12}>
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={next}>
          <Text style={styles.ctaText}>{last ? "Let's go" : 'Next'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listWrap: { flex: 1 },

  slide: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },

  illo: {
    width: BOX,
    height: BOX,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xl,
  },
  orbit: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
  },
  runner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  startDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    backgroundColor: colors.bg,
  },
  stealCircle: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
  },
  signalHousing: {
    width: 62,
    height: 150,
    borderRadius: radius.lg,
    borderWidth: 3,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'space-evenly',
  },
  signalLamp: { width: 30, height: 30, borderRadius: 15 },
  stopLine: {
    position: 'absolute',
    bottom: 18,
    left: 20,
    right: 20,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  waitingRunner: {
    position: 'absolute',
    bottom: 30,
    left: 48,
    width: 16,
    height: 16,
    borderRadius: 8,
  },

  copy: { alignItems: 'center' },
  title: {
    ...type.title,
    textAlign: 'center',
    marginBottom: space.md,
  },
  body: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: space.sm,
  },

  dots: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    marginVertical: space.lg,
    height: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginHorizontal: 5,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
  },
  skip: { ...type.bodyMedium, color: colors.textMuted },
  cta: {
    backgroundColor: colors.primary,
    paddingHorizontal: space.xl,
    paddingVertical: 14,
    borderRadius: radius.pill,
  },
  ctaText: { ...type.buttonSm },
});
