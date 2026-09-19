// Rivals — every runner you've traded land with, newest beat first.
//
// The list is a READ of the claim engine's ledger (territory_steals), so it
// can never disagree with the map. Clubmates never appear: their land isn't
// stealable, so there's nothing to be rivals about.
//
// THE PAGE IS A PAINTED PARK, and the cards are what is standing in it: trees
// over the header, the city behind the treeline, two dogs in the grass at the
// bottom pulling on the same bone. See components/rivals/RivalsBackdrop.js for
// how the picture is fitted to the window — everything here just draws on top
// of it, which is why the header carries `onArt`, nothing paints a background,
// and the list keeps its last card clear of the grass.
//
// ACTIVE AND HISTORY are two views of the SAME response, split on the client
// by how long ago the last beat was. There is no history endpoint and none is
// needed: /me/rivals already returns every rivalry newest first, so the split
// is a date comparison, and it can never disagree with the card it filters.

import React, { useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swords } from 'lucide-react-native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { brand, nbTextOn, radius, space, useTheme, useThemedType } from '../theme';
import { Framed, Skeleton, EmptyState, ToonHeader } from '../components/ui';
import RivalCard from '../components/RivalCard';
import RivalsBackdrop from '../components/rivals/RivalsBackdrop';
import { RIVALS_PARK } from '../config/onboardingArt';
import { useAvatar } from '../state/avatar';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';
import { sinceServer } from '../utils/time';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import { haptic, PressableScale, Reveal, staggerDelay } from '../ui/motion';

// How long a rivalry stays ACTIVE after its last beat. Two weeks is long
// enough that a runner who goes out at the weekend never sees last Saturday's
// fight drop into history before they have answered it, and short enough that
// Active is the list of people you are actually trading ground with now.
export const ACTIVE_DAYS = 14;
const ACTIVE_MS = ACTIVE_DAYS * 24 * 60 * 60 * 1000;

// Against the SERVER's clock, the same as the "21h ago" on the card: judge it
// by the phone's and a phone set a day fast files a rivalry as history while
// its own card still says it moved yesterday.
export function isActive(rival) {
  const at = rival?.last_event?.at;
  return !!at && sinceServer(at) < ACTIVE_MS;
}

// The two tabs under the title. Chips in the same drawn frame as the season
// sheet chips, stretched to halves so the pair reads as one control; the
// selected one takes the teal every rivalry tag and lead button on the page is
// already wearing. A tab, not a button, to a screen reader.
function RivalsFilter({ tab, onChange, activeCount }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const tabs = [
    // No count until the list has landed: "Active (0)" for the length of a
    // cold start would be a claim, not a placeholder.
    { key: 'active', label: activeCount == null ? 'Active' : `Active (${activeCount})` },
    { key: 'history', label: 'History' },
  ];
  return (
    <View style={styles.filter} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.key === tab;
        const fill = on ? brand.teal : colors.card;
        return (
          <PressableScale
            key={t.key}
            style={styles.filterTab}
            onPress={() => {
              if (on) return;
              haptic.light();
              onChange(t.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
          >
            <Framed
              frame={frameVariant('chip', `rivals:${t.key}`)}
              fill={fill}
              on={fill}
              weight={on ? INK.medium : INK.thin}
              pose={framePose(`rivals:${t.key}`)}
              inset={3}
              contentStyle={styles.filterFace}
            >
              <Text
                style={[type.bodySmBold, { color: on ? nbTextOn(fill) : colors.text }]}
                numberOfLines={1}
              >
                {t.label}
              </Text>
            </Framed>
          </PressableScale>
        );
      })}
    </View>
  );
}

