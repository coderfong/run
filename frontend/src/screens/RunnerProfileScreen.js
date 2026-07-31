// RunnerProfile — another runner's public profile, opened from a paser row.
//
// The read-only twin of the You tab: same bust + level border + stat wall, but
// with a paser action instead of settings. `state` comes from the server so the
// button is always right, even if the relationship changed on another device.

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import { radius, space, useTheme, useThemedType, useThemedStyles } from '../theme';
import { Screen, Card, Row, Button, Pill, StatValue, SectionHeader, Skeleton, EmptyState } from '../components/ui';
import { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import { PressableScale, Reveal } from '../ui/motion';
import AppIcon from '../components/AppIcon';
import { toast } from '../ui/toast';

const km = (m) => (m / 1000).toFixed(1);
const km2 = (m2) => (m2 / 1e6).toFixed(2);
const mins = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export default function RunnerProfileScreen({ navigation, route }) {
  const { userId, username } = route.params || {};
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setP(await api.runnerProfile(userId)); } catch { setP(false); }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Keep the header title honest even before the fetch lands.
  useFocusEffect(useCallback(() => {
    navigation.setOptions({ title: p?.username || username || 'Runner' });
  }, [navigation, p?.username, username]));

  const act = async (fn, msg) => {
    setBusy(true);
    try {
      await fn();
      if (msg) toast.success(msg);
      await load();
    } catch (e) {
      toast.error(e.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (p === false) {
    return (
      <Screen center>
        <EmptyState
          icon={<AppIcon name="invite" size={44} />}
          title="Runner not found"
          body="This account may have been deleted."
        />
      </Screen>
    );
  }
  if (!p) {
    return (
      <Screen>
        <Skeleton width="100%" height={220} style={{ borderRadius: radius.card, marginTop: space.md }} />
        <Skeleton width="100%" height={180} style={{ borderRadius: radius.card, marginTop: space.md }} />
      </Screen>
    );
  }

  const accent = p.clan_color?.stroke || colors.textMuted;

  const paserAction = () => {
    if (p.state === 'self') return null;
    if (busy) return <ActivityIndicator size="small" color={accent} style={{ marginTop: space.md }} />;
    switch (p.state) {
      case 'none':
        return (
          <Button
            title="Add paser"
            variant="gradient"
            full={false}
            icon={<AppIcon name="invite" size={18} />}
            style={{ marginTop: space.md }}
            onPress={() => act(() => api.addPaser(userId), `Request sent to ${p.username}`)}
          />
        );
      case 'pending_out':
        return (
          <Button
            title="Requested · tap to cancel"
            variant="secondary"
            size="sm"
            full={false}
            style={{ marginTop: space.md }}
            onPress={() => act(() => api.removePaser(userId), 'Request cancelled')}
          />
        );
      case 'pending_in':
        return (
          <Row gap={8} style={{ marginTop: space.md }}>
            <Button
              title="Accept"
              full={false}
              onPress={() => act(() => api.respondToPaser(p.request_id, 'accept'), `You and ${p.username} are pasers`)}
            />
            <Button
              title="Decline"
              variant="secondary"
              full={false}
              onPress={() => act(() => api.respondToPaser(p.request_id, 'decline'))}
            />
          </Row>
        );
      case 'paser':
        return (
          <Row gap={8} style={{ marginTop: space.md }}>
            <Pill label="Your paser" color={accent} dot />
            <Button
              title="Remove"
              variant="secondary"
              size="sm"
              full={false}
              onPress={() => act(() => api.removePaser(userId), `Removed ${p.username}`)}
            />
          </Row>
        );
      default:
        return null;
    }
  };

  return (
    <Screen scroll contentStyle={{ paddingBottom: space.xxl }}>
      <Reveal style={styles.header}>
        <PortraitBorder level={p.level} size={104}>
          <CharacterBust equipped={p.avatar} size={96} ring={accent} />
        </PortraitBorder>
        <Text style={[type.title, { marginTop: space.md }]}>{p.username}</Text>
        <Row gap={8} style={{ marginTop: space.sm }}>
          <Pill label={p.clan_tag ? `[${p.clan_tag}]` : 'Solo'} color={accent} dot />
          <Pill label={`Level ${p.level}`} color={colors.textMuted} />
          <Pill label={`${p.paser_count} paser${p.paser_count === 1 ? '' : 's'}`} color={colors.textMuted} />
        </Row>
        {paserAction()}
      </Reveal>

      <View style={styles.wall}>
        <Card style={styles.tile}><StatValue size="md" label="Area held" value={km2(p.total_area_m2)} unit="km²" color={accent} /></Card>
        <Card style={styles.tile}><StatValue size="md" label="Distance" value={km(p.career_distance_m)} unit="km" /></Card>
        <Card style={styles.tile}><StatValue size="md" label="Runs" value={String(p.runs_count)} /></Card>
        <Card style={styles.tile}><StatValue size="md" label="Biggest claim" value={km2(p.biggest_claim_m2)} unit="km²" color={accent} /></Card>
        <Card style={styles.tile}><StatValue size="md" label="Zones" value={String(p.territory_count)} /></Card>
        <Card style={styles.tile}><StatValue size="md" label="Level" value={String(p.level)} /></Card>
      </View>

      <SectionHeader title="Recent runs" style={{ marginTop: space.xl, marginBottom: space.md }} />
      {p.recent_runs.length === 0 ? (
        <Card><Text style={[type.caption, { textAlign: 'center' }]}>No runs yet.</Text></Card>
      ) : (
        p.recent_runs.map((r) => (
          <PressableScale key={r.run_id} onPress={() => navigation.navigate('RunDetail', { runId: r.run_id })}>
            <Card style={{ marginBottom: space.sm }}>
              <Row between>
                <View>
                  <Text style={type.bodyBold}>{km(r.distance_m)} km · {mins(r.duration_s)}</Text>
                  <Text style={type.caption}>
                    {new Date(r.created_at).toLocaleDateString()}
                    {r.closed_loop ? ` · ${km2(r.area_m2)} km² claimed` : ''}
                  </Text>
                </View>
                {r.closed_loop ? <AppIcon name="claim" size={20} /> : null}
              </Row>
            </Card>
          </PressableScale>
        ))
      )}
    </Screen>
  );
}

const makeStyles = (colors, _scheme, type) => StyleSheet.create({
  header: { alignItems: 'center', marginTop: space.md, marginBottom: space.xl },
  wall: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: { width: '31%', marginBottom: space.md },
});
