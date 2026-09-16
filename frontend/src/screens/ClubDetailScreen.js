// Public clan profile — reached by tapping a clan in the directory or the
// season leaderboard. Shows stats, the leader, the full roster, and a single
// join / request action. Joining is NOT automatic on tap (that lives here).
//
// The join action is in the HEADER, not after the roster. It used to sit at the
// bottom of the page, below eleven members, and the first thing the eye found
// up top was the privacy chip: an outline Pill reading "Open", which is a drawn
// hollow box with a verb in it and therefore indistinguishable from an outline
// Button. So the one thing that looked tappable was not, and the one thing that
// was, was off screen.

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Shield } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { useQuery } from '../hooks/useQuery';
import { useClan } from '../state/clan';
import { radius, space, useTheme, useThemedStyles, useThemedType } from '../theme';
import { Screen, Card, Row, Button, PageTexture, Pill, SectionHeader, Skeleton, StatValue } from '../components/ui';
import ClubAvatar from '../components/ClubAvatar';
import RankCard from '../components/rank/RankCard';
import { standingFrom } from '../config/rankLadder';
import { toast } from '../ui/toast';
import { Arrival, Bar, Reveal, staggerDelay, useArrival } from '../ui/motion';

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

  const arriving = useArrival(loading);

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

  const page = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl }}
    >
      {/* header */}
      <Card style={styles.header}>
        <ClubAvatar photoUrl={clan.photo_url} badgeIcon={clan.badge_icon} color={clan.color} size={64} />
        <Text style={[type.title, { marginTop: space.sm }]}>[{clan.tag}] {clan.name}</Text>
        {clan.description ? (
          <Text style={[type.caption, { textAlign: 'center', marginTop: 2 }]}>{clan.description}</Text>
        ) : null}
        {clan.league ? (
          <Row gap={8} style={{ marginTop: space.sm }}>
            <Pill label={LEAGUE_LABEL[clan.league]} color={accent} />
          </Row>
        ) : null}

        {/* Who may join, said in a sentence. This was an outline Pill reading
            "Open": a hollow drawn box with a verb in it, sitting a finger's
            width under the club name. That is the same shape as an outline
            Button and it was the only thing on the first screenful that looked
            pressable, so people pressed it and nothing happened, because the
            real join control was four scrolls down under the roster. The state
            says what it means now, and the action it was mistaken for sits
            directly beneath it. */}
        <Text style={[type.caption, { marginTop: space.sm }]}>
          {isOpen ? 'Anyone can join' : 'Joining needs approval'}
        </Text>

        {/* The join action, in the header where the eye already is. */}
        <View style={styles.action}>
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
      </Card>

      {/* stats */}
      <Row between style={{ marginTop: space.lg }}>
        <StatValue size="md" label="Land" value={km2(clan.season_area_m2)} unit="km²" color={accent} />
        <StatValue size="md" label="Season" value={clan.season_rank ? `#${clan.season_rank}` : '·'} />
        <StatValue size="md" label="Members" value={String(clan.member_count)} />
      </Row>

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
                <Text style={type.caption}>{km(leader.week_distance_m)} km and {leader.week_claims} claims this week</Text>
              </View>
            </Row>
          </Card>
        </>
      )}

      {/* roster */}
      <SectionHeader title={`Members (${clan.member_count})`} style={{ marginTop: space.xl, marginBottom: space.md }} />
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
    </ScrollView>
  );

  // Page colour and dot grid on the wrapper, under the scroll, as ClubScreen's
  // hub does: the grid holds still while the page scrolls over it.
  return (
    <Arrival active={arriving} style={{ flex: 1, backgroundColor: colors.bg }}>
      <PageTexture />
      {page}
    </Arrival>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  header: { alignItems: 'center' },
  // Full width inside a centred card: a join button that hugged its label
  // would be one more small box in a stack of small boxes, which is the
  // reading problem this screen just had.
  action: { alignSelf: 'stretch', marginTop: space.md },
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
