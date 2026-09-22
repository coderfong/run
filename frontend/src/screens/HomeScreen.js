// Home — PACER header, season carousel and shortcuts form the scrollable
// header above run cards. Pulling back to the top reveals them again.

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from '../ui/image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Animated, {
  cancelAnimation,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import {
  NB,
  brand,
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
import PendingClaimCard from '../components/claim/PendingClaimCard';
import { openClaims } from '../utils/claimWindow';
import HomeBackdrop from '../components/home/HomeBackdrop';
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
// The art box is sized to what the DRAWING needs, not to half the card. At
// height 190 the runner (430x640) comes out 128pt wide, so the old 52% box
// held 34pt of empty air on a 375pt phone — air the text column was short of,
// which is what drove the headline into `adjustsFontSizeToFit` in the first
// place. 44% is 137pt there and 130pt on a 360, both of which still show the
// drawing whole. The PRO card overrides it: its art is a 4:3 scene, not a
// figure, and it is width-limited rather than height-limited.
// Read as motion without new art: a small bob + lean loop on the same PNG.
const AnimatedImage = Animated.createAnimatedComponent(Image);

function RunningArt({ art, style }) {
  const reduced = useReduceMotion();
  const bob = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(bob);
      bob.value = 0;
      return undefined;
    }
    // A jog's cadence, not a spring — reverse:true makes withRepeat yo-yo
    // 0→1→0 forever, so this never settles the way a run-count-limited
    // repeat would.
    bob.value = withRepeat(withTiming(1, { duration: 220 }), -1, true);
    return () => cancelAnimation(bob);
  }, [reduced]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -bob.value * 5 },
      { rotate: `${(bob.value - 0.5) * 3}deg` },
    ],
  }));

  return <AnimatedImage source={art} style={[style, animatedStyle]} resizeMode="contain" />;
}

function HeroCard({ width, bg, art, artWidth = '44%', eyebrow, title, sub, cta, onPress, onPressIn, runLoop = false }) {
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
            {/* ONE SIZE ON EVERY CARD. `adjustsFontSizeToFit` picks a size per
                Text, so the carousel used to run 30pt, 18pt and 30pt across its
                three headlines and the type jumped as you swiped — and the
                middle one was clamped at the 0.6 floor while still overflowing
                its column, so it was a different size AND clipped. The titles
                are short enough now that 26pt fits the narrowest column the
                card ever has (see heroTitle); the shrink stays as a floor for
                phones under 360pt, where it costs a few points rather than a
                third of the headline. */}
            <Text
              style={[type.display, styles.heroTitle]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {title}
            </Text>
            {sub ? <Text style={[type.bodySm, styles.heroSub]}>{sub}</Text> : null}
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
        {runLoop ? (
          <RunningArt art={art} style={[styles.heroImg, { width: artWidth }]} />
        ) : (
          <Image source={art} style={[styles.heroImg, { width: artWidth }]} resizeMode="contain" />
        )}
      </Framed>
    </PressableScale>
  );
}