export default function RivalsScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { equipped } = useAvatar();

  const { data: rivals, loading, refresh } = useQuery('me:rivals', api.rivals, {
    fallback: { rivals: [] },
    select: (d) => d.rivals || [],
  });
  const [pulling, setPulling] = useState(false);
  const [tab, setTab] = useState('active');

  // The measured height of the header, which is what tells the canopy behind
  // it how far to hang its treeline down. It changes with the reader's text
  // size, so it is measured rather than assumed — see RivalsBackdrop.
  const [headerH, setHeaderH] = useState(0);
  const onHeaderLayout = (e) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setHeaderH((prev) => (prev === h ? prev : h));
  };

  // WHAT SITS BELOW THE SCROLL — the tab bar, in practice. The park's bottom
  // band is pinned to the WINDOW, but the list stops at the tab bar, so the
  // run-out the last card needs is the band MINUS whatever chrome already
  // covers it. Measured rather than assumed: the tab bar's height is a
  // function of the safe-area inset and the platform, and guessing it either
  // leaves the last card sitting in the grass or floats it a hundred points
  // above the treeline.
  const [chrome, setChrome] = useState(0);
  const onListLayout = (e) => {
    const { y, height: h } = e.nativeEvent.layout;
    const below = Math.max(0, Math.round(height - (y + h)));
    setChrome((prev) => (prev === below ? prev : below));
  };
  const foot = Math.max(space.xxl, Math.round(width * RIVALS_PARK.bottom) - chrome);

  // Warm the portraits behind the cards that are already drawn, never in front.
  useEffect(() => {
    if (rivals?.length) preloadRunnerAssets(rivals);
  }, [rivals]);

  const onRefresh = async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  };

  const all = rivals || [];
  const active = all.filter(isActive);
  const history = all.filter((r) => !isActive(r));
  const shown = tab === 'active' ? active : history;

  const header = (
    <View onLayout={onHeaderLayout}>
      <ToonHeader
        panel
        compact
        // The header stands IN the park rather than on a brand panel: no fill,
        // no bottom rule, and the copy takes its ink from the scheme so it reads
        // on the daylight sky and on the dusk wash alike. It keeps the panel's
        // shape and its white back tile — the format is the same, the ground
        // underneath it is the page's own painting.
        //
        // It also drops the cut-out runners the panel used to carry. Two drawn
        // characters over a drawn treeline is two illustrations fighting for the
        // same corner, and the one that belongs to the page is the park.
        onArt
        title="Rivals"
        titleStyle={type.display}
        // ONE SHORT FIXED LINE, and no eyebrow over the title. The header used
        // to carry an eyebrow AND a running score ("You're up 38.67 km² · 7
        // rivals"), which put three lines of copy on the sky and ran the longest
        // of them across the left tree, where it could not be read. The score
        // is on every card's bar already; the count is on the Active tab.
        subtitle="Show them who is boss."
        top={insets.top}
        // These screens are reachable straight from another tab, where there
        // may be nothing beneath them to pop back to — fall through to the
        // profile rather than leaving a back button that does nothing.
        onBack={() =>
          (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('YouMain'))
        }
      >
        <RivalsFilter tab={tab} onChange={setTab} activeCount={loading ? null : active.length} />
      </ToonHeader>
    </View>
  );

  // The park is drawn in EVERY state, loading included. A page that only grows
  // its ground once the request lands shows every reader a flat grey rectangle
  // on every visit, which is the one thing the painting is there to stop.
  if (loading) {
    return (
      <View style={styles.page}>
        <RivalsBackdrop headerHeight={headerH} />
        {header}
        <View style={styles.list}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={210} style={styles.card} />
          ))}
        </View>
      </View>
    );
  }

  let empty = null;
  if (all.length === 0) {
    empty = (
      <EmptyState
        icon={<Swords size={64} color={colors.textDim} />}
        title="No rivals yet"
        body="Take their land, or lose yours, to start a rivalry."
        actionLabel="Start a run"
        onAction={() => navigation.navigate('Record')}
        style={styles.empty}
      />
    );
  } else if (shown.length === 0 && tab === 'active') {
    empty = (
      <EmptyState
        icon={<Swords size={64} color={colors.textDim} />}
        title="All quiet"
        body="No fights in the last two weeks. Go take some ground."
        actionLabel="Start a run"
        onAction={() => navigation.navigate('Record')}
        style={styles.empty}
      />
    );
  } else if (shown.length === 0) {
    empty = (
      <EmptyState
        icon={<Swords size={64} color={colors.textDim} />}
        title="No history yet"
        body="Rivalries move here after two quiet weeks."
        style={styles.empty}
      />
    );
  }

  return (
    <View style={styles.page}>
      <RivalsBackdrop headerHeight={headerH} />
      {header}
      <ScrollView
        onLayout={onListLayout}
        style={styles.scroll}
        contentContainerStyle={[styles.list, { paddingBottom: foot }]}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={onRefresh}
            tintColor={colors.textMuted}
          />
        }
      >
        {empty ||
          shown.map((r, i) => (
            <Reveal key={r.user_id} delay={staggerDelay(i)}>
              <RivalCard
                rival={r}
                myAvatar={equipped}
                style={{ marginTop: space.md }}
                onPress={() => navigation.navigate('RivalDetail', { userId: r.user_id })}
                onTakeBack={() => navigation.navigate('Record')}
                onViewLand={
                  r.last_event?.lat != null
                    ? () =>
                        navigation.navigate('Map', {
                          screen: 'MapMain',
                          params: { focus: { lat: r.last_event.lat, lon: r.last_event.lon } },
                        })
                    : undefined
                }
              />
            </Reveal>
          ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // No background of its own, in either scheme: the backdrop under it is the
  // page's ground, and a `colors.bg` here would paint the park out.
  page: { flex: 1 },
  // `flex: 1` and not just a transparent ground: a ScrollView with no flex in
  // a column sizes itself to its CONTENT, so a long list would run off the
  // bottom of the page instead of scrolling inside it.
  scroll: { flex: 1, backgroundColor: 'transparent' },
  list: { paddingHorizontal: space.gutter },
  card: { borderRadius: radius.card, marginTop: space.md },
  empty: { paddingTop: space.xl },
  // Full width of the header's gutter, so the pair lines up with the cards
  // under it rather than hugging the title.
  filter: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  filterTab: { flex: 1 },
  filterFace: { alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
});
