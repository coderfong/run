// RunnerProfile — another runner's public profile, opened from a paser row, a
// map portrait or the Crossroads plaza.
//
// The read-only twin of the You tab, and it is meant to be recognisable as one:
// the same roadside scene behind the portrait, the same drawn stat wall, the
// same bust in the same rank border. `state` comes from the server so the paser
// button is always right, even if the relationship changed on another device.
//
// THE HEADER IS THREE THINGS, IN THIS ORDER: a framed picture of the runner on
// the road, the chips that say who they are, then the buttons for what you can
// do about it. It used to be one pile stacked on the scene — chips straddling
// the road's bottom edge, the paser button under them and the safety button
// under that, with the whole page starting a bar's height too low because it
// paid the safe-area inset a second time under a navigation bar that had
// already paid it. Each of those is fixed at its own layer below.
//
// The wall used to be six bare Cards at `width: '31%'`. A Card renders inside
// its own hard-shadow wrapper, and it is the WRAPPER that gets laid out — so
// the percentage resolved against a box that had no width of its own, every
// tile collapsed to the width of its longest word, and the page showed six
// black columns with "DISTANCE" set one letter per line. Sharing You's tile
// (components/StatTile.js) fixes it and makes the two walls one thing;
// components/ui/Card.js now also moves sizing onto that wrapper, so a plain
// Card with a width can never fail this way again.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { useQuery } from '../hooks/useQuery';
import { radius, space, toon, useTheme, useThemedType, useThemedStyles } from '../theme';
import { Screen, Card, Row, Button, Framed, Pill, OutlinedText, SectionHeader, Skeleton, EmptyState } from '../components/ui';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import SceneBackdrop, { useSceneBackdrop } from '../components/SceneBackdrop';
import StatTile from '../components/StatTile';
import { Arrival, PressableScale, Reveal, useArrival } from '../ui/motion';
import AppIcon from '../components/AppIcon';
import { toast } from '../ui/toast';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';
import { openSafetyActions } from '../utils/safety';
import { shortDate } from '../utils/time';

