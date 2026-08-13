// LeaderboardView — individual runners ranked by land held. Podium tint,
// rank-change arrows vs last visit, own row pinned when scrolled off-screen.
// Clan and solo standings live on the Season screen (SeasonScreen).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Image } from '../ui/image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import AppIcon from './AppIcon';

import { api } from '../api/client';
import { fetchAndCache, getCached, setCached } from '../api/cache';
import { radius, shadow, space, withAlpha, useTheme, useThemedType, useThemedStyles } from '../theme';
import { NEUTRAL } from '../state/clan';
import { useAuth } from '../auth/AuthContext';
import { useAccent } from '../hooks/useAccent';
import { Skeleton, shouldStagger, staggerDelay, useReduceMotion } from '../ui/motion';
import { EmptyState } from './ui';
import { toast } from '../ui/toast';
import { art } from '../config/onboardingArt';
import GameLottie from './GameLottie';

// Rank -> place sticker. Null entries fall back to the plain "#n" text.
const PLACE_BADGE = {
  1: art('badge1st'),
  2: art('badge2nd'),
  3: art('badge3rd'),
};

// Exported so the post-claim leaderboard transition reads the SAME snapshot
// this screen writes — "your rank last time you looked" is the only honest
// basis this app has for a rank change, and there must be exactly one of it.
export const RANKS_KEY = 'tr.lastRanks';
const PODIUM = {
  1: { rankColor: '#b45309', bg: 'rgba(234,179,8,0.10)' },
  2: { rankColor: '#6b7280', bg: 'rgba(148,163,184,0.12)' },
  3: { rankColor: '#9a3412', bg: 'rgba(180,83,9,0.08)' },
};

function RankDelta({ delta, celebrate = false }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!delta) return null;
  return (
    <View style={styles.deltaSlot}>
      {celebrate && delta > 0 ? <GameLottie name="rankUp" size={62} trigger={delta} style={styles.rankFx} /> : null}
      <Text style={[styles.delta, { color: delta > 0 ? colors.ok : colors.danger }]}>{delta > 0 ? '▲' : '▼'}</Text>
    </View>
  );
}

// One standings row. Extracted so the post-claim leaderboard transition can
// render the real thing rather than a lookalike — there is one row design in
// this app and both callers use it.
export function LeaderboardRow({ item, isMe = false, board = 'land', celebrateDelta = false, style }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const c = item.clan_color || NEUTRAL;
  const podium = PODIUM[item.rank];
  return (
    <View
      style={[
        styles.row,
        podium && { backgroundColor: podium.bg },
        isMe && { backgroundColor: withAlpha(c.stroke, 0.08) },
        style,
      ]}
    >
      {/* Top three get the comic place sticker instead of "#n" — the art has
          the ordinal lettering baked in. */}
      {PLACE_BADGE[item.rank] ? (
        <Image
          source={PLACE_BADGE[item.rank]}
          style={styles.placeBadge}
          resizeMode="contain"
          fadeDuration={0}
          accessibilityLabel={`Rank ${item.rank}`}
        />
      ) : (
        <Text style={[styles.rank, podium && { color: podium.rankColor }]}>#{item.rank}</Text>
      )}
      <RankDelta delta={item.delta} celebrate={celebrateDelta} />
      <View style={[styles.dot, { backgroundColor: c.stroke }]} />
      <View style={{ flex: 1 }}>
        <Text style={type.bodyBold}>
          {item.clan_tag ? `[${item.clan_tag}] ` : ''}{item.username}{isMe ? ' · you' : ''}
        </Text>
        <Text style={type.caption}>
          {item.clan_tag ? 'club' : 'solo'} · {item.territory_count} territories
        </Text>
      </View>
      <Text style={[styles.area, { color: c.stroke }]}>
        {board === 'rank'
          ? `${(item.rank_points || 0).toLocaleString()} pts · ${item.rank_label || ''}`
          : `${((item.total_area_m2 || 0) / 1e6).toFixed(3)} km²`}
      </Text>
    </View>
  );
}

