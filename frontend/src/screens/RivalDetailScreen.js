// RivalDetailScreen — one rivalry, in full.
//
// The split here is the whole PASER PRO idea in one screen. Everything that
// tells you WHO IS WINNING is free: the card, both runners' land, the career
// totals, and every beat that has passed between you. PRO buys the reading of
// it — streaks, defence rates, current form, the ground you keep meeting on.
//
// So a free runner is never left wondering whether they are ahead. They can
// see that they are. What they cannot see is the analysis, and analysis has
// never won anybody a metre of ground.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import ProTeaser from '../components/ProTeaser';
import RivalCard, { ago, fmtArea } from '../components/RivalCard';
import { Card, Screen, Skeleton, ToonButton } from '../components/ui';
import { GOLD } from '../config/pro';
import { useQuery } from '../hooks/useQuery';
import { useAvatar } from '../state/avatar';
import { radius, space, useTheme, useThemedType } from '../theme';
import { Reveal, staggerDelay } from '../ui/motion';
import { parseServerDate } from '../utils/time';

const DASH = '·'; // the app's empty-value placeholder

function fmtKm(m) {
  const km = Math.max(0, Number(m) || 0) / 1000;
  return `${km.toFixed(km >= 100 ? 0 : 1)} km`;
}

function fmtRate(r) {
  return r == null ? DASH : `${Math.round(r * 100)}%`;
}

function fmtStreak(n, theirName) {
  if (!n) return DASH;
  return n > 0 ? `You ${n}` : `${theirName} ${Math.abs(n)}`;
}

function fmtSince(iso) {
  if (!iso) return DASH;
  const d = parseServerDate(iso);
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// One line of the head to head: a label with both runners' numbers either
// side. Always both, always in the same order, so the eye can run down the
// column rather than re-reading which side is which.
function Versus({ label, mine, theirs, colors, type }) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[type.bodySmBold, { flex: 1, textAlign: 'right' }]}>{mine}</Text>
      <Text style={[type.caption, { color: colors.textMuted, flex: 1.4, textAlign: 'center' }]}>
        {label}
      </Text>
      <Text style={[type.bodySmBold, { flex: 1 }]}>{theirs}</Text>
    </View>
  );
}

