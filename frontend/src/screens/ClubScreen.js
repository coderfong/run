// Club tab. Clubless -> a directory (search, create, join-by-code). Member ->
// the club hub (header, weekly goal, members, role-gated management).

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from '../ui/image';
import { ArrowRight, Camera, Users } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../auth/AuthContext';
import { useClan } from '../state/clan';
import { nbField, space, withAlpha, useTheme, useThemedType, useThemedStyles } from '../theme';
import { art } from '../config/onboardingArt';
import { Screen, Card, Framed, Row, Button, Input, Pill, SectionHeader, Segmented, Skeleton, EmptyState, ToonButton } from '../components/ui';
import ClubAvatar from '../components/ClubAvatar';
import RankCard from '../components/rank/RankCard';
import { standingFrom } from '../config/rankLadder';
import { toast } from '../ui/toast';
import { pickPhoto } from '../ui/photoPicker';
import { framePose, frameVariant } from '../ui/frameRegistry';
import { Arrival, Bar, PressableScale, useArrival } from '../ui/motion';
import GameLottie from '../components/GameLottie';
import { INK } from '../ui/frameRegistry';

const km = (m) => (m / 1000).toFixed(1);
const LEAGUE_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };

const CLUB_INTRO_KEY = 'tr.clubIntro.v1';

// Every hub tab lays out on the same page padding, so the switcher does not
// move under your thumb when you switch with it. The hub used to be a raw
// ScrollView, which skipped Screen's top safe-area inset entirely and parked
// the switcher under the status bar and the Dynamic Island, where roughly half
// of it could not be tapped at all.
//
// NO paddingTop HERE. Screen flattens [inset, contentStyle] in that order, so
// a paddingTop on this side wins over the safe-area inset and puts the page
// back under the status bar — the exact bug it looks like it is fixing. The
// gap above the switcher is a margin on the switcher instead.
const HUB_PAGE = { paddingBottom: space.xxl };

