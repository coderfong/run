// Home — PACER header (wordmark + bell), the season banner card over the
// Marina Bay art, then [Feed | Leaderboard].

import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { brand, radius, space, toon, useTheme, useThemedType, useThemedStyles } from '../theme';
import { useReduceMotion, PressableScale } from '../ui/motion';
import { Segmented, EmptyState, OutlinedText, Skeleton } from '../components/ui';
import FeedCard from '../components/FeedCard';
import LeaderboardView from '../components/LeaderboardView';
import EnergyMeter from '../components/EnergyMeter';
import BuyEnergySheet from '../components/BuyEnergySheet';
import RivalCard from '../components/RivalCard';
import SideRail from '../components/SideRail';
import { art } from '../config/onboardingArt';
import { useAvatar } from '../state/avatar';
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

// The same clock, short enough for a rail tile ("6d 15h").
function seasonShort() {
  const ms = Math.max(0, SEASON_END - Date.now());
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

// A hero card: a SOLID flat brand-color panel (no photo, no dark scrim). The
// illustration sits on the right and melts into the panel via a same-color
// horizontal fade — so text lives on clean color, never fighting an image.
function HeroCard({ width, bg, art, artWidth = '52%', eyebrow, title, sub, cta, onPress }) {
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale style={{ width }} onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
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

// A rivalry that moved recently outranks everything else on Home — it's the
// one thing here with a name attached and a verb to answer it with. Only
// shown while the beat is fresh; a two-week-old steal is history, not a hook.
const RIVAL_ALERT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function RivalAlert({ navigation, onShown }) {
  const { equipped } = useAvatar();
  const [rival, setRival] = useState(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api
        .rivals(5)
        .then((d) => {
          if (!alive) return;
          const fresh = (d.rivals || []).find((r) => {
            const e = r.last_event;
            if (!e) return false;
            const at = new Date(e.at.endsWith('Z') ? e.at : `${e.at}Z`).getTime();
            return Date.now() - at < RIVAL_ALERT_MAX_AGE_MS;
          });
          setRival(fresh || null);
          onShown?.(!!fresh);
        })
        .catch(() => {});
      return () => { alive = false; };
    }, [onShown])
  );

  if (!rival) return null;
  return (
    <RivalCard
      rival={rival}
      myAvatar={equipped}
      compact
      style={{ marginBottom: space.md }}
      onPress={() => navigation.navigate('You', { screen: 'Rivals' })}
      onTakeBack={() => navigation.navigate('Record')}
      onViewLand={
        rival.last_event?.lat != null
          ? () =>
              navigation.navigate('Map', {
                screen: 'MapMain',
                params: { focus: { lat: rival.last_event.lat, lon: rival.last_event.lon } },
              })
          : undefined
      }
    />
  );
}

function FeedList({ navigation }) {
  const { colors } = useTheme();
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
        art={require('../../assets/art/empty-runs.png')}
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
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('feed');
  const [unread, setUnread] = useState(0);
  const [energy, setEnergy] = useState(null);
  const [shopOpen, setShopOpen] = useState(false);

  const loadEnergy = useCallback(() => {
    api.energyStatus().then(setEnergy).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      api.notifications().then((d) => setUnread(d.unread || 0)).catch(() => {});
      loadEnergy();
    }, [loadEnergy])
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: space.sm }}>
        {/* header: wordmark + energy + bell */}
        <View style={styles.header}>
          <OutlinedText style={styles.wordmark} outline={toon.ink} width={2.5} align="left">
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
              onPress={() => { setUnread(0); navigation.navigate('Notifications'); }}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <AppIcon name="bell" size={24} />
              {unread > 0 && <View style={[styles.bellDot, { backgroundColor: brand.pink }]} />}
            </PressableScale>
          </View>
        </View>

        {/* A live rivalry beats the onboarding checklist for attention — and
            the two never really overlap anyway (you can't have rivals before
            your first claim). */}
        <RivalAlert navigation={navigation} />
        <HeroCarousel navigation={navigation} />
        <Segmented
          options={[{ key: 'feed', label: 'Feed' }, { key: 'leaderboard', label: 'Leaderboard' }]}
          value={tab}
          onChange={setTab}
          style={{ marginTop: space.lg, marginBottom: space.xs }}
        />
      </View>
      {tab === 'feed' ? <FeedList navigation={navigation} /> : <LeaderboardView />}

      {/* floating shortcuts to where the economy lives — pass, boxes, shop,
          season. Absolute so it never steals width from the feed.
          The rail's Shop tile is the COSMETICS shop; energy top-ups stay on
          the energy meter itself (here, the result screen and profile). */}
      <SideRail
        navigation={navigation}
        seasonLabel={seasonShort()}
        onOpenShop={() => navigation.navigate('Shop')}
        style={{ top: insets.top + 96 }}
      />
      <BuyEnergySheet visible={shopOpen} onClose={() => setShopOpen(false)} onPurchased={loadEnergy} />
    </View>
  );
}

const makeStyles = (colors, _scheme, type) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  wordmark: { ...type.title, color: '#ffffff' },
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
