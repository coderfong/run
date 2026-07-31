// ProgressionScreen — the two-track reward pass over the permanent 1..50
// career ladder. Free track on the left, Premium (gold) on the right, tier
// diamonds down the middle. Tiers you've reached are tap-to-claim; premium
// tiers need the pass (one-time IAP via BuyPassSheet). Levels never reset —
// this is the battle-pass LOOK on career progression, not a season.
//
// Data is server-owned via /me/progression; claims persist in reward_claims.

import React, { useCallback, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Check, Lock } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useAvatar } from '../state/avatar';
import { brand, radius, space, toon, toonSurface, toonType, useTheme, useThemedType, withAlpha } from '../theme';
import { Card, Row, Button, Pill, Skeleton, Screen, OutlinedText, ProgressTrack, ToonButton } from '../components/ui';
import { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import RewardArt, { RARITY_COLOR } from '../components/RewardArt';
import RewardReveal from '../components/RewardReveal';
import BuyPassSheet, { GOLD } from '../components/BuyPassSheet';
import { art } from '../config/onboardingArt';
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

// One reward tile on a track. The whole pass state machine renders here:
//   locked (level unreached)      dim; premium also shows a lock pre-purchase
//   claimable                     accent ring + CLAIM pill, tappable
//   needs the pass                gold lock, tapping opens the purchase sheet
//   claimed                       dim + check
//
// The tile draws each reward as ITSELF (components/RewardArt.js) — the wood
// border shows the wood border, the crown shows the crown. A tier holding two
// rewards (premium lootbox tiers) shows both, smaller.
function TrackTile({ rewards, accent, unlocked, claimed, gated, busy, onPress, equipped, isPro }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const surface = toonSurface(colors, scheme);
  const claimable = unlocked && !claimed && !gated;
  const dim = !unlocked || claimed;
  const shown = rewards.slice(0, 2);
  // Generated chrome; each falls back to the code-drawn version when absent.
  //
  // NOTE: tile-free / tile-pro are deliberately NOT used. They're 9-slice
  // frames, and RN's Image has no cross-platform 9-slice — resizeMode
  // "stretch" scales the whole bitmap, so a 512² frame squashed into a
  // ~140×116 tile distorts its corners and crown badly enough to overlap the
  // neighbouring rows. The code-drawn outline below is correct at any size.
  // (capInsets would fix it, but it's iOS-only.)
  const chipClaimedArt = art('chipClaimed');
  const chipLockedArt = art('chipLocked');
  const chipLockedProArt = art('chipLockedPro');
  const stampArt = art('stampClaimed');
  return (
    <TouchableOpacity
      style={[
        styles.tile,
        { backgroundColor: colors.card, opacity: dim ? 0.5 : 1, ...surface.outline },
        claimable && { borderWidth: 2.5, borderColor: accent },
      ]}
      onPress={onPress}
      disabled={!unlocked || claimed || busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={rewards.map((r) => r.label).join(', ')}
      accessibilityState={{ disabled: !unlocked || claimed }}
    >
      <View style={styles.artRow}>
        {shown.map((r, i) => (
          <RewardArt
            key={`${r.kind}:${r.key}:${i}`}
            reward={r}
            equipped={equipped}
            accent={accent}
            size={shown.length > 1 ? 38 : 52}
          />
        ))}
      </View>
      <Text style={[type.caption, { color: colors.text, textAlign: 'center' }]} numberOfLines={2}>
        {rewards.map((r) => r.label).join(' + ')}
      </Text>
      {claimed ? (
        chipClaimedArt ? (
          <Image source={chipClaimedArt} style={styles.chipArt} resizeMode="contain" fadeDuration={0} />
        ) : (
          <View style={[styles.state, { backgroundColor: colors.cardAlt }]}>
            <Check size={12} color={colors.textMuted} />
          </View>
        )
      ) : gated && unlocked ? (
        chipLockedProArt ? (
          <Image source={chipLockedProArt} style={styles.chipArt} resizeMode="contain" fadeDuration={0} />
        ) : (
          <View style={[styles.state, { backgroundColor: withAlpha(GOLD, 0.2) }]}>
            <Lock size={12} color={GOLD} />
          </View>
        )
      ) : claimable ? (
        // Code-drawn pill. The btn-claim art is another 9-slice asset: stretched
        // into this ~46x22 chip it blew up into a full-width pink bar across
        // every row. Same reason tile-free/tile-pro aren't used above.
        <View style={[styles.state, styles.claimPill, { backgroundColor: accent }]}>
          <Text style={[type.captionMedium, { color: '#fff', fontSize: 10 }]}>{busy ? '…' : 'CLAIM'}</Text>
        </View>
      ) : chipLockedArt ? (
        <Image source={chipLockedArt} style={styles.chipArt} resizeMode="contain" fadeDuration={0} />
      ) : (
        <View style={[styles.state, { backgroundColor: colors.cardAlt }]}>
          <Lock size={12} color={colors.textDim} />
        </View>
      )}
      {/* CLAIMED rubber stamp reads better than a tick once a tier is spent */}
      {claimed && stampArt && (
        <Image source={stampArt} style={styles.stamp} resizeMode="contain" fadeDuration={0} pointerEvents="none" />
      )}
    </TouchableOpacity>
  );
}

// The center spine: a continuous line with the tier diamond on it. Reached
// tiers fill solid; the NEXT tier gets the bright ring so the eye lands on
// what you're running toward.
// The tier diamond uses real gem art when it exists (drawn point-up, so it
// skips the 45° transform the code-drawn square needs) and falls back to the
// original rotated square otherwise. The level number sits on its flat centre.
function Spine({ level, reached, current }) {
  const { colors } = useTheme();
  const fill = reached ? brand.pink : colors.card;
  const ring = current ? '#F5C451' : reached ? brand.pink : colors.border;
  const gem = art(current ? 'diamondCurrent' : reached ? 'diamondReached' : 'diamondLocked');
  return (
    <View style={styles.spine}>
      <View style={[styles.spineLine, { backgroundColor: reached ? withAlpha(brand.pink, 0.4) : colors.border }]} />
      {gem ? (
        <View style={styles.gemWrap}>
          <Image
            source={gem}
            style={styles.gemArt}
            resizeMode="contain"
            fadeDuration={0}
          />
          <OutlinedText
            style={[toonType.label, { color: reached ? '#fff' : colors.textDim, fontSize: 14 }]}
            outline={toon.ink}
            width={reached ? 1.5 : 0}
          >
            {String(level)}
          </OutlinedText>
        </View>
      ) : (
        <View
          style={[
            styles.diamond,
            { backgroundColor: fill, borderColor: ring, borderWidth: current ? 3 : 2.5 },
          ]}
        >
          <OutlinedText
            style={[toonType.label, styles.diamondText, { color: reached ? '#fff' : colors.textDim, fontSize: 14 }]}
            outline={toon.ink}
            width={reached ? 1.5 : 0}
          >
            {String(level)}
          </OutlinedText>
        </View>
      )}
    </View>
  );
}

export default function ProgressionScreen() {
  const { colors } = useTheme();
  const type = useThemedType();
  const { equipped } = useAvatar();
  const [data, setData] = useState(null);
  const [opening, setOpening] = useState(false);
  const [passOpen, setPassOpen] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  // What the reveal is currently showing: { rewards, accent } or null.
  const [reveal, setReveal] = useState(null);

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
      // The box is the lucky-draw moment — reveal what fell out of it rather
      // than reporting it in a toast that's gone in two seconds.
      setReveal({
        rewards: [{ kind: 'cosmetic', key: `${roll.slot}:${roll.item.id}`, label: roll.item.label }],
        accent: RARITY_COLOR[rarity] || brand.pink,
      });
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not open lootbox');
    } finally {
      setOpening(false);
    }
  };

  const claim = async (tierLevel, track) => {
    const key = `${tierLevel}:${track}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const res = await api.claimReward(tierLevel, track);
      setReveal({ rewards: res.rewards, accent: track === 'premium' ? GOLD : brand.pink });
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not claim');
    } finally {
      setBusyKey(null);
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

  const { level, xp_into_level, xp_for_next, ladder, pending_lootboxes, premium_active, claims, rank } = data;
  const pct = Math.max(0, Math.min(1, xp_into_level / xp_for_next));
  const claimed = new Set(claims.map((c) => `${c.level}:${c.track}`));
  // Unclaimed count on tiers you've reached — surfaced on the header so the
  // screen tells you there's something to collect before you scroll.
  const claimableCount = ladder.reduce((n, row) => {
    if (row.level > level) return n;
    if (!claimed.has(`${row.level}:free`)) n += 1;
    if (premium_active && !claimed.has(`${row.level}:premium`)) n += 1;
    return n;
  }, 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl }}>
      {/* hero strip — sets the "this is the pass" tone above the ladder */}
      {art('passBanner') && (
        <Image
          source={art('passBanner')}
          style={styles.banner}
          resizeMode="cover"
          fadeDuration={0}
        />
      )}
      {/* header: portrait + level + xp */}
      <Card style={{ alignItems: 'center' }}>
        <PortraitBorder borderKey={rank?.key || 'wood'} size={104}>
          <CharacterBust equipped={equipped} size={104} bg={colors.cardAlt} />
        </PortraitBorder>
        <Text style={[type.title, { marginTop: space.sm }]}>Level {level}</Text>
        {/* Rank, not level — and it shows progress toward the next tier so the
            border reads as something you're climbing, not something you were
            handed at a level. */}
        <Text style={[type.caption, { color: colors.textMuted }]}>
          {rank?.label || 'Wood'}
          {rank?.next_points
            ? ` · ${rank.points}/${rank.next_points} to ${rank.next_label}`
            : ' · top rank'}
        </Text>
        <View style={[styles.xpTrack, { backgroundColor: colors.cardAlt }]}>
          <View style={[styles.xpFill, { width: `${pct * 100}%` }]} />
        </View>
        <Text style={[type.caption, { color: colors.textDim, marginTop: 6 }]}>
          {level >= 50 ? 'Max level reached' : `${xp_into_level.toLocaleString()} / ${xp_for_next.toLocaleString()} XP to level ${level + 1}`}
        </Text>
        {claimableCount > 0 && (
          <Pill label={`${claimableCount} reward${claimableCount === 1 ? '' : 's'} to claim`} color={brand.pink} dot style={{ marginTop: space.sm }} />
        )}
      </Card>

      {/* premium pass banner / status */}
      {premium_active ? (
        <Row gap={8} style={[styles.passActive, { backgroundColor: withAlpha(GOLD, 0.12), borderColor: withAlpha(GOLD, 0.5) }]}>
          <AppIcon name="crown" size={20} />
          <Text style={[type.bodySmBold, { flex: 1, color: colors.text }]}>Premium pass active</Text>
        </Row>
      ) : (
        <Card style={[styles.passBanner, { borderColor: GOLD }]}>
          <Row gap={12}>
            {art('crestPro') ? (
              <Image source={art('crestPro')} style={{ width: 34, height: 34 }} resizeMode="contain" fadeDuration={0} />
            ) : (
              <AppIcon name="crown" size={28} />
            )}
            <View style={{ flex: 1 }}>
              <OutlinedText
                style={[toonType.sub, { color: GOLD, textAlign: 'left' }]}
                outline={toon.ink}
                width={1.5}
                align="left"
                containerStyle={{ alignSelf: 'flex-start' }}
              >
                PASER PRO
              </OutlinedText>
              <Text style={[type.caption, { color: colors.textMuted, marginTop: 2 }]}>
                Every tier pays twice: 17 exclusive cosmetics, a rarer box AND
                energy on box tiers, and bigger energy packs everywhere else.
              </Text>
            </View>
          </Row>
          <ToonButton
            title="Unlock PASER PRO"
            variant="gold"
            size="sm"
            onPress={() => setPassOpen(true)}
            style={{ marginTop: space.md }}
          />
        </Card>
      )}

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

      {/* track headers — sticky-feeling tickets that name each column */}
      <View style={styles.trackHead}>
        {/* Lane plates were regenerated at the pill's real ~4:1 aspect, so
            stretching them is near-uniform and no longer distorts. */}
        <View style={[styles.ticket, art('laneFree') ? styles.ticketArt : { backgroundColor: colors.card, borderColor: toon.ink }]}>
          {art('laneFree') && (
            <Image source={art('laneFree')} style={styles.laneArt} resizeMode="stretch" fadeDuration={0} />
          )}
          <OutlinedText style={[toonType.label, { color: '#fff' }]} outline={toon.ink} width={1.5}>
            FREE
          </OutlinedText>
        </View>
        <View style={{ width: SPINE_W }} />
        <View style={[styles.ticket, styles.ticketPro, art('lanePro') ? styles.ticketArt : { backgroundColor: GOLD }]}>
          {art('lanePro') && (
            <Image source={art('lanePro')} style={styles.laneArt} resizeMode="stretch" fadeDuration={0} />
          )}
          {art('crestPro') && (
            <Image source={art('crestPro')} style={styles.crest} resizeMode="contain" fadeDuration={0} />
          )}
          <OutlinedText style={[toonType.label, { color: '#fff' }]} outline={toon.ink} width={1.5}>
            PASER PRO
          </OutlinedText>
        </View>
      </View>

      {/* the two-track ladder */}
      {ladder.map((row) => {
        const reached = level >= row.level;
        const current = level + 1 === row.level;
        return (
          <View key={row.level} style={styles.tierRow}>
            <TrackTile
              rewards={row.rewards}
              accent={brand.pink}
              unlocked={reached}
              claimed={claimed.has(`${row.level}:free`)}
              gated={false}
              busy={busyKey === `${row.level}:free`}
              onPress={() => claim(row.level, 'free')}
              equipped={equipped}
              isPro={false}
            />
            <Spine level={row.level} reached={reached} current={current} />
            <TrackTile
              rewards={row.premium}
              accent={GOLD}
              unlocked={reached}
              claimed={claimed.has(`${row.level}:premium`)}
              gated={!premium_active}
              busy={busyKey === `${row.level}:premium`}
              onPress={() => (premium_active ? claim(row.level, 'premium') : setPassOpen(true))}
              equipped={equipped}
              isPro
            />
          </View>
        );
      })}

      <BuyPassSheet visible={passOpen} onClose={() => setPassOpen(false)} onPurchased={load} />
      <RewardReveal
        visible={!!reveal}
        rewards={reveal?.rewards}
        accent={reveal?.accent}
        equipped={equipped}
        onClose={() => setReveal(null)}
      />
    </ScrollView>
  );
}

const SPINE_W = 56;

const styles = StyleSheet.create({
  xpTrack: { height: 10, borderRadius: 5, overflow: 'hidden', alignSelf: 'stretch', marginTop: space.md },
  xpFill: { height: '100%', borderRadius: 5, backgroundColor: brand.pink },
  boxCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderWidth: 1.5, borderRadius: radius.card, padding: space.lg, marginTop: space.md,
  },
  passBanner: { marginTop: space.md, borderWidth: 1.5 },
  passActive: {
    marginTop: space.md, borderWidth: 1, borderRadius: radius.card,
    paddingHorizontal: space.lg, paddingVertical: space.md, alignItems: 'center',
  },

  trackHead: { flexDirection: 'row', alignItems: 'center', marginTop: space.xl, marginBottom: space.sm },
  ticket: {
    flex: 1, alignItems: 'center', borderWidth: 2, borderRadius: radius.pill,
    paddingVertical: 7,
  },
  ticketPro: { borderColor: toon.ink },

  tierRow: { flexDirection: 'row', alignItems: 'stretch' },
  tile: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.card, padding: space.md, paddingBottom: space.lg + 6,
    marginVertical: space.xs, minHeight: 116,
  },
  artRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 54 },
  banner: { width: '100%', height: 128, borderRadius: radius.card, marginBottom: space.md },
  crest: { width: 22, height: 22, marginRight: 6 },
  ticketArt: { backgroundColor: 'transparent', borderWidth: 0 },
  laneArt: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  chipArt: { position: 'absolute', bottom: 4, width: 26, height: 26 },
  stamp: { position: 'absolute', width: '86%', height: '52%', opacity: 0.75 },
  state: {
    position: 'absolute', bottom: 8, borderRadius: radius.pill,
    paddingHorizontal: 8, paddingVertical: 3, alignItems: 'center', justifyContent: 'center',
  },
  claimPill: { paddingHorizontal: 10 },

  spine: { width: SPINE_W, alignItems: 'center', justifyContent: 'center' },
  spineLine: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  diamond: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  diamondText: { transform: [{ rotate: '-45deg' }] },
  // Art variant: no rotation, and the gem is drawn larger than its 40px slot
  // so the glow/sparkles can bleed past the spine without clipping.
  gemWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  // Slightly larger than the slot so the current tier's glow/sparkles read,
  // but kept inside SPINE_W (56) — at 60 it overhung the spine and collided
  // with the reward tiles either side.
  gemArt: { position: 'absolute', width: 48, height: 48 },
});
