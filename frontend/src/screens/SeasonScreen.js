// Season standings — clans ranked by total land held this season. Reached from
// the Home season banner's "View season". Tap a clan to open its profile.

import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Crown, Trophy } from 'lucide-react-native';

import { api } from '../api/client';
import { brand, colors, radius, space, type } from '../theme';
import { Screen, Card, Row, Skeleton, EmptyState } from '../components/ui';
import ClanBadge from '../components/ClanBadge';
import { PressableScale } from '../ui/motion';

const km2 = (m) => (m / 1e6).toFixed(2);
const LEAGUE_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };

export default function SeasonScreen({ navigation }) {
  const [rows, setRows] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.clanLeaderboard());
    } catch {
      setRows([]);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!rows) {
    return (
      <Screen>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={64} style={{ borderRadius: radius.card, marginTop: space.md }} />
        ))}
      </Screen>
    );
  }

  if (rows.length === 0) {
    return (
      <Screen center>
        <EmptyState
          icon={<Trophy size={40} color={colors.textMuted} />}
          title="No clans on the board yet"
          body="Claim land with a clan to put it on the season standings."
        />
      </Screen>
    );
  }

  const open = (clanId) => navigation.navigate('ClubDetail', { clanId });

  return (
    <Screen gutter={false}>
      <FlatList
        data={rows}
        keyExtractor={(c) => c.clan_id}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xxl, paddingTop: space.md }}
        ListHeaderComponent={
          <View style={{ marginBottom: space.md }}>
            <Text style={type.display}>Season standings</Text>
            <Text style={[type.body, { color: colors.textMuted, marginTop: 2 }]}>
              Clans ranked by land conquered.
            </Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const rank = index + 1;
          const c = item.color;
          const top = rank === 1;
          return (
            <PressableScale onPress={() => open(item.clan_id)}>
              <Card style={[{ marginBottom: space.sm }, top && { borderWidth: 1, borderColor: c.stroke }]}>
                <Row between>
                  <Row gap={12} style={{ flex: 1 }}>
                    <View style={styles.rankCol}>
                      {top ? (
                        <Crown size={18} color="#eab308" fill="#eab308" />
                      ) : (
                        <Text style={[type.statSm, { color: colors.textMuted }]}>{rank}</Text>
                      )}
                    </View>
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
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[type.statSm, { color: c.stroke }]}>{km2(item.total_area_m2)}</Text>
                    <Text style={type.caption}>km²</Text>
                  </View>
                </Row>
              </Card>
            </PressableScale>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  rankCol: { width: 24, alignItems: 'center' },
  badgeChip: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
