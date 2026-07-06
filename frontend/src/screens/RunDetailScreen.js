// Run detail — route on the game board, splits, claim outcome, kudos.
// Reached from the feed and the You tab's recent runs.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Heart } from 'lucide-react-native';

import { api } from '../api/client';
import { NEUTRAL } from '../state/clan';
import { colors, radius, space, type, withAlpha } from '../theme';
import { Screen, Card, Row, StatValue, Skeleton } from '../components/ui';
import { PressableScale, haptic } from '../ui/motion';
import GameMap, { MAP_READY, TerritoryFill, Trail, MapPoint } from '../components/GameMap';
import { toast } from '../ui/toast';

const km = (m) => (m / 1000).toFixed(2);

function paceStr(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtPace(distanceM, durationS) {
  if (!distanceM || distanceM < 50 || !durationS) return '—';
  return `${paceStr(durationS / (distanceM / 1000))} /km`;
}

function fmtDuration(s) {
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

export default function RunDetailScreen({ route }) {
  const { runId } = route.params;
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.runDetail(runId).then(setD).catch(() => setD(false));
  }, [runId]);

  const kudos = async () => {
    if (busy || !d) return;
    setBusy(true);
    haptic.light();
    // optimistic
    setD((p) => ({ ...p, kudoed: !p.kudoed, kudos_count: p.kudos_count + (p.kudoed ? -1 : 1) }));
    try {
      const r = await api.toggleKudos(runId);
      setD((p) => ({ ...p, kudoed: r.kudoed, kudos_count: r.kudos_count }));
    } catch (e) {
      toast.error(e.message || 'Could not send kudos');
    } finally {
      setBusy(false);
    }
  };

  if (d === false) return <Screen center><Text style={type.body}>Run not found.</Text></Screen>;
  if (!d) {
    return (
      <Screen>
        <Skeleton width="100%" height={220} style={{ borderRadius: 16, marginTop: space.md }} />
        <Skeleton width="70%" height={20} style={{ marginTop: space.lg }} />
      </Screen>
    );
  }

  const c = d.clan_color || NEUTRAL;
  const path = (d.path || []).map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
  const ring = (d.territory_rings?.[0] || []).map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
  const slowest = d.splits.length ? Math.max(...d.splits.map((s) => s.seconds)) : 1;

  return (
    <Screen scroll contentStyle={{ paddingBottom: space.xxl }}>
      {/* map */}
      <View style={styles.map}>
        {MAP_READY && path.length > 1 ? (
          <GameMap theme="light" initialCenter={path[0]} initialZoom={14}>
            {ring.length >= 3 && <TerritoryFill id="d-terr" points={ring} fillColor={c.stroke} strokeColor={c.stroke} fillOpacity={0.35} />}
            <Trail id="d-trail" points={path} color={c.stroke} width={5} />
            <MapPoint id="d-start" point={path[0]} color={c.stroke} />
          </GameMap>
        ) : (
          <View style={styles.mapPlaceholder}>
            <Text style={type.caption}>{MAP_READY ? 'No route recorded' : 'Map needs the dev build'}</Text>
          </View>
        )}
      </View>

      {/* header */}
      <Row between style={{ marginTop: space.lg }}>
        <View>
          <Text style={type.title}>{d.clan_tag ? `[${d.clan_tag}] ` : ''}{d.username}{d.is_you ? ' · you' : ''}</Text>
          <Text style={type.caption}>{new Date(d.created_at).toLocaleString()}</Text>
        </View>
        <PressableScale onPress={kudos} style={styles.kudos} accessibilityRole="button" accessibilityLabel="Give kudos">
          <Heart size={20} color={d.kudoed ? c.stroke : colors.textMuted} fill={d.kudoed ? c.stroke : 'transparent'} />
          <Text style={[type.bodySmBold, { color: d.kudoed ? c.stroke : colors.textMuted }]}>{d.kudos_count}</Text>
        </PressableScale>
      </Row>

      <Row between style={{ marginTop: space.lg }}>
        <StatValue size="md" label="Distance" value={km(d.distance_m)} unit="km" />
        <StatValue size="md" label="Pace" value={fmtPace(d.distance_m, d.duration_s).split(' ')[0]} unit="/km" />
        <StatValue size="md" label="Time" value={fmtDuration(d.duration_s)} />
        <StatValue size="md" label={d.closed_loop ? 'Claimed' : 'No loop'} value={d.closed_loop ? Math.round(d.area_m2).toLocaleString() : '—'} unit={d.closed_loop ? 'm²' : ''} color={d.closed_loop ? c.stroke : colors.textDim} />
      </Row>

      {/* splits */}
      {d.splits.length > 0 && (
        <Card style={{ marginTop: space.xl }}>
          <Text style={[type.label, { color: colors.textMuted, marginBottom: space.md }]}>Splits</Text>
          {d.splits.map((s) => (
            <View key={s.km} style={styles.splitRow}>
              <Text style={styles.splitKm}>{s.km} km</Text>
              <View style={styles.track}>
                <View style={[styles.bar, { width: `${Math.max(12, (s.seconds / slowest) * 100)}%`, backgroundColor: withAlpha(c.stroke, 0.5) }]} />
              </View>
              <Text style={styles.splitPace}>{paceStr(s.seconds)}</Text>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  map: { height: 240, borderRadius: radius.card, overflow: 'hidden', marginTop: space.md, backgroundColor: colors.bgElevated },
  mapPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  kudos: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: space.sm },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  splitKm: { ...type.statSm, width: 52 },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bgElevated, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  splitPace: { ...type.statSm, color: colors.textMuted, width: 52, textAlign: 'right' },
});