export default function RivalDetailScreen({ route, navigation }) {
  const { userId } = route.params || {};
  const { colors } = useTheme();
  const type = useThemedType();
  const { equipped } = useAvatar();

  const { data, loading } = useQuery(
    userId ? `rival:${userId}` : null,
    () => api.rivalDetail(userId),
  );

  const rival = data?.rival;
  const analytics = data?.analytics;
  // Every beat that has passed between the two runners. Free, listed in full
  // below, and therefore safe to summarise in the teaser.
  const beats = (data?.events || []).length;

  React.useEffect(() => {
    if (rival?.username) navigation.setOptions({ title: rival.username });
  }, [rival?.username, navigation]);

  if (loading || !rival) {
    return (
      <Screen>
        <Skeleton width="100%" height={210} style={{ borderRadius: radius.card }} />
        <Skeleton width="100%" height={160} style={{ borderRadius: radius.card, marginTop: space.md }} />
      </Screen>
    );
  }

  return (
    <Screen gutter={false}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xxl }}>
        {/* The headline of the whole page, and the one thing that was still
            swapping in cold after the skeleton — everything under it already
            arrives on its own Reveal. */}
        <Reveal from="none" duration={260}>
        <RivalCard
          rival={rival}
          myAvatar={equipped}
          onTakeBack={() => navigation.navigate('Record')}
          onViewLand={
            rival.last_event?.lat != null
              ? () =>
                  navigation.navigate('Map', {
                    screen: 'MapMain',
                    params: { focus: { lat: rival.last_event.lat, lon: rival.last_event.lon } },
                  })
              : undefined
          }
        />
        </Reveal>

        {analytics ? (
          <Reveal delay={80}>
            <Card style={styles.panel}>
              <Text style={[type.captionMedium, { color: GOLD, marginBottom: space.xs }]}>
                HEAD TO HEAD
              </Text>
              <View style={[styles.row, { borderBottomColor: colors.border }]}>
                <Text style={[type.caption, { color: colors.textMuted, flex: 1, textAlign: 'right' }]}>
                  You
                </Text>
                <Text style={[type.caption, { color: colors.textDim, flex: 1.4, textAlign: 'center' }]}>
                  {`since ${fmtSince(analytics.first_met)}`}
                </Text>
                <Text style={[type.caption, { color: colors.textMuted, flex: 1 }]}>
                  {rival.username}
                </Text>
              </View>
              <Versus
                label="land held"
                mine={fmtArea(rival.your_land_m2)}
                theirs={fmtArea(rival.their_land_m2)}
                colors={colors}
                type={type}
              />
              <Versus
                label="taken from them"
                mine={fmtArea(rival.you_took_m2)}
                theirs={fmtArea(rival.they_took_m2)}
                colors={colors}
                type={type}
              />
              <Versus
                label="defence rate"
                mine={fmtRate(analytics.your_defence_rate)}
                theirs={fmtRate(analytics.their_defence_rate)}
                colors={colors}
                type={type}
              />
              <Versus
                label="last 30 days"
                mine={fmtKm(analytics.your_distance_m_30d)}
                theirs={fmtKm(analytics.their_distance_m_30d)}
                colors={colors}
                type={type}
              />
              <Versus
                label="takes, last 30 days"
                mine={String(analytics.your_beats_30d)}
                theirs={String(analytics.their_beats_30d)}
                colors={colors}
                type={type}
              />

              <View style={styles.footRow}>
                <Text style={[type.caption, { color: colors.textMuted }]}>Current streak</Text>
                <Text style={[type.bodySmBold]}>
                  {fmtStreak(analytics.streak, rival.username)}
                </Text>
              </View>

              {/* Only worth naming when the beats really cluster. Two runners
                  who have met once each side of a city have no battleground,
                  and saying they do would be a confident lie. */}
              {analytics.battleground_beats >= 3 && analytics.battleground_lat != null ? (
                <ToonButton
                  title={`See the ground you fight over (${analytics.battleground_beats} beats)`}
                  variant="neutral"
                  size="sm"
                  onPress={() =>
                    navigation.navigate('Map', {
                      screen: 'MapMain',
                      params: {
                        focus: {
                          lat: analytics.battleground_lat,
                          lon: analytics.battleground_lon,
                        },
                      },
                    })
                  }
                  style={{ marginTop: space.sm }}
                />
              ) : null}
            </Card>
          </Reveal>
        ) : (
          <Reveal delay={80}>
            {/* The one real number in this teaser is the beat count, and it is
                real because the whole event list is FREE and already rendered
                further down this very screen. Saying "you have traded ground
                18 times" is therefore not a withheld statistic being dangled —
                it is a summary of something they can scroll to and count. The
                four locked rows below it carry no numbers, because the free
                response genuinely has none to show. */}
            <ProTeaser
              context="rival_insights"
              title="Rival Intelligence"
              blurb={
                beats
                  ? `You have traded ground ${beats} ${beats === 1 ? 'time' : 'times'}. PRO reads what that adds up to.`
                  : 'Streaks, defence rates and the ground you keep fighting over.'
              }
              rows={[
                { label: 'Most contested area' },
                { label: 'Battle history' },
                { label: 'Momentum' },
                { label: 'Defence rate, both sides' },
              ]}
              cta="View full rivalry"
              feature="rival_insights"
              style={{ marginTop: space.md }}
            />
          </Reveal>
        )}

        <Text style={[type.captionMedium, { color: colors.textMuted, marginTop: space.lg }]}>
          EVERY BEAT
        </Text>
        {(data.events || []).map((e, i) => (
          <Reveal key={`${e.at}:${i}`} delay={staggerDelay(i)}>
            <View style={[styles.beat, { borderBottomColor: colors.border }]}>
              <Text style={[type.bodySmBold, { flex: 1 }]}>{beatLabel(e, rival.username)}</Text>
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {`${fmtArea(e.area_m2)}, ${ago(e.at)}`}
              </Text>
            </View>
          </Reveal>
        ))}
      </ScrollView>
    </Screen>
  );
}

// The four kinds the API sends, in the second person. Kept here rather than
// imported from RivalCard because that one phrases the LATEST beat as a
// headline ("They took 0.3 km² off you"); a list wants the short form.
function beatLabel(event, them) {
  switch (event.kind) {
    case 'you_took':
      return `You took ground from ${them}`;
    case 'they_took':
      return `${them} took ground from you`;
    case 'you_held':
      return `You held against ${them}`;
    case 'they_held':
      return `${them} held against you`;
    default:
      return DASH;
  }
}

const styles = StyleSheet.create({
  panel: { marginTop: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.sm,
  },
  beat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
});
