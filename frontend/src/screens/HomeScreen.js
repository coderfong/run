// Home — the feed + season surface. Flat season banner, a [Feed | Leaderboard]
// segmented control, then either the activity feed or the leaderboard.
//
// The season banner is a Phase-4 placeholder (static window); Phase 5 wires it
// to real seasons + your clan's league and rank. Route thumbnails on feed
// cards need run geometry (not carried in the feed) — deferred.

import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Footprints } from 'lucide-react-native';

import { api } from '../api/client';
import { colors, space, type } from '../theme';
import { useReduceMotion } from '../ui/motion';
import { Segmented, EmptyState, Skeleton } from '../components/ui';
import FeedCard from '../components/FeedCard';
import LeaderboardView from '../components/LeaderboardView';
import { useAccent } from '../hooks/useAccent';

// Placeholder season (Phase 5 replaces with the real seasons table).
const SEASON_NAME = 'Monsoon';
const SEASON_NO = 1;
const SEASON_END = new Date('2026-09-30T00:00:00Z');

function SeasonBanner() {
  const days = Math.max(0, Math.ceil((SEASON_END - Date.now()) / 86400000));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <View>
        <Text style={type.labelSm}>Season {SEASON_NO}</Text>
        <Text style={[type.title, { marginTop: 2 }]}>{SEASON_NAME}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={type.statMd}>{days}</Text>
        <Text style={type.caption}>days left</Text>
      </View>
    </View>
  );
}

function FeedList({ navigation }) {
  const accent = useAccent();
  const reduce = useReduceMotion();
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await api.feed();
      setItems(data.items || []);
      setCursor(data.next_cursor || null);
    } catch {
      setItems((prev) => prev || []);
    } finally {
      if (isRefresh) setRefreshing(false);
    }
  }, []);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.feed(cursor);
      setItems((prev) => [...(prev || []), ...(data.items || [])]);
      setCursor(data.next_cursor || null);
    } catch {
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  if (!items) {
    return (
      <View style={{ paddingHorizontal: space.gutter, paddingTop: space.md }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={110} style={{ borderRadius: 16, marginBottom: space.md }} />
        ))}
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Footprints size={40} color={accent} />}
        title="Your feed is quiet"
        body="Start a run — the feed fills as you and your city claim land."
        actionLabel="Start run"
        onAction={() => navigation.navigate('Record')}
        accent={accent}
      />
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.xxl }}
      data={items}
      keyExtractor={(it) => it.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={accent} colors={[accent]} />}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      renderItem={({ item, index }) => (
        <Animated.View entering={reduce ? undefined : FadeInDown.delay(Math.min(index, 12) * 30).duration(240)}>
          <FeedCard item={item} navigation={navigation} />
        </Animated.View>
      )}
    />
  );
}

export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState('feed');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: space.gutter, paddingTop: space.sm }}>
        <SeasonBanner />
        <Segmented
          options={[{ key: 'feed', label: 'Feed' }, { key: 'leaderboard', label: 'Leaderboard' }]}
          value={tab}
          onChange={setTab}
          style={{ marginTop: space.lg, marginBottom: space.xs }}
        />
      </View>
      {tab === 'feed' ? <FeedList navigation={navigation} /> : <LeaderboardView />}
    </View>
  );
}
