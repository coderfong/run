// RunnerProfile — another runner's public profile, opened from a paser row, a
// map portrait or the Crossroads plaza.
//
// The read-only twin of the You tab, and it is meant to be recognisable as one:
// the same roadside scene behind the portrait, the same drawn stat wall, the
// same bust in the same rank border. `state` comes from the server so the paser
// button is always right, even if the relationship changed on another device.
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
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { useQuery } from '../hooks/useQuery';
import { radius, space, toon, useTheme, useThemedType, useThemedStyles } from '../theme';
import { Screen, Card, Row, Button, Pill, OutlinedText, SectionHeader, Skeleton, EmptyState } from '../components/ui';
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

  const page = (
    <Screen scroll contentStyle={{ paddingBottom: space.xxl }}>
      <Reveal style={[styles.header, { minHeight: sceneH }]}>
        {/* The same scene the You tab stands on, with the same wind through it
            — this page is that page for somebody else, and it read as a
            different app entirely without it. `bleed` fills any box taller than
            the art with road rather than cropping into the trees. */}
        <SceneBackdrop variant="profile" minHeight={sceneH} bleed ambient="leaves" playing={focused} />
        {/* Border comes from RANK (territorial standing), not level — same
            rule as your own profile. The bust fills the frame's opening, on an
            opaque disc: at anything less the scene shows through the gap. */}
        <PortraitBorder borderKey={p.rank_key || 'wood'} size={104}>
          <CharacterBust equipped={p.avatar} size={104} ring={accent} bg={colors.cardAlt} />
        </PortraitBorder>
        {/* On the scene, so it takes the game treatment — white with an ink
            outline — rather than the palette's body colour, which is near-black
            in light mode and vanishes into the hedge. */}
        <OutlinedText
          style={[type.title, { color: '#fff', marginTop: space.md }]}
          outline={toon.ink}
          width={2.5}
        >
          {p.username}
        </OutlinedText>
        <Row gap={8} style={{ marginTop: space.sm }}>
          <Pill label={p.clan_tag ? `[${p.clan_tag}]` : 'Solo'} color={accent} dot />
          {/* Seeded on the FIELD, not the value, so a chip keeps its colour as
              the number behind it climbs. */}
          <Pill label={`Level ${p.level}`} seed="profile:level" />
          <Pill label={`${p.paser_count} paser${p.paser_count === 1 ? '' : 's'}`} seed="profile:pasers" />
        </Row>
        {paserAction()}
        {p.state !== 'self' ? (
          <Button
            title="Report or block"
            variant="secondary"
            size="sm"
            full={false}
            style={{ marginTop: space.sm }}
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
        ) : null}
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
        <StatTile label="Level" value={String(p.level)} style={styles.tile} />
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
  // `paddingTop` drops the portrait onto the road rather than onto the treeline,
  // and the bottom margin closes back up because the header now ENDS at the
  // scene's edge — the same pair of numbers the You tab's header carries.
  header: { alignItems: 'center', marginTop: space.md, marginBottom: space.md, paddingTop: space.lg },
  wall: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  // 31.5, matching You: the drawn frame's ink sits a shade outside the box it
  // is given, and three tiles at 31 left a visible seam of page between them.
  tile: { width: '31.5%', marginBottom: space.md },
});
