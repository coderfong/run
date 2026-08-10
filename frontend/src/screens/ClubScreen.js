// Club tab. Clubless -> a directory (search, create, join-by-code). Member ->
// the club hub (header, weekly goal, members, role-gated management).

import React, { useEffect, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from '../ui/image';
import { ArrowRight, MessageCircle, UserPlus } from 'lucide-react-native';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../auth/AuthContext';
import { useClan } from '../state/clan';
import { radius, space, withAlpha, useTheme, useThemedType, useThemedStyles } from '../theme';
import { art } from '../config/onboardingArt';
import { Screen, Card, Row, Button, Pill, SectionHeader, Skeleton, EmptyState } from '../components/ui';
import ClanBadge from '../components/ClanBadge';
import { toast } from '../ui/toast';
import { Bar } from '../ui/motion';
import GameLottie from '../components/GameLottie';

const km = (m) => (m / 1000).toFixed(1);
const LEAGUE_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };

// ---------------------------------------------------------------------------
// Clanless directory
// ---------------------------------------------------------------------------

function Directory({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { refresh } = useClan();
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');

  // The directory's default listing (empty search) is cached, so the clubless
  // Club tab has clubs in it the moment you open it. Typed searches go through
  // the same cache keyed by term, so backspacing through a query re-shows each
  // result set instead of re-querying it.
  const { data: results, loading: searching } = useQuery(
    `clans:search:${q.trim()}`,
    () => api.searchClans(q.trim()),
    { fallback: [] }
  );

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

      <Button title="Create a club" variant="gradient" icon={<UserPlus size={18} color="#fff" />} onPress={() => navigation.navigate('ClubCreate')} />

      {/* the Join button matches the input height and centres with it */}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md, alignItems: 'center' }}>
        <TextInput
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
      <TextInput
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
            title="No clubs yet"
            body="Be the first. Create a club and claim land together."
            style={{ paddingTop: space.lg }}
          />
        ) : (
          results.map((c) => (
            <Card key={c.id} onPress={() => navigation.navigate('ClubDetail', { clanId: c.id })} style={{ marginBottom: space.sm }}>
              <Row between>
                <Row gap={12}>
                  <View style={[styles.badgeChip, { backgroundColor: c.color.fill }]}>
                    <ClanBadge icon={c.badge_icon} size={22} color={c.color.stroke} />
                  </View>
                  <View>
                    <Text style={type.bodyBold}>[{c.tag}] {c.name}</Text>
                    <Text style={type.caption}>
                      {c.member_count} members{c.league ? ` · ${LEAGUE_LABEL[c.league]}` : ''}
                      {c.privacy !== 'open' ? ' · invite only' : ''}
                    </Text>
                  </View>
                </Row>
                <Text style={[type.statSm, { color: c.color.stroke }]}>{(c.season_area_m2 / 1e6).toFixed(1)}</Text>
              </Row>
            </Card>
          ))
        )}
      </View>
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

  const onRefresh = async () => {
    setPulling(true);
    try {
      await Promise.all([load(), canSeeRequests ? reloadRequests() : null]);
    } finally {
      setPulling(false);
    }
  };

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

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={accent} />}
    >
      {/* header — crew-standoff art sits behind the crest, faded so the
          club's own colour and text stay dominant */}
      <View style={[styles.header, { backgroundColor: withAlpha(accent, 0.1) }]}>
        {art('headerClub') && (
          <Image
            source={art('headerClub')}
            style={styles.headerArt}
            resizeMode="cover"
            fadeDuration={0}
            pointerEvents="none"
          />
        )}
        <View style={[styles.badgeChip, { backgroundColor: clan.color.fill, width: 56, height: 56 }]}>
          <ClanBadge icon={clan.badge_icon} size={30} color={accent} />
        </View>
        <Text style={[type.title, { marginTop: space.sm }]}>[{clan.tag}] {clan.name}</Text>
        {clan.description ? <Text style={[type.caption, { textAlign: 'center', marginTop: 2 }]}>{clan.description}</Text> : null}
        <Row gap={8} style={{ marginTop: space.sm }}>
          {clan.league ? <Pill label={LEAGUE_LABEL[clan.league]} color={accent} /> : null}
          <Pill label={clan.season_rank ? `Season #${clan.season_rank}` : 'Unranked'} color={accent} variant="outline" />
          <Pill label={`${clan.member_count} members`} color={colors.textMuted} />
        </Row>
      </View>

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
            Hit it together for a badge frame. Your share highlighted.
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
          <TouchableOpacity
            style={[styles.actionPill, { borderColor: accent }]}
            onPress={() => navigation.navigate('ClubChat', { clanId })}
            accessibilityRole="button"
            accessibilityLabel="Open club chat"
          >
            <MessageCircle size={15} color={accent} />
            <Text style={[type.captionMedium, { color: accent }]}>Chat</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionPill}
            onPress={invite}
            accessibilityRole="button"
            accessibilityLabel="Invite a member"
          >
            <UserPlus size={15} color={colors.textMuted} />
            <Text style={[type.captionMedium, { color: colors.textMuted }]}>Invite</Text>
          </TouchableOpacity>
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
                <Text style={type.bodyBold}>{m.username}{m.user_id === user.id ? ' · you' : ''}</Text>
                {m.role !== 'member' ? <Pill label={m.role} color={accent} /> : null}
              </Row>
              <Text style={type.caption}>{km(m.week_distance_m)} km · {m.week_claims} claims this week</Text>
            </View>
          </TouchableOpacity>
        ))}
      </Card>

      <Button title="Leave club" variant="secondary" onPress={leave} style={{ marginTop: space.xl }} />
    </ScrollView>
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
  if (loading) {
    return (
      <Screen>
        <Skeleton width="60%" height={34} style={{ marginTop: space.md }} />
        <Skeleton width="100%" height={120} style={{ borderRadius: 16, marginTop: space.lg }} />
      </Screen>
    );
  }
  return clan?.clan_id ? <MemberHub clanId={clan.clan_id} navigation={navigation} /> : <Directory navigation={navigation} />;
}

const makeStyles = (colors, _scheme, type) => StyleSheet.create({
  // title and crew sit together on the left rather than pushed to opposite edges
  dirHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  dirCrewWrap: { flex: 1, maxWidth: 190, aspectRatio: 2.57 },
  dirCrew: { width: '100%', height: '100%' },
  input: {
    ...type.body, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12,
  },
  badgeChip: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', borderRadius: radius.card, padding: space.xl, overflow: 'hidden' },
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
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 7,
    backgroundColor: colors.card,
  },
});