// Swipeable hero: start a run, leaderboards, then PRO when available.
function HeroCarousel({ navigation }) {
  const styles = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const cardW = width - space.gutter * 2;
  const [page, setPage] = useState(0);
  const warmSeason = () => preloadScreenImages('Season');
  const { isPro, canShowPro, openPaywall } = useProEntitlement();
  const showPro = canShowPro && !isPro;
  const pages = showPro ? 3 : 2;
  const proPage = 2;
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
          bg={brand.teal}
          art={require('../../assets/art/card-solo.png')}
          /* The eyebrow gives the REASON, the title is the hook, the button is
             the verb. It used to read "START A RUN TODAY" over a button that
             said "Start a run", so the card said the same sentence twice in two
             cases. Same rule on the two cards below it: the season card was
             "LEADERBOARDS" over "View leaderboards", and the PRO card was
             "PASER PRO" over "GO PRO".
             At labelSm's 12pt with 0.6 tracking this measures 161.8pt against a
             178pt column on a 375pt phone, so it holds one line. */
          eyebrow="THERE'S LAND TO CLAIM"
          title="LET'S RUN"
          cta="Start a run"
          runLoop
          onPressIn={() => preloadScreenImages('Record')}
          onPress={() => navigation.navigate('Record')}
        />
        <HeroCard
          width={cardW}
          bg={brand.pink}
          art={require('../../assets/art/season-banner.png')}
          eyebrow={`${SEASON_CITY} SEASON ${SEASON_NO}`}
          title="THE BOARD"
          sub={countdown()}
          cta="See the standings"
          onPressIn={warmSeason}
          onPress={() => navigation.navigate('Season')}
        />
        {showPro ? (
          <HeroCard
            width={cardW}
            bg={GOLD}
            art={require('../../assets/art/card-pro.png')}
            artWidth="66%"
            eyebrow="UPGRADE"
            title="GO PRO"
            sub="Strategy, insights and exclusive styles"
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

// How far down the feed the arrival animation reaches. Past this the cards are
// below the fold on every phone, so an entrance nobody sees costs a layout
// animation per row and nothing else.
const FIRST_PAGE_ANIMATED = 4;

// One row of the feed, memoised.
//
// FeedCard is the most expensive component in the app — 86 native views for an
// ordinary run — and without a memo every visible card re-rendered whenever the
// LIST re-rendered: a focus revalidation landing, a pull finishing, another
// page appending. None of those change a card that is already on screen, and
// all of them were paying for one.
//
// The comparison is field-by-field on the props that actually reach the card,
// rather than the default shallow one, because `item` is a fresh object every
// time the feed response is re-seeded from cache — identical content, new
// identity, which a shallow compare cannot tell from a real change.
const FeedRow = React.memo(
  function FeedRow({ item, index, navigation, visibility, animate }) {
    // This row's two answers from the feed's visibility store, read HERE so a
    // row scrolling in or out re-renders itself and nothing else.
    const id = item.id;
    const onScreen = useSyncExternalStore(visibility.subscribe, () => visibility.isOnScreen(id));
    const autoPlaySteal = useSyncExternalStore(visibility.subscribe, () => visibility.plays(id));
    const card = (
      <FeedCard
        item={item}
        navigation={navigation}
        autoPlaySteal={autoPlaySteal}
        onScreen={onScreen}
        index={index}
      />
    );
    if (!animate) return card;
    return (
      <Animated.View entering={FadeInDown.delay(index * 30).duration(240)}>
        {card}
      </Animated.View>
    );
  },
  (prev, next) =>
    prev.visibility === next.visibility &&
    prev.animate === next.animate &&
    prev.navigation === next.navigation &&
    sameRow(prev.item, next.item)
);

// WHICH FEED ROWS ARE ON SCREEN, held outside React state.
//
// Two things on a card want to know. A steal's heads sulk on an endless loop,
// and the list keeps two screens of rows mounted either side of the one being
// read, so most of the loops running on Home were on cards nobody could see.
// And exactly one steal per visit plays its detonation by itself, which is only
// worth doing where somebody is looking.
//
// Build 66 kept the visible ids in FeedList STATE and handed the list an
// `extraData`, so every row entering or leaving the viewport re-rendered the
// whole list, and "the first visible steal" moved as you scrolled: each steal
// you reached went off, scrolling back set it off again, and so did every
// return to Home. Here each row subscribes to its own two answers, a change
// re-renders only the rows whose answer changed, and the one autoplay is spent
// the first time it is used.
const AUTOPLAY_SPENT = {};

export function createFeedVisibility() {
  let onScreen = new Set();
  // Ids at least mostly on screen for a beat, in list order.
  let seen = [];
  // Ids of rows that took land off somebody.
  let steals = new Set();
  // The one row allowed to detonate by itself, then AUTOPLAY_SPENT for good.
  let autoPlay = null;
  // Home is the screen in front, motion is allowed, and the feed has landed.
  let allowed = false;
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener());

  const latch = () => {
    if (autoPlay !== null || !allowed) return;
    const id = seen.find((candidate) => steals.has(candidate));
    if (id === undefined) return;
    autoPlay = id;
    emit();
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isOnScreen: (id) => onScreen.has(id),
    plays: (id) => autoPlay === id,
    setOnScreen: (ids) => {
      const next = new Set(ids);
      if (next.size === onScreen.size && [...next].every((id) => onScreen.has(id))) return;
      onScreen = next;
      // Scrolled away, the detonation is spent: coming back to that card
      // later shows the settled bar, not the bomb again.
      if (autoPlay !== null && autoPlay !== AUTOPLAY_SPENT && !onScreen.has(autoPlay)) {
        autoPlay = AUTOPLAY_SPENT;
      }
      emit();
    },
    setSeen: (ids) => {
      seen = ids;
      latch();
    },
    setSteals: (ids) => {
      steals = new Set(ids);
      latch();
    },
    setAllowed: (next) => {
      allowed = next;
      latch();
    },
  };
}

const viewableIds = (entries) =>
  entries.filter((entry) => entry.isViewable).map((entry) => entry.item?.id);

// Everything about a feed row that a card can DRAW differently.
//
// Deliberately not a shallow compare, and deliberately not a deep one either.
// A row's run facts — distance, duration, route, rings, who it took ground
// from — are settled the moment the run is submitted and cannot change for a
// given id, so comparing them would be work with no possible finding. What CAN
// move under a card that is already on screen is the social layer, and that is
// what this checks.
//
// The lists are compared by CONTENT rather than by identity, which is the part
// that matters: every focus revalidation rebuilds the feed response, so an
// identity check would find a new `reactions` array on every single refresh
// and re-render every visible card for a set of chips that had not changed.
const listSig = (list, of) => (Array.isArray(list) ? list.map(of).join('|') : '');

function sameRow(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.kudoed === b.kudoed &&
    a.kudos_count === b.kudos_count &&
    a.caption === b.caption &&
    a.my_reaction === b.my_reaction &&
    a.comment_count === b.comment_count &&
    listSig(a.media, String) === listSig(b.media, String) &&
    listSig(a.reactions, (r) => `${r?.emote}:${r?.count}`) ===
      listSig(b.reactions, (r) => `${r?.emote}:${r?.count}`)
  );
}

function FeedList({ navigation, header }) {
  const styles = useThemedStyles(makeStyles);
  const accent = useAccent();
  const reduce = useReduceMotion();
  // Which rows are on screen, and which one steal may play itself. One store
  // for the life of the list; see createFeedVisibility.
  const visibilityRef = useRef(null);
  if (visibilityRef.current === null) visibilityRef.current = createFeedVisibility();
  const visibility = visibilityRef.current;
  // Two thresholds, because the two questions differ. Is ANY of the card on
  // screen, so its heads may sulk? Has it been properly SEEN, so the one steal
  // that goes off by itself is one somebody is looking at? FlatList refuses
  // pairs that change after mount, hence the ref.
  const viewabilityPairs = useRef([
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 5 },
      onViewableItemsChanged: ({ viewableItems }) => visibility.setOnScreen(viewableIds(viewableItems)),
    },
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 60, minimumViewTime: 180 },
      onViewableItemsChanged: ({ viewableItems }) => visibility.setSeen(viewableIds(viewableItems)),
    },
  ]).current;
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
  // What the visibility store needs from the list itself: which rows are
  // steals, and whether one may play yet (Home in front, motion allowed, the
  // feed landed). Each row's on-screen answer comes from the viewability pairs.
  useEffect(() => {
    visibility.setSteals(items.filter((row) => row.victims?.length).map((row) => row.id));
  }, [items, visibility]);
  // Whether Home is the screen in front, told to the store by the navigator's
  // own events rather than read with useIsFocused. Reading it here re-rendered
  // this list — and with it every card on the feed, the heaviest component in
  // the app — twice per tab switch, to keep one flag only the store reads.
  useEffect(() => {
    const allow = (focused) => visibility.setAllowed(focused && !reduce && !loading);
    allow(navigation?.isFocused ? navigation.isFocused() : true);
    const offFocus = navigation?.addListener?.('focus', () => allow(true));
    const offBlur = navigation?.addListener?.('blur', () => allow(false));
    return () => {
      offFocus?.();
      offBlur?.();
    };
  }, [navigation, reduce, loading, visibility]);

  // A FEED CARD IS 86 NATIVE VIEWS — measured, not estimated, and down from
  // 241 before the frames learned to nine-slice themselves natively (see
  // ui/ArtFrame.js). Two things still follow from it, and both are below.
  //
  // First: FlatList's default `initialNumToRender` is 10, so opening Home
  // built roughly two and a half THOUSAND views before it could draw a frame.
  // Four fills the first screen on the largest phone we support; the rest
  // arrive in small batches as you scroll, which is what the windowing props
  // are for. `windowSize` is in screenfuls — five keeps two either side of
  // what you are looking at, which is enough to scroll into without ever
  // showing a hole, and far short of the ten (five screens' worth of cards)
  // the default keeps alive.
  //
  // Second: the entrance animation is now keyed off the FIRST page only.
  // `entering` fires whenever a cell MOUNTS, and a virtualized list mounts
  // cells continuously as you scroll — so every card past the first screenful
  // was fading and sliding in under the scroll, which reads as the list
  // stuttering rather than as an animation. It belongs to arriving on Home,
  // so it now runs for the cards that are there when you arrive.
  const renderRow = useCallback(
    ({ item, index }) => (
      <View style={styles.feedRow}>
        {loading ? (
          // Matches the card it stands in for: the feed card's radius comes
          // from the limited scale now, and the literal 16 that used to be
          // here left the placeholder visibly rounder than its replacement.
          <Skeleton width="100%" height={110} style={{ borderRadius: radius.card, marginBottom: space.md }} />
        ) : (
          <FeedRow
            item={item}
            index={index}
            navigation={navigation}
            visibility={visibility}
            animate={!reduce && index < FIRST_PAGE_ANIMATED}
          />
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
    ),
    [loading, styles.feedRow, navigation, visibility, reduce, rows.length]
  );

  return (
    <FlatList
      initialNumToRender={4}
      maxToRenderPerBatch={3}
      windowSize={5}
      // NOT `removeClippedSubviews`. It would help here more than almost
      // anywhere — eighty images a row is exactly what it is for — but it is
      // the flag with a standing history of blank cells on iOS, and a feed
      // that sometimes shows empty cards is worse than one that holds a few
      // extra views.
      // TRANSPARENT, not `colors.bg`: the page is a painting now
      // (components/home/HomeBackdrop.js) and a list painted in the page
      // colour would cover all of it but the strip under the last card.
      style={styles.list}
      contentContainerStyle={{ paddingBottom: space.xxl, flexGrow: 1 }}
      data={rows}
      viewabilityConfigCallbackPairs={viewabilityPairs}
      keyExtractor={(it) => it.id}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <View style={{ paddingHorizontal: space.gutter }}>
          {/* No block behind the mascot, and no button under the copy. The
              button was a second "Start run" on a page whose hero card already
              carries one a few hundred points up, which is the same sentence
              twice — and an empty feed is not the place to ask twice. What is
              left states the situation and says who fills it. */}
          <EmptyState
            bare
            art={require('../../assets/art/empty-runs.png')}
            title="Your feed is quiet"
            body="Your runs and your pasers' runs appear here."
          />
        </View>
      }
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={accent} colors={[accent]} />}
      onEndReached={loading ? undefined : loadMore}
      onEndReachedThreshold={0.5}
      renderItem={renderRow}
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
  
  // Animate the bell when there are unread notifications
  const bellScale = useSharedValue(1);
  const reduced = useReduceMotion();
  
  useEffect(() => {
    if (unread > 0 && !reduced) {
      // Keeps pulsing for as long as something is unread, not just a few
      // beats after landing on Home — a badge that stops moving is a badge
      // you've already learned to stop looking at.
      bellScale.value = withRepeat(
        withSpring(1.18, { damping: 12, stiffness: 200 }),
        -1,
        true
      );
    } else {
      cancelAnimation(bellScale);
      bellScale.value = withTiming(1);
    }
    return () => cancelAnimation(bellScale);
  }, [unread, reduced]);
  
  const bellAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bellScale.value }],
  }));
  
  // Land from a run the runner chose to plan later. The claim screen can be
  // left without placing it, and this is how Home offers it back. The key is
  // dropped from the cache after every run and every claim, so it is fresh on
  // the next visit.
  const { data: pendingClaims } = useQuery('me:pending-claims', api.pendingClaims, {
    fallback: [],
  });
  const waiting = openClaims(pendingClaims);

  useFocusEffect(
    useCallback(() => preloadScreenImagesAfterInteractions([
      'Season',
      'Progression',
      'Shop',
      'Record',
      'Rivals',
      'Crossroads',
      'Notifications',
      'Leaderboard',
      'SharedIcons',
    ]), [])
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
          {/* A bare glyph, not a boxed control: the sticker's own bold
              outline already reads as a tappable icon, and the extra card +
              hard-shadow box around it doubled up on that edge instead of
              adding one. */}
          <Animated.View style={bellAnimatedStyle}>
            <PressableShift
              offset={NB.offsetSm}
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
              <AppIcon name="bell" size={38} />
              {unread > 0 && <View style={[styles.bellDot, { backgroundColor: brand.pink }]} />}
            </PressableShift>
          </Animated.View>
        </View>
      </View>

      {/* Land from a run whose attack was put off. Above the hero, because it
          is the one thing on Home that runs out. */}
      {waiting.length > 0 && (
        <PendingClaimCard
          claim={waiting[0]}
          count={waiting.length}
          onPress={() => navigation.navigate('PlanAttack', { runId: waiting[0].run_id })}
          style={styles.pendingClaim}
        />
      )}

      <HeroCarousel navigation={navigation} />

      {/* These shortcuts replace the redundant Feed/Leaderboard switch and
          scroll away with the season card instead of covering run cards. */}
      <SideRail
        inline
        firstRunComplete={runCount > 0}
        navigation={navigation}
        onOpenShop={() => navigation.navigate('Shop')}
        style={styles.shortcutRow}
      />
    </View>
  );

  // The street is drawn behind EVERYTHING, feed skeletons included — a page
  // that only grows its ground once the feed lands shows a flat rectangle on
  // every visit, which is the one thing the painting is there to stop. It is
  // absolutely positioned and takes no taps, so it costs the feed no layout.
  return (
    <View style={styles.page}>
      <HomeBackdrop />
      {/* The safe-area inset is the FEED's, not the page's. Yoga lays an
          absolutely positioned child out inside its parent's padding, so a
          `paddingTop` up here would push the painting's sky down by the notch
          and leave a bare strip of pager colour above it. */}
      <View style={{ flex: 1, paddingTop: insets.top }}>
        <FeedList navigation={navigation} header={feedHeader} />
      </View>
      {IAP_ENABLED ? (
        <BuyEnergySheet visible={shopOpen} onClose={() => setShopOpen(false)} onPurchased={reloadEnergy} />
      ) : null}
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  // No background of its own: the page IS the painting under it.
  page: { flex: 1 },
  // The feed shows the painting through itself. Both the list and its rows are
  // unpainted; every card on it carries its own fill.
  list: { backgroundColor: 'transparent' },
  feedHeader: { paddingHorizontal: space.gutter, paddingTop: space.sm },
  feedRow: { paddingHorizontal: space.gutter },
  shortcutRow: { marginTop: space.lg, marginBottom: space.md },
  // Clear of the hero below it, plus the room the card's own drop falls into.
  pendingClaim: { marginBottom: space.md + NB.offset },
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
  headerRight: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  // A real flex item, not intrinsic-width content. Let it consume ALL of the
  // room between the wordmark and bell: the old 150pt cap left a conspicuous
  // hole in the middle of wider phones and kept even a full Energy track
  // looking like a short pink dash. `minWidth: 0` still lets it yield cleanly
  // on narrow screens.
  headerEnergy: { flex: 1, minWidth: 0 },
  bell: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Ringed in the page colour now that it sits on the bare icon rather than
  // on a card-coloured box, so the dot still reads as punched out of
  // something instead of just stuck to the glyph.
  bellDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.bg,
  },

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
  // flex-start, not center: the button below is left-aligned (`heroBtn` is
  // `alignSelf: 'flex-start'`), so a centered text block sat on a different
  // left edge than the CTA it belongs to.
  heroText: { flex: 1, justifyContent: 'space-between', paddingRight: space.sm, alignItems: 'flex-start', paddingTop: space.sm },
  // bleed to the card edges (negative margins cancel the card padding) so the
  // illustration is as large as possible.
  heroImg: { height: 190, marginVertical: -space.md, marginRight: -space.md },
  heroEyebrow: { color: '#141414', opacity: 0.75 },
  // 26/34 rather than the token's 30/40. With the art box at 44% the text
  // column comes out 178pt on a 375pt phone and 170pt on a 360 (the art's own
  // negative margin hands back the card padding it bleeds over), and the widest
  // headline the carousel carries — "THE BOARD" — measures 152pt of Poppins
  // Black at 26 with the display token's 0.3 tracking. So every card draws its
  // title at the size it was asked for and the three of them match, which is
  // the whole reason the titles are short. lineHeight stays at the token's
  // 1.3x: Poppins Black clips at tighter leading.
  heroTitle: { color: '#141414', fontSize: 26, lineHeight: 34, marginTop: 2 },
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
