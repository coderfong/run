// Home — PACER header, season carousel and shortcuts form the scrollable
// header above run cards. Pulling back to the top reveals them again.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from '../ui/image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { brand, radius, space, toon, useTheme, useThemedType, useThemedStyles } from '../theme';
import { useReduceMotion, PressableScale } from '../ui/motion';
import { EmptyState, OutlinedText, Skeleton } from '../components/ui';
import FeedCard from '../components/FeedCard';
import EnergyMeter from '../components/EnergyMeter';
import BuyEnergySheet from '../components/BuyEnergySheet';
import SideRail from '../components/SideRail';
import { useAvatar } from '../state/avatar';
import { useAccent } from '../hooks/useAccent';
import {
  preloadScreenImages,
  preloadScreenImagesAfterInteractions,
} from '../config/screenAssets';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';

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

// A hero card: a SOLID flat brand-color panel (no photo, no dark scrim). The
// illustration sits on the right and melts into the panel via a same-color
// horizontal fade — so text lives on clean color, never fighting an image.
function HeroCard({ width, bg, art, artWidth = '52%', eyebrow, title, sub, cta, onPress, onPressIn }) {
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      style={{ width }}
      onPressIn={onPressIn}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[styles.hero, { backgroundColor: bg }]}>
        <View style={styles.heroText}>
          <View>
            <Text style={[type.labelSm, styles.heroEyebrow]}>{eyebrow}</Text>
            {/* one line always — "STANDINGS" is wider than the text column at 30pt */}
            <Text
              style={[type.display, styles.heroTitle]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              {title}
            </Text>
            <Text style={[type.bodySm, styles.heroSub]}>{sub}</Text>
          </View>
          <View style={styles.heroBtn}>
            <Text style={[type.buttonSm, { color: '#141414' }]}>{cta}</Text>
          </View>
        </View>
        {/* the transparent illustration, shown whole (contain) — no crop, no fade */}
        <Image source={art} style={[styles.heroImg, { width: artWidth }]} resizeMode="contain" />
      </View>
    </PressableScale>
  );
}

