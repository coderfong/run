// Season standings — reached from the Home season banner. Two boards:
//   Clans — clans ranked by total land held this season.
//   Solo  — players NOT in a clan, ranked by their own land.
// Tap a clan row to open its profile; solo rows aren't tappable (no profile).

import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Crown, Trophy } from 'lucide-react-native';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors, radius, space, type, withAlpha } from '../theme';
import { NEUTRAL } from '../state/clan';
import { Screen, Card, Row, Segmented, Skeleton, EmptyState } from '../components/ui';
import ClanBadge from '../components/ClanBadge';
import { PressableScale } from '../ui/motion';

const km2 = (m) => (m / 1e6).toFixed(2);
const LEAGUE_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };

export default function SeasonScreen({ navigation, route }) {
  const { user } = useAuth();
  const [mode, setMode] = useState(route.params?.mode || 'clans');
  const [rows, setRows] = useState(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      setRows(mode === 'clans' ? await api.clanLeaderboard() : await api.leaderboard({ solo: true }));
    } catch {
      setRows([]);
    }
  }, [mode]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const header = (
    <View style={{ marginBottom: space.md }}>
      <Text style={type.display}>Season standings</Text>
      <Text style={[type.body, { color: colors.textMuted, marginTop: 2, marginBottom: space.lg }]}>
        {mode === 'clans' ? 'Clans ranked by land conquered.' : 'Solo runners ranked by land conquered.'}
      </Text>
      <Segmented
        options={[{ key: 'clans', label: 'Clans' }, { key: 'solo', label: 'Solo' }]}
        value={mode}
        onChange={setMode}
      />
    </View>
  );

  if (!rows) {
    return (
      <Screen>
        <View style={{ marginTop: space.md }}>{header}</View>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={64} style={{ borderRadius: radius.card, marginTop: space.sm }} />
        ))}
      </Screen>
    );
  }

  const openClan = (clanId) => navigation.navigate('ClubDetail', { clanId });

  const renderClan = (item, index) => {
    const rank = index + 1;
    const c = item.color;
    const top = rank === 1;
    return (
      <PressableScale onPress={() => openClan(item.clan_id)}>
        <Card style={[{ marginBottom: space.sm }, top && { borderWidth: 1, borderColor: c.stroke }]}>
          <Row between>
            <Row gap={12} style={{ flex: 1 }}>
              <RankCol rank={rank} top={top} />
              <View style={[styles.badgeChip, { backgroundColor: c.fill }]}>
                <ClanBadge icon={item.badge_icon} size={20} color={c.stroke} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.bodyBold} numberOfLines={1}>[{item.tag}] {item.name}</Text>
                <Text style={type.caption}>
                  {item.member_count} members{item.league ? ` · ${LEAGUE_LABEL[item.league]}` : ''}
                </Text>
              </View>
            </Row>
            <Amount value={km2(item.total_area_m2)} unit="km²" color={c.stroke} />
          </Row>
        </Card>
      </PressableScale>
    );
  };

  const renderSolo = (item, index) => {
    const rank = index + 1;
    const top = rank === 1;
    const isMe = item.user_id === user.id;
    const c = NEUTRAL;
    return (
      <Card style={[{ marginBottom: space.sm }, isMe && { backgroundColor: withAlpha(c.stroke, 0.1) }]}>
        <Row between>
          <Row gap={12} style={{ flex: 1 }}>
            <RankCol rank={rank} top={top} />
            <View style={[styles.avatar, { backgroundColor: c.fill, borderColor: c.stroke }]}>
              <Text style={[type.bodySmBold, { color: c.stroke }]}>
                {(item.username || '?').slice(0, 2).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.bodyBold} numberOfLines={1}>{item.username}{isMe ? ' · you' : ''}</Text>
              <Text style={type.caption}>{item.territory_count} territories</Text>
            </View>
          </Row>
          <Amount value={Math.round(item.total_area_m2).toLocaleString()} unit="m²" color={c.stroke} />
        </Row>
      </Card>
    );
  };

  return (
    <Screen gutter={false}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.clan_id || item.user_id}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xxl, paddingTop: space.md }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon={<Trophy size={40} color={colors.textMuted} />}
            title={mode === 'clans' ? 'No clans on the board yet' : 'No solo runners yet'}
            body={mode === 'clans'
              ? 'Claim land with a clan to put it on the season standings.'
              : 'Claim land without a clan to appear here.'}
            style={{ marginTop: space.xxl }}
          />
        }
        renderItem={({ item, index }) => (mode === 'clans' ? renderClan(item, index) : renderSolo(item, index))}
      />
    </Screen>
  );
}

function RankCol({ rank, top }) {
  return (
    <View style={styles.rankCol}>
      {top ? <Crown size={18} color="#eab308" fill="#eab308" /> : <Text style={[type.statSm, { color: colors.textMuted }]}>{rank}</Text>}
    </View>
  );
}

function Amount({ value, unit, color }) {
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={[type.statSm, { color }]}>{value}</Text>
      <Text style={type.caption}>{unit}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rankCol: { width: 24, alignItems: 'center' },
  badgeChip: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
