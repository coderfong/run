// Home — PACER header, season carousel and shortcuts form the scrollable
// header above run cards. Pulling back to the top reveals them again.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from '../ui/image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import {
  NB,
  brand,
  hardShadow,
  nbDrop,
  nbInk,
  radius,
  space,
  toon,
  useTheme,
  useThemedType,
  useThemedStyles,
} from '../theme';
import { useReduceMotion, PressableScale, PressableShift } from '../ui/motion';
import { EmptyState, Framed, OutlinedText, Skeleton } from '../components/ui';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import FeedCard from '../components/FeedCard';
import EnergyMeter from '../components/EnergyMeter';
import BuyEnergySheet from '../components/BuyEnergySheet';
import SideRail from '../components/SideRail';
import ProHomeCard from '../components/ProHomeCard';
import { useAvatar } from '../state/avatar';
import { useAccent } from '../hooks/useAccent';
import {
  preloadScreenImages,
  preloadScreenImagesAfterInteractions,
} from '../config/screenAssets';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';
import { EVENTS, track } from '../analytics';
import { GOLD } from '../config/pro';
import { HOME_AUTO_PROMPT_DELAY_MS } from '../config/proExposure';
import { IAP_ENABLED } from '../config/releaseFeatures';
import { useProEntitlement } from '../pro/ProProvider';

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
      {/* `weight` in points, so the hero's line is the same pen as the chip
          inside it and as the buttons further down the page. Drawn at the art's
          own size — which is what this used to do — the banner is a 370px
          drawing with a 19px stroke, so a full width hero wore a 19pt line, the
          corner bands swallowed a third of the card, and the eyebrow's first
          letters sat underneath the ink. */}
      <Framed
        frame={frameVariant('featured', `${eyebrow}:${title}`)}
        tint={toon.ink}
        fill={bg}
        weight={INK.bold}
        pose={framePose(`${eyebrow}:${title}`)}
        inset={false}
        style={styles.hero}
        contentStyle={styles.heroContent}
      >
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
          <Framed
            frame={frameVariant('chip', cta)}
            tint={toon.ink}
            fill="#ffffff"
            weight={INK.thin}
            pose={framePose(cta)}
            inset={false}
            style={styles.heroBtn}
            contentStyle={styles.heroBtnContent}
          >
            <Text style={[type.buttonSm, { color: '#141414' }]}>{cta}</Text>
          </Framed>
        </View>
        {/* the transparent illustration, shown whole (contain) — no crop, no fade */}
        <Image source={art} style={[styles.heroImg, { width: artWidth }]} resizeMode="contain" />
      </Framed>
    </PressableScale>
  );
}