// Swipeable hero: Season → Clubs → Solo, each deep-linking into the standings.
function HeroCarousel({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const cardW = width - space.gutter * 2;
  const [page, setPage] = useState(0);
  const warmSeason = () => preloadScreenImages('Season');

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
        <HeroCard
          width={cardW}
          bg={brand.pink}
          art={require('../../assets/art/season-banner.png')}
          eyebrow={`SEASON ${SEASON_NO} · ${SEASON_CITY}`}
          title="STANDINGS"
          sub={countdown()}
          cta="View season"
          onPressIn={warmSeason}
          onPress={() => navigation.navigate('Season')}
        />
        <HeroCard
          width={cardW}
          bg={brand.purple}
          art={require('../../assets/art/card-clubs.png')}
          artWidth="69%"
          eyebrow="STANDINGS"
          title="CLUBS"
          sub="Who holds the most land"
          cta="View clubs"
          onPressIn={warmSeason}
          onPress={() => navigation.navigate('Season', { mode: 'clans' })}
        />
        <HeroCard
          width={cardW}
          bg={brand.teal}
          art={require('../../assets/art/card-solo.png')}
          eyebrow="LADDER"
          title="SOLO"
          sub="Climb without a club"
          cta="View solo"
          onPressIn={warmSeason}
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

function FeedList({ navigation, header }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const accent = useAccent();
  const reduce = useReduceMotion();
  // The first page comes from the cache, so coming back to Home shows the feed
  // you were just looking at instead of four skeletons and a round trip. Later
  // pages are deliberately NOT cached: they're append-only scroll state, and
  // restoring page 5 of a feed you scrolled yesterday is not what you want.
  const { data, loading, refresh } = useQuery('feed', api.feed, {
    fallback: { items: [] },
  });
  const [more, setMore] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);
  // Only a PULL drives the spinner. `refreshing` from the query is also true
  // during the silent focus revalidation, and showing the wheel for that would
  // just be the old "always loading" look wearing a different hat.
  const [pulling, setPulling] = useState(false);
  const moreCursor = useRef(null);

  const items = useMemo(() => [...(data?.items || []), ...more], [data, more]);
  const cursor = more.length ? moreCursor.current : data?.next_cursor || null;

  // Warm the avatar layers, but never wait on them: a feed row is text and
  // numbers plus a portrait, and holding all four rows behind ~36 image decodes
  // is what made the skeletons sit there for seconds.
  useEffect(() => {
    if (items.length) preloadRunnerAssets(items);
  }, [items]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.feed(cursor);
      setMore((prev) => [...prev, ...(page.items || [])]);
      moreCursor.current = page.next_cursor || null;
    } catch {
    } finally {
      setLoadingMore(false);
    }
  };

  // Pull-to-refresh restarts paging — the extra pages hang off the OLD first
  // page, and appending them under a fresh one would duplicate rows.
  const onRefresh = async () => {
    setPulling(true);
    setMore([]);
    moreCursor.current = null;
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  };

  const rows = loading ? Array.from({ length: 4 }, (_, i) => ({ id: `skeleton-${i}` })) : items;
  // Exactly one card detonates on its own: the most recent run that actually
  // took land off somebody. Every other steal on the page sits settled until
  // it is tapped — twenty bombs going off down a scroll is not a payoff.
  const autoStealId = (loading ? null : rows.find((r) => r.victims?.length))?.id ?? null;

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: space.xxl, flexGrow: 1 }}
      data={rows}
      keyExtractor={(it) => it.id}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <View style={{ paddingHorizontal: space.gutter }}>
          <EmptyState
            art={require('../../assets/art/empty-runs.png')}
            title="Your feed is quiet"
            body="Start a run. The feed fills as you and your city claim land."
            actionLabel="Start run"
            onAction={() => navigation.navigate('Record')}
            accent={accent}
          />
        </View>
      }
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={accent} colors={[accent]} />}
      onEndReached={loading ? undefined : loadMore}
      onEndReachedThreshold={0.5}
      renderItem={({ item, index }) => (
        <View style={styles.feedRow}>
          {loading ? (
            <Skeleton width="100%" height={110} style={{ borderRadius: 16, marginBottom: space.md }} />
          ) : (
            <Animated.View entering={reduce ? undefined : FadeInDown.delay(Math.min(index, 12) * 30).duration(240)}>
              <FeedCard
                item={item}
                navigation={navigation}
                autoPlaySteal={item.id === autoStealId}
              />
            </Animated.View>
          )}
        </View>
      )}
    />
  );
}

