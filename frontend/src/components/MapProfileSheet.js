// MapProfileSheet — quick-look popup opened by tapping a player's territory
// or portrait on the global Map. Shares RunnerProfileScreen's fetch (same
// cache key), so a runner already looked at elsewhere in the app opens here
// instantly. "Full profile" pushes into the real RunnerProfileScreen for the
// paser action, safety actions, and recent-runs list this popup skips.

import React from 'react';
import { Text, View } from 'react-native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { space, useTheme, useThemedType } from '../theme';
import { Sheet, Card, Row, Button, StatValue, Skeleton } from './ui';
import { Arrival, useArrival } from '../ui/motion';
import { CharacterBust } from './character/CharacterRig';
import PortraitBorder from './PortraitBorder';

const km = (m) => (m / 1000).toFixed(1);
const km2 = (m2) => (m2 / 1e6).toFixed(2);

export default function MapProfileSheet({ userId, onClose, navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const { data: p, loading } = useQuery(
    userId ? `runner:${userId}` : null,
    () => api.runnerProfile(userId)
  );

  const accent = p?.clan_color?.stroke || colors.textMuted;
  const arriving = useArrival(loading);

  return (
    <Sheet visible={!!userId} onClose={onClose}>
      {loading ? (
        <Skeleton width="100%" height={180} style={{ borderRadius: 16 }} />
      ) : !p ? (
        <Text style={[type.body, { textAlign: 'center', paddingVertical: space.lg }]}>
          Runner not found.
        </Text>
      ) : (
        <Arrival active={arriving}>
          <View style={{ alignItems: 'center' }}>
            <PortraitBorder borderKey={p.rank_key || 'wood'} size={84}>
              <CharacterBust equipped={p.avatar} size={84} ring={accent} />
            </PortraitBorder>
            {/* The name is the whole point of a quick-look popup — it used to
                sit above a row of "Solo · Level N · N pasers" pills, which
                pushed it up small and left it with no fallback: an account
                with no username on record rendered nothing here at all, just
                a gap over the pills. Username and level are the identity this
                popup exists to show; club membership and paser count are one
                tap away on the full profile, not worth a pill each here. */}
            <Text style={[type.title, { marginTop: space.sm, textAlign: 'center' }]} numberOfLines={1}>
              {p.username || 'Runner'}
            </Text>
            <Text style={[type.bodyBold, { color: accent, marginTop: 2 }]}>
              {p.clan_tag ? `[${p.clan_tag}] · ` : ''}Level {p.level}
            </Text>
          </View>

          <Row gap={space.sm} style={{ marginTop: space.lg }}>
            <Card style={{ flex: 1 }}>
              <StatValue size="sm" label="Area held" value={km2(p.total_area_m2)} unit="km²" color={accent} />
            </Card>
            <Card style={{ flex: 1 }}>
              <StatValue size="sm" label="Distance" value={km(p.career_distance_m)} unit="km" />
            </Card>
            <Card style={{ flex: 1 }}>
              <StatValue size="sm" label="Zones" value={String(p.territory_count)} />
            </Card>
          </Row>

          {navigation ? (
            <Button
              title="Full profile"
              variant="secondary"
              style={{ marginTop: space.md }}
              onPress={() => {
                onClose();
                navigation.navigate('RunnerProfile', { userId: p.user_id, username: p.username });
              }}
            />
          ) : null}
        </Arrival>
      )}
    </Sheet>
  );
}