// Swipeable hero: Season → Clubs → Solo → PRO, each deep-linking somewhere.
//
// THE PRO SLIDE IS LAST, AND IT IS A SLIDE. Home's other PRO surface (the card
// partway down the feed) only appears after three finished runs, which left a
// new account with no route to the paywall from the app's main screen at all.
// This one is always there for anybody who could subscribe — but it is the
// fourth card in a carousel that opens on the season, so it costs nothing to
// anybody who does not swipe to it and covers nothing on the way past.
//
// A subscriber never sees it: `canShowPro && !isPro`, the same pair every other
// marketing surface asks (src/pro/storeAvailable.js).
function HeroCarousel({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const cardW = width - space.gutter * 2;
  const [page, setPage] = useState(0);
  const warmSeason = () => preloadScreenImages('Season');
  const { isPro, canShowPro, openPaywall } = useProEntitlement();
  const showPro = canShowPro && !isPro;
  const pages = showPro ? 4 : 3;
  const proPage = 3;
  const proSeen = useRef(false);

  const onEnd = (e) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / cardW);
    if (i !== page) setPage(i);
  };

  // Counted when it is SWIPED TO, not when it mounts. Every one of these cards
  // is mounted from the first frame; firing on mount would report an
  // impression for a card three screens off to the right that nobody ever saw,
  // and the conversion rate underneath it would be nonsense.
  useEffect(() => {
    if (!showPro || page !== proPage || proSeen.current) return;
    proSeen.current = true;
    track(EVENTS.TEASER_IMPRESSION, { source: 'home', context: 'home', feature: 'home_hero' });
  }, [page, showPro]);

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
        {showPro ? (
          <HeroCard
            width={cardW}
            bg={GOLD}
            art={require('../../assets/art/onboarding/pro-hero.png')}
            eyebrow="PASER PRO"
            title="GO PRO"
            sub="Strategy · Insights · Exclusive styles"
            cta="See the plans"
            onPress={() => {
              track(EVENTS.TEASER_TAP, { source: 'home', context: 'home', feature: 'home_hero' });
              openPaywall('home');
            }}
          />
        ) : null}
      </ScrollView>
      <View style={styles.dots}>
        {Array.from({ length: pages }, (_, i) => (
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
  // One focus subscription for the feed, passed down as a primitive. The tab
  // stays mounted, but every open reaction picker should close when it leaves.
  const screenFocused = useIsFocused();
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
            // Matches the card it stands in for: the feed card's radius comes
            // from the limited scale now, and the literal 16 that used to be
            // here left the placeholder visibly rounder than its replacement.
            <Skeleton width="100%" height={110} style={{ borderRadius: radius.card, marginBottom: space.md }} />
          ) : (
            <Animated.View entering={reduce ? undefined : FadeInDown.delay(Math.min(index, 12) * 30).duration(240)}>
              <FeedCard
                item={item}
                navigation={navigation}
                autoPlaySteal={item.id === autoStealId}
                screenFocused={screenFocused}
              />
            </Animated.View>
          )}
          {/* PASER PRO, partway down the feed rather than above it. Renders
              nothing at all for a subscriber, for anybody under three finished
              runs, or while the store is off — see ProHomeCard's own header
              for why each of those is a rule. Placed AFTER the third card so
              it is below real content on any screen size.
              `min(2, last)` rather than a flat 2: a feed with one or two cards
              in it never reached index 2, so the card silently did not exist
              on exactly the accounts a quiet feed describes. It still lands
              after real content, just after less of it. */}
          {index === Math.min(2, rows.length - 1) && !loading ? <ProHomeCard /> : null}
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
  // The header sits directly on the page, so its strokes are judged against the
  // page rather than against a card. Both the bell box and its unread dot take
  // this, so the dot reads as punched out of the same sheet of ink.
  const headerInk = nbInk(scheme, colors.bg);
  const bellShadow = hardShadow(nbDrop(scheme, { on: colors.bg }), NB.offsetSm);
  const insets = useSafeAreaInsets();
  const { refreshRank } = useAvatar();
  const [shopOpen, setShopOpen] = useState(false);
  const { openPaywall, runCount } = useProEntitlement();
  // Once per app launch. Home stays mounted behind the other tabs, so this ref
  // outlives every tab switch — which is what makes it a launch guard rather
  // than a screen one.
  const promptedRef = useRef(false);

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

  // PASER's one prompt that nobody asked for.
  //
  // Home is where a returning runner lands, and it is the only place in the
  // app where PRO can be raised outside a run's own aftermath. Everything that
  // decides whether it is ALLOWED lives in the exposure rules, not here:
  // `automatic: true` sends this through `canShowAuto`, which refuses for
  // anybody under three finished runs, for the second time in a session, for
  // twenty hours after the last one, and for good once it has been dismissed
  // twice. A refusal is recorded in the funnel with its reason, so a quiet
  // prompt can be explained rather than guessed at.
  //
  // The ref makes it once per app launch even if the rules would allow more,
  // and it is deliberately NOT set until the timer actually runs: leaving Home
  // in the first couple of seconds cancels the prompt rather than spending it.
  //
  // WAITING FOR `runCount` IS THE POINT OF THE GUARD, not a nicety. The rules
  // treat an unknown run count as not eligible, so on a cold start where
  // /me/stats has not landed yet this would fire, be refused as `runs_unknown`
  // and burn its one shot for the launch — a prompt that only ever appeared on
  // a warm start, for no reason anybody would ever find. Not scheduling until
  // the number exists means the timer starts when the answer can be real; the
  // effect re-runs on its own when it arrives.
  useFocusEffect(
    useCallback(() => {
      if (promptedRef.current || runCount == null) return undefined;
      const timer = setTimeout(() => {
        promptedRef.current = true;
        openPaywall('home', { automatic: true });
      }, HOME_AUTO_PROMPT_DELAY_MS);
      return () => clearTimeout(timer);
    }, [openPaywall, runCount])
  );

  const feedHeader = (
    <View style={styles.feedHeader}>
      <View style={styles.header}>
        {/* Outline width taken from the token rather than a literal 2.5, so the
            wordmark, the bell box beside it and the buttons down the page are
            all drawn with one pen. */}
        <OutlinedText style={styles.wordmark} outline={wordmarkOutline} width={NB.stroke} align="left">
          {brand.name}
        </OutlinedText>
        <View style={styles.headerRight}>
          {energy && (
            <EnergyMeter
              compact
              status={energy}
              onPress={IAP_ENABLED ? () => setShopOpen(true) : undefined}
              style={styles.headerEnergy}
            />
          )}
          {/* A stroked box, not a bare glyph. The bell used to be the only
              tappable thing in the header with no edge on it, which next to a
              stroked energy chip read as decoration rather than as a control —
              and it is the one that takes you somewhere. */}
          <PressableShift
            offset={NB.offsetSm}
            style={[styles.bell, { borderColor: headerInk }]}
            containerStyle={bellShadow}
            onPress={() => {
              // Clear the dot in the cache too, so coming back to Home doesn't
              // briefly show a badge for notifications already read.
              setNotifs((prev) => ({ ...(prev || {}), unread: 0 }));
              navigation.navigate('Notifications');
            }}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <AppIcon name="bell" size={22} />
            {unread > 0 && <View style={[styles.bellDot, { backgroundColor: brand.pink, borderColor: headerInk }]} />}
          </PressableShift>
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
      {IAP_ENABLED ? (
        <BuyEnergySheet visible={shopOpen} onClose={() => setShopOpen(false)} onPurchased={reloadEnergy} />
      ) : null}
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
  bell: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    borderWidth: NB.strokeThin,
  },
  // Nudged inside the box's stroke rather than hanging over the old bare icon's
  // corner. Its ring is the header ink now, not the page colour: a dot ringed in
  // `bg` sitting on a card-coloured box punched a hole in the box.
  bellDot: { position: 'absolute', top: 4, right: 4, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },

  // The art is ~square, so with resizeMode="contain" its size is capped by the
  // card HEIGHT, not the art box's width — past ~65% width a wider box gains
  // nothing and only starves the text. Height is the lever that actually works;
  // the tighter padding buys back the text column that the wider art costs.
  // The hero panels are saturated brand colour in BOTH themes, so they take a
  // hard ink outline either way (unlike neutral cards — see toonSurface).
  hero: {
    height: 190,
  },
  heroContent: {
    flex: 1,
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
    marginTop: space.xs,
  },
  heroBtnContent: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  // Pagination as flat blocks with an edge, per the reference system sheet —
  // the current page is a long pink bar, the others are small hollow squares.
  // They were a pink lozenge next to two dots in `colors.border`, which on the
  // paper page is a warm hairline grey: the inactive pages read as smudges.
  // SQUARE, not round. These sit directly under the hero, which is the most
  // hand-drawn thing on the screen, and a hard-edged row of blocks under a
  // wobbly ink box is the contrast the whole style runs on.
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: space.md },
  dot: { height: 8, borderRadius: 0, borderWidth: 1.5, borderColor: nbInk(scheme, colors.bg) },
  dotOn: { width: 22, backgroundColor: brand.pink },
  dotOff: { width: 8, backgroundColor: 'transparent' },
});