export default function HomeScreen({ navigation }) {
  const { colors, scheme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // The wordmark is a sticker: a fill with a hard outline around it. In light
  // mode the old fixed white fill left only the black outline to carry the
  // letters against a near-white page, so the word all but vanished. The
  // sticker flips instead — ink letters, white outline.
  const wordmarkOutline = scheme === 'light' ? '#ffffff' : toon.ink;
  const insets = useSafeAreaInsets();
  const { refreshRank } = useAvatar();
  const [shopOpen, setShopOpen] = useState(false);

  // Both of these used to arrive a round trip after the header drew, so the
  // energy meter and the bell's unread dot popped in a beat late on every
  // visit. Seeded from cache, they are simply there.
  const { data: energy, refresh: reloadEnergy } = useQuery('me:energy', api.energyStatus);
  const { data: notifs, setData: setNotifs } = useQuery('notifications', api.notifications, {
    fallback: { unread: 0, items: [] },
  });
  const unread = notifs?.unread || 0;

  useEffect(
    () => preloadScreenImagesAfterInteractions([
      'Season',
      'Progression',
      'Shop',
      'Record',
      'Rivals',
      'Crossroads',
      'Notifications',
      'Leaderboard',
      'SharedIcons',
    ]),
    []
  );

  useFocusEffect(
    useCallback(() => {
      // Energy and notifications refresh themselves on focus (useQuery). What
      // is left here is the avatar tier: portrait frames all over the app draw
      // it from the avatar context, and it is only fetched at sign-in. Rank
      // moves mid-session, so Home — the screen you always come back to — is
      // where it gets refreshed. (This used to live in the rivalry card that
      // sat here; the card moved to the Rivals page, the refresh must not.)
      refreshRank?.();
    }, [refreshRank])
  );

  const feedHeader = (
    <View style={styles.feedHeader}>
      <View style={styles.header}>
        <OutlinedText style={styles.wordmark} outline={wordmarkOutline} width={2.5} align="left">
          {brand.name}
        </OutlinedText>
        <View style={styles.headerRight}>
          {energy && (
            <EnergyMeter
              compact
              status={energy}
              onPress={() => setShopOpen(true)}
              style={styles.headerEnergy}
            />
          )}
          <PressableScale
            style={styles.bell}
            onPress={() => {
              // Clear the dot in the cache too, so coming back to Home doesn't
              // briefly show a badge for notifications already read.
              setNotifs((prev) => ({ ...(prev || {}), unread: 0 }));
              navigation.navigate('Notifications');
            }}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <AppIcon name="bell" size={24} />
            {unread > 0 && <View style={[styles.bellDot, { backgroundColor: brand.pink }]} />}
          </PressableScale>
        </View>
      </View>

      <HeroCarousel navigation={navigation} />

      {/* These shortcuts replace the redundant Feed/Leaderboard switch and
          scroll away with the season card instead of covering run cards. */}
      <SideRail
        inline
        navigation={navigation}
        onOpenShop={() => navigation.navigate('Shop')}
        style={styles.shortcutRow}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <FeedList navigation={navigation} header={feedHeader} />
      <BuyEnergySheet visible={shopOpen} onClose={() => setShopOpen(false)} onPurchased={reloadEnergy} />
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  feedHeader: { paddingHorizontal: space.gutter, paddingTop: space.sm },
  feedRow: { paddingHorizontal: space.gutter },
  shortcutRow: { marginTop: space.lg, marginBottom: space.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // A minimum gap, not just space-between: the energy meter grows to fill
    // whatever is left, so on a full bar it ran right up against the wordmark.
    gap: space.md,
    marginBottom: space.md,
  },
  // Paired with the outline flip in HomeScreen: ink on light, white on dark.
  wordmark: { ...type.title, color: scheme === 'light' ? toon.ink : '#ffffff' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 },
  headerEnergy: { flexShrink: 1 },
  bell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  bellDot: { position: 'absolute', top: 7, right: 8, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: colors.bg },

  // The art is ~square, so with resizeMode="contain" its size is capped by the
  // card HEIGHT, not the art box's width — past ~65% width a wider box gains
  // nothing and only starves the text. Height is the lever that actually works;
  // the tighter padding buys back the text column that the wider art costs.
  // The hero panels are saturated brand colour in BOTH themes, so they take a
  // hard ink outline either way (unlike neutral cards — see toonSurface).
  hero: {
    height: 190,
    borderRadius: radius.lg,
    borderWidth: 2.5,
    borderColor: toon.ink,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: space.md,
  },
  heroText: { flex: 1, justifyContent: 'space-between', paddingRight: space.sm },
  // bleed to the card edges (negative margins cancel the card padding) so the
  // illustration is as large as possible.
  heroImg: { height: 190, marginVertical: -space.md, marginRight: -space.md },
  heroEyebrow: { color: '#141414', opacity: 0.75 },
  heroTitle: { color: '#141414', marginTop: 2 },
  heroSub: { color: '#141414', opacity: 0.72, marginTop: 4 },
  heroBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: toon.ink,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    marginTop: space.xs,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: space.md },
  dot: { height: 6, borderRadius: 3 },
  dotOn: { width: 18, backgroundColor: brand.pink },
  dotOff: { width: 6, backgroundColor: colors.border },
});
