// SideRail — the floating shortcut column on Home (mobile-game convention):
// pass, shop and season, each a framed tile with a live badge or countdown.
//
// It exists because those three screens are where the game's economy lives
// and none of them were reachable from Home. Everything it shows is a REAL
// state — claimable tiers, season time left — never decoration.
//
// Art is optional: each tile falls back to its sticker icon until the framed
// art lands (docs/ONBOARDING_ASSETS.md §7).

import React, { useCallback, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';

import { api } from '../api/client';
import { brand, space, toon, toonRadius, toonType, useTheme } from '../theme';
import { haptic, PressableScale } from '../ui/motion';
import { art } from '../config/onboardingArt';
import AppIcon from './AppIcon';

const GOLD = ['#FFD98A', '#F0A93C', '#A8631A'];

function RailTile({ icon, artKey, label, badge, tint = GOLD, onPress }) {
  const { colors } = useTheme();
  const src = art(artKey);
  return (
    <View style={styles.slot}>
      <PressableScale
        onPress={() => { haptic.light(); onPress?.(); }}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}${badge ? `, ${badge}` : ''}` : 'Open'}
        style={styles.tileWrap}
      >
        <LinearGradient colors={tint} start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }} style={styles.tile}>
          <View style={[styles.tileInner, { backgroundColor: colors.card }]}>
            {src ? (
              <Image source={src} style={styles.tileArt} resizeMode="contain" />
            ) : (
              <AppIcon name={icon} size={30} />
            )}
          </View>
        </LinearGradient>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={1}>{badge}</Text>
          </View>
        ) : null}
      </PressableScale>
      {label ? (
        <Text style={[toonType.label, styles.label]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

export default function SideRail({ navigation, seasonLabel, onOpenShop, style }) {
  const [claimable, setClaimable] = useState(0);
  const [boxes, setBoxes] = useState(0);

  // The rail's whole job is to show what's WAITING, so it re-reads on focus.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api
        .progression()
        .then((d) => {
          if (!alive) return;
          const claimed = new Set((d.claims || []).map((c) => `${c.level}:${c.track}`));
          let n = 0;
          for (const row of d.ladder || []) {
            if (row.level > d.level) break;
            if (!claimed.has(`${row.level}:free`)) n += 1;
            if (d.premium_active && !claimed.has(`${row.level}:premium`)) n += 1;
          }
          setClaimable(n);
          setBoxes((d.pending_lootboxes || []).length);
        })
        .catch(() => {});
      return () => { alive = false; };
    }, [])
  );

  return (
    <View style={[styles.rail, style]} pointerEvents="box-none">
      <RailTile
        icon="award"
        artKey="railPass"
        label="Pass"
        badge={claimable ? String(claimable) : null}
        onPress={() => navigation.navigate('You', { screen: 'Progression' })}
      />
      <RailTile
        icon="lootbox"
        artKey="railBoxes"
        label="Boxes"
        badge={boxes ? String(boxes) : null}
        tint={['#F97CBB', brand.pink, '#B4256F']}
        onPress={() => navigation.navigate('You', { screen: 'Progression' })}
      />
      <RailTile
        icon="energy"
        artKey="railShop"
        label="Shop"
        tint={['#7FF0DE', brand.teal, '#128476']}
        onPress={onOpenShop}
      />
      <RailTile
        icon="trophy"
        artKey="railSeason"
        label={seasonLabel}
        tint={['#C4B5FD', brand.purple, '#5B21B6']}
        onPress={() => navigation.navigate('Season')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', right: space.sm, gap: space.md, alignItems: 'center' },
  slot: { alignItems: 'center', width: 62 },
  tileWrap: { width: 56, height: 56 },
  tile: {
    width: 56,
    height: 56,
    borderRadius: toonRadius.cell,
    borderWidth: 2.5,
    borderColor: toon.ink,
    padding: 3,
  },
  tileInner: {
    flex: 1,
    borderRadius: toonRadius.cell - 5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tileArt: { width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: toon.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  label: { color: 'rgba(255,255,255,0.75)', fontSize: 10, marginTop: 3 },
});
