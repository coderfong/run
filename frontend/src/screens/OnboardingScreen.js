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
import Svg, { Circle, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space, type } from '../theme';

const { width } = Dimensions.get('window');
const BOX = 220; // illustration canvas size

const SLIDES = [
  {
    key: 'run',
    title: 'Run a closed loop',
    body:
      'Trace any path you want. The moment your route closes back near where you started, you complete a loop.',
    accent: '#2563eb',
  },
  {
    key: 'claim',
    title: 'Claim the land inside it',
    body:
      'Whatever ground your loop encloses becomes your territory. Bigger loops, bigger land.',
    accent: '#16a34a',
  },
  {
    key: 'compete',
    title: 'Steal it from rivals',
    body:
      'Run over someone else’s territory and the overlap becomes yours. Singapore is divided into 4 teams — pick your side.',
    accent: '#9333ea',
  },
  {
    key: 'permission',
    title: 'We need GPS',
    body:
      'Territory Run only works while tracking your run. We never share your location and you can revoke permission anytime.',
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

// Step 2: the loop fills in with claimed land, pulsing.
function IllustrationClaim({ accent }) {
  const fill = useRef(new Animated.Value(0)).current;
  const R = 78;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(fill, {
          toValue: 1,
          duration: 1100,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(700),
        Animated.timing(fill, {
          toValue: 0,
          duration: 450,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(250),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [fill]);

  const scale = fill.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] });
  const opacity = fill.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] });
  const D = R * 2;

  return (
    <View style={styles.illo}>
      <Animated.View
        style={{
          position: 'absolute',
          width: D,
          height: D,
          borderRadius: R,
          backgroundColor: accent,
          opacity,
          transform: [{ scale }],
        }}
      />
      <Svg width={BOX} height={BOX}>
        <Circle cx={BOX / 2} cy={BOX / 2} r={R} stroke={accent} strokeWidth={4} fill="none" />
      </Svg>
    </View>
  );
}

// Step 3: two overlapping territories; the captured overlap flips to your colour.
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

// Step 4: a location pin with expanding radar pulses.
function IllustrationGps({ accent }) {
  const r0 = useRef(new Animated.Value(0)).current;
  const r1 = useRef(new Animated.Value(0)).current;
  const r2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, {
            toValue: 1,
            duration: 2000,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
    const anims = [make(r0, 0), make(r1, 650), make(r2, 1300)];
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [r0, r1, r2]);

  const ring = (v) => ({
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: accent,
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 2.2] }) }],
  });

  return (
    <View style={styles.illo}>
      <Animated.View style={ring(r0)} />
      <Animated.View style={ring(r1)} />
      <Animated.View style={ring(r2)} />
      <Svg width={70} height={84} viewBox="0 0 24 28">
        <Path
          d="M12 0C6.5 0 2 4.5 2 10c0 7 10 18 10 18s10-11 10-18C22 4.5 17.5 0 12 0z"
          fill={accent}
        />
        <Circle cx={12} cy={10} r={3.6} fill={colors.bg} />
      </Svg>
    </View>
  );
}

const ILLUSTRATIONS = {
  run: IllustrationLoop,
  claim: IllustrationClaim,
  compete: IllustrationSteal,
  permission: IllustrationGps,
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
