import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { colors, font, radius, space } from '../theme';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    key: 'run',
    title: 'Run a closed loop',
    body:
      'Trace any path you want. The moment your route closes back near where you started, you complete a loop.',
    accent: '#c5fc4b',
  },
  {
    key: 'claim',
    title: 'Claim the land inside it',
    body:
      'Whatever ground your loop encloses becomes your territory. Bigger loops, bigger land.',
    accent: '#22c55e',
  },
  {
    key: 'compete',
    title: 'Steal it from rivals',
    body:
      'Run over someone else’s territory and the overlap becomes yours. Singapore is divided into 5 teams — pick your side.',
    accent: '#a855f7',
  },
  {
    key: 'permission',
    title: 'We need GPS',
    body:
      'Territory Run only works while tracking your run. We never share your location and you can revoke permission anytime.',
    accent: '#3b82f6',
  },
];

export default function OnboardingScreen({ onDone }) {
  const ref = useRef(null);
  const [index, setIndex] = useState(0);

  const finish = async () => {
    try {
      await AsyncStorage.setItem('tr.onboardingDone', '1');
    } catch {}
    onDone?.();
  };

  const next = () => {
    if (index < SLIDES.length - 1) {
      ref.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      finish();
    }
  };

  const onMomentumEnd = (e) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setIndex(i);
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={ref}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <View
              style={[
                styles.iconBlob,
                { backgroundColor: item.accent + '33', borderColor: item.accent },
              ]}
            >
              <View
                style={[styles.iconCore, { backgroundColor: item.accent }]}
              />
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <TouchableOpacity onPress={finish}>
          <Text style={styles.skip}>Skip</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.cta}
          activeOpacity={0.85}
          onPress={next}
        >
          <Text style={styles.ctaText}>
            {index === SLIDES.length - 1 ? "Let's go" : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  slide: {
    width,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl + 32,
    alignItems: 'center',
  },
  iconBlob: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xl,
  },
  iconCore: { width: 48, height: 48, borderRadius: 24 },
  title: {
    ...font.hero,
    textAlign: 'center',
    marginBottom: space.md,
  },
  body: {
    color: colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: space.md,
  },

  dots: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginVertical: space.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },
  dotActive: { backgroundColor: colors.primary, width: 22 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xl,
    paddingBottom: space.xxl,
  },
  skip: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  cta: {
    backgroundColor: colors.primary,
    paddingHorizontal: space.xl,
    paddingVertical: 14,
    borderRadius: radius.pill,
  },
  ctaText: { color: colors.primaryInk, fontWeight: '800', fontSize: 15 },
});
