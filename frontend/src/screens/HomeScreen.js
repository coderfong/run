// Home — PACER header (wordmark + bell), the season banner card over the
// Marina Bay art, then [Feed | Leaderboard].

import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, ImageBackground, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Bell, Footprints } from 'lucide-react-native';

import { api } from '../api/client';
import { brand, colors, radius, space, type } from '../theme';
import { useReduceMotion, PressableScale } from '../ui/motion';
import { Segmented, EmptyState, Skeleton } from '../components/ui';
import FeedCard from '../components/FeedCard';
import LeaderboardView from '../components/LeaderboardView';
import { useAccent } from '../hooks/useAccent';

// Season window (matches the seeded Season 1; Phase-next: read from the API).
const SEASON_NO = '01';
const SEASON_CITY = 'SINGAPORE';
const SEASON_END = new Date('2026-10-04T00:00:00Z');

function countdown() {
  const ms = Math.max(0, SEASON_END - Date.now());
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return `ENDS IN ${d}D ${String(h).padStart(2, '0')}H`;
}

// Shadow keeps the white copy legible now that the scrim is lighter.
const heroShadow = { textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 };

function SeasonCard({ width, onPress }) {
  return (
    <PressableScale style={{ width }} onPress={onPress} accessibilityRole="button" accessibilityLabel="View season standings">
      <ImageBackground
        source={require('../../assets/art/season-banner.png')}
        style={styles.hero}
        imageStyle={{ borderRadius: radius.card }}
        resizeMode="cover"
      >
        {/* lighter left-to-right scrim so the art reads through */}
        <LinearGradient
          colors={['rgba(11,13,16,0.55)', 'rgba(11,13,16,0.05)']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.card }]}
        />
        <View style={styles.heroInner}>
          <View>
            <Text style={[type.labelSm, { color: 'rgba(255,255,255,0.9)' }, heroShadow]}>Season {SEASON_NO}</Text>
            <Text style={[type.display, { color: '#fff', marginTop: 2 }, heroShadow]}>{SEASON_CITY}</Text>
            <Text style={[type.labelSm, { color: '#fff', marginTop: 4 }, heroShadow]}>{countdown()}</Text>
          </View>
          <View style={[styles.heroChip, { backgroundColor: brand.pink }]}>
            <Text style={[type.buttonSm, { color: '#fff' }]}>View season</Text>
          </View>
        </View>
      </ImageBackground>
    </PressableScale>
  );
}

function GradientCard({ width, gradient, eyebrow, title, sub, chip, onPress }) {
  return (
    <PressableScale style={{ width }} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroInner}>
          <View>
            <Text style={[type.labelSm, { color: 'rgba(255,255,255,0.85)' }]}>{eyebrow}</Text>
            <Text style={[type.display, { color: '#fff', marginTop: 2 }]}>{title}</Text>
            <Text style={[type.bodySm, { color: 'rgba(255,255,255,0.9)', marginTop: 4 }]}>{sub}</Text>
          </View>
          <View style={[styles.heroChip, { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
            <Text style={[type.buttonSm, { color: '#fff' }]}>{chip}</Text>
          </View>
        </View>
      </LinearGradient>
    </PressableScale>
  );
}

// Swipeable hero: Season → Clans → Solo, each deep-linking into the standings.
function HeroCarousel({ navigation }) {
  const { width } = useWindowDimensions();
  const cardW = width - space.gutter * 2;
  const [page, setPage] = useState(0);

  const onEnd = (e) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / cardW);
    if (i !== page) setPage(i);
  };

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onEnd}
        decelerationRate="fast"
      >
        <SeasonCard width={cardW} onPress={() => navigation.navigate('Season')} />
        <GradientCard
          width={cardW}
          gradient={brand.gradient}
          eyebrow="STANDINGS"
          title="CLANS"
          sub="Who holds the most land"
          chip="View clans"
          onPress={() => navigation.navigate('Season', { mode: 'clans' })}
        />
        <GradientCard
          width={cardW}
          gradient={brand.gradientTeal}
          eyebrow="LADDER"
          title="SOLO"
          sub="Climb without a clan"
          chip="View solo"
          onPress={() => navigation.navigate('Season', { mode: 'solo' })}
        />
      </ScrollView>
      <View style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.dot, i === page ? styles.dotOn : styles.dotOff]} />
        ))}
      </View>
    </View>
  );
}

function FeedList({ navigation }) {
  const accent = useAccent();
  const reduce = useReduceMotion();
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await api.feed();
      setItems(data.items || []);
      setCursor(data.next_cursor || null);
    } catch {
      setItems((prev) => prev || []);
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.feed(cursor);
      setItems((prev) => [...(prev || []), ...(data.items || [])]);
      setCursor(data.next_cursor || null);
    } catch {
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  if (!items) {
    return (
      <View style={{ paddingHorizontal: space.gutter, paddingTop: space.md }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={110} style={{ borderRadius: 16, marginBottom: space.md }} />
        ))}
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Footprints size={40} color={accent} />}
        title="Your feed is quiet"
        body="Start a run — the feed fills as you and your city claim land."
        actionLabel="Start run"
        onAction={() => navigation.navigate('Record')}
        accent={accent}
      />
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.xxl }}
      data={items}
      keyExtractor={(it) => it.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={accent} colors={[accent]} />}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      renderItem={({ item, index }) => (
        <Animated.View entering={reduce ? undefined : FadeInDown.delay(Math.min(index, 12) * 30).duration(240)}>
          <FeedCard item={item} navigation={navigation} />
        </Animated.View>
      )}
    />
  );
}

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('feed');
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      api.notifications().then((d) => setUnread(d.unread || 0)).catch(() => {});
    }, [])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: space.sm }}>
        {/* header: wordmark + bell */}
        <View style={styles.header}>
          <Text style={styles.wordmark}>{brand.name}</Text>
          <PressableScale
            style={styles.bell}
            onPress={() => { setUnread(0); navigation.navigate('Notifications'); }}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Bell size={22} color={colors.text} strokeWidth={2} />
            {unread > 0 && <View style={[styles.bellDot, { backgroundColor: brand.pink }]} />}
          </PressableScale>
        </View>

        <HeroCarousel navigation={navigation} />
        <Segmented
          options={[{ key: 'feed', label: 'Feed' }, { key: 'leaderboard', label: 'Leaderboard' }]}
          value={tab}
          onChange={setTab}
          style={{ marginTop: space.lg, marginBottom: space.xs }}
        />
      </View>
      {tab === 'feed' ? <FeedList navigation={navigation} /> : <LeaderboardView />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  wordmark: { ...type.title, transform: [{ skewX: '-6deg' }] },
  bell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  bellDot: { position: 'absolute', top: 7, right: 8, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: colors.bg },

  hero: { height: 150, borderRadius: radius.card, overflow: 'hidden' },
  heroInner: { padding: space.lg, flex: 1, justifyContent: 'space-between' },
  heroChip: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: space.md },
  dot: { height: 6, borderRadius: 3 },
  dotOn: { width: 18, backgroundColor: brand.pink },
  dotOff: { width: 6, backgroundColor: colors.border },
});
