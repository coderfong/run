// ProgressionScreen — the level ladder. Shows the player's level + border, an
// XP bar, the energy meter (with refill shop), any unopened lootboxes, and the
// full 1..50 reward ladder (locked/unlocked/current). Data is server-owned via
// /me/progression; opening a lootbox rolls a cosmetic of its rarity and
// persists it so it sticks across devices.

import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Lock } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useAvatar } from '../state/avatar';
import { brand, radius, space, useTheme, useThemedType, withAlpha } from '../theme';
import { Card, Row, SectionHeader, Skeleton, Screen } from '../components/ui';
import { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import EnergyMeter from '../components/EnergyMeter';
import BuyEnergySheet from '../components/BuyEnergySheet';
import { borderForLevel, RARITY_COLORS, REWARD_KIND_LABEL } from '../config/progression';
import { ITEMS } from '../config/cosmetics';
import { toast } from '../ui/toast';

// Roll a random cosmetic of `rarity` from the catalog (legendary → epic pool).
function rollCosmetic(rarity) {
  const want = rarity === 'legendary' ? 'epic' : rarity;
  const pool = [];
  for (const slot of Object.keys(ITEMS)) {
    for (const item of ITEMS[slot]) {
      if ((item.rarity || 'common') === want && item.id !== 'none') pool.push({ slot, item });
    }
  }
  const src = pool.length ? pool : Object.keys(ITEMS).flatMap((s) => ITEMS[s].map((item) => ({ slot: s, item })));
  return src[Math.floor(Math.random() * src.length)];
}

function RewardChip({ reward, colors, type }) {
  const c = reward.kind === 'lootbox' ? RARITY_COLORS[reward.key] || brand.pink : brand.purple;
  return (
    <View style={[styles.chip, { borderColor: withAlpha(c, 0.5), backgroundColor: withAlpha(c, 0.12) }]}>
      <Text style={[type.caption, { color: colors.text }]} numberOfLines={1}>
        {reward.label || REWARD_KIND_LABEL[reward.kind] || reward.kind}
      </Text>
    </View>
  );
}

export default function ProgressionScreen() {
  const { colors } = useTheme();
  const type = useThemedType();
  const { equipped } = useAvatar();
  const [data, setData] = useState(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.progression()); } catch { setData(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openBox = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const { rarity } = await api.openLootbox();
      const roll = rollCosmetic(rarity);
      await api.addUnlock(roll.item.id);
      toast.success(`${rarity[0].toUpperCase() + rarity.slice(1)} lootbox: ${roll.item.label}!`);
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not open lootbox');
    } finally {
      setOpening(false);
    }
  };

  if (data === false) {
    return <Screen center><Text style={type.body}>Couldn’t load progression.</Text></Screen>;
  }
  if (!data) {
    return (
      <Screen>
        <Skeleton width="100%" height={180} style={{ borderRadius: radius.card, marginTop: space.md }} />
        <Skeleton width="100%" height={400} style={{ borderRadius: radius.card, marginTop: space.md }} />
      </Screen>
    );
  }

  const { level, xp_into_level, xp_for_next, energy, ladder, pending_lootboxes } = data;
  const pct = Math.max(0, Math.min(1, xp_into_level / xp_for_next));
  const tier = borderForLevel(level);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl }}>
      {/* header: portrait + level + xp */}
      <Card style={{ alignItems: 'center' }}>
        <PortraitBorder tier={tier} size={104}>
          <CharacterBust equipped={equipped} size={104} bg={colors.cardAlt} />
        </PortraitBorder>
        <Text style={[type.title, { marginTop: space.sm }]}>Level {level}</Text>
        <Text style={[type.caption, { color: colors.textMuted }]}>{tier.label} border</Text>
        <View style={[styles.xpTrack, { backgroundColor: colors.cardAlt }]}>
          <View style={[styles.xpFill, { width: `${pct * 100}%` }]} />
        </View>
        <Text style={[type.caption, { color: colors.textDim, marginTop: 6 }]}>
          {level >= 50 ? 'Max level reached' : `${xp_into_level.toLocaleString()} / ${xp_for_next.toLocaleString()} XP to level ${level + 1}`}
        </Text>
      </Card>

      {/* energy + shop */}
      <View style={{ marginTop: space.md }}>
        <EnergyMeter status={energy} onPress={() => setShopOpen(true)} />
      </View>

      {/* unopened lootboxes */}
      {pending_lootboxes.length > 0 && (
        <TouchableOpacity style={[styles.boxCard, { borderColor: brand.pink }]} onPress={openBox} activeOpacity={0.85} disabled={opening}>
          <AppIcon name="lootbox" size={26} />
          <View style={{ flex: 1 }}>
            <Text style={type.bodyBold}>{pending_lootboxes.length} lootbox{pending_lootboxes.length === 1 ? '' : 'es'} ready</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>Tap to open a random collectible</Text>
          </View>
          <AppIcon name="sparkles" size={20} />
        </TouchableOpacity>
      )}

      {/* the ladder */}
      <SectionHeader title="Reward ladder" style={{ marginTop: space.xl, marginBottom: space.md }} />
      {ladder.map((row) => {
        const unlocked = level >= row.level;
        const current = level + 1 === row.level;
        return (
          <View
            key={row.level}
            style={[
              styles.row,
              { backgroundColor: colors.card, borderColor: current ? brand.pink : 'transparent' },
              current && { borderWidth: 1.5 },
            ]}
          >
            <View style={[styles.lvlBadge, { backgroundColor: unlocked ? withAlpha(brand.pink, 0.18) : colors.cardAlt }]}>
              {unlocked ? (
                <Text style={[type.bodyBold, { color: brand.pink }]}>{row.level}</Text>
              ) : (
                <Lock size={14} color={colors.textDim} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Row gap={6} style={{ flexWrap: 'wrap' }}>
                {row.rewards.map((rw, i) => <RewardChip key={i} reward={rw} colors={colors} type={type} />)}
              </Row>
              <Text style={[type.caption, { color: colors.textDim, marginTop: 4 }]}>
                {row.xp_required.toLocaleString()} XP
              </Text>
            </View>
          </View>
        );
      })}

      <BuyEnergySheet visible={shopOpen} onClose={() => setShopOpen(false)} onPurchased={load} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  xpTrack: { height: 10, borderRadius: 5, overflow: 'hidden', alignSelf: 'stretch', marginTop: space.md },
  xpFill: { height: '100%', borderRadius: 5, backgroundColor: brand.pink },
  boxCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderWidth: 1.5, borderRadius: radius.card, padding: space.lg, marginTop: space.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderRadius: radius.card, padding: space.md, marginBottom: space.sm,
  },
  lvlBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});
