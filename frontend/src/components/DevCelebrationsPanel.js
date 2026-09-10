// Every full screen celebration, playable from a desk.
//
// Rank up, rank down and level up only happen when a real claim or a real loss
// crosses a line, which is slow to arrange and impossible to repeat. This plays
// the REAL components with made up standings, so what you are looking at is
// exactly what a runner sees. Nothing is written: no rank, no XP, no unlocks.
//
// The one exception is "Real drop", which runs the actual demotion path end to
// end: it records a tier ABOVE your current one as the last one this device
// showed you, then asks RankDropWatcher to look, exactly as it does when the
// app comes back to the foreground.
//
// Gated like DevProPanel: `__DEV__`, or an account the server has flagged with
// `dev_tools` on /me.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { rollCosmetic } from '../config/lootboxRoll';
import { RANK_TIERS, TOP_TIER, standingFrom, tierByKey } from '../config/rankLadder';
import { requestRankCheck, writeSeenRank } from '../rank/rankSeen';
import { useAvatar } from '../state/avatar';
import { brand, radius, space, useTheme, useThemedType } from '../theme';
import { PressableScale } from '../ui/motion';
import { toast } from '../ui/toast';
import CrossroadsIntro from './paserby/CrossroadsIntro';
import LevelUpCelebration from './LevelUpCelebration';
import LootboxGamble from './lootbox/LootboxGamble';
import RankDownCeremony from './rank/RankDownCeremony';
import RankUpCeremony from './rank/RankUpCeremony';
import RewardReveal from './RewardReveal';
import { RARITY_COLOR } from './RewardArt';

const ACCENT = brand.teal;
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const LEVELS = [2, 10, 25, 50];

// Entering a tier lands at its first division; dropping into one lands at its
// last, just under the floor you fell through.
const entered = (tier) => standingFrom({ key: RANK_TIERS[tier].key, progress: 0 });
const fellInto = (tier) => standingFrom({ key: RANK_TIERS[tier].key, progress: 0.9 });

// The shape backend/app/lootbox.py rolls, bid upward on the first two taps so
// the colours climb on screen.
function demoSequence(rarity) {
  let at = RARITIES.indexOf(rarity);
  const steps = [0, 1, 2].map((i) => {
    const upgraded = i < 2 && at < RARITIES.length - 1;
    if (upgraded) at += 1;
    return { upgraded, rarity: RARITIES[at] };
  });
  return { rarity, final_rarity: RARITIES[at], chances: steps.length, steps };
}

