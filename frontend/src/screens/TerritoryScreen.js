// Your land — every plot you hold, soonest to fade first, and a fortnight of
// what happened to your ground.
//
// Opened from the "Your land" card on You. HOLDING and HISTORY are two views of
// ONE response (GET /me/territory), the same one the card reads, so the page
// and the card can never disagree about a plot.
//
// A holding that looks like one blob on the map is often several plots here:
// ground re-run on Wednesday gets a new clock and the Monday ground beside it
// keeps its own. That split is the point of the page, so it is shown rather
// than merged away. Tapping a plot opens the map framed on it; tapping a beat
// opens the map where it happened.

import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAccent } from '../hooks/useAccent';
import { brand, radius, space, useTheme, useThemedType } from '../theme';
import { Reveal } from '../ui/motion';
import { Card, EmptyState, PageTexture, Segmented, Skeleton, ToonHeader } from '../components/ui';
import AppIcon from '../components/AppIcon';
import LandSummary from '../components/territory/LandSummary';
import PlotRow from '../components/territory/PlotRow';
import BeatRow from '../components/territory/BeatRow';
import { FADING_HOURS, beatFocus, plotFocus } from '../territory/landStatus';

export default function TerritoryScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const accent = useAccent();

  const { data, loading, refresh } = useQuery('me:territory', api.myTerritory, { fallback: null });
  const [tab, setTab] = useState('holding');
  // Only a pull drives the spinner; the query's own `refreshing` is also true
  // during the silent refresh on focus.
  const [pulling, setPulling] = useState(false);

  const plots = Array.isArray(data?.plots) ? data.plots : [];
  const history = Array.isArray(data?.history) ? data.history : [];
  const fadingHours = data?.fading_hours || FADING_HOURS;

  const onRefresh = async () => {
    setPulling(true);
    try {
      await refresh();
    } finally {
      setPulling(false);
    }
  };

  const toMap = (focus) => {
    if (focus) navigation.navigate('Map', { screen: 'MapMain', params: { focus } });
  };

  const header = (
    <ToonHeader
      panel
      compact
      solid={brand.teal}
      title="Your land"
      titleStyle={type.display}
      subtitle="Run it again before it fades."
      top={insets.top}
      // Reachable from another tab's notification one day; fall back to the
      // profile rather than leave a back button that does nothing.
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('YouMain'))}
    >
      <Segmented
        options={[
          // No count until the answer is in: "Holding (0)" for the length of a
          // cold start would be a claim, not a placeholder.
          { key: 'holding', label: data ? `Holding (${data.summary?.plots ?? plots.length})` : 'Holding' },
          { key: 'history', label: 'History' },
        ]}
        value={tab}
        onChange={setTab}
        style={styles.tabs}
      />
    </ToonHeader>
  );

  let body;
  if (loading) {
    body = Array.from({ length: 3 }).map((_, i) => (
      <Skeleton key={i} width="100%" height={84} style={styles.skeleton} />
    ));
  } else if (!data) {
    body = (
      <EmptyState
        icon={<AppIcon name="claim" size={48} />}
        title="Could not load your land"
        body="Pull down to try again."
        style={styles.empty}
      />
    );
  } else if (tab === 'holding') {
    body = plots.length ? (
      <Reveal>
        <Card padded={false} style={styles.card}>
          <LandSummary summary={data.summary} />
          {plots.map((plot) => (
            <PlotRow
              key={plot.id}
              plot={plot}
              accent={accent}
              fadingHours={fadingHours}
              onPress={() => toMap(plotFocus(plot))}
              divider
            />
          ))}
        </Card>
      </Reveal>
    ) : (
      <EmptyState
        icon={<AppIcon name="claim" size={48} />}
        title="No land right now"
        body="Run to claim some."
        actionLabel="Start a run"
        onAction={() => navigation.navigate('Record')}
        accent={accent}
        style={styles.empty}
      />
    );
  } else {
    body = history.length ? (
      <Reveal>
        <Card padded={false} style={styles.card}>
          {history.map((beat, i) => {
            const focus = beatFocus(beat);
            return (
              <BeatRow
                key={`${beat.kind}:${beat.at}:${i}`}
                beat={beat}
                onPress={focus ? () => toMap(focus) : undefined}
                divider={i > 0}
              />
            );
          })}
        </Card>
        <Text style={[type.caption, styles.foot, { color: colors.textDim }]}>
          {`Last ${data.history_days || 14} days`}
        </Text>
      </Reveal>
    ) : (
      <EmptyState
        icon={<AppIcon name="timer" size={48} />}
        title="Nothing yet"
        body="Lost, held and faded ground shows up here."
        style={styles.empty}
      />
    );
  }

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <PageTexture />
      {header}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={colors.textMuted} />
        }
      >
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  // `flex: 1`: a ScrollView with no flex in a column sizes itself to its
  // content, and a long list would run off the page instead of scrolling.
  scroll: { flex: 1 },
  list: { paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.xxl },
  tabs: { marginTop: space.md },
  card: { marginTop: space.sm },
  skeleton: { borderRadius: radius.card, marginTop: space.md },
  empty: { paddingTop: space.xl },
  foot: { textAlign: 'center', marginTop: space.md },
});
