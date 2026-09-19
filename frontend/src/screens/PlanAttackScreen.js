// Plan your attack, later.
//
// The post-run claim screen can be left without placing the land ("Plan
// later"), and the run's land then waits for a while (the server's
// `claim_defer_hours`). This is the way back in, opened from Home or from the
// run's own page. It fetches what the claim screen needs for that one run and
// hands it to ResultScreen in its deferred mode, which is the SAME claim
// screen: same map, same rigid stamp, same sequence and payoff. What it leaves
// out is what belonged to the moment the run finished (the confetti, crossed
// paths, the run's own payouts), all of which was banked and shown back then.
//
// A root screen rather than a route inside the Record modal, because Record
// mounts the live recorder, and nothing about placing an old run's land should
// start GPS.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { ToonButton } from '../components/ui';
import BackButton from '../components/ui/BackButton';
import { space, useTheme, useThemedStyles } from '../theme';
import ResultScreen from './ResultScreen';

// The claim screen draws `{latitude, longitude}` points; the server stores
// the route as [lon, lat] pairs.
export function toMapPath(pairs) {
  return (Array.isArray(pairs) ? pairs : [])
    .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([longitude, latitude]) => ({ latitude, longitude }));
}

// Why the claim cannot reopen, in plain words. `gone` marks the refusals that
// mean this land will never be placeable again, which Home must stop offering.
export function resumeFailure(error) {
  switch (error?.status) {
    case 410:
      return { gone: true, message: 'This land has expired.' };
    case 409:
      return { gone: true, message: 'This run is already claimed.' };
    case 404:
    case 422:
      return { gone: true, message: 'This run has no land to place.' };
    default:
      return { gone: false, message: error?.message || 'Could not load this run.' };
  }
}

export default function PlanAttackScreen({ navigation, route }) {
  const runId = route?.params?.runId;
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    api
      .claimResume(runId)
      .then((d) => {
        if (!alive) return;
        setState({
          status: 'ready',
          params: {
            // The server's own splits ride along on the result: the stored
            // route has no timestamps to work them out from again.
            result: { ...d.result, splits: d.splits || [] },
            path: toMapPath(d.path),
            deferred: true,
          },
        });
      })
      .catch((error) => {
        if (!alive) return;
        const failure = resumeFailure(error);
        if (failure.gone) invalidate('me:pending-claims');
        setState({ status: 'error', message: failure.message });
      });
    return () => {
      alive = false;
    };
  }, [runId]);

  if (state.status === 'ready') {
    return <ResultScreen navigation={navigation} route={{ params: state.params }} />;
  }

  const close = () => navigation.goBack();
  return (
    <View
      style={[
        styles.page,
        { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.lg },
      ]}
    >
      <BackButton onPress={close} />
      <View style={styles.body}>
        {state.status === 'loading' ? (
          <>
            <ActivityIndicator color={colors.text} />
            <Text style={styles.note}>Reading the ground…</Text>
          </>
        ) : (
          <>
            <Text style={styles.message}>{state.message}</Text>
            <ToonButton title="Back" onPress={close} size="sm" containerStyle={styles.back} />
          </>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  note: { ...type.bodySm, color: colors.textMuted },
  message: { ...type.bodySmBold, color: colors.text, textAlign: 'center' },
  back: { width: 160 },
});
