// Public clan profile — reached by tapping a clan in the directory or the
// season leaderboard. Shows stats, the leader, the full roster, and a single
// join / request action. Joining is NOT automatic on tap (that lives here).

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Shield } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { useQuery } from '../hooks/useQuery';
import { useClan } from '../state/clan';
import { radius, space, withAlpha, useTheme, useThemedStyles, useThemedType } from '../theme';
import { Screen, Card, Row, Button, Pill, SectionHeader, Skeleton, StatValue } from '../components/ui';
import ClubAvatar from '../components/ClubAvatar';
import { toast } from '../ui/toast';
import { Bar, Reveal, staggerDelay } from '../ui/motion';

const km2 = (m) => (m / 1e6).toFixed(2);
const km = (m) => (m / 1000).toFixed(1);
const LEAGUE_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };

export default function ClubDetailScreen({ route, navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { clanId } = route.params;
  const { clan: myClan, refresh } = useClan();
  // Cached per club, so the roster is already drawn when you tap back into a
  // club you were just looking at from the directory or the standings.
  const { data: clan, loading, error } = useQuery(
    clanId ? `clan:${clanId}` : null,
    () => api.getClan(clanId)
  );
  const [busy, setBusy] = useState(false);

  if (loading && error) {
    return <Screen center><Text style={type.body}>This club no longer exists.</Text></Screen>;
  }
  if (loading) {
    return (
      <Screen>
        <Skeleton width="100%" height={140} style={{ borderRadius: radius.card, marginTop: space.md }} />
        <Skeleton width="100%" height={64} style={{ borderRadius: radius.card, marginTop: space.md }} />
      </Screen>
    );
  }

  const accent = clan.color.stroke;
  const leader = clan.members.find((m) => m.role === 'leader');

  // Club XP → level (same curve as a player: level = floor(sqrt(xp/100))).
  const clubXp = clan.xp || 0;
  const clubLevel = Math.floor(Math.sqrt(clubXp / 100));
  const levelBase = 100 * clubLevel * clubLevel;
  const nextBase = 100 * (clubLevel + 1) * (clubLevel + 1);
  const xpIntoLevel = clubXp - levelBase;
  const xpForLevel = Math.max(1, nextBase - levelBase);
  const clubPct = Math.max(0, Math.min(100, (xpIntoLevel / xpForLevel) * 100));
  const isMember = myClan?.clan_id === clanId;
  const inAnotherClan = !!myClan?.clan_id && !isMember;
  const isOpen = clan.privacy === 'open';

  const join = async () => {
    setBusy(true);
    try {
      if (isOpen) {
        await api.joinClan(clanId);
        // The roster and member count just changed — drop every cached club
        // view so the club tab and this page don't show the pre-join numbers.
        invalidate('clan:');
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
        <ClubAvatar photoUrl={clan.photo_url} badgeIcon={clan.badge_icon} color={clan.color} size={64} />
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
        <StatValue size="md" label="Season" value={clan.season_rank ? `#${clan.season_rank}` : '·'} />
        <StatValue size="md" label="Members" value={String(clan.member_count)} />
      </Row>

      {/* club XP progress — every member's runs, claims and steals feed this */}
      <Card style={{ marginTop: space.md }}>
        <Row between>
          <Text style={type.bodyBold}>Club level {clubLevel}</Text>
          <Text style={type.caption}>{clubXp.toLocaleString()} XP</Text>
        </Row>
        <Bar
          pct={clubPct / 100}
          trackStyle={styles.xpTrack}
          fillStyle={[styles.xpFill, { backgroundColor: accent }]}
        />
        <Text style={[type.caption, { marginTop: 6 }]}>
          {xpIntoLevel.toLocaleString()} / {xpForLevel.toLocaleString()} to level {clubLevel + 1}
        </Text>
      </Card>

      {/* leader */}
      {leader && (
        <>
          <SectionHeader title="Leader" style={{ marginTop: space.xl, marginBottom: space.md }} />
          <Card>
            <Row gap={12}>
              <View style={[styles.leaderAvatar, { backgroundColor: clan.color.fill, borderColor: accent }]}>
                <AppIcon name="crown" size={22} />
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
          <Reveal key={m.user_id} delay={staggerDelay(i)}>
            <View style={[styles.memberRow, i > 0 && styles.divider]}>
              <Row gap={8} style={{ flex: 1 }}>
                <Text style={type.bodyBold}>{m.username}</Text>
                {m.role !== 'member' ? <Pill label={m.role} color={accent} /> : null}
              </Row>
              <Text style={type.caption}>{km(m.week_distance_m)} km</Text>
            </View>
          </Reveal>
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

const makeStyles = (colors) => StyleSheet.create({
  header: { alignItems: 'center', borderRadius: radius.card, padding: space.xl },
  xpTrack: { height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: 'hidden', marginTop: space.sm },
  xpFill: { height: '100%', borderRadius: 4 },
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
