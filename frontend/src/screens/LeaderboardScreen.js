import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { api } from '../api/client';
import { colors, font, radius, space } from '../theme';
import { regionForUser } from '../data/regions';
import { useAuth } from '../auth/AuthContext';
import { toast } from '../ui/toast';

export default function LeaderboardScreen() {
  const { user } = useAuth();
  const myTeam = regionForUser(user?.username || '');
  const [rows, setRows] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.leaderboard();
        setRows(data);
      } catch (e) {
        toast.error(e.message || 'Could not load leaderboard');
        setRows([]);
      }
    })();
  }, []);

  if (!rows) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={rows}
      keyExtractor={(r) => r.user_id}
      ListHeaderComponent={
        <View style={styles.heading}>
          <Text style={font.hero}>Leaderboard</Text>
          <Text style={font.muted}>Top runners by territory area</Text>
        </View>
      }
      renderItem={({ item, index }) => {
        const isMe = item.user_id === user.id;
        const team = regionForUser(item.username);
        return (
          <View style={[styles.row, isMe && [styles.rowSelf, { borderColor: myTeam.color }]]}>
            <Text style={styles.rank}>#{index + 1}</Text>
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
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.bg },
  listContent: { padding: space.lg, paddingBottom: space.xxl },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },

  heading: { marginBottom: space.lg },

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
  },
  rowSelf: { borderColor: colors.primary, borderWidth: 1.5 },

  rank: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    width: 36,
  },
  teamDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },

  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  area: { color: colors.primary, fontWeight: '800' },
});
