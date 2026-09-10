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

import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swords } from 'lucide-react-native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { radius, space, useTheme, useThemedType } from '../theme';
import { Skeleton, EmptyState, ToonHeader } from '../components/ui';
import RivalCard, { fmtArea } from '../components/RivalCard';
import RivalsBackdrop from '../components/rivals/RivalsBackdrop';
import { RIVALS_PARK } from '../config/onboardingArt';
import { useAvatar } from '../state/avatar';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';
import { Reveal, staggerDelay } from '../ui/motion';

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

  // WHAT SITS BELOW THE SCROLL — the tab bar, in practice. The park's bottom
  // band is pinned to the WINDOW, but the list stops at the tab bar, so the
  // run-out the last card needs is the band MINUS whatever chrome already
  // covers it. Measured rather than assumed: the tab bar's height is a
  // function of the safe-area inset and the platform, and guessing it either
  // leaves the last card sitting in the grass or floats it a hundred points
  // above the treeline.
  // The measured height of the header, which is what tells the canopy behind
  // it how far to hang its treeline down. It changes with the reader's text
  // size, so it is measured rather than assumed — see RivalsBackdrop.
  const [headerH, setHeaderH] = useState(0);
  const onHeaderLayout = (e) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setHeaderH((prev) => (prev === h ? prev : h));
  };

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

  // Career score across every rivalry — the one-line "how am I doing".
  const net = (rivals || []).reduce((sum, r) => sum + (r.net_m2 || 0), 0);
  const score = rivals?.length
    ? `${net >= 0 ? "You're up" : "You're down"} ${fmtArea(Math.abs(net))} · ${rivals.length} ${rivals.length === 1 ? 'rival' : 'rivals'}`
    : undefined;

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
        eyebrow="Head to head"
        title="Rivals"
        // Home-card type: uppercase `type.display` over a small `type.labelSm`
        // eyebrow, the same as every other page header.
        titleStyle={type.display}
        eyebrowStyle={type.labelSm}
        // Season standings carries a line under its title saying what the board
        // is; this page had a bare word and the art. The sentence also gives the
        // text column something to fill.
        subtitle={score}
        top={insets.top}
        // These screens are reachable straight from another tab, where there
        // may be nothing beneath them to pop back to — fall through to the
        // profile rather than leaving a back button that does nothing.
        onBack={() =>
          (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('YouMain'))
        }
      />
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
        {rivals.length === 0 ? (
          <EmptyState
            icon={<Swords size={64} color={colors.textDim} />}
            title="No rivals yet"
            body="Claim ground someone else holds, or lose some of yours, and a rivalry begins."
            actionLabel="Start a run"
            onAction={() => navigation.navigate('Record')}
            style={{ paddingTop: space.xl }}
          />
        ) : (
          rivals.map((r, i) => (
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
          ))
        )}
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
});
