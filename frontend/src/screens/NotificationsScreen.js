// Notifications inbox (the bell). Marks everything read on open.

import React, { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Bell, Heart, Shield, Swords, Trophy } from 'lucide-react-native';

import { api } from '../api/client';
import { brand, colors, radius, space, type } from '../theme';
import { Screen, Skeleton, EmptyState } from '../components/ui';

const CATEGORY_ICON = {
  stolen: Swords,
  clan_goal: Shield,
  kudos: Heart,
  season: Trophy,
  recap: Bell,
};

function timeAgo(iso) {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationsScreen() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.notifications();
        setItems(data.items || []);
        if (data.unread > 0) api.markNotificationsRead().catch(() => {});
      } catch {
        setItems([]);
      }
    })();
  }, []);

  if (!items) {
    return (
      <Screen>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={64} style={{ borderRadius: radius.card, marginTop: space.md }} />
        ))}
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen center>
        <EmptyState
          icon={<Bell size={40} color={colors.textMuted} />}
          title="Nothing yet"
          body="Attacks on your land, club goals, and kudos land here."
        />
      </Screen>
    );
  }

  return (
    <Screen gutter={false}>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xxl, paddingTop: space.md }}
        renderItem={({ item }) => {
          const Icon = CATEGORY_ICON[item.category] || Bell;
          return (
            <View style={[styles.row, !item.read && styles.unread]}>
              <View style={styles.icon}>
                <Icon size={18} color={item.read ? colors.textMuted : brand.pink} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.bodyBold}>{item.title}</Text>
                <Text style={[type.bodySm, { color: colors.textMuted, marginTop: 2 }]}>{item.body}</Text>
                <Text style={[type.caption, { marginTop: 4 }]}>{timeAgo(item.created_at)}</Text>
              </View>
            </View>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.lg,
    marginBottom: space.sm,
  },
  unread: { backgroundColor: colors.cardAlt },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