function ClubIntroOverlay({ step, onNext, accent }) {
  const styles = useThemedStyles(makeStyles);
  if (step == null) return null;
  const ranking = step === 1;
  // Ranking rows get the sticker trophy; the members row keeps the lucide
  // glyph, since there is no sticker for a group of people.
  // Ranking rows get the sticker trophy; the members row keeps the lucide
  // glyph, since there is no sticker for a group of people.
  const Icon = Users;
  return (
    <View style={styles.introOverlay} accessibilityViewIsModal>
      <View style={styles.introScrim} />
      <Framed
        frame={ranking ? 'bubble' : 'panel'}
        tint={accent}
        fill={ranking ? '#2A1743' : '#132F39'}
        weight={INK.medium}
        inset={false}
        style={styles.introCard}
        contentStyle={styles.introInner}
      >
        <View style={[styles.introIcon, { backgroundColor: accent }]}>
          {ranking
            ? <AppIcon name="trophy" size={46} />
            : <Icon size={42} color="#FFFFFF" strokeWidth={2.4} />}
        </View>
        <View style={styles.introDots}>
          {[0, 1].map((i) => <View key={i} style={[styles.introDot, i === step && { backgroundColor: accent, width: 20 }]} />)}
        </View>
        <Text style={styles.introTitle}>{ranking ? 'Club rankings' : 'Club view'}</Text>
        <Text style={styles.introBody}>
          {ranking
            ? 'See the club standings. Tap a club to view it.'
            : 'Weekly goals, members, chat and invites, all in one place.'}
        </Text>
        <ToonButton title={ranking ? 'Got it' : 'Show me rankings'} onPress={onNext} fill={{ color: accent, border: '#FFFFFF' }} />
      </Framed>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Clanless directory
// ---------------------------------------------------------------------------

// The searchable list of every club. Shared by the clubless directory and by
// the member hub's "All clubs" tab, so there is ONE club browser in the app
// rather than two that drift apart — joining a club used to take the directory
// away with it, leaving no way back to the other clubs.
function ClubSearch({ navigation, emptyBody = 'Be the first. Create a club and claim land together.' }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const [q, setQ] = useState('');

  // The default listing (empty search) is cached, so the browser has clubs in
  // it the moment you open it. Typed searches go through the same cache keyed
  // by term, so backspacing through a query re-shows each result set instead
  // of re-querying it.
  const { data: results, loading: searching } = useQuery(
    `clans:search:${q.trim()}`,
    () => api.searchClans(q.trim()),
    { fallback: [] }
  );

  return (
    <>
      <Input
        style={styles.input}
        value={q}
        onChangeText={setQ}
        placeholder="Search by name or tag"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
      />

      <View style={{ marginTop: space.md }}>
        {searching ? (
          <Skeleton width="100%" height={64} style={{ borderRadius: 16 }} />
        ) : results.length === 0 ? (
          <EmptyState
            art={require('../../assets/art/empty-club.png')}
            title={q.trim() ? 'No matches' : 'No clubs yet'}
            body={q.trim() ? 'Try another name or tag.' : emptyBody}
            style={{ paddingTop: space.lg }}
          />
        ) : (
          results.map((c) => (
            // Dealt a drawn box off the club's own id, so a directory of them
            // is a stack of hand-drawn cards rather than one card repeated —
            // the same rule the feed's frames follow.
            <Card
              key={c.id}
              frame={frameVariant('box', `club:${c.id}`)}
              framePose={framePose(`club:${c.id}`)}
              frameTint={c.color.stroke}
              onPress={() => navigation.navigate('ClubDetail', { clanId: c.id })}
              style={{ marginBottom: space.sm }}
            >
              <Row between>
                <Row gap={12}>
                  <ClubAvatar photoUrl={c.photo_url} badgeIcon={c.badge_icon} color={c.color} />
                  <View>
                    <Text style={type.bodyBold}>[{c.tag}] {c.name}</Text>
                    <Text style={type.caption}>
                      {c.member_count} members{c.league ? `, ${LEAGUE_LABEL[c.league]} league` : ''}
                      {c.privacy !== 'open' ? ', invite only' : ''}
                    </Text>
                  </View>
                </Row>
                <Text style={[type.statSm, { color: c.color.stroke }]}>{(c.season_area_m2 / 1e6).toFixed(1)}</Text>
              </Row>
            </Card>
          ))
        )}
      </View>
    </>
  );
}

function Directory({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { refresh } = useClan();
  const [code, setCode] = useState('');

  const joinCode = async () => {
    if (!code.trim()) return;
    try {
      await api.joinByCode(code.trim());
      invalidate('clan');
      await refresh();
      toast.success('Joined club');
    } catch (e) {
      toast.error(e.message || 'Invalid code');
    }
  };

  return (
    <Screen scroll contentStyle={{ paddingBottom: space.xxl }}>
      <View style={styles.dirHeader}>
        <Text style={type.display}>Clubs</Text>
        <View style={styles.dirCrewWrap}>
          <Image source={require('../../assets/art/club-crew.png')} style={styles.dirCrew} resizeMode="contain" />
        </View>
      </View>
      <Text style={[type.body, { color: colors.textMuted, marginTop: 4, marginBottom: space.lg }]}>
        Solo land is grey. Club land claims.
      </Text>

      <Button title="Create a club" variant="gradient" icon={<AppIcon name="invite" size={20} />} onPress={() => navigation.navigate('ClubCreate')} />

      {/* the Join button matches the input height and centres with it */}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md, alignItems: 'center' }}>
        <Input
          style={[styles.input, { flex: 1, height: 48 }]}
          value={code}
          onChangeText={setCode}
          placeholder="Have an invite code?"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
        />
        <Button title="Join" variant="gradient" size="sm" full={false} onPress={joinCode} icon={<ArrowRight size={16} color="#fff" />} style={{ height: 48, justifyContent: 'center' }} />
      </View>

      <SectionHeader title="Find a club" style={{ marginTop: space.xl, marginBottom: space.md }} />
      <ClubSearch navigation={navigation} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Member hub
// ---------------------------------------------------------------------------

function MemberHub({ clanId, navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const { refresh } = useClan();
  // Shares the `clan:<id>` key with the public club profile, so opening one
  // from the other costs nothing and the hub is drawn on the first frame.
  const { data: clan, loading, refresh: load } = useQuery(
    clanId ? `clan:${clanId}` : null,
    () => api.getClan(clanId)
  );
  // Only leaders and officers can see the join queue, and `my_role` arrives
  // with the club — so this query stays disabled until we know.
  const canSeeRequests = clan?.my_role === 'leader' || clan?.my_role === 'officer';
  const { data: requests, refresh: reloadRequests } = useQuery(
    clanId ? `clan:${clanId}:requests` : null,
    () => api.listJoinRequests(clanId),
    { enabled: canSeeRequests, fallback: [] }
  );
  const [pulling, setPulling] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [clubView, setClubView] = useState('view');
  const { data: clubRanks, loading: ranksLoading, refresh: reloadRanks } = useQuery(
    'leaderboard:clans:elo',
    api.clanEloLeaderboard,
    { enabled: clubView === 'rankings', fallback: [] }
  );

  const onRefresh = async () => {
    setPulling(true);
    try {
      await Promise.all([load(), canSeeRequests ? reloadRequests() : null]);
    } finally {
      setPulling(false);
    }
  };

  const arriving = useArrival(loading);

  if (loading) {
    return (
      <Screen>
        <Skeleton width="100%" height={120} style={{ borderRadius: 16, marginTop: space.md }} />
        <Skeleton width="100%" height={64} style={{ borderRadius: 16, marginTop: space.md }} />
      </Screen>
    );
  }

  const accent = clan.color.stroke;
  const myRole = clan.my_role;
  const canManage = myRole === 'leader' || myRole === 'officer';
  const goal = clan.week_goal;
  const distPct = goal ? Math.min(1, goal.progress_distance_m / goal.target_distance_m) : 0;
  const claimPct = goal ? Math.min(1, goal.progress_claims / Math.max(1, goal.target_claims)) : 0;

  const invite = async () => {
    try {
      const inv = await api.createInvite(clanId);
      await Share.share({ message: `Join ${clan.tag} on PASER: ${inv.url}` });
    } catch (e) {
      toast.error(e.message || 'Could not create invite');
    }
  };

  const leave = () => {
    Alert.alert('Leave club?', myRole === 'leader' ? 'Transfer leadership first if others remain.' : 'You can rejoin later.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          try {
            await api.leaveClan();
            // Every cached club view now shows you as a member; drop them all
            // rather than let a stale roster greet you on the way back in.
            invalidate('clan:');
            await refresh();
            toast.success('Left club');
          }
          catch (e) { toast.error(e.message || 'Could not leave'); }
        },
      },
    ]);
  };

  // The crest belongs to the whole club, so only the people who run it can
  // change it. Writing it invalidates every cached club view: the directory,
  // the standings and this hub all carry the old photo URL.
  const setPhoto = async (photo) => {
    setPhotoBusy(true);
    try {
      await api.updateClan(clanId, { photo });
      invalidate('clan');
      invalidate('leaderboard:clans');
      await Promise.all([load(), refresh()]);
      toast.success(photo ? 'Club photo updated' : 'Club photo removed');
    } catch (e) {
      toast.error(e.message || 'Could not update the club photo');
    } finally {
      setPhotoBusy(false);
    }
  };

  const pickClubPhoto = async (source) => {
    try {
      const picked = await pickPhoto(source, { square: true });
      if (picked) await setPhoto(picked);
    } catch (e) {
      toast.error(e.message || 'Could not add that photo');
    }
  };

  const changePhoto = () => {
    if (!canManage || photoBusy) return;
    const opts = [
      { text: 'Choose photo', onPress: () => pickClubPhoto('library') },
      { text: 'Take photo', onPress: () => pickClubPhoto('camera') },
    ];
    if (clan.photo_url) {
      opts.push({ text: 'Remove photo', style: 'destructive', onPress: () => setPhoto('') });
    }
    Alert.alert('Club photo', 'Every runner who finds your club sees this.', [
      ...opts,
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const manageMember = (m) => {
    if (!canManage || m.user_id === user.id) return;
    const opts = [];
    if (myRole === 'leader' && m.role === 'member') opts.push({ text: 'Promote to officer', onPress: () => act(() => api.setClanRole(clanId, m.user_id, 'officer')) });
    if (myRole === 'leader' && m.role === 'officer') opts.push({ text: 'Demote to member', onPress: () => act(() => api.setClanRole(clanId, m.user_id, 'member')) });
    if (myRole === 'leader') opts.push({ text: 'Transfer leadership', onPress: () => act(() => api.setClanRole(clanId, m.user_id, 'leader')) });
    if (m.role !== 'leader') opts.push({ text: 'Kick', style: 'destructive', onPress: () => act(() => api.kickMember(clanId, m.user_id)) });
    if (!opts.length) return;
    Alert.alert(m.username, 'Manage member', [...opts, { text: 'Cancel', style: 'cancel' }]);
  };

  const act = async (fn) => {
    try {
      await fn();
      await Promise.all([load(), reloadRequests(), refresh()]);
    } catch (e) { toast.error(e.message || 'Action failed'); }
  };

  const tabs = (
    <Segmented
      options={[
        { key: 'view', label: 'Club view' },
        { key: 'rankings', label: 'Club rank' },
        { key: 'browse', label: 'All clubs' },
      ]}
      value={clubView}
      onChange={setClubView}
      style={{ marginTop: space.sm }}
    />
  );

  if (clubView === 'browse') {
    return (
      <Screen scroll contentStyle={HUB_PAGE}>
        {tabs}
        {/* The segment already says "All clubs", so this is the one thing the
            list does not say for itself. */}
        <Text style={[type.body, { color: colors.textMuted, marginTop: space.lg, marginBottom: space.md }]}>
          Tap a club to look inside.
        </Text>
        <ClubSearch navigation={navigation} emptyBody="Nothing to browse yet." />
      </Screen>
    );
  }

  if (clubView === 'rankings') {
    return (
      <Screen scroll contentStyle={HUB_PAGE}>
        {tabs}
        <Card style={styles.rankHero}>
          <Row gap={space.md}>
            <AppIcon name="trophy" size={34} />
            <View style={{ flex: 1 }}>
              <Text style={type.title}>Club rank standings</Text>
              <Text style={type.caption}>Rated territory battles move both clubs up or down.</Text>
            </View>
          </Row>
        </Card>
        {ranksLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={72} style={{ borderRadius: 16, marginTop: space.sm }} />
          ))
        ) : (clubRanks || []).map((entry, index) => (
          <Card
            key={entry.clan_id}
            frame={frameVariant('box', `club-rank:${entry.clan_id}`)}
            framePose={framePose(`club-rank:${entry.clan_id}`)}
            frameTint={entry.color?.stroke || accent}
            onPress={() => navigation.navigate('ClubDetail', { clanId: entry.clan_id })}
            style={{ marginTop: space.sm }}
          >
            <Row gap={space.md}>
              <Text style={[type.statSm, { width: 28, color: index < 3 ? '#F5B32C' : colors.textDim }]}>#{index + 1}</Text>
              <ClubAvatar
                photoUrl={entry.photo_url}
                badgeIcon={entry.badge_icon}
                color={entry.color || { fill: colors.cardAlt, stroke: accent }}
              />
              <View style={{ flex: 1 }}>
                <Text style={type.bodyBold}>[{entry.tag}] {entry.name}</Text>
                <Text style={type.caption}>
                  {entry.elo_label || 'Wood'}, {entry.member_count} members
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[type.bodySmBold, { color: entry.color?.stroke || accent }]}>{(entry.elo_rating ?? 1000).toLocaleString()} pts</Text>
                <Text style={type.caption}>{(entry.total_area_m2 / 1e6).toFixed(2)} km²</Text>
              </View>
            </Row>
          </Card>
        ))}
        <Button title="Refresh rankings" variant="secondary" onPress={reloadRanks} style={{ marginTop: space.lg }} />
      </Screen>
    );
  }

  // Bound to a name and wrapped below rather than wrapped in place: the hub is
  // a hundred lines of JSX and re-indenting all of it to gain one parent would
  // bury the change.
  const hub = (
    <Screen
      scroll
      contentStyle={HUB_PAGE}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={accent} />}
    >
      {tabs}
      {/* header — crew-standoff art sits behind the crest, faded so the
          club's own colour and text stay dominant */}
      <Card style={styles.header}>
        {art('headerClub') && (
          <Image
            source={art('headerClub')}
            style={styles.headerArt}
            resizeMode="cover"
            fadeDuration={0}
            pointerEvents="none"
          />
        )}
        <TouchableOpacity
          onPress={changePhoto}
          disabled={!canManage || photoBusy}
          activeOpacity={0.85}
          accessibilityRole={canManage ? 'button' : 'image'}
          accessibilityLabel={canManage ? 'Change the club photo' : `${clan.name} photo`}
        >
          <ClubAvatar
            photoUrl={clan.photo_url}
            badgeIcon={clan.badge_icon}
            color={clan.color}
            size={64}
          />
          {canManage ? (
            // The upload is a photo's worth of base64 over mobile data, so the
            // corner marker doubles as the progress it would otherwise lack.
            <View style={[styles.crestEdit, { backgroundColor: accent }]}>
              {photoBusy
                ? <ActivityIndicator size="small" color="#FFFFFF" />
                : <Camera size={13} color="#FFFFFF" strokeWidth={2.4} />}
            </View>
          ) : null}
        </TouchableOpacity>
        <Text style={[type.title, { marginTop: space.sm }]}>[{clan.tag}] {clan.name}</Text>
        {clan.description ? <Text style={[type.caption, { textAlign: 'center', marginTop: 2 }]}>{clan.description}</Text> : null}
        <Row gap={8} style={{ marginTop: space.sm }}>
          {clan.league ? <Pill label={LEAGUE_LABEL[clan.league]} color={accent} /> : null}
          {/* No colour: a metadata chip deals its own from the deck. Seeded on
              what it MEANS rather than on its label, so the chip does not
              change colour when a member joins. */}
          <Pill label={`${clan.member_count} members`} seed="club:members" />
        </Row>
      </Card>

      {/* A club stands on the same ten tier ladder its members do. It has no
          runner to put in the badge, so it wears its own crest instead. */}
      <RankCard
        title="Club rank"
        standing={standingFrom({
          key: clan.elo_key,
          points: clan.elo_rating,
          next_points: clan.elo_next_rating,
          progress: clan.elo_progress,
        })}
        emblem={<ClubAvatar photoUrl={clan.photo_url} badgeIcon={clan.badge_icon} color={clan.color} size={70} />}
        style={{ marginTop: space.lg }}
      />

      {/* weekly goal (the chest) */}
      {goal && (
        <Card style={{ marginTop: space.lg, position: 'relative' }}>
          {goal.reached ? (
            <GameLottie
              name="clubComplete"
              size={132}
              trigger={`${goal.progress_distance_m}:${goal.progress_claims}`}
              style={styles.clubCompleteFx}
            />
          ) : null}
          <SectionHeader title="Weekly goal" action={goal.reached ? '✓ reached' : undefined} />
          <Text style={[type.caption, { marginTop: 4, marginBottom: space.md }]}>
            Two or more of you on the same route at the same time. Hit it together
            for a badge frame.
          </Text>
          <GoalBar label={`Distance ${km(goal.progress_distance_m)}/${km(goal.target_distance_m)} km`} pct={distPct} accent={accent} mine={goal.my_distance_m / Math.max(1, goal.target_distance_m)} />
          <GoalBar label={`Claims ${goal.progress_claims}/${goal.target_claims}`} pct={claimPct} accent={accent} mine={goal.my_claims / Math.max(1, goal.target_claims)} />
        </Card>
      )}

      {/* pending join requests (officer+) */}
      {canManage && (requests?.length || 0) > 0 && (
        <>
          <SectionHeader title="Join requests" style={{ marginTop: space.xl, marginBottom: space.md }} />
          <Card padded={false}>
            {requests.map((r, i) => (
              <View key={r.id} style={[styles.memberRow, i > 0 && styles.divider, { flexDirection: 'row', alignItems: 'center', gap: space.md }]}>
                <Text style={[type.bodyBold, { flex: 1 }]}>{r.username}</Text>
                <Button title="Approve" size="sm" full={false} accent={accent}
                  onPress={() => act(async () => { await api.actOnJoinRequest(clanId, r.id, 'approve'); toast.success(`${r.username} joined`); })} />
                <Button title="Deny" size="sm" variant="secondary" full={false}
                  onPress={() => act(() => api.actOnJoinRequest(clanId, r.id, 'deny'))} />
              </View>
            ))}
          </Card>
        </>
      )}

      {/* members — chat + invite as matching pill actions */}
      <View style={styles.membersHeader}>
        <Text style={type.heading}>Members</Text>
        <Row gap={8}>
          <PressableScale
            onPress={() => navigation.navigate('ClubChat', { clanId })}
            accessibilityRole="button"
            accessibilityLabel="Open club chat"
          >
            <Framed
              frame={frameVariant('chip', 'club-chat')}
              tint={accent}
              on={colors.card}
              fill={colors.card}
              weight={INK.thin}
              pose={framePose('club-chat')}
              inset={3}
              contentStyle={styles.actionPillInner}
            >
              <AppIcon name="comment" size={18} />
              <Text style={[type.captionMedium, { color: accent, paddingHorizontal: space.xs }]}>Chat</Text>
            </Framed>
          </PressableScale>
          <PressableScale
            onPress={invite}
            accessibilityRole="button"
            accessibilityLabel="Invite a member"
          >
            <Framed
              frame={frameVariant('chip', 'club-invite')}
              tint={colors.textMuted}
              on={colors.card}
              fill={colors.card}
              weight={INK.thin}
              pose={framePose('club-invite')}
              inset={3}
              contentStyle={styles.actionPillInner}
            >
              <AppIcon name="invite" size={18} />
              <Text style={[type.captionMedium, { color: colors.textMuted, paddingHorizontal: space.xs }]}>Invite</Text>
            </Framed>
          </PressableScale>
        </Row>
      </View>
      <Card padded={false}>
        {clan.members.map((m, i) => (
          <TouchableOpacity
            key={m.user_id}
            onPress={() => manageMember(m)}
            style={[styles.memberRow, i > 0 && styles.divider]}
            accessibilityRole={canManage ? 'button' : 'text'}
          >
            <View style={{ flex: 1 }}>
              <Row gap={8}>
                <Text style={type.bodyBold}>{m.username}{m.user_id === user.id ? ' (you)' : ''}</Text>
                {m.role !== 'member' ? <Pill label={m.role} color={accent} /> : null}
              </Row>
              <Text style={type.caption}>{km(m.week_distance_m)} km and {m.week_claims} claims this week</Text>
            </View>
          </TouchableOpacity>
        ))}
      </Card>

      <Button title="Leave club" variant="secondary" onPress={leave} style={{ marginTop: space.xl }} />
    </Screen>
  );

  // Fades up only when the hub follows the placeholder blocks above. Coming
  // back to a club that is already in cache, this is a plain view and the fade
  // is skipped entirely — see useArrival.
  // The page colour and its dot grid come from Screen, which keeps them on the
  // wrapper under the scroll, so the grid holds still while the hub scrolls
  // over it (see PageTexture).
  return (
    <Arrival active={arriving} style={{ flex: 1, backgroundColor: colors.bg }}>
      {hub}
    </Arrival>
  );
}

