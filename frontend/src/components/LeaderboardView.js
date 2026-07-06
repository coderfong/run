// LeaderboardView — Runners | Clans. Runners keeps the v1 treatment (podium
// tint, rank-change arrows vs last visit, own row pinned when off-screen).
// Clans ranks by summed member area (empty until Phase 5 populates clans).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { api } from '../api/client';
import { colors, radius, shadow, space, type, withAlpha } from '../theme';
import { regionForUser } from '../data/regions';
import { useAuth } from '../auth/AuthContext';
import { useAccent } from '../hooks/useAccent';
import { Skeleton, useReduceMotion } from '../ui/motion';
import { Segmented } from './ui';
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
  const [mode, setMode] = useState('runners');
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
        if (mode === 'clans') {
          const data = await api.clanLeaderboard();
          setRows((data || []).map((c, i) => ({ ...c, rank: i + 1 })));
        } else {
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
        }
      } catch (e) {
        toast.error(e.message || 'Could not load leaderboard');
        setRows((prev) => prev || []);
      } finally {
        if (isRefresh) setRefreshing(false);
      }
    },
    [mode]
  );

  useEffect(() => {
    load();
  }, [load]);

  const header = (
    <Segmented
      options={[{ key: 'runners', label: 'Runners' }, { key: 'clans', label: 'Clans' }]}
      value={mode}
      onChange={setMode}
      style={{ marginBottom: space.lg }}
    />
  );

  if (!rows) {
    return (
      <View style={styles.listContent}>
        {header}
        {Array.from({ length: 7 }).map((_, i) => <RowSkeleton key={i} />)}
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={styles.listContent}>
        {header}
        <View style={{ alignItems: 'center', paddingTop: space.xxl }}>
          <Text style={[type.title, { textAlign: 'center', marginBottom: space.sm }]}>
            {mode === 'clans' ? 'No clans yet.' : 'Nobody has claimed land yet.'}
          </Text>
          <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>
            {mode === 'clans'
              ? 'Clans arrive in the next update — then this ranks them by held land.'
              : 'Be first — run a loop and the ground inside is yours.'}
          </Text>
        </View>
      </View>
    );
  }

  if (mode === 'clans') {
    return (
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={rows}
        keyExtractor={(c) => c.clan_id}
        ListHeaderComponent={header}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={accent} colors={[accent]} />}
        renderItem={({ item, index }) => (
          <Animated.View
            entering={reduce ? undefined : FadeInDown.delay(Math.min(index, 12) * 30).duration(260)}
            style={[styles.row, PODIUM[item.rank] && { backgroundColor: PODIUM[item.rank].bg }]}
          >
            <Text style={[styles.rank, PODIUM[item.rank] && { color: PODIUM[item.rank].rankColor }]}>#{item.rank}</Text>
            <View style={[styles.dot, { backgroundColor: item.color_stroke }]} />
            <View style={{ flex: 1 }}>
              <Text style={type.bodyBold}>[{item.tag}] {item.name}</Text>
              <Text style={type.caption}>{item.member_count} members · {item.territory_count} zones</Text>
            </View>
            <Text style={[styles.area, { color: item.color_stroke }]}>
              {(item.total_area_m2 / 1e6).toFixed(2)} km²
            </Text>
          </Animated.View>
        )}
      />
    );
  }

  const myRow = rows.find((r) => r.user_id === user.id);
  const showPinned = myRow && !myVisible;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        style={styles.list}
        contentContainerStyle={[styles.listContent, showPinned && { paddingBottom: 96 }]}
        data={rows}
        keyExtractor={(r) => r.user_id}
        ListHeaderComponent={header}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewabilityConfig}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={accent} colors={[accent]} />}
        renderItem={({ item, index }) => {
          const isMe = item.user_id === user.id;
          const team = regionForUser(item.username);
          const podium = PODIUM[item.rank];
          return (
            <Animated.View
              entering={reduce ? undefined : FadeInDown.delay(Math.min(index, 12) * 30).duration(260)}
              style={[
                styles.row,
                podium && { backgroundColor: podium.bg },
                isMe && { backgroundColor: withAlpha(team.stroke, 0.08) },
              ]}
            >
              <Text style={[styles.rank, podium && { color: podium.rankColor }]}>#{item.rank}</Text>
              <RankDelta delta={item.delta} />
              <View style={[styles.dot, { backgroundColor: team.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={type.bodyBold}>{item.username}{isMe ? ' · you' : ''}</Text>
                <Text style={type.caption}>{team.name} · {item.territory_count} territories</Text>
              </View>
              <Text style={[styles.area, { color: team.color }]}>
                {Math.round(item.total_area_m2).toLocaleString()} m²
              </Text>
            </Animated.View>
          );
        }}
      />
      {showPinned && (
        <View style={[styles.pinned, { backgroundColor: withAlpha(regionForUser(myRow.username).stroke, 0.12) }]}>
          <Text style={styles.rank}>#{myRow.rank}</Text>
          <View style={[styles.dot, { backgroundColor: regionForUser(myRow.username).color }]} />
          <View style={{ flex: 1 }}>
            <Text style={type.bodyBold}>{myRow.username} · you</Text>
          </View>
          <Text style={[styles.area, { color: regionForUser(myRow.username).color }]}>
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
});
