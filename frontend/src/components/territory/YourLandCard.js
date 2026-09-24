// Your land, on the You page, directly under the stat wall that counts it.
//
// WHY HERE. The wall above says how much ground you hold (Area held, Zones);
// this says what is happening to it: which plots are about to fade, what was
// held off, what was lost. The full list and the history are one tap away on
// the Territory page, so the profile carries only the plots that need you
// soonest. The Rivals section that used to sit lower on this page was removed
// for being clutter, which is why this stays one card.
//
// It is the SAME request as the full page ('me:territory'), so the card and
// the page never disagree and opening the page after the card costs nothing.
// A failed or missing endpoint (an app build ahead of its backend) hides the
// card rather than showing a broken one.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../../api/client';
import { useQuery } from '../../hooks/useQuery';
import { radius, space, useTheme, useThemedType } from '../../theme';
import { Reveal } from '../../ui/motion';
import { Button, Card, SectionHeader, Skeleton } from '../ui';
import LandSummary from './LandSummary';
import PlotRow from './PlotRow';
import { FADING_HOURS, plotFocus } from '../../territory/landStatus';

// Soonest to fade first, so these are the ones that need a run soonest.
const PREVIEW = 3;

// `nested` — the card sits on You directly under the stat wall, so its
// heading is a plain section title rather than a drawn label box.
export default function YourLandCard({ navigation, accent, nested = false }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const { data, loading } = useQuery('me:territory', api.myTerritory, { fallback: null });

  const heading = (
    <SectionHeader
      title="Your land"
      framed={!nested}
      action={data ? 'See all' : undefined}
      onAction={() => navigation.navigate('Territory')}
      style={nested ? styles.headingNested : styles.heading}
    />
  );

  if (loading) {
    return (
      <View>
        {heading}
        <Skeleton width="100%" height={150} style={{ borderRadius: radius.card }} />
      </View>
    );
  }
  if (!data || !Array.isArray(data.plots)) return null;

  const plots = data.plots;
  const showOnMap = (plot) => {
    const focus = plotFocus(plot);
    if (focus) navigation.navigate('Map', { screen: 'MapMain', params: { focus } });
  };

  return (
    <Reveal delay={100}>
      {heading}
      <Card padded={false}>
        <LandSummary summary={data.summary} />
        {plots.length ? (
          plots.slice(0, PREVIEW).map((plot) => (
            <PlotRow
              key={plot.id}
              plot={plot}
              accent={accent}
              fadingHours={data.fading_hours || FADING_HOURS}
              onPress={() => showOnMap(plot)}
              divider
              compact
            />
          ))
        ) : (
          <View style={[styles.empty, { borderTopColor: colors.border }]}>
            <Text style={type.bodyBold}>No land right now</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>Run to claim some.</Text>
            <Button
              title="Start a run"
              size="sm"
              full={false}
              accent={accent}
              onPress={() => navigation.navigate('Record')}
              style={styles.cta}
            />
          </View>
        )}
      </Card>
    </Reveal>
  );
}

const styles = StyleSheet.create({
  heading: { marginTop: space.xl, marginBottom: space.md },
  headingNested: { marginTop: space.md, marginBottom: space.md },
  empty: {
    alignItems: 'center',
    gap: 2,
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cta: { marginTop: space.md },
});
