// LeaderboardView — individual runners ranked by land held. Podium tint,
// rank-change arrows vs last visit, own row pinned when scrolled off-screen.
// Clan and solo standings live on the Season screen (SeasonScreen).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Crown } from 'lucide-react-native';

import { api } from '../api/client';
import { colors, radius, shadow, space, type, withAlpha } from '../theme';
import { NEUTRAL } from '../state/clan';
import { useAuth } from '../auth/AuthContext';
import { useAccent } from '../hooks/useAccent';
import { Skeleton, useReduceMotion } from '../ui/motion';
import { toast } from '../ui/toast';

const RANKS_KEY = 'tr.lastRanks';
const PODIUM = {
  1: { rankColor: '#b45309', bg: 'rgba(234,179,8,0.10)' },
  2: { rankColor: '#6b7280', bg: 'rgba(148,163,184,0.12)' },
  3: { rankColor: '#9a3412', bg: 'rgba(180,83,9,0.08)' },
};

function RankDelta({ delta }) {
  if (!delta) return null;
  return <Text style={[styles.delta, { color: delta > 0 ? colors.ok : colors.danger }]}>{delta > 0 ? '▲' : '▼'}</Text>;
}

function RowSkeleton() {
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

export default function LeaderboardView() {
  const { user } = useAuth();
  const accent = useAccent();
  const reduce = useReduceMotion();
  const [rows, setRows] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [myVisible, setMyVisible] = useState(true);
  const prevRanksRef = useRef(null);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewable = useRef(({ viewableItems }) => {
    setMyVisible(viewableItems.some((v) => v.item?.user_id === user.id));
  }).current;

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setRows(null);
      try {
        if (prevRanksRef.current === null) {
          try {
            prevRanksRef.current = JSON.parse(await AsyncStorage.getItem(RANKS_KEY)) || {};
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

  if (!rows) {
    return (
      <View style={styles.listContent}>
        {Array.from({ length: 7 }).map((_, i) => <RowSkeleton key={i} />)}
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={styles.listContent}>
        <View style={{ alignItems: 'center', paddingTop: space.xxl }}>
          <Text style={[type.title, { textAlign: 'center', marginBottom: space.sm }]}>
            Nobody has claimed land yet.
          </Text>
          <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>
            Be first — run a loop and the ground inside is yours.
          </Text>
        </View>
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
      {podiumOrder.map((r) => {
        const c = r.clan_color || NEUTRAL;
        const isFirst = r.rank === 1;
        return (
          <View key={r.user_id} style={[styles.podiumCol, isFirst && styles.podiumFirst]}>
            {isFirst && <Crown size={18} color="#eab308" fill="#eab308" style={{ marginBottom: 4 }} />}
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
              {Math.round(r.total_area_m2).toLocaleString()}
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
        renderItem={({ item, index }) => {
          const isMe = item.user_id === user.id;
          const c = item.clan_color || NEUTRAL;
          const podium = PODIUM[item.rank];
          return (
            <Animated.View
              entering={reduce ? undefined : FadeInDown.delay(Math.min(index, 12) * 30).duration(260)}
              style={[
                styles.row,
                podium && { backgroundColor: podium.bg },
                isMe && { backgroundColor: withAlpha(c.stroke, 0.08) },
              ]}
            >
              <Text style={[styles.rank, podium && { color: podium.rankColor }]}>#{item.rank}</Text>
              <RankDelta delta={item.delta} />
              <View style={[styles.dot, { backgroundColor: c.stroke }]} />
              <View style={{ flex: 1 }}>
                <Text style={type.bodyBold}>{item.clan_tag ? `[${item.clan_tag}] ` : ''}{item.username}{isMe ? ' · you' : ''}</Text>
                <Text style={type.caption}>{item.clan_tag ? 'club' : 'solo'} · {item.territory_count} territories</Text>
              </View>
              <Text style={[styles.area, { color: c.stroke }]}>
                {Math.round(item.total_area_m2).toLocaleString()} m²
              </Text>
            </Animated.View>
          );
        }}
      />
      {showPinned && (
        <View style={[styles.pinned, { backgroundColor: withAlpha((myRow.clan_color || NEUTRAL).stroke, 0.12) }]}>
          <Text style={styles.rank}>#{myRow.rank}</Text>
          <View style={[styles.dot, { backgroundColor: (myRow.clan_color || NEUTRAL).stroke }]} />
          <View style={{ flex: 1 }}>
            <Text style={type.bodyBold}>{myRow.username} · you</Text>
          </View>
          <Text style={[styles.area, { color: (myRow.clan_color || NEUTRAL).stroke }]}>
            {Math.round(myRow.total_area_m2).toLocaleString()} m²
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
  delta: { ...type.caption, width: 14 },
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

  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: space.xl,
    marginBottom: space.lg,
  },
  podiumCol: { alignItems: 'center', width: 88 },
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
