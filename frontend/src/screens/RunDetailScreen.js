// Run detail: a fixed route summary, with paged splits and a separate details sheet.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MoreHorizontal, Send } from 'lucide-react-native';
import { useIsFocused } from '@react-navigation/native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { NEUTRAL } from '../state/clan';
import { NB, nbField, nbInk, nbRadius, radius, space, toonSurface, useTheme, useThemedStyles, useThemedType } from '../theme';
import { Screen, Card, Row, Input, Skeleton, BackButton } from '../components/ui';
import { PressableScale, haptic } from '../ui/motion';
import GameMap, { MAP_READY, TerritoryFill, Trail, MapPoint } from '../components/GameMap';
import { toast } from '../ui/toast';
import HomeBackdrop from '../components/home/HomeBackdrop';
import TerritoryInsights from '../components/TerritoryInsights';
import { ProLockedSection } from '../components/ProLock';
import { openSafetyActions } from '../utils/safety';
import { longDateTime, sinceServer } from '../utils/time';

const km = (m) => (m / 1000).toFixed(2);

function paceStr(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtPace(distanceM, durationS) {
  if (!distanceM || distanceM < 50 || !durationS) return '·';
  return `${paceStr(durationS / (distanceM / 1000))} /km`;
}

function fmtDuration(s) {
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

// The compact form — a comment row shows "6m", not "6m ago". Ages come from
// the shared UTC parser; only the wording is local to this screen.
function timeAgo(iso) {
  const ms = sinceServer(iso);
  if (!Number.isFinite(ms)) return '·';
  const s = ms / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function RunDetailScreen({ navigation, route }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { runId, focusComments = false } = route.params;
  // Cached per run: reopening a run from the feed or your recent-runs list
  // draws the route, splits and comments immediately rather than rebuilding
  // the page from two skeletons.
  const { data: d, loading, error } = useQuery(
    `run:${runId}`,
    () => api.runDetail(runId)
  );
  const { data: comments, setData: setComments } = useQuery(
    `run:${runId}:comments`,
    () => api.runComments(runId),
    { fallback: [] }
  );
  const [detailsOpen, setDetailsOpen] = useState(focusComments);
  const [splitPage, setSplitPage] = useState(0);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapSize, setMapSize] = useState(null);
  const fitRoute = useCallback(() => {
    const points = (d?.path || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([longitude, latitude]) => ({ longitude, latitude }));
    if (points.length > 1) mapRef.current?.fitToPoints(points, 32, 0);
  }, [d?.path]);
  useEffect(() => { if (mapReady && mapSize) fitRoute(); }, [mapReady, mapSize, fitRoute]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const screenFocused = useIsFocused();
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  // The comment button on a feed card arrives here asking for the composer.
  // Honoured once per visit: `focusComments` used to be passed and then
  // silently ignored, so tapping comment opened this page at the map and the
  // comment box was two screenfuls down — which reads as the button being
  // broken rather than as a page that scrolled to the wrong place.
  const jumped = useRef(false);

  useEffect(() => {
    if (!screenFocused) setDetailsOpen(false);
  }, [screenFocused]);

  // Focus comments inside the details sheet when opened from a feed comment.
  const onCommentsLayout = useCallback((event) => {
    if (!focusComments || jumped.current) return;
    jumped.current = true;
    const y = event.nativeEvent.layout.y;
    // After the layout pass that produced this y, and after the keyboard has
    // somewhere to push: focus last so the scroll is not fighting it.
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - space.lg), animated: true });
      inputRef.current?.focus();
    });
  }, [focusComments]);

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


  if (error && !d) return <Screen><BackButton onPress={() => navigation.goBack()} /><Text style={type.body}>Run not found.</Text></Screen>;
  if (loading || !d) {
    return (
      <Screen>
        <BackButton onPress={() => navigation.goBack()} />
        <Skeleton width="100%" height={220} style={{ borderRadius: 16, marginTop: space.md }} />
        <Skeleton width="70%" height={20} style={{ marginTop: space.lg }} />
      </Screen>
    );
  }

  const c = d.clan_color || NEUTRAL;
  const path = (d.path || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
  const ring = (d.territory_rings?.[0] || []).map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
  const splits = d.splits || [];
  const slowest = Math.max(1, ...splits.map((s) => s.seconds));
  const pages = Math.max(1, Math.ceil(splits.length / 4));
  const pageIndex = Math.min(splitPage, pages - 1);
  // Reactions are deliberately separate from comments. Older servers may
  // still return sticker-only rows; omit those instead of putting emojis back
  // into the discussion.
  const textComments = (comments || []).filter((cm) => cm.body?.trim());

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <HomeBackdrop />
      <Screen style={{ backgroundColor: 'transparent', paddingBottom: 12 }}>
        <Row gap={12} style={{ paddingVertical: 10 }}>
          <BackButton onPress={() => navigation.goBack()} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={[type.title, { fontSize: 23 }]}>{d.clan_tag ? `[${d.clan_tag}] ` : ''}{d.username}{d.is_you ? ' · you' : ''}</Text>
            <Text numberOfLines={1} adjustsFontSizeToFit style={type.caption}>{longDateTime(d.created_at)}</Text>
          </View>
          {!d.is_you ? <PressableScale accessibilityRole="button" accessibilityLabel={`Safety options for ${d.username}`} onPress={() => openSafetyActions({ userId: d.user_id, username: d.username, context: `run ${runId}`, onBlocked: () => navigation.goBack() })}><MoreHorizontal size={24} color={colors.text} /></PressableScale> : null}
        </Row>

        <View style={[styles.map, { flex: 1, minHeight: 100, marginBottom: 12 }]}
          onLayout={(event) => { const { width, height } = event.nativeEvent.layout; setMapSize((old) => old?.width === width && old?.height === height ? old : { width, height }); }}>
          {MAP_READY && path.length > 1 ? (
            <GameMap ref={mapRef} constrainToCity={false} locked initialCenter={path[0]} onReady={() => setMapReady(true)}>
              {ring.length >= 3 && <TerritoryFill id="d-terr" points={ring} fillColor={c.stroke} strokeColor={c.stroke} fillOpacity={0.25} />}
              <Trail id="d-trail" points={path} color={c.stroke} width={4} />
              <MapPoint id="d-start" point={path[0]} color="#36A76B" />
              <MapPoint id="d-finish" point={path[path.length - 1]} color={c.stroke} />
            </GameMap>
          ) : <View style={styles.mapPlaceholder}><Text style={type.caption}>{MAP_READY ? 'No route recorded' : 'Map needs the dev build'}</Text></View>}
        </View>

        <View style={styles.summary}>
          {[['Distance', km(d.distance_m), 'km'], ['Pace', fmtPace(d.distance_m, d.duration_s).split(' ')[0], '/km'], ['Time', fmtDuration(d.duration_s), ''], [d.closed_loop ? 'Claimed' : 'No claim', d.closed_loop ? (d.area_m2 / 1e6).toFixed(2) : '·', d.closed_loop ? 'km²' : '']].map(([label, value, unit]) => (
            <View key={label} style={{ width: '50%', paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={type.labelSm}>{label}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[type.statSm, { fontSize: 23 }]}>{value}<Text style={type.caption}> {unit}</Text></Text>
            </View>
          ))}
        </View>

        {splits.length > 0 ? <ProLockedSection context="run_detail" feature="run_splits" title="Splits" style={{ marginTop: 10 }}>
          <View style={[styles.summary, { display: 'flex', flexDirection: 'column', marginTop: 10, padding: 12 }]}>
            <Row between style={{ marginBottom: 6 }}>
              <Text style={type.label}>Splits</Text>
              <Row gap={12}>
                {pages > 1 ? <>
                  <PressableScale disabled={pageIndex === 0} accessibilityRole="button" hitSlop={12} accessibilityLabel="Previous splits" onPress={() => setSplitPage(pageIndex - 1)}><Text style={[type.bodySmBold, { opacity: pageIndex === 0 ? 0.3 : 1 }]}>‹</Text></PressableScale>
                  <Text style={type.caption}>{pageIndex + 1} / {pages}</Text>
                  <PressableScale disabled={pageIndex === pages - 1} accessibilityRole="button" hitSlop={12} accessibilityLabel="Next splits" onPress={() => setSplitPage(pageIndex + 1)}><Text style={[type.bodySmBold, { opacity: pageIndex === pages - 1 ? 0.3 : 1 }]}>›</Text></PressableScale>
                </> : null}
              </Row>
            </Row>
            {splits.slice(pageIndex * 4, pageIndex * 4 + 4).map((split) => <View key={split.km} style={[styles.splitRow, { marginBottom: 4 }]}>
              <Text style={[type.caption, { width: 42 }]}>{split.km} km</Text>
              <View style={styles.track}><View style={[styles.bar, { width: `${Math.max(12, split.seconds / slowest * 100)}%`, backgroundColor: c.stroke }]} /></View>
              <Text style={[type.bodySmBold, { width: 42, textAlign: 'right' }]}>{paceStr(split.seconds)}</Text>
            </View>)}
          </View>
        </ProLockedSection> : null}
        <PressableScale accessibilityRole="button" accessibilityLabel="Open comments and run details" onPress={() => setDetailsOpen(true)} style={{ paddingTop: 10, alignItems: 'center' }}>
          <Text style={type.bodySmBold}>Comments{d.is_you ? ' & territory details' : ''}  ↗</Text>
        </PressableScale>
      </Screen>
      <Modal visible={detailsOpen} animationType="slide" onRequestClose={() => setDetailsOpen(false)}>
        <Screen>
          <Row gap={12} style={{ paddingVertical: 12 }}><BackButton onPress={() => setDetailsOpen(false)} /><Text style={type.title}>Run details</Text></Row>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
              {d.is_you ? <TerritoryInsights runId={d.id} /> : null}
      {/* comments */}
      <Card
        frame="panel"
        frameTint={c.stroke}
        onLayout={onCommentsLayout}
        style={[styles.framedPanel, { marginTop: space.xl }]}
      >
        <Text style={[type.label, { color: colors.textMuted, marginBottom: space.md }]}>
          Comments{textComments.length ? ` · ${textComments.length}` : ''}
        </Text>
        {comments === undefined ? (
          <Skeleton width="100%" height={16} />
        ) : textComments.length === 0 ? (
          <Text style={[type.caption, { marginBottom: space.sm }]}>Be the first to say something.</Text>
        ) : (
          textComments.map((cm) => (
            <View key={cm.id} style={styles.commentRow}>
              <Row between>
                <Text style={type.bodySmBold}>
                  {cm.username}
                  {cm.is_you ? ' · you' : ''}
                  <Text style={[type.caption, { color: colors.textDim }]}>  {timeAgo(cm.created_at)}</Text>
                </Text>
                {!cm.is_you ? (
                  <PressableScale
                    onPress={() => openSafetyActions({
                      userId: cm.user_id,
                      username: cm.username,
                      context: `comment ${cm.id} on run ${runId}`,
                      onBlocked: (blockedId) => setComments((prev) =>
                        (prev || []).filter((item) => item.user_id !== blockedId)
                      ),
                    })}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={`Safety options for ${cm.username}`}
                  >
                    <MoreHorizontal size={20} color={colors.textMuted} />
                  </PressableScale>
                ) : null}
              </Row>
              <Text style={[type.bodySm, { marginTop: 2 }]}>{cm.body}</Text>
            </View>
          ))
        )}

        <View style={styles.commentInputRow}>
          <Input
            ref={inputRef}
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
            style={[styles.sendBtn, { backgroundColor: c.stroke, borderColor: nbInk(scheme, c.stroke), opacity: draft.trim() && !sending ? 1 : 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel="Post comment"
          >
            <Send size={18} color="#fff" />
          </PressableScale>
        </View>
      </Card>
            </ScrollView>
          </KeyboardAvoidingView>
        </Screen>
      </Modal>
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  // Stroke lives on the clipping box; the drop is the HardShadow wrapper's job.
  // marginTop moved to that wrapper so the box slides fully under its own drop.
  map: {
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
    ...toonSurface(colors, scheme, { on: colors.bgElevated }).outline,
  },
  summary: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: colors.card, borderRadius: 14, borderWidth: 2, borderColor: colors.text, paddingVertical: 5 },
  mapPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  kudos: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: space.sm },
  kudosSlot: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  kudosFx: { position: 'absolute', zIndex: 4 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  splitKm: { ...type.statSm, width: 52 },
  track: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.bgElevated, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  splitPace: { ...type.statSm, color: colors.textMuted, width: 52, textAlign: 'right' },
  // The panel art has a clipped upper-left corner. Its ordinary line clearance
  // is enough for straight edges but not for that diagonal.
  framedPanel: {
    paddingTop: 40,
    paddingLeft: 28,
    paddingRight: 24,
    paddingBottom: 24,
  },

  commentRow: { marginBottom: space.md },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, marginTop: space.sm },
  // Thin for the same reason as the club chat composer: it is half of a docked
  // row, not a field standing on its own.
  commentInput: {
    ...type.bodySm,
    flex: 1,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    maxHeight: 90,
    color: colors.text,
    ...nbField(scheme, { on: colors.bgElevated, stroke: NB.strokeThin }),
  },
  // Squared, stroked — part of the docked composer row, so it takes the stroke
  // and not the drop, the same call the comment field beside it makes (a flush
  // control, not a block sitting on the page). Border colour is set inline
  // against the clan fill it carries.
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: nbRadius.sm,
    borderWidth: NB.stroke,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