function RowSkeleton() {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Skeleton width={28} height={18} />
      <View style={{ width: 10 }} />
      <View style={{ flex: 1 }}>
        <Skeleton width="55%" height={15} />
        <Skeleton width="35%" height={11} style={{ marginTop: 6 }} />
      </View>
      <Skeleton width={72} height={17} />
    </View>
  );
}

// `board`: 'land' (area held) or 'rank' (rank points). Rank is the
// competitive read — it decays and can be lost, so it answers "who's winning
// now", where land answers "who holds the most".
export default function LeaderboardView({ board = 'land' }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const accent = useAccent();
  const reduce = useReduceMotion();
  // Seeded from the response cache — the standings you last saw are on screen
  // while the fresh ones are fetched, instead of seven skeleton rows.
  const [rows, setRows] = useState(() => getCached(`leaderboard:${board}`));
  const [refreshing, setRefreshing] = useState(false);
  const [myVisible, setMyVisible] = useState(true);
  const prevRanksRef = useRef(null);

  // Switching board swaps to THAT board's cached rows rather than leaving the
  // other board's ordering on screen while the new one is fetched.
  const seededBoard = useRef(board);
  if (seededBoard.current !== board) {
    seededBoard.current = board;
    setRows(getCached(`leaderboard:${board}`));
  }

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewable = useRef(({ viewableItems }) => {
    setMyVisible(viewableItems.some((v) => v.item?.user_id === user.id));
  }).current;

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      // No blanking to skeletons here: whatever is already on screen (cached
      // or from the last board) stays put until the new rows are ready.
      try {
        if (prevRanksRef.current === null) {
          try {
            prevRanksRef.current = JSON.parse(await AsyncStorage.getItem(`${RANKS_KEY}.${board}`)) || {};
          } catch {
            prevRanksRef.current = {};
          }
        }
        const data = await fetchAndCache(`leaderboard:${board}:raw`, () =>
          (board === 'rank' ? api.rankLeaderboard() : api.leaderboard())
        );
        const withDelta = (data || []).map((r, i) => {
          const prev = prevRanksRef.current[r.user_id];
          return { ...r, rank: i + 1, delta: prev ? prev - (i + 1) : 0 };
        });
        setRows(withDelta);
        // Cache the ranked rows, not the raw payload — the delta arrows are
        // part of what the row shows, and recomputing them from a stale
        // snapshot on the next mount would invent movement that didn't happen.
        setCached(`leaderboard:${board}`, withDelta);
        const ranks = {};
        withDelta.forEach((r) => (ranks[r.user_id] = r.rank));
        // Keyed per board: the two lists have different orderings, so sharing
        // one snapshot made every board switch show phantom movement arrows.
        AsyncStorage.setItem(`${RANKS_KEY}.${board}`, JSON.stringify(ranks)).catch(() => {});
      } catch (e) {
        toast.error(e.message || 'Could not load leaderboard');
        setRows((prev) => prev || []);
      } finally {
        if (isRefresh) setRefreshing(false);
      }
    },
    [board]
  );

  useEffect(() => {
    load();
  }, [load]);

  if (rows === undefined) {
    return (
      <View style={styles.listContent}>
        {Array.from({ length: 7 }).map((_, i) => <RowSkeleton key={i} />)}
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={styles.listContent}>
        <EmptyState
          art={require('../../assets/art/empty-leaderboard.png')}
          title="Nobody has claimed land yet"
          body="Be first. Run a loop and the ground inside is yours."
          style={{ paddingTop: space.xl }}
        />
      </View>
    );
  }

  const myRow = rows.find((r) => r.user_id === user.id);
  // Podium members are always visible in the header — never pin them.
  const showPinned = myRow && myRow.rank > 3 && !myVisible;
  const podiumRows = rows.slice(0, 3);
  const listRows = rows.slice(3);

  // Visual order silver–gold–bronze, gold centered and raised.
  const podiumOrder = [podiumRows[1], podiumRows[0], podiumRows[2]].filter(Boolean);

  const podium = (
    <View style={styles.podium}>
      {art('headerLeaderboard') && (
        <Image
          source={art('headerLeaderboard')}
          style={styles.podiumArt}
          resizeMode="cover"
          fadeDuration={0}
          pointerEvents="none"
        />
      )}
      {podiumOrder.map((r) => {
        const c = r.clan_color || NEUTRAL;
        const isFirst = r.rank === 1;
        return (
          <View key={r.user_id} style={[styles.podiumCol, isFirst && styles.podiumFirst]}>
            {r.user_id === user.id && r.delta > 0 ? (
              <GameLottie name="rankUp" size={100} trigger={r.delta} style={styles.podiumRankFx} />
            ) : null}
            {isFirst && <AppIcon name="crown" size={20} style={{ marginBottom: 4 }} />}
            <View
              style={[
                styles.podiumAvatar,
                { backgroundColor: c.fill, borderColor: c.stroke },
                isFirst && { width: 72, height: 72, borderRadius: 36 },
              ]}
            >
              <Text style={[isFirst ? type.title : type.bodyBold, { color: c.stroke }]}>
                {(r.username || '?').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <Text style={[type.caption, { marginTop: 6 }]}>#{r.rank}</Text>
            <Text style={type.bodySmBold} numberOfLines={1}>
              {r.username}
            </Text>
            <Text style={[type.captionMedium, { color: c.stroke }]}>
              {board === 'rank'
                ? `${(r.rank_points || 0).toLocaleString()} pts`
                : Math.round(r.total_area_m2).toLocaleString()}
            </Text>
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        style={styles.list}
        contentContainerStyle={[styles.listContent, showPinned && { paddingBottom: 96 }]}
        data={listRows}
        keyExtractor={(r) => r.user_id}
        ListHeaderComponent={podium}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewabilityConfig}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={accent} colors={[accent]} />}
        renderItem={({ item, index }) => (
          <Animated.View
            layout={reduce ? undefined : LinearTransition.duration(320)}
            entering={
              reduce || !shouldStagger(index)
                ? undefined
                : FadeInDown.delay(staggerDelay(index)).duration(260)
            }
          >
            <LeaderboardRow
              item={item}
              isMe={item.user_id === user.id}
              board={board}
              celebrateDelta={item.user_id === user.id}
            />
          </Animated.View>
        )}
      />
      {showPinned && (
        <View style={[styles.pinned, { backgroundColor: withAlpha((myRow.clan_color || NEUTRAL).stroke, 0.12) }]}>
          {myRow.delta > 0 ? <GameLottie name="rankUp" size={74} trigger={myRow.delta} style={styles.pinnedRankFx} /> : null}
          <Text style={styles.rank}>#{myRow.rank}</Text>
          <View style={[styles.dot, { backgroundColor: (myRow.clan_color || NEUTRAL).stroke }]} />
          <View style={{ flex: 1 }}>
            <Text style={type.bodyBold}>{myRow.username} · you</Text>
          </View>
          <Text style={[styles.area, { color: (myRow.clan_color || NEUTRAL).stroke }]}>
            {board === 'rank'
              ? `${(myRow.rank_points || 0).toLocaleString()} pts`
              : `${((myRow.total_area_m2 || 0) / 1e6).toFixed(3)} km²`}
          </Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors, _scheme, type) => StyleSheet.create({
  list: { backgroundColor: colors.bg },
  listContent: { paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    marginBottom: space.sm,
    ...shadow.card,
  },
  rank: { ...type.statSm, width: 36 },
  placeBadge: { width: 36, height: 30, marginRight: 2 },
  deltaSlot: { width: 14, alignItems: 'center', justifyContent: 'center' },
  delta: { ...type.caption },
  rankFx: { position: 'absolute' },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  area: { ...type.statSm },
  pinned: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    bottom: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    ...shadow.raised,
  },
  pinnedRankFx: { position: 'absolute', left: 4 },

  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: space.xl,
    marginBottom: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  // Podium scene behind the top three, faded so the real avatars read first.
  podiumArt: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.18 },
  podiumCol: { alignItems: 'center', width: 88 },
  podiumRankFx: { position: 'absolute', top: -22 },
  podiumFirst: { marginBottom: space.sm },
  podiumAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