const km = (m) => (m / 1000).toFixed(1);
const km2 = (m2) => (m2 / 1e6).toFixed(2);
const mins = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export default function RunnerProfileScreen({ navigation, route }) {
  const { userId, username } = route.params || {};
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  // The leaves stop crossing when this page is not the one you are looking at
  // — same rule the You tab's own scene follows.
  const focused = useIsFocused();
  // The roadside scene behind the portrait: daytime kerb in light, the lamp-lit
  // street in dark. It sizes itself to the window rather than to this header,
  // so the header only needs the height to reserve room for it.
  const { height: sceneH } = useSceneBackdrop({ variant: 'profile' });
  // The name is the lowest thing standing ON the scene, so the hero panel has
  // to be at least tall enough to hold it — measured rather than guessed, the
  // same way the You tab sizes its own header. `bleed` fills anything the art
  // does not reach with road, so a taller box reads as a longer road.
  const [nameBottom, setNameBottom] = useState(0);
  const heroH = Math.max(sceneH, nameBottom ? nameBottom + space.md : 0);
  // Cached per runner, so tapping back into someone you just looked at draws
  // their profile at once. The key changes with the runner, and useQuery
  // re-seeds on a key change — the previous runner's stats never linger.
  const { data: p, loading, error, refresh: load } = useQuery(
    userId ? `runner:${userId}` : null,
    () => api.runnerProfile(userId)
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (p) preloadRunnerAssets([p]);
  }, [p]);

  // Keep the header title honest even before the fetch lands.
  useEffect(() => {
    navigation.setOptions({ title: p?.username || username || 'Runner' });
  }, [navigation, p?.username, username]);

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

  const arriving = useArrival(loading);

  if (loading && error) {
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
  if (loading) {
    return (
      <Screen edges={[]}>
        <Skeleton width="100%" height={220} style={{ borderRadius: radius.card, marginTop: space.md }} />
        <Skeleton width="100%" height={180} style={{ borderRadius: radius.card, marginTop: space.md }} />
      </Screen>
    );
  }

  const accent = p.clan_color?.stroke || colors.textMuted;

  // The runner actions, as a flat list of equal-width buttons rather than a
  // stack — the paser action and the safety action are two things you can do
  // to this runner, and stacking them made the second read as a warning about
  // the first. Every one of them is `flex: 1` inside its row, so a row of two
  // splits the page and a row of one fills it. `Your paser` is no longer one
  // of them: a state is not an action, so it sits with the other status chips.
  const paserButtons = () => {
    if (p.state === 'self') return [];
    switch (p.state) {
      case 'none':
        return [
          <Button
            key="add"
            title="Add paser"
            variant="gradient"
            size="sm"
            full={false}
            loading={busy}
            icon={<AppIcon name="invite" size={18} />}
            style={styles.action}
            onPress={() => act(() => api.addPaser(userId), `Request sent to ${p.username}`)}
          />,
        ];
      case 'pending_out':
        // WAS "Requested · tap to cancel", which is a sentence, and a sentence
        // does not fit in half a row. The chip above already says a request is
        // out; this says what tapping does.
        return [
          <Button
            key="cancel"
            title="Cancel request"
            variant="secondary"
            size="sm"
            full={false}
            loading={busy}
            style={styles.action}
            onPress={() => act(() => api.removePaser(userId), 'Request cancelled')}
          />,
        ];
      case 'pending_in':
        return [
          <Button
            key="accept"
            title="Accept"
            size="sm"
            full={false}
            loading={busy}
            style={styles.action}
            onPress={() => act(() => api.respondToPaser(p.request_id, 'accept'), `You and ${p.username} are pasers`)}
          />,
          <Button
            key="decline"
            title="Decline"
            variant="secondary"
            size="sm"
            full={false}
            loading={busy}
            style={styles.action}
            onPress={() => act(() => api.respondToPaser(p.request_id, 'decline'))}
          />,
        ];
      case 'paser':
        return [
          <Button
            key="remove"
            title="Remove paser"
            variant="secondary"
            size="sm"
            full={false}
            loading={busy}
            style={styles.action}
            onPress={() => act(() => api.removePaser(userId), `Removed ${p.username}`)}
          />,
        ];
      default:
        return [];
    }
  };

  const actions = paserButtons();
  if (p.state !== 'self') {
    actions.push(
      <Button
        key="safety"
        title="Report or block"
        variant="secondary"
        size="sm"
        full={false}
        style={styles.action}
        onPress={() => openSafetyActions({
          userId,
          username: p.username,
          context: 'runner profile',
          onBlocked: () => {
            // A block empties this runner out of the plaza and the badge as
            // well as out of feeds. Dropping the cached Crossed Paths means
            // the screen you go BACK to has already forgotten them, rather
            // than showing them until its next refresh lands.
            invalidate('me:paserby');
            navigation.goBack();
          },
        })}
      />
    );
  }
  // Three buttons at half a row each do not fit, and the pair that answers a
  // request belongs together — so the incoming-request case keeps Accept and
  // Decline on their own line and drops the safety action underneath.
  const actionRows = actions.length > 2
    ? [actions.slice(0, -1), actions.slice(-1)]
    : [actions];

  const page = (
    <Screen scroll edges={[]} contentStyle={{ paddingBottom: space.xxl }}>
      <Reveal style={styles.header}>
        {/* THE SCENE IS A PICTURE, SO IT HANGS IN A FRAME. It used to be a
            bare band bled to the window edges: the one surface on a page made
            of drawn boxes with no drawn edge of its own, which is why it read
            as a banner the page was sitting under rather than as part of it.
            Same treatment the feed gives a photo — ink round the outside, the
            art clipped to the box inside it.

            The clip is on the CONTENT, never on the frame's own View: the ink
            sits a shade outside the box it is given, so clipping there would
            shave the drawn line off its own corners. */}
        <Framed
          frame={frameVariant('featured', `runner:${userId}`)}
          weight={INK.bold}
          pose={framePose(`runner:${userId}`)}
          inset={false}
          contentStyle={[styles.heroInner, { height: heroH }]}
        >
          {/* The same scene the You tab stands on, with the same wind through
              it — this page is that page for somebody else, and it read as a
              different app entirely without it. `bleed` fills any box taller
              than the art with road rather than cropping into the trees. */}
          <SceneBackdrop variant="profile" minHeight={heroH} bleed ambient="leaves" playing={focused} />
          {/* Border comes from RANK (territorial standing), not level — same
              rule as your own profile. The bust fills the frame's opening, on
              an opaque disc: at anything less the scene shows through the gap. */}
          <PortraitBorder borderKey={p.rank_key || 'wood'} size={104}>
            <CharacterBust equipped={p.avatar} size={104} ring={accent} bg={colors.cardAlt} />
          </PortraitBorder>
          {/* On the scene, so it takes the game treatment — white with an ink
              outline — rather than the palette's body colour, which is
              near-black in light mode and vanishes into the hedge. */}
          <View
            style={styles.nameRow}
            onLayout={(e) => {
              const { y, height } = e.nativeEvent.layout;
              setNameBottom(y + height);
            }}
          >
            <OutlinedText style={[type.title, { color: '#fff' }]} outline={toon.ink} width={2.5}>
              {p.username}
            </OutlinedText>
          </View>
        </Framed>

        {/* The chips come OFF the scene and onto the paper. They used to sit
            across its bottom edge, half on the road and half on the page, so
            the one thing on the screen with no ground under it was the row
            you read first. */}
        <Row gap={8} style={styles.pills}>
          <Pill label={p.clan_tag ? `[${p.clan_tag}]` : 'Solo'} color={accent} dot />
          {/* Seeded on the FIELD, not the value, so a chip keeps its colour as
              the number behind it climbs. */}
          <Pill label={`Level ${p.level}`} seed="profile:level" />
          <Pill label={`${p.paser_count} paser${p.paser_count === 1 ? '' : 's'}`} seed="profile:pasers" />
          {p.state === 'paser' ? <Pill label="Your paser" color={accent} dot /> : null}
          {p.state === 'pending_out' ? <Pill label="Request sent" seed="profile:pending" /> : null}
        </Row>

        {actionRows.map((row, i) => (
          row.length ? <Row key={i} gap={space.sm} style={styles.actions}>{row}</Row> : null
        ))}
      </Reveal>

      {/* The same six drawn tiles You gets, dealt the same frames off the same
          labels. Nothing counts up here: the count-up is reserved for your own
          area held (see theme/motion — one counting number per screen). */}
      <View style={styles.wall}>
        <StatTile label="Area held" value={km2(p.total_area_m2)} unit="km²" accent={accent} style={styles.tile} />
        <StatTile label="Distance" value={km(p.career_distance_m)} unit="km" style={styles.tile} />
        <StatTile label="Runs" value={String(p.runs_count)} style={styles.tile} />
        <StatTile label="Biggest claim" value={km2(p.biggest_claim_m2)} unit="km²" accent={accent} style={styles.tile} />
        <StatTile label="Zones" value={String(p.territory_count)} style={styles.tile} />
        <StatTile label="Solo Elo" value={String(p.solo_elo || 1000)} unit={p.solo_elo_label || 'Wood'} accent={accent} style={styles.tile} />
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
                    {shortDate(r.created_at)}
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

  return (
    <Arrival active={arriving} style={{ flex: 1 }}>
      {page}
    </Arrival>
  );
}

const makeStyles = (colors, _scheme, type) => StyleSheet.create({
  // No `paddingTop` any more: the page no longer pays the safe-area inset a
  // second time (see the Screen's `edges`), so the header starts a single
  // gutter under the navigation bar instead of a bar's height below it.
  header: { marginTop: space.md, marginBottom: space.lg },
  // The scene, clipped to the frame. `paddingTop` drops the portrait onto the
  // road rather than onto the treeline; the rounded clip keeps the art's square
  // corners from poking out past a hand-drawn line that curves in at every one
  // of them. Nothing here paints a background — the picture IS the background.
  heroInner: {
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: radius.md,
    paddingTop: space.lg,
    paddingHorizontal: space.lg,
  },
  nameRow: { alignItems: 'center', marginTop: space.sm },
  // Centred and wrapping: a clan tag, a level, a paser count and a relationship
  // is four chips, and four chips do not fit on one line of a small phone.
  pills: { flexWrap: 'wrap', justifyContent: 'center', rowGap: 8, marginTop: space.md },
  actions: { marginTop: space.sm },
  action: { flex: 1 },
  wall: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  // 31.5, matching You: the drawn frame's ink sits a shade outside the box it
  // is given, and three tiles at 31 left a visible seam of page between them.
  tile: { width: '31.5%', marginBottom: space.md },
});
