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
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Shield, ArrowLeft } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { useQuery } from '../hooks/useQuery';
import { useClan } from '../state/clan';
import { radius, space, useTheme, useThemedStyles, useThemedType } from '../theme';
import { Screen, Card, Row, Button, Pill, SectionHeader, Skeleton, StatValue } from '../components/ui';
import ClubAvatar from '../components/ClubAvatar';
import PlayerIdentity, { RankCrest, RunnerFigure } from '../components/identity/PlayerIdentity';
import RankCard from '../components/rank/RankCard';
import { standingFrom } from '../config/rankLadder';
import { toast } from '../ui/toast';
import { Arrival, Bar, Reveal, staggerDelay, useArrival } from '../ui/motion';

const km2 = (m) => (m / 1e6).toFixed(2);
// A featured member's full body runner.
const FEATURED_H = 120;
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
  // The member holding the most of the club's land. Featured beside the leader
  // as a whole runner unless it IS the leader.
  const top = clan.members.reduce((best, m) => (!best || m.area_m2 > best.area_m2 ? m : best), null);
  const mvp = top && top.area_m2 > 0 && top.user_id !== leader?.user_id ? top : null;
  // A server from before members carried their loadout sends no `avatar` key
  // at all; that keeps the old icon layout rather than a stranger in default
  // clothes.
  const hasLooks = (m) => !!m && 'avatar' in m;

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
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl, paddingTop: space.md }}
      >
        {/* header */}
        <Card style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={colors.text} />
          </TouchableOpacity>
          <ClubAvatar photoUrl={clan.photo_url} badgeIcon={clan.badge_icon} color={clan.color} size={64} />
          <Text style={[type.title, { marginTop: space.sm }]}>[{clan.tag}] {clan.name}</Text>
          {clan.league ? (
            <Row gap={8} style={{ marginTop: space.sm }}>
              <Pill label={LEAGUE_LABEL[clan.league]} color={accent} />
            </Row>
          ) : null}

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

        {/* stats */}
        <Row between style={{ marginTop: space.lg }}>
          <StatValue size="md" label="Land" value={km2(clan.season_area_m2)} unit="km²" color={accent} />
          <StatValue size="md" label="Season" value={clan.season_rank ? `#${clan.season_rank}` : '·'} />
          <StatValue size="md" label="Members" value={String(clan.member_count)} />
        </Row>

        {/* leader */}
        {leader && hasLooks(leader) ? (
          <>
            <SectionHeader
              title={mvp ? 'Leader and top runner' : 'Leader'}
              style={{ marginTop: space.xl, marginBottom: space.md }}
            />
            {/* The featured members stand as their whole runner: a club is
                the people in it, and this is where you see who they are. */}
            <Card>
              <Row style={styles.featured}>
                {[{ m: leader, tag: 'Leader', icon: 'crown' }, mvp ? { m: mvp, tag: 'Top runner', icon: 'trophy' } : null]
                  .filter(Boolean)
                  .map(({ m, tag, icon }) => (
                    <View key={m.user_id} style={styles.featuredMember}>
                      <View style={styles.featuredRunner}>
                        <RunnerFigure equipped={m.avatar} height={FEATURED_H} accessibilityLabel={`${m.username}'s runner`} />
                        {m.rank_key ? <RankCrest tierKey={m.rank_key} size={24} style={styles.featuredCrest} /> : null}
                      </View>
                      <Row gap={4}>
                        <AppIcon name={icon} size={16} />
                        <Text style={[type.captionMedium, { color: accent }]}>{tag}</Text>
                      </Row>
                      <Text style={type.bodyBold} numberOfLines={1}>{m.username}</Text>
                      <Text style={type.caption} numberOfLines={1}>{`${km2(m.area_m2)} km², ${m.week_claims} claims this week`}</Text>
                    </View>
                  ))}
              </Row>
            </Card>
          </>
        ) : leader ? (
          <>
            <SectionHeader title="Leader" style={{ marginTop: space.xl, marginBottom: space.md }} />
            <Card>
              <Row gap={12}>
                <View style={[styles.leaderAvatar, { backgroundColor: clan.color.fill, borderColor: accent }]}>
                  <AppIcon name="crown" size={22} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.bodyBold}>{leader.username}</Text>
                  <Text style={type.caption}>{km2(leader.area_m2)} km² and {leader.week_claims} claims this week</Text>
                </View>
              </Row>
            </Card>
          </>
        ) : null}

        {/* roster */}
        <SectionHeader title={`Members (${clan.member_count})`} style={{ marginTop: space.xl, marginBottom: space.md }} />
        <Card padded={false}>
          {clan.members.map((m, i) => (
            <Reveal key={m.user_id} delay={staggerDelay(i)}>
              <View style={[styles.memberRow, i > 0 && styles.divider]}>
                <Row gap={8} style={{ flex: 1 }}>
                  {/* Portrait with its rank ring: a roster is a list, and a
                      list gets the smallest mode (see identity/PlayerIdentity). */}
                  {hasLooks(m) ? (
                    <PlayerIdentity mode="portrait" equipped={m.avatar} rankKey={m.rank_key} size={32} bg={colors.cardAlt} />
                  ) : null}
                  <Text style={type.bodyBold}>{m.username}</Text>
                  {m.role !== 'member' ? <Pill label={m.role} color={accent} /> : null}
                </Row>
                <Text style={type.caption}>{km2(m.area_m2)} km²</Text>
              </View>
            </Reveal>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );

  // Page colour on the wrapper
  return (
    <Arrival active={arriving} style={{ flex: 1, backgroundColor: colors.bg }}>
      {page}
    </Arrival>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  header: { alignItems: 'center', position: 'relative' },
  backButton: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.border,
  },
  // Full width inside a centred card: a join button that hugged its label
  // would be one more small box in a stack of small boxes, which is the
  // reading problem this screen just had.
  action: { alignSelf: 'stretch', marginTop: space.md },
  xpTrack: { height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: 'hidden', marginTop: space.sm },
  xpFill: { height: '100%', borderRadius: 4 },
  featured: { justifyContent: 'space-around', alignItems: 'flex-end' },
  featuredMember: { flex: 1, alignItems: 'center', gap: 2 },
  featuredRunner: { alignItems: 'center', justifyContent: 'flex-end', marginBottom: space.xs },
  featuredCrest: { position: 'absolute', right: -8, bottom: -2 },
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
