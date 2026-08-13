// Rivals — every runner you've traded land with, newest beat first.
//
// The list is a READ of the claim engine's ledger (territory_steals), so it
// can never disagree with the map. Clubmates never appear: their land isn't
// stealable, so there's nothing to be rivals about.

import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swords } from 'lucide-react-native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { radius, space, useTheme, useThemedType } from '../theme';
import { Screen, Skeleton, EmptyState, ToonHeader } from '../components/ui';
import RivalCard, { fmtArea } from '../components/RivalCard';
import { art } from '../config/onboardingArt';
import { useAvatar } from '../state/avatar';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';
import { Reveal, staggerDelay } from '../ui/motion';

export default function RivalsScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const { equipped } = useAvatar();

  const { data: rivals, loading, refresh } = useQuery('me:rivals', api.rivals, {
    fallback: { rivals: [] },
    select: (d) => d.rivals || [],
  });
  const [pulling, setPulling] = useState(false);

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
    <ToonHeader
      panel
      compact
      eyebrow="Head to head"
      title="Rivals"
      // Home's hero-card format, shared with Season standings and Pasers: two
      // runners staking rival flags either side of a split plot, cut out on the
      // right of a flat teal panel with black copy on the left. The art used to
      // fill the whole rectangle behind a scrim, with white outlined text over
      // it (spec: docs/ONBOARDING_ASSETS.md §7).
      art={art('panelRivals')}
      // Home-card type: uppercase `type.display` over a small `type.labelSm`
      // eyebrow. The panel supplies the ink colour, so no override here.
      titleStyle={type.display}
      eyebrowStyle={type.labelSm}
      // Season standings carries a line under its title saying what the board
      // is; this page had a bare word and the art. The sentence also gives the
      // text column something to fill, which is what pulls the cut-out in
      // beside the copy.
      subtitle={score}
      solid={PANEL_TEAL}
      top={insets.top}
      // These screens are reachable straight from another tab, where there
      // may be nothing beneath them to pop back to — fall through to the
      // profile rather than leaving a back button that does nothing.
      onBack={() =>
        (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('YouMain'))
      }
    />
  );

  if (loading) {
    return (
      <Screen gutter={false} edges={[]}>
        {header}
        <View style={{ paddingHorizontal: space.gutter }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={210} style={{ borderRadius: radius.card, marginTop: space.md }} />
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen gutter={false} edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={onRefresh}
            tintColor={colors.textMuted}
          />
        }
      >
        <View style={{ marginHorizontal: -space.gutter }}>{header}</View>

        {rivals.length === 0 ? (
          <EmptyState
            icon={<Swords size={64} color={colors.textDim} />}
            title="No rivals yet"
            body="Claim ground someone else holds, or lose some of yours, and the rivalry starts itself."
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
    </Screen>
  );
}

// The teal baked into header-rivals.png, lightened until it clears 4.5:1
// against the panel's ink copy — the same floor the season boards use. It stays
// a property of the artwork rather than a brand token, so it moves when the art
// does; the ORIGINAL #04776E is too dark to put black type on.
const PANEL_TEAL = '#008E78';
