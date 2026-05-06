import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Polygon } from 'react-native-maps';

import { colors, font, radius, space } from '../theme';
import { SG_BBOX, SG_REGIONS, SG_VIEW_REGION, regionForUser } from '../data/regions';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 18) return 'Good Afternoon';
  return 'Good Evening';
}

// Adjust polygon opacity so the region the user belongs to reads as "their" team.
function regionFill(hex, isMine) {
  const alpha = isMine ? 'AA' : '55';
  return `${hex}${alpha}`;
}

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const myRegion = useMemo(() => regionForUser(user.username), [user.username]);

  const [territoryCount, setTerritoryCount] = useState(null);
  const [myArea, setMyArea] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.mapPolygons({
          minLon: SG_BBOX.minLon,
          minLat: SG_BBOX.minLat,
          maxLon: SG_BBOX.maxLon,
          maxLat: SG_BBOX.maxLat,
        });
        const ts = data.territories || [];
        setTerritoryCount(ts.length);
        const mine = ts
          .filter((t) => t.user_id === user.id)
          .reduce((s, t) => s + (t.area_m2 || 0), 0);
        setMyArea(mine);
      } catch (e) {
        setTerritoryCount(0);
        setMyArea(0);
      }
    })();
  }, [user.id]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.hi}>Hi, {greeting()}</Text>
          <Text style={styles.name}>{user.username}</Text>
        </View>
        <TouchableOpacity
          style={[styles.teamBadge, { borderColor: myRegion.color }]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Profile')}
        >
          <View style={[styles.teamDot, { backgroundColor: myRegion.color }]} />
          <Text style={styles.teamText}>{myRegion.name}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.mapCard}>
        <View style={styles.mapHeader}>
          <Text style={font.section}>Territories of Singapore</Text>
          <Text style={font.muted}>5 teams · pick land, not sides</Text>
        </View>

        <View style={styles.mapWrap}>
          <MapView
            style={styles.map}
            initialRegion={SG_VIEW_REGION}
            pointerEvents="none"
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
          >
            {SG_REGIONS.map((r) => (
              <Polygon
                key={r.key}
                coordinates={r.coordinates}
                strokeColor={r.color}
                strokeWidth={r.key === myRegion.key ? 2.5 : 1.5}
                fillColor={regionFill(r.color, r.key === myRegion.key)}
              />
            ))}
          </MapView>
        </View>

        <View style={styles.legend}>
          {SG_REGIONS.map((r) => (
            <View key={r.key} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: r.color }]} />
              <Text
                style={[
                  styles.legendLabel,
                  r.key === myRegion.key && styles.legendLabelMine,
                ]}
              >
                {r.name}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatTile
          label="Your Region"
          value={myRegion.name}
          accent={myRegion.color}
        />
        <StatTile
          label="Territories"
          value={
            territoryCount === null ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              String(territoryCount)
            )
          }
        />
        <StatTile
          label="Your Land"
          value={
            myArea === null
              ? <ActivityIndicator color={colors.primary} />
              : `${Math.round(myArea).toLocaleString()} m²`
          }
        />
      </View>

      <TouchableOpacity
        style={styles.primaryBtn}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('Running')}
      >
        <Text style={styles.primaryBtnText}>Start Run</Text>
      </TouchableOpacity>

      <View style={styles.secondaryRow}>
        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('GlobalMap')}
        >
          <Text style={styles.secondaryBtnText}>World Map</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Leaderboard')}
        >
          <Text style={styles.secondaryBtnText}>Leaderboard</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function StatTile({ label, value, accent }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text
        style={[styles.tileValue, accent && { color: accent }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  container: { padding: space.lg, paddingBottom: space.xxl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: space.lg,
  },
  hi: { ...font.muted, marginBottom: 2 },
  name: { ...font.title },

  teamBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    backgroundColor: colors.card,
  },
  teamDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  teamText: { color: colors.text, fontWeight: '700' },

  mapCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.lg,
  },
  mapHeader: { marginBottom: space.md },
  mapWrap: {
    height: 260,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
  },
  map: { flex: 1 },

  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: space.md,
    marginHorizontal: -space.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space.xs,
    marginVertical: space.xs,
  },
  legendSwatch: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  legendLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  legendLabelMine: { color: colors.text },

  statsRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
  tile: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.md,
  },
  tileLabel: { ...font.muted, marginBottom: 6 },
  tileValue: { color: colors.primary, fontSize: 18, fontWeight: '800' },

  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: radius.lg,
    alignItems: 'center',
    marginBottom: space.md,
  },
  primaryBtnText: { color: colors.primaryInk, fontSize: 17, fontWeight: '800' },

  secondaryRow: { flexDirection: 'row', gap: space.sm },
  secondaryBtn: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: { color: colors.text, fontWeight: '700' },
});