function GoalBar({ label, pct, mine, accent }) {
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const previousPct = useRef(pct);
  const [progressFx, setProgressFx] = useState(0);

  useEffect(() => {
    if (pct > previousPct.current) setProgressFx((token) => token + 1);
    previousPct.current = pct;
  }, [pct]);

  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[type.caption, { marginBottom: 6 }]}>{label}</Text>
      {/* Two fills in one track: the club's total in a wash of the accent, and
          your own share solid on top. Both animate, so a goal moving forward
          shows you which part of it was you. */}
      <View style={styles.goalBarStage}>
        <View style={styles.barTrack}>
          <Bar
            pct={pct}
            trackStyle={StyleSheet.absoluteFill}
            fillStyle={[styles.barFill, { backgroundColor: withAlpha(accent, 0.4) }]}
          />
          <Bar
            pct={Math.min(pct, mine || 0)}
            trackStyle={StyleSheet.absoluteFill}
            fillStyle={[styles.barFill, styles.barMine, { backgroundColor: accent }]}
          />
        </View>
        {progressFx > 0 ? (
          <GameLottie
            name="clubProgress"
            size={54}
            trigger={progressFx}
            style={[styles.clubProgressFx, { left: `${Math.round(pct * 100)}%` }]}
          />
        ) : null}
      </View>
    </View>
  );
}

