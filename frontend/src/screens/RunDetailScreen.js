// Run detail — route on the game board, splits, claim outcome, kudos,
// comments. Reached from the feed and the You tab's recent runs.

import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Heart, Send } from 'lucide-react-native';

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

function timeAgo(iso) {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function RunDetailScreen({ route }) {
  const { runId } = route.params;
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.runDetail(runId).then(setD).catch(() => setD(false));
    api.runComments(runId).then(setComments).catch(() => setComments([]));
  }, [runId]);

  const sendComment = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    haptic.light();
    try {
      const c = await api.addRunComment(runId, body);
      setComments((prev) => [...(prev || []), c]);
      setDraft('');
    } catch (e) {
      toast.error(e.message || 'Could not post comment');
    } finally {
      setSending(false);
    }
  };

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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <Screen scroll contentStyle={{ paddingBottom: space.xxl }}>
      {/* map */}
      <View style={styles.map}>
        {MAP_READY && path.length > 1 ? (
          <GameMap theme="dark" initialCenter={path[0]} initialZoom={14}>
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
        <StatValue size="md" label={d.closed_loop ? 'Claimed' : 'No claim'} value={d.closed_loop ? (d.area_m2 / 1e6).toFixed(d.area_m2 >= 1e5 ? 2 : 3) : '—'} unit={d.closed_loop ? 'km²' : ''} color={d.closed_loop ? c.stroke : colors.textDim} />
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

      {/* comments */}
      <Card style={{ marginTop: space.xl }}>
        <Text style={[type.label, { color: colors.textMuted, marginBottom: space.md }]}>
          Comments{comments?.length ? ` · ${comments.length}` : ''}
        </Text>
        {!comments ? (
          <Skeleton width="100%" height={16} />
        ) : comments.length === 0 ? (
          <Text style={[type.caption, { marginBottom: space.sm }]}>Be the first to say something.</Text>
        ) : (
          comments.map((cm) => (
            <View key={cm.id} style={styles.commentRow}>
              <Text style={type.bodySmBold}>
                {cm.username}
                {cm.is_you ? ' · you' : ''}
                <Text style={[type.caption, { color: colors.textDim }]}>  {timeAgo(cm.created_at)}</Text>
              </Text>
              <Text style={[type.bodySm, { marginTop: 2 }]}>{cm.body}</Text>
            </View>
          ))
        )}
        <View style={styles.commentInputRow}>
          <TextInput
            style={styles.commentInput}
            placeholder="Add a comment…"
            placeholderTextColor={colors.textDim}
            value={draft}
            onChangeText={setDraft}
            maxLength={280}
            multiline
            accessibilityLabel="Comment"
          />
          <PressableScale
            onPress={sendComment}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, { backgroundColor: c.stroke, opacity: draft.trim() && !sending ? 1 : 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel="Post comment"
          >
            <Send size={18} color="#fff" />
          </PressableScale>
        </View>
      </Card>
    </Screen>
    </KeyboardAvoidingView>
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

  commentRow: { marginBottom: space.md },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: space.sm },
  commentInput: {
    ...type.bodySm,
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    maxHeight: 90,
    color: colors.text,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
