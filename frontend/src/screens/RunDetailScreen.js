// Run detail — route on the game board, splits, claim outcome, kudos,
// comments. Reached from the feed and the You tab's recent runs.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { MoreHorizontal, Send } from 'lucide-react-native';
import { useIsFocused } from '@react-navigation/native';

import { api } from '../api/client';
import { updateCached } from '../api/cache';
import { useQuery } from '../hooks/useQuery';
import { NEUTRAL } from '../state/clan';
import { NB, nbField, nbInk, nbRadius, radius, space, toonSurface, withAlpha, useTheme, useThemedStyles, useThemedType } from '../theme';
import { Screen, Card, Row, Input, StatValue, Skeleton, HardShadow } from '../components/ui';
import { Arrival, PressableScale, haptic, useArrival } from '../ui/motion';
import GameMap, { MAP_READY, TerritoryFill, Trail, MapPoint } from '../components/GameMap';
import { toast } from '../ui/toast';
import GameLottie from '../components/GameLottie';
import ReactionBar, { ReactionTrigger } from '../components/ReactionBar';
import { useRunReactions } from '../hooks/useRunReactions';
import AppIcon from '../components/AppIcon';
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
  const { data: d, loading, error, setData: setD } = useQuery(
    `run:${runId}`,
    () => api.runDetail(runId)
  );
  const { data: comments, setData: setComments } = useQuery(
    `run:${runId}:comments`,
    () => api.runComments(runId),
    { fallback: [] }
  );
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [kudosFx, setKudosFx] = useState(0);
  const [reactOpen, setReactOpen] = useState(false);
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
    if (!screenFocused) setReactOpen(false);
  }, [screenFocused]);

  // Measured rather than guessed: the page above the composer is a map, a stat
  // row and a splits table whose height depends on how far the run was.
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

  // `d` is undefined until the first fetch or cache hit lands, which is fine:
  // the summary starts empty and fills in with everything else.
  const { reactions, mine, burst, react } = useRunReactions(runId, d, (r) => {
    setD((p) => (p ? { ...p, reactions: r.reactions, my_reaction: r.my_reaction } : p));
  });

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
    if (!d.kudoed) setKudosFx((token) => token + 1);
    // optimistic
    setD((p) => ({ ...p, kudoed: !p.kudoed, kudos_count: p.kudos_count + (p.kudoed ? -1 : 1) }));
    try {
      const r = await api.toggleKudos(runId);
      setD((p) => ({ ...p, kudoed: r.kudoed, kudos_count: r.kudos_count }));
      // Keep the feed row for this run in step — it's the same heart.
      updateCached('feed', (feed) => ({
        ...feed,
        items: (feed.items || []).map((row) =>
          (row.id === runId ? { ...row, kudoed: r.kudoed, kudos_count: r.kudos_count } : row)
        ),
      }));
    } catch (e) {
      toast.error(e.message || 'Could not send kudos');
    } finally {
      setBusy(false);
    }
  };

  const arriving = useArrival(loading);

  if (loading && error) return <Screen center><Text style={type.body}>Run not found.</Text></Screen>;
  if (loading) {
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
  // Reactions are deliberately separate from comments. Older servers may
  // still return sticker-only rows; omit those instead of putting emojis back
  // into the discussion.
  const textComments = (comments || []).filter((cm) => cm.body?.trim());

  // Bound and wrapped below rather than in place — see the same pattern in
  // ClubScreen; the page is far too long to re-indent for one parent.
  const page = (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
    <Screen scroll scrollRef={scrollRef} contentStyle={{ paddingBottom: space.xxl }}>
      {/* map — a defined NB object: heavy stroke on the inner box (which clips),
          hard offset drop from HardShadow so it lands on Android too. The clan
          colours stay inside the trail and territory; the box's own edge is
          neutral chrome. */}
      <HardShadow radius={radius.card} on={colors.bgElevated} style={{ marginTop: space.md }}>
        <View style={styles.map}>
          {MAP_READY && path.length > 1 ? (
            <GameMap initialCenter={path[0]} initialZoom={14}>
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
      </HardShadow>

      {/* header */}
      <Row between style={{ marginTop: space.lg }}>
        <View>
          <Text style={type.title}>{d.clan_tag ? `[${d.clan_tag}] ` : ''}{d.username}{d.is_you ? ' · you' : ''}</Text>
          <Text style={type.caption}>{longDateTime(d.created_at)}</Text>
        </View>
        <View style={styles.kudosSlot}>
          {/* Cleared on finish — left up, it is an invisible last frame sitting
              over the button it just celebrated. */}
          {kudosFx > 0 ? (
            <GameLottie
              name="kudos"
              size={96}
              trigger={kudosFx}
              onFinish={() => setKudosFx(0)}
              style={styles.kudosFx}
            />
          ) : null}
          <Row gap={2}>
            {!d.is_you ? (
              <PressableScale
                onPress={() => openSafetyActions({
                  userId: d.user_id,
                  username: d.username,
                  context: `run ${runId}`,
                  onBlocked: () => navigation.goBack(),
                })}
                style={styles.kudos}
                accessibilityRole="button"
                accessibilityLabel={`Safety options for ${d.username}`}
              >
                <MoreHorizontal size={24} color={colors.textMuted} />
              </PressableScale>
            ) : null}
            <ReactionTrigger
              mine={mine}
              active={reactOpen}
              color={c.stroke}
              onPress={() => { haptic.light(); setReactOpen((v) => !v); }}
            />
            <PressableScale
              onPress={kudos}
              style={styles.kudos}
              accessibilityRole="button"
              accessibilityState={{ selected: !!d.kudoed }}
              accessibilityLabel={d.kudoed ? 'Remove kudos' : 'Give kudos'}
            >
              {/* Same two states as the feed card's heart: full strength once
                  you have given it, a step down before. */}
              <AppIcon name="like" size={28} opacity={d.kudoed ? 1 : 0.62} />
              <Text style={[type.bodySmBold, { color: d.kudoed ? c.stroke : colors.textMuted }]}>{d.kudos_count}</Text>
            </PressableScale>
          </Row>
        </View>
      </Row>

      {/* Chips always; the picker only when asked for. This page used to show
          all eight tiles permanently, which put a control block between the
          runner's name and their splits on a screen you opened to read the
          run. */}
      <ReactionBar
        reactions={reactions}
        mine={mine}
        burst={burst}
        color={c.stroke}
        onReact={react}
        open={reactOpen}
        onRequestClose={() => setReactOpen(false)}
        style={{ marginTop: space.md }}
      />

      <Row between style={{ marginTop: space.lg }}>
        <StatValue size="md" label="Distance" value={km(d.distance_m)} unit="km" />
        <StatValue size="md" label="Pace" value={fmtPace(d.distance_m, d.duration_s).split(' ')[0]} unit="/km" />
        <StatValue size="md" label="Time" value={fmtDuration(d.duration_s)} />
        <StatValue size="md" label={d.closed_loop ? 'Claimed' : 'No claim'} value={d.closed_loop ? (d.area_m2 / 1e6).toFixed(d.area_m2 >= 1e5 ? 2 : 3) : '·'} unit={d.closed_loop ? 'km²' : ''} color={d.closed_loop ? c.stroke : colors.textDim} />
      </Row>

      {/* splits — drawn box. The two panels on this page are the two blocks
          of detail you came here to read, so they are the ones that earn the
          ink; the map and the stat row above are already strong shapes.

          PRO depth: the per-kilometre breakdown is a richer VIEW of a run, not
          a lever on it — reading your splits changes nothing about the ground
          you hold, so it is a fair thing to sell. When PRO is off in this
          build the lock never appears and everyone keeps their splits. */}
      {d.splits.length > 0 && (
        <ProLockedSection
          context="run_detail"
          feature="run_splits"
          title="Splits"
          blurb="Your per kilometre pace, fastest to slowest."
          style={{ marginTop: space.xl }}
        >
          {/* marginTop lives on the Card too, not only on the wrapper: when
              PRO is off or the runner is a subscriber the section renders these
              children directly, so the gap has to travel with them. */}
          <Card frame="panel" frameTint={c.stroke} style={[styles.framedPanel, { marginTop: space.xl }]}>
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
        </ProLockedSection>
      )}

      {/* What this run did for the ground you hold — the same free/PRO split
          the result screen shows, so a run read back a week later says exactly
          what it said on the day.

          OWN RUNS ONLY, and that is not a preference: /runs/{id}/insights
          answers 404 for anybody else's run (see the note on guessable ids in
          backend/app/routes/insights.py). Rendering it on a stranger's run
          would show a permanently empty panel, and on a PRO account it would
          look like the analytics had broken. */}
      {d.is_you ? <TerritoryInsights runId={d.id} style={{ marginTop: space.xl }} /> : null}

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
    </Screen>
    </KeyboardAvoidingView>
  );

  return (
    <Arrival active={arriving} style={{ flex: 1 }}>
      {page}
    </Arrival>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  // Stroke lives on the clipping box; the drop is the HardShadow wrapper's job.
  // marginTop moved to that wrapper so the box slides fully under its own drop.
  map: {
    height: 240,
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
    ...toonSurface(colors, scheme, { on: colors.bgElevated }).outline,
  },
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