export default function ClubScreen({ navigation }) {
  const { clan, loading } = useClan();
  const [introStep, setIntroStep] = useState(null);

  useEffect(() => {
    if (!clan?.clan_id) {
      setIntroStep(null);
      return undefined;
    }
    let alive = true;
    AsyncStorage.getItem(`${CLUB_INTRO_KEY}:${clan.clan_id}`)
      .then((seen) => { if (alive && !seen) setIntroStep(0); })
      .catch(() => {});
    return () => { alive = false; };
  }, [clan?.clan_id]);

  const advanceIntro = () => {
    if (introStep === 0) {
      setIntroStep(1);
      return;
    }
    setIntroStep(null);
    if (clan?.clan_id) AsyncStorage.setItem(`${CLUB_INTRO_KEY}:${clan.clan_id}`, '1').catch(() => {});
  };

  const arriving = useArrival(loading);

  if (loading) {
    return (
      <Screen>
        <Skeleton width="60%" height={34} style={{ marginTop: space.md }} />
        <Skeleton width="100%" height={120} style={{ borderRadius: 16, marginTop: space.lg }} />
      </Screen>
    );
  }
  // The directory is the whole screen for anyone without a club, so it fades
  // out of the same placeholders the hub does.
  if (!clan?.clan_id) {
    return (
      <Arrival active={arriving} style={{ flex: 1 }}>
        <Directory navigation={navigation} />
      </Arrival>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <MemberHub clanId={clan.clan_id} navigation={navigation} />
      <ClubIntroOverlay step={introStep} onNext={advanceIntro} accent={clan.color?.stroke || '#2DD4BF'} />
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  // title and crew sit together on the left rather than pushed to opposite edges
  dirHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  dirCrewWrap: { flex: 1, maxWidth: 190, aspectRatio: 2.57 },
  dirCrew: { width: '100%', height: '100%' },
  input: {
    ...type.body, backgroundColor: colors.card,
    paddingHorizontal: space.md, paddingVertical: 12,
    ...nbField(scheme, { on: colors.card }),
  },
  crestEdit: {
    position: 'absolute', right: -4, bottom: -4,
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  header: { alignItems: 'center', overflow: 'hidden', marginTop: space.md },
  rankHero: { marginTop: space.md },
  headerArt: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.22 },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: colors.bgElevated, overflow: 'hidden' },
  goalBarStage: { position: 'relative', justifyContent: 'center' },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 5 },
  barMine: {},
  clubProgressFx: { position: 'absolute', marginLeft: -27 },
  clubCompleteFx: { position: 'absolute', right: -18, top: -30, zIndex: 3 },
  memberRow: { paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56, justifyContent: 'center' },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },

  membersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.xl,
    marginBottom: space.md,
  },
  actionPillInner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  introOverlay: {
    ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 30,
    alignItems: 'center', justifyContent: 'center', padding: space.gutter,
  },
  introScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,6,10,0.72)' },
  introCard: { width: '100%', maxWidth: 420, minHeight: 350 },
  introInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  introIcon: { width: 86, height: 86, borderRadius: 43, alignItems: 'center', justifyContent: 'center' },
  introDots: { flexDirection: 'row', gap: 6 },
  introDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  introTitle: { ...type.title, color: '#FFFFFF', textAlign: 'center' },
  introBody: { ...type.body, color: 'rgba(255,255,255,0.82)', textAlign: 'center', lineHeight: 22 },
});
