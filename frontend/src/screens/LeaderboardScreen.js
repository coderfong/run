import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { api } from '../api/client';
import { colors, radius, shadow, space, type } from '../theme';
import { regionForUser } from '../data/regions';
import { useAuth } from '../auth/AuthContext';
import { Skeleton, useReduceMotion } from '../ui/motion';
import { toast } from '../ui/toast';

const RANKS_KEY = 'tr.lastRanks'; // { [user_id]: rank } from the previous visit

// Subtle podium treatment for the top three.
const PODIUM = {
  1: { rankColor: '#b45309', bg: 'rgba(234,179,8,0.10)' },
  2: { rankColor: '#6b7280', bg: 'rgba(148,163,184,0.12)' },
  3: { rankColor: '#9a3412', bg: 'rgba(180,83,9,0.08)' },
};

function RankDelta({ delta }) {
  if (!delta) return null;
  const up = delta > 0;
  return (
    <Text style={[styles.rankDelta, { color: up ? colors.ok : colors.danger }]}>
      {up ? '▲' : '▼'}
    </Text>
  );
}

function LeaderboardSkeleton() {
  return (
    <View style={styles.listContent}>
      <View style={styles.heading}>
        <Skeleton width={220} height={34} />
        <Skeleton width={170} height={14} style={{ marginTop: 10 }} />
      </View>
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={28} height={18} />
          <View style={{ width: 10 }} />
          <View style={{ flex: 1 }}>
            <Skeleton width="55%" height={15} />
            <Skeleton width="35%" height={11} style={{ marginTop: 6 }} />
          </View>
          <Skeleton width={72} height={17} />
        </View>
      ))}
    </View>
  );
}

export default function LeaderboardScreen() {
  const { user } = useAuth();
  const myTeam = regionForUser(user?.username || '');
  const reduceMotion = useReduceMotion();
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [myRowVisible, setMyRowVisible] = useState(true);
  const prevRanksRef = useRef(null);

  // Pin the signed-in user's row to the bottom whenever it's off-screen.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    setMyRowVisible(viewableItems.some((v) => v.item?.user_id === user.id));
  }).current;

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      try {
        // Previous visit's ranks -> movement arrows.
        if (prevRanksRef.current === null) {
          try {
            prevRanksRef.current =
              JSON.parse(await AsyncStorage.getItem(RANKS_KEY)) || {};
          } catch {
            prevRanksRef.current = {};
          }
        }
        const data = await api.leaderboard();
        const withDelta = (data || []).map((r, i) => {
          const prev = prevRanksRef.current[r.user_id];
          return { ...r, rank: i + 1, delta: prev ? prev - (i + 1) : 0 };
        });
        setRows(withDelta);
        const ranks = {};
        withDelta.forEach((r) => (ranks[r.user_id] = r.rank));
        AsyncStorage.setItem(RANKS_KEY, JSON.stringify(ranks)).catch(() => {});
      } catch (e) {
        toast.error(e.message || 'Could not load leaderboard');
        setRows((prev) => prev || []);
      } finally {
        if (isRefresh) setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  if (!rows) return <LeaderboardSkeleton />;

  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Nobody has claimed land yet.</Text>
        <Text style={styles.emptyBody}>
          Be first — run a loop and the ground inside is yours.
        </Text>
      </View>
    );
  }

  const myRow = rows.find((r) => r.user_id === user.id);
  const showPinned = myRow && !myRowVisible;

  return (
    <View style={styles.wrap}>
    <FlatList
      style={styles.list}
      contentContainerStyle={[styles.listContent, showPinned && { paddingBottom: 96 }]}
      data={rows}
      keyExtractor={(r) => r.user_id}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => load(true)}
          tintColor={myTeam.stroke}
          colors={[myTeam.stroke]}
        />
      }
      ListHeaderComponent={
        <View style={styles.heading}>
          <Text style={type.display}>Leaderboard</Text>
          <Text style={{ ...type.body, color: colors.textMuted }}>
            Top runners by territory area
          </Text>
        </View>
      }
      renderItem={({ item, index }) => {
        const isMe = item.user_id === user.id;
        const team = regionForUser(item.username);
        const podium = PODIUM[item.rank];
        return (
          <Animated.View
            entering={
              reduceMotion
                ? undefined
                : FadeInDown.delay(Math.min(index, 12) * 30).duration(260)
            }
            style={[
              styles.row,
              podium && { backgroundColor: podium.bg },
              isMe && [styles.rowSelf, { borderColor: myTeam.color }],
            ]}
          >
            <Text style={[styles.rank, podium && { color: podium.rankColor }]}>
              #{item.rank}
            </Text>
            <RankDelta delta={item.delta} />
            <View style={[styles.teamDot, { backgroundColor: team.color }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.username}</Text>
              <Text style={styles.meta}>
                {team.name} · {item.territory_count} territories
              </Text>
            </View>
            <Text style={[styles.area, { color: team.color }]}>
              {Math.round(item.total_area_m2).toLocaleString()} m²
            </Text>
          </Animated.View>
        );
      }}
    />

    {/* your row, pinned while it's scrolled out of view */}
    {showPinned && (
      <View style={[styles.pinned, { borderColor: myTeam.color }]}>
        <Text style={styles.rank}>#{myRow.rank}</Text>
        <View style={[styles.teamDot, { backgroundColor: myTeam.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{myRow.username} (you)</Text>
          <Text style={styles.meta}>
            {myTeam.name} · {myRow.territory_count} territories
          </Text>
        </View>
        <Text style={[styles.area, { color: myTeam.color }]}>
          {Math.round(myRow.total_area_m2).toLocaleString()} m²
        </Text>
      </View>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  list: { backgroundColor: colors.bg },
  listContent: { padding: space.lg, paddingBottom: space.xxl },

  heading: { marginBottom: space.lg },

  empty: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  emptyTitle: { ...type.title, textAlign: 'center', marginBottom: space.sm },
  emptyBody: { ...type.body, color: colors.textMuted, textAlign: 'center' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    marginBottom: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  rowSelf: { borderWidth: 1.5 },

  rank: {
    ...type.statSm,
    width: 36,
  },
  rankDelta: { ...type.caption, width: 14 },
  teamDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },

  name: { ...type.bodyBold },
  meta: { ...type.caption, marginTop: 2 },

  area: { ...type.statSm },

  pinned: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    ...shadow.raised,
  },
});
