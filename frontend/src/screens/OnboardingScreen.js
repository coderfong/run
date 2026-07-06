// PACER onboarding — three full-bleed art slides (assets/art/*):
// 1 the loop mechanic · 2 clans + defending land · 3 the safety contract.
// Top: "1 / 3" + Skip. Bottom: dots + circular next (slide 3: gradient CTA).

import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  ImageBackground,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Flag, Route, ShieldCheck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { brand, colors, radius, space, type } from '../theme';
import { PressableScale, haptic } from '../ui/motion';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    key: 'loop',
    art: require('../../assets/art/onboarding-loop.png'),
    headline: ['Run.', 'Close the loop.'],
    accentLine: 'Claim the land.',
    accent: brand.pink,
    body: 'Close a loop anywhere in the real world to capture territory for your clan.',
  },
  {
    key: 'clans',
    art: require('../../assets/art/onboarding-clans.png'),
    headline: ['Clans fight.'],
    accentLine: 'Defend your land.',
    accent: brand.purple,
    body: 'Other clans will try to take over your territory. Hold it together.',
  },
  {
    key: 'safety',
    art: require('../../assets/art/onboarding-safety.png'),
    headline: ['Territory can wait.'],
    accentLine: "Traffic can't.",
    accent: brand.teal,
    body: 'Run smart and come back strong.',
    bullets: [
      { icon: ShieldCheck, title: 'Stay alert', body: 'Eyes up at crossings — a loop is never worth a red light.' },
      { icon: Route, title: 'Use safe routes', body: 'Pick paths and park connectors over traffic.' },
      { icon: Flag, title: 'Follow the rules', body: 'Captures are validated server-side. No prize for cutting corners.' },
    ],
  },
];

function Slide({ item, insets, index, onNext, onDone, last }) {
  return (
    <ImageBackground source={item.art} style={{ width, flex: 1 }} resizeMode="cover">
      <LinearGradient
        colors={['rgba(11,13,16,0.72)', 'rgba(11,13,16,0.05)', 'rgba(11,13,16,0.88)']}
        locations={[0, 0.42, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.slideInner, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xl }]}>
        {/* headline block */}
        <View style={{ marginTop: space.xl }}>
          {item.headline.map((line) => (
            <Text key={line} style={styles.headline}>{line}</Text>
          ))}
          <Text style={[styles.headline, { color: item.accent }]}>{item.accentLine}</Text>
        </View>

        {/* lower block */}
        <View>
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
        </View>
      </View>
    </ImageBackground>
  );
}

export default function OnboardingScreen({ onDone }) {
  const insets = useSafeAreaInsets();
  const listRef = useRef(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  const finish = () => { haptic.light(); onDone?.(); };
  const next = () => {
    if (last) return finish();
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item, index: i }) => (
          <Slide item={item} insets={insets} index={i} last={i === SLIDES.length - 1} onNext={next} onDone={finish} />
        )}
      />

      {/* top chrome: progress + skip */}
      <View style={[styles.topBar, { top: insets.top + space.sm }]}>
        <Text style={styles.progress}>
          <Text style={{ color: SLIDES[index].accent }}>{index + 1}</Text> / {SLIDES.length}
        </Text>
        <TouchableOpacity onPress={finish} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip intro">
          <Text style={[type.bodyMedium, { color: 'rgba(255,255,255,0.8)' }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* bottom chrome: dots + next (hidden on the CTA slide) */}
      <View style={[styles.bottomBar, { bottom: insets.bottom + space.xl }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View
              key={s.key}
              style={[styles.dot, i === index && { backgroundColor: SLIDES[index].accent, width: 8 }]}
            />
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
      </View>
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
    marginBottom: 76, // clears the bottom chrome
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
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
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