function Btn({ label, on, disabled, onPress, colors, type }) {
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={[
        styles.btn,
        {
          borderColor: on ? ACCENT : colors.border,
          backgroundColor: on ? colors.cardAlt : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text style={[type.caption, { color: on ? ACCENT : colors.textMuted }]}>{label}</Text>
    </PressableScale>
  );
}

export default function DevCelebrationsPanel({ style }) {
  const { user } = useAuth();
  const { equipped } = useAvatar();
  const { colors } = useTheme();
  const type = useThemedType();

  const [tier, setTier] = useState(3);
  const [rankUp, setRankUp] = useState(null);
  const [rankDown, setRankDown] = useState(null);
  const [level, setLevel] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [gamble, setGamble] = useState(null);
  const [crossroads, setCrossroads] = useState(false);

  if (!__DEV__ && !user?.dev_tools) return null;

  const label = RANK_TIERS[tier].label;
  const btn = { colors, type };

  const showCosmetic = (rarity, fromLootbox = false) => {
    let roll = null;
    try {
      // Nothing counts as owned here, so the pick is from the whole rarity.
      roll = rollCosmetic(rarity, () => false);
    } catch (e) {
      // rollCosmetic throws when a rarity has no box-eligible items at all.
    }
    if (!roll?.item) {
      toast.error(`No ${rarity} item to show`);
      return;
    }
    setReveal({
      rewards: [{ kind: 'cosmetic', key: `${roll.slot}:${roll.item.id}`, label: roll.item.label }],
      accent: RARITY_COLOR[rarity] || brand.pink,
      fromLootbox,
    });
  };

  const armRealDrop = async () => {
    try {
      const stats = await api.meStats();
      const now = tierByKey(stats?.rank_key).tier;
      if (now >= TOP_TIER) {
        toast.error('Nothing above Mythic to drop from');
        return;
      }
      await writeSeenRank(user?.id, RANK_TIERS[now + 1].key);
      requestRankCheck();
    } catch (e) {
      toast.error(e.message || 'Could not read your rank');
    }
  };

  return (
    <View style={[styles.panel, { borderColor: ACCENT, backgroundColor: colors.card }, style]}>
      <Text style={[type.captionMedium, { color: ACCENT }]}>DEV · CELEBRATIONS</Text>
      <Text style={[type.caption, { color: colors.textMuted, marginBottom: space.sm }]}>
        Plays the real screens with made up numbers. Nothing is saved.
      </Text>

      <Text style={[type.caption, { color: colors.textDim }]}>{`Rank · ${label}`}</Text>
      <View style={styles.row}>
        {RANK_TIERS.map((t, i) => (
          <Btn key={t.key} label={t.label} on={tier === i} onPress={() => setTier(i)} {...btn} />
        ))}
      </View>
      <View style={styles.row}>
        <Btn
          label={`Up into ${label}`}
          disabled={tier === 0}
          onPress={() => setRankUp({ from: fellInto(tier - 1), to: entered(tier) })}
          {...btn}
        />
        <Btn
          label={`Down into ${label}`}
          disabled={tier === TOP_TIER}
          onPress={() => setRankDown({ from: entered(tier + 1), to: fellInto(tier) })}
          {...btn}
        />
        <Btn label="Real drop" onPress={armRealDrop} {...btn} />
      </View>

      <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>Level up</Text>
      <View style={styles.row}>
        {LEVELS.map((n) => (
          <Btn key={n} label={`Level ${n}`} onPress={() => setLevel(n)} {...btn} />
        ))}
      </View>

      <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>Reward reveal</Text>
      <View style={styles.row}>
        {RARITIES.map((r) => (
          <Btn key={r} label={r} onPress={() => showCosmetic(r)} {...btn} />
        ))}
      </View>

      <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>Loot box</Text>
      <View style={styles.row}>
        {RARITIES.slice(0, 3).map((r) => (
          <Btn key={r} label={`${r} box`} onPress={() => setGamble(demoSequence(r))} {...btn} />
        ))}
      </View>

      <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>Other</Text>
      <View style={styles.row}>
        <Btn label="Crossroads intro" onPress={() => setCrossroads(true)} {...btn} />
      </View>

      <RankUpCeremony
        visible={!!rankUp}
        from={rankUp?.from}
        to={rankUp?.to}
        equipped={equipped}
        onDone={() => setRankUp(null)}
      />
      <RankDownCeremony
        visible={!!rankDown}
        from={rankDown?.from}
        to={rankDown?.to}
        equipped={equipped}
        onDone={() => setRankDown(null)}
      />
      <LevelUpCelebration
        visible={level != null}
        level={level}
        equipped={equipped}
        accent={brand.pink}
        onClose={() => setLevel(null)}
      />
      <LootboxGamble
        visible={!!gamble}
        sequence={gamble}
        onOpened={(rarity) => {
          setGamble(null);
          showCosmetic(rarity, true);
        }}
        onClose={() => setGamble(null)}
      />
      <RewardReveal
        visible={!!reveal}
        rewards={reveal?.rewards}
        accent={reveal?.accent}
        fromLootbox={!!reveal?.fromLootbox}
        equipped={equipped}
        onClose={() => setReveal(null)}
      />
      <CrossroadsIntro visible={crossroads} onClose={() => setCrossroads(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 2, borderRadius: radius.card, padding: space.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  btn: { borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
});
