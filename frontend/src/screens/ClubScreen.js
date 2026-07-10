// Club tab. Clubless -> a directory (search, create, join-by-code). Member ->
// the club hub (header, weekly goal, members, role-gated management).

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { UserPlus } from 'lucide-react-native';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useClan } from '../state/clan';
import { colors, radius, space, type, withAlpha } from '../theme';
import { Screen, Card, Row, Button, Pill, SectionHeader, Skeleton, EmptyState } from '../components/ui';
import ClanBadge from '../components/ClanBadge';
import { toast } from '../ui/toast';

const km = (m) => (m / 1000).toFixed(1);
const LEAGUE_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };

// ---------------------------------------------------------------------------
// Clanless directory
// ---------------------------------------------------------------------------

function Directory({ navigation }) {
  const { refresh } = useClan();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [code, setCode] = useState('');

  const search = useCallback(async (term) => {
    try {
      setResults(await api.searchClans(term));
    } catch {
      setResults([]);
    }
  }, []);

  useEffect(() => {
    search('');
  }, [search]);

  const joinCode = async () => {
    if (!code.trim()) return;
    try {
      await api.joinByCode(code.trim());
      await refresh();
      toast.success('Joined club');
    } catch (e) {
      toast.error(e.message || 'Invalid code');
    }
  };

  return (
    <Screen scroll contentStyle={{ paddingBottom: space.xxl }}>
      <Text style={[type.display, { marginTop: space.sm }]}>Clubs</Text>
      <Text style={[type.body, { color: colors.textMuted, marginTop: 4, marginBottom: space.lg }]}>
        Solo land is grey. Club land conquers.
      </Text>

      <Button title="Create a club" variant="gradient" icon={<UserPlus size={18} color="#fff" />} onPress={() => navigation.navigate('ClubCreate')} />

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={code}
          onChangeText={setCode}
          placeholder="Have an invite code?"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
        />
        <Button title="Join" size="sm" full={false} onPress={joinCode} />
      </View>

      <SectionHeader title="Find a club" style={{ marginTop: space.xl, marginBottom: space.md }} />
      <TextInput
        style={styles.input}
        value={q}
        onChangeText={(v) => { setQ(v); search(v); }}
        placeholder="Search by name or tag"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
      />

      <View style={{ marginTop: space.md }}>
        {!results ? (
          <Skeleton width="100%" height={64} style={{ borderRadius: 16 }} />
        ) : results.length === 0 ? (
          <Text style={[type.caption, { paddingVertical: space.lg }]}>No clubs found. Be the first — create one.</Text>
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

function MemberHub({ clanId }) {
  const { user } = useAuth();
  const { refresh } = useClan();
  const [clan, setClan] = useState(null);
  const [requests, setRequests] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await api.getClan(clanId);
      setClan(c);
      if (c.my_role === 'leader' || c.my_role === 'officer') {
        api.listJoinRequests(clanId).then(setRequests).catch(() => setRequests([]));
      }
    } catch {
      setClan(null);
    } finally {
      setRefreshing(false);
    }
  }, [clanId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!clan) {
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
      await Share.share({ message: `Join ${clan.tag} on PACER: ${inv.url}` });
    } catch (e) {
      toast.error(e.message || 'Could not create invite');
    }
  };

  const leave = () => {
    Alert.alert('Leave club?', myRole === 'leader' ? 'Transfer leadership first if others remain.' : 'You can rejoin later.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave', style: 'destructive', onPress: async () => {
          try { await api.leaveClan(); await refresh(); toast.success('Left club'); }
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
    try { await fn(); await load(); await refresh(); }
    catch (e) { toast.error(e.message || 'Action failed'); }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={accent} />}
    >
      {/* header */}
      <View style={[styles.header, { backgroundColor: withAlpha(accent, 0.1) }]}>
        <View style={[styles.badgeChip, { backgroundColor: clan.color.fill, width: 56, height: 56 }]}>
          <ClanBadge icon={clan.badge_icon} size={30} color={accent} />
        </View>
        <Text style={[type.title, { marginTop: space.sm }]}>[{clan.tag}] {clan.name}</Text>
        {clan.description ? <Text style={[type.caption, { textAlign: 'center', marginTop: 2 }]}>{clan.description}</Text> : null}
        <Row gap={8} style={{ marginTop: space.sm }}>
          {clan.league ? <Pill label={LEAGUE_LABEL[clan.league]} color={accent} /> : null}
          <Pill label={`Season #${clan.season_rank ?? '—'}`} color={accent} variant="outline" />
          <Pill label={`${clan.member_count} members`} color={colors.textMuted} />
        </Row>
      </View>

      {/* weekly goal (the chest) */}
      {goal && (
        <Card style={{ marginTop: space.lg }}>
          <SectionHeader title="Weekly goal" action={goal.reached ? '✓ reached' : undefined} />
          <Text style={[type.caption, { marginTop: 4, marginBottom: space.md }]}>
            Hit it together for a badge frame. Your share highlighted.
          </Text>
          <GoalBar label={`Distance ${km(goal.progress_distance_m)}/${km(goal.target_distance_m)} km`} pct={distPct} accent={accent} mine={goal.my_distance_m / Math.max(1, goal.target_distance_m)} />
          <GoalBar label={`Claims ${goal.progress_claims}/${goal.target_claims}`} pct={claimPct} accent={accent} mine={goal.my_claims / Math.max(1, goal.target_claims)} />
        </Card>
      )}

      {/* pending join requests (officer+) */}
      {canManage && requests.length > 0 && (
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

      {/* members */}
      <SectionHeader title="Members" action="Invite" onAction={invite} style={{ marginTop: space.xl, marginBottom: space.md }} />
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
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={[type.caption, { marginBottom: 6 }]}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: withAlpha(accent, 0.4) }]} />
        <View style={[styles.barFill, styles.barMine, { width: `${Math.min(pct, mine || 0) * 100}%`, backgroundColor: accent }]} />
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
  return clan?.clan_id ? <MemberHub clanId={clan.clan_id} /> : <Directory navigation={navigation} />;
}

const styles = StyleSheet.create({
  input: {
    ...type.body, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12,
  },
  badgeChip: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', borderRadius: radius.card, padding: space.xl },
  barTrack: { height: 10, borderRadius: 5, backgroundColor: colors.bgElevated, overflow: 'hidden' },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 5 },
  barMine: {},
  memberRow: { paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56, justifyContent: 'center' },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
});
