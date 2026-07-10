// Public clan profile — reached by tapping a clan in the directory or the
// season leaderboard. Shows stats, the leader, the full roster, and a single
// join / request action. Joining is NOT automatic on tap (that lives here).

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Crown, Shield } from 'lucide-react-native';

import { api } from '../api/client';
import { useClan } from '../state/clan';
import { colors, radius, space, type, withAlpha } from '../theme';
import { Screen, Card, Row, Button, Pill, SectionHeader, Skeleton, StatValue } from '../components/ui';
import ClanBadge from '../components/ClanBadge';
import { toast } from '../ui/toast';

const km2 = (m) => (m / 1e6).toFixed(2);
const km = (m) => (m / 1000).toFixed(1);
const LEAGUE_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };

export default function ClubDetailScreen({ route, navigation }) {
  const { clanId } = route.params;
  const { clan: myClan, refresh } = useClan();
  const [clan, setClan] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setClan(await api.getClan(clanId));
    } catch {
      setClan(false);
    }
  }, [clanId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (clan === false) {
    return <Screen center><Text style={type.body}>This club no longer exists.</Text></Screen>;
  }
  if (!clan) {
    return (
      <Screen>
        <Skeleton width="100%" height={140} style={{ borderRadius: radius.card, marginTop: space.md }} />
        <Skeleton width="100%" height={64} style={{ borderRadius: radius.card, marginTop: space.md }} />
      </Screen>
    );
  }

  const accent = clan.color.stroke;
  const leader = clan.members.find((m) => m.role === 'leader');
  const isMember = myClan?.clan_id === clanId;
  const inAnotherClan = !!myClan?.clan_id && !isMember;
  const isOpen = clan.privacy === 'open';

  const join = async () => {
    setBusy(true);
    try {
      if (isOpen) {
        await api.joinClan(clanId);
        await refresh();
        toast.success(`Joined ${clan.tag}`);
        navigation.goBack();
      } else {
        await api.requestJoin(clanId);
        toast.success(`Request sent to ${clan.tag}`);
        navigation.goBack();
      }
    } catch (e) {
      toast.error(e.message || 'Could not join');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl }}
    >
      {/* header */}
      <View style={[styles.header, { backgroundColor: withAlpha(accent, 0.1) }]}>
        <View style={[styles.badgeChip, { backgroundColor: clan.color.fill }]}>
          <ClanBadge icon={clan.badge_icon} size={32} color={accent} />
        </View>
        <Text style={[type.title, { marginTop: space.sm }]}>[{clan.tag}] {clan.name}</Text>
        {clan.description ? (
          <Text style={[type.caption, { textAlign: 'center', marginTop: 2 }]}>{clan.description}</Text>
        ) : null}
        <Row gap={8} style={{ marginTop: space.sm }}>
          {clan.league ? <Pill label={LEAGUE_LABEL[clan.league]} color={accent} /> : null}
          <Pill label={isOpen ? 'Open' : 'Invite only'} color={colors.textMuted} variant="outline" />
        </Row>
      </View>

      {/* stats */}
      <Row between style={{ marginTop: space.lg }}>
        <StatValue size="md" label="Land" value={km2(clan.season_area_m2)} unit="km²" color={accent} />
        <StatValue size="md" label="Season" value={clan.season_rank ? `#${clan.season_rank}` : '—'} />
        <StatValue size="md" label="Members" value={String(clan.member_count)} />
      </Row>

      {/* leader */}
      {leader && (
        <>
          <SectionHeader title="Leader" style={{ marginTop: space.xl, marginBottom: space.md }} />
          <Card>
            <Row gap={12}>
              <View style={[styles.leaderAvatar, { backgroundColor: clan.color.fill, borderColor: accent }]}>
                <Crown size={20} color={accent} fill={accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.bodyBold}>{leader.username}</Text>
                <Text style={type.caption}>{km(leader.week_distance_m)} km · {leader.week_claims} claims this week</Text>
              </View>
            </Row>
          </Card>
        </>
      )}

      {/* roster */}
      <SectionHeader title={`Members · ${clan.member_count}`} style={{ marginTop: space.xl, marginBottom: space.md }} />
      <Card padded={false}>
        {clan.members.map((m, i) => (
          <View key={m.user_id} style={[styles.memberRow, i > 0 && styles.divider]}>
            <Row gap={8} style={{ flex: 1 }}>
              <Text style={type.bodyBold}>{m.username}</Text>
              {m.role !== 'member' ? <Pill label={m.role} color={accent} /> : null}
            </Row>
            <Text style={type.caption}>{km(m.week_distance_m)} km</Text>
          </View>
        ))}
      </Card>

      {/* join action */}
      <View style={{ marginTop: space.xl }}>
        {isMember ? (
          <Row gap={8} style={{ justifyContent: 'center' }}>
            <Shield size={16} color={accent} />
            <Text style={[type.bodyBold, { color: accent }]}>You're in this club</Text>
          </Row>
        ) : inAnotherClan ? (
          <Text style={[type.caption, { textAlign: 'center' }]}>
            Leave your current club before joining another.
          </Text>
        ) : (
          <Button
            title={isOpen ? 'Join club' : 'Request to join'}
            variant="gradient"
            loading={busy}
            onPress={join}
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', borderRadius: radius.card, padding: space.xl },
  badgeChip: { width: 56, height: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  leaderAvatar: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 52,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
});
