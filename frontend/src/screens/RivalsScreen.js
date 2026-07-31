// Rivals — every runner you've traded land with, newest beat first.
//
// The list is a READ of the claim engine's ledger (territory_steals), so it
// can never disagree with the map. Clubmates never appear: their land isn't
// stealable, so there's nothing to be rivals about.

import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Swords } from 'lucide-react-native';

import { api } from '../api/client';
import { radius, space, useTheme, useThemedType } from '../theme';
import { Screen, Skeleton, EmptyState, ToonHeader } from '../components/ui';
import RivalCard, { fmtArea } from '../components/RivalCard';
import { useAvatar } from '../state/avatar';

export default function RivalsScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const { equipped } = useAvatar();

  const [rivals, setRivals] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.rivals();
      setRivals(d.rivals || []);
    } catch {
      setRivals([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Career score across every rivalry — the one-line "how am I doing".
  const net = (rivals || []).reduce((sum, r) => sum + (r.net_m2 || 0), 0);

  const header = (
    <ToonHeader
      eyebrow="Head to head"
      title="Rivals"
      tint={['#ef4444', '#fb923c']}
      top={insets.top}
      onBack={() => navigation.goBack()}
    >
      {rivals?.length ? (
        <Text style={[type.bodySm, styles.score]}>
          {net >= 0
            ? `You're up ${fmtArea(net)} across ${rivals.length} ${rivals.length === 1 ? 'rivalry' : 'rivalries'}`
            : `You're down ${fmtArea(-net)} across ${rivals.length} ${rivals.length === 1 ? 'rivalry' : 'rivalries'}`}
        </Text>
      ) : null}
    </ToonHeader>
  );

  if (!rivals) {
    return (
      <Screen gutter={false} edges={[]}>
        {header}
        <View style={{ paddingHorizontal: space.gutter }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={210} style={{ borderRadius: radius.card, marginTop: space.md }} />
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen gutter={false} edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.textMuted}
          />
        }
      >
        <View style={{ marginHorizontal: -space.gutter }}>{header}</View>

        {rivals.length === 0 ? (
          <EmptyState
            icon={<Swords size={64} color={colors.textDim} />}
            title="No rivals yet"
            body="Claim ground someone else holds — or lose some of yours — and the rivalry starts itself."
            actionLabel="Start a run"
            onAction={() => navigation.navigate('Record')}
            style={{ paddingTop: space.xl }}
          />
        ) : (
          rivals.map((r) => (
            <RivalCard
              key={r.user_id}
              rival={r}
              myAvatar={equipped}
              style={{ marginTop: space.md }}
              onTakeBack={() => navigation.navigate('Record')}
              onViewLand={
                r.last_event?.lat != null
                  ? () =>
                      navigation.navigate('Map', {
                        screen: 'MapMain',
                        params: { focus: { lat: r.last_event.lat, lon: r.last_event.lon } },
                      })
                  : undefined
              }
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  score: { color: 'rgba(255,255,255,0.9)', marginTop: space.sm },
});
