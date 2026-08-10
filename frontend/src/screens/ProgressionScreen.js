// ProgressionScreen — the two-track reward pass over the permanent 1..50
// career ladder. Free track on the left, Premium (gold) on the right, tier
// diamonds down the middle. Tiers you've reached are tap-to-claim; premium
// tiers need the pass (one-time IAP via BuyPassSheet). Levels never reset —
// this is the battle-pass LOOK on career progression, not a season.
//
// Data is server-owned via /me/progression; claims persist in reward_claims.

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from '../ui/image';
import { Check, Lock } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAvatar } from '../state/avatar';
import { brand, fonts, radius, space, toon, toonSurface, toonType, useTheme, useThemedType, withAlpha } from '../theme';
import { Card, Row, Skeleton, Screen, OutlinedText, ToonButton } from '../components/ui';
import { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import GameAnimation from '../components/GameAnimation';
import RewardArt, { RARITY_COLOR } from '../components/RewardArt';
import RewardReveal from '../components/RewardReveal';
import BuyPassSheet, { GOLD } from '../components/BuyPassSheet';
import { art } from '../config/onboardingArt';
import { MAX_LEVEL } from '../config/progression';
import { ITEMS } from '../config/cosmetics';
import { toast } from '../ui/toast';
import { Bar, Pulse, useReduceMotion } from '../ui/motion';

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
//   claimable                     accent ring, the reward BREATHING, tappable
//   needs the pass                gold lock, tapping opens the purchase sheet
//   claimed                       dim + check
//
// The tile draws each reward as ITSELF (components/RewardArt.js) — the wood
// border shows the wood border, the crown shows the crown. A tier holding two
// rewards (premium lootbox tiers) shows both, smaller.
//
// A claimable tier used to also carry a small pink CLAIM pill. Fifty of them
// down the page was a column of the same word; the pulse says it instead, and
// the tile gets that space back for the artwork.
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
      {/* Every kind of reward now draws to the same box at the same size, so
          the ladder reads as one grid instead of a jumble of big chests and
          small stickers. Two-reward tiers step down only enough to fit. */}
      <Pulse active={claimable} style={styles.artRow}>
        {shown.map((r, i) => (
          <RewardArt
            key={`${r.kind}:${r.key}:${i}`}
            reward={r}
            equipped={equipped}
            accent={accent}
            size={shown.length > 1 ? ART_SIZE_PAIR : ART_SIZE}
            // Only the tier you can actually claim moves. Every chest on the
            // ladder is the same gift box either way — but twenty of them
            // bouncing at once in this ScrollView would be a wall of motion
            // AND twenty simultaneous decodes on a screen that mounts all
            // fifty rows up front.
            animated={claimable}
          />
        ))}
      </Pulse>
      {/* No caption — the tile shows the reward as itself. The name is still
          on the accessibility label and in the claim toast. */}
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
        // Nothing. The pulse and the accent ring are the affordance; the only
        // thing worth a chip here is the moment the tap is in flight.
        busy ? (
          <View style={[styles.state, styles.claimPill, { backgroundColor: accent }]}>
            <Text style={[type.captionMedium, { color: '#fff', fontSize: 10 }]}>…</Text>
          </View>
        ) : null
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
// original rotated square otherwise.
//
// WHERE THE NUMBER GOES. A gem is not a circle: it is widest across its crown,
// near the top, and tapers to a point. Centring the number in the gem's BOX
// therefore drops it into the taper, where a two-digit level overhangs both
// edges. It sits on the crown instead — up by CROWN_OFFSET — and is capped to
// the width actually available there, so 7 and 47 both fit inside the stone.
function Spine({ level, reached, current }) {
  const { colors } = useTheme();
  const fill = reached ? brand.pink : colors.card;
  const ring = current ? '#F5C451' : reached ? brand.pink : colors.border;
  const gem = art(current ? 'diamondCurrent' : reached ? 'diamondReached' : 'diamondLocked');
  const numStyle = [
    styles.gemNumber,
    { color: reached ? '#fff' : colors.textDim },
    String(level).length > 1 && styles.gemNumberWide,
  ];
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
            style={numStyle}
            outline={toon.ink}
            width={reached ? 1.5 : 0}
            numberOfLines={1}
            containerStyle={styles.gemNumberBox}
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
            style={[...numStyle, styles.diamondText]}
            outline={toon.ink}
            width={reached ? 1.5 : 0}
            numberOfLines={1}
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
  const reducedMotion = useReduceMotion();
  const { equipped, refreshUnlocks } = useAvatar();
  // Shares the 'me:progression' key with the avatar context, which fetches the
  // same payload for its unlock gates — so opening the pass from You costs no
  // request at all and the ladder is drawn on the first frame.
  const { data, loading, error, refresh: load } = useQuery('me:progression', api.progression);
  const [opening, setOpening] = useState(false);
  const [passOpen, setPassOpen] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [claimingAll, setClaimingAll] = useState(false);
  // { done, total } while the fallback sweep is walking tiers one at a time,
  // so a button that may sit there for a minute says how far it has got.
  const [sweep, setSweep] = useState(null);
  // What the reveal is currently showing: { rewards, accent, fromLootbox }.
  const [reveal, setReveal] = useState(null);

  const openBox = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const { rarity } = await api.openLootbox();
      const roll = rollCosmetic(rarity);
      // The unlock is what you actually keep, so a failure to write it must
      // not be swallowed by the celebration that follows.
      await api.addUnlock(roll.item.id);
      // The box is the lucky-draw moment — `fromLootbox` is what makes the
      // reveal stage it as one: a shut box first, then the item coming out of
      // it. Reporting it in a toast that's gone in two seconds is the version
      // this replaced.
      setReveal({
        rewards: [{ kind: 'cosmetic', key: `${roll.slot}:${roll.item.id}`, label: roll.item.label }],
        accent: RARITY_COLOR[rarity] || brand.pink,
        fromLootbox: true,
      });
      // The equippable set changed — without this the item is in your
      // collection but the studio still shows it locked until a restart.
      refreshUnlocks?.();
      await load();
    } catch (e) {
      // 404 means the box list on screen is stale (another device opened it,
      // or the claim that granted it never landed) — reload rather than
      // leaving a row that does nothing when tapped.
      if (e.status === 404) {
        toast.error('That box is already open');
        load();
      } else {
        toast.error(e.message || 'Could not open lootbox');
      }
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
      // A tier can hand over a cosmetic, and a server grant beats the stat
      // gate — the studio can't know it is equippable without re-reading them.
      // The cache coalesces this with `load`, so it is not a second request.
      refreshUnlocks?.();
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not claim');
    } finally {
      setBusyKey(null);
    }
  };

  // Every tier that is unlocked and still unclaimed, in ladder order.
  const pendingTiers = (d) => {
    if (!d) return [];
    const done = new Set(d.claims.map((c) => `${c.level}:${c.track}`));
    const out = [];
    for (const row of d.ladder) {
      if (row.level > d.level) break;
      if (!done.has(`${row.level}:free`)) out.push([row.level, 'free']);
      if (d.premium_active && !done.has(`${row.level}:premium`)) out.push([row.level, 'premium']);
    }
    return out;
  };

  // FALLBACK PATH — see `claimAll`. Walks the pending tiers one request at a
  // time. Slow by construction (a maxed premium player has a hundred of them),
  // which is exactly why the server-side sweep exists; this is only what
  // happens when the server doesn't have it yet.
  const claimTierByTier = async () => {
    const pending = pendingTiers(data);
    const rewards = [];
    setSweep({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i += 1) {
      const [lvl, track] = pending[i];
      try {
        const res = await api.claimReward(lvl, track);
        rewards.push(...(res.rewards || []));
      } catch (e) {
        // 409 = already claimed (a stale list, or a second device got there
        // first). Not a reason to abandon the other eighty tiers.
        if (e.status === 409) {
          setSweep({ done: i + 1, total: pending.length });
          continue;
        }
        // Anything else stops the sweep — but the tiers BEFORE this one were
        // really claimed, server-side, and throwing here would drop them on
        // the floor and show an error for rewards the player already owns.
        // Hand back what was collected and say the sweep is incomplete.
        return { rewards, stoppedAt: e };
      }
      setSweep({ done: i + 1, total: pending.length });
    }
    return { rewards, stoppedAt: null };
  };

  const claimAll = async () => {
    if (claimingAll) return;
    setClaimingAll(true);
    try {
      let rewards;
      let stoppedAt = null;
      try {
        rewards = (await api.claimAllRewards()).rewards || [];
      } catch (e) {
        // /me/rewards/claim-all is newer than some deployed backends, and a
        // 404 is the server saying it doesn't have the route — NOT that there
        // was nothing to claim. Left unhandled this button simply did nothing
        // but toast an error. Claiming tier by tier reaches the same end state
        // through an endpoint every version has had.
        if (e.status !== 404) throw e;
        ({ rewards, stoppedAt } = await claimTierByTier());
      }
      // One sweep can hand over a hundred things. The reveal shows the pile;
      // the tiles behind it settle when the refresh lands.
      if (rewards.length) {
        setReveal({ rewards, accent: brand.pink });
      } else if (!stoppedAt) {
        toast.show('Nothing left to claim');
      }
      // A partial sweep still collected something — say so instead of
      // pretending it all worked, and leave the rest for another tap.
      if (stoppedAt) {
        toast.error(
          rewards.length
            ? 'Collected what we could. Tap Claim all again for the rest'
            : stoppedAt.message || 'Could not claim your rewards'
        );
      }
      refreshUnlocks?.();
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not claim your rewards');
    } finally {
      setSweep(null);
      setClaimingAll(false);
    }
  };

  // Only a failure with NOTHING cached is a dead end; a failed refresh over a
  // ladder that's already on screen leaves the ladder alone.
  if (loading && error) {
    return <Screen center><Text style={type.body}>Couldn’t load progression.</Text></Screen>;
  }
  if (loading) {
    return (
      <Screen>
        <Skeleton width="100%" height={180} style={{ borderRadius: radius.card, marginTop: space.md }} />
        <Skeleton width="100%" height={400} style={{ borderRadius: radius.card, marginTop: space.md }} />
      </Screen>
    );
  }

  const { level, xp_into_level, xp_for_next, ladder, pending_lootboxes, premium_active, claims, rank } = data;
  // At the ceiling there is no "next level" to be part-way to, and the server
  // keeps reporting progress toward a level 51 that doesn't exist. A bar
  // sitting a third full under the words "Max level reached" reads as a bug,
  // so the ladder being finished fills it.
  const maxed = level >= MAX_LEVEL;
  const pct = maxed ? 1 : Math.max(0, Math.min(1, xp_into_level / xp_for_next));
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
      {/* The header IS the banner. The purple crew art used to be a separate
          strip above a plain card, so the screen opened with two stacked
          blocks saying the same thing; now the card sits ON the art and the
          portrait has something to sit against. */}
      <View style={styles.header}>
        {art('passBanner') && (
          <Image
            source={art('passBanner')}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            fadeDuration={0}
          />
        )}
        {/* The art is busy behind type — this keeps the copy legible without
            hiding the crew, and it is always dark, so the text below is always
            white regardless of theme. */}
        <View style={[StyleSheet.absoluteFill, styles.headerScrim]} pointerEvents="none" />
        <View style={styles.headerInner}>
          <PortraitBorder borderKey={rank?.key || 'wood'} size={104}>
            <CharacterBust equipped={equipped} size={104} bg={withAlpha('#000000', 0.35)} />
          </PortraitBorder>
          <Text style={[type.title, styles.headerText, { marginTop: space.sm }]}>Level {level}</Text>
          {/* Rank, not level. At the top tier it is just the name — it used to
              read "Mythic · top rank", which said the same thing twice. */}
          <Text style={[type.caption, styles.headerSubText]}>
            {rank?.next_points
              ? `${rank?.label || 'Wood'} · ${rank.points}/${rank.next_points} to ${rank.next_label}`
              : (rank?.label || 'Wood')}
          </Text>
          {/* Fills from empty every time you open the screen. You mostly get
              here straight off a finished run, and watching the bar run up to
              where your XP landed is the whole point of the number; the small
              delay lets the header settle first so the fill isn't competing
              with the card's own entrance. */}
          <Bar
            pct={pct}
            animateOnMount
            delay={260}
            durationMs={700}
            trackStyle={[styles.xpTrack, { backgroundColor: withAlpha('#000000', 0.45) }]}
            fillStyle={styles.xpFill}
          />
          <Text style={[type.caption, styles.headerSubText, { marginTop: 6 }]}>
            {maxed
              ? 'Max level reached'
              : `${xp_into_level.toLocaleString()} / ${xp_for_next.toLocaleString()} XP to level ${level + 1}`}
          </Text>
        </View>
      </View>

      {/* What there is to collect, and one button that collects it. This used
          to be a small pill under the portrait, which is a strange way to
          mention eighty-five unclaimed rewards. */}
      {claimableCount > 0 && (
        <View style={[styles.claimBar, { backgroundColor: colors.card, borderColor: brand.pink }]}>
          <View style={{ flex: 1 }}>
            <OutlinedText
              style={[toonType.sub, { color: brand.pink, textAlign: 'left' }]}
              outline={toon.ink}
              width={1.5}
              align="left"
              containerStyle={{ alignSelf: 'flex-start' }}
            >
              {`${claimableCount} REWARD${claimableCount === 1 ? '' : 'S'}`}
            </OutlinedText>
            <Text style={[type.caption, { color: colors.textMuted, marginTop: 2 }]}>
              waiting to be claimed
            </Text>
          </View>
          <ToonButton
            title={
              sweep ? `${sweep.done}/${sweep.total}` : claimingAll ? 'Claiming…' : 'Claim all'
            }
            size="sm"
            onPress={claimAll}
            // The spinner hides the count, and on the slow path the count is
            // the only thing telling you it hasn't hung.
            loading={claimingAll && !sweep}
            disabled={claimingAll}
            style={styles.claimAllBtn}
          />
        </View>
      )}

      {/* The PRO pitch, shown only to non-holders. There is no "premium pass
          active" banner any more: once you own it the whole gold track is
          unlocked down the page, which says it better than a bar does. */}
      {!premium_active && (
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
          {/* The one chest on this screen that is always worth looking at:
              there is a box waiting and the row exists to be tapped. It is
              this row's icon as well as its animation, so Reduce Motion stills
              it rather than leaving the row with an empty slot. */}
          <GameAnimation name="giftBox" size={34} loop={!reducedMotion} still={reducedMotion} />
          <View style={{ flex: 1 }}>
            <Text style={type.bodyBold}>{pending_lootboxes.length} lootbox{pending_lootboxes.length === 1 ? '' : 'es'} ready</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>Tap to open a random collectible</Text>
          </View>
          <AppIcon name="sparkles" size={20} />
        </TouchableOpacity>
      )}

      {/* Solid, code-drawn lane buttons; the labels never depend on artwork. */}
      <View style={styles.trackHead}>
        <View style={[styles.ticket, styles.ticketFree]}>
          <View style={styles.ticketHighlight} pointerEvents="none" />
          <Text style={[toonType.label, styles.ticketText, { color: '#fff' }]}>FREE</Text>
        </View>
        <View style={{ width: SPINE_W }} />
        <View style={[styles.ticket, styles.ticketPro]}>
          <View style={styles.ticketHighlight} pointerEvents="none" />
          <Text style={[toonType.label, styles.ticketText, styles.ticketTextPro]}>PASER PRO</Text>
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
        fromLootbox={!!reveal?.fromLootbox}
        equipped={equipped}
        onClose={() => setReveal(null)}
      />
    </ScrollView>
  );
}

const SPINE_W = 56;
// Reward art: ONE size for every kind, so the ladder is a grid rather than an
// assortment. Up from 52/38 — the tiles gained the room the CLAIM pill used to
// take, and the lootboxes gained the room their border used to take.
const ART_SIZE = 64;
const ART_SIZE_PAIR = 46;
// The gem's crown sits above its box centre; the level number rides with it.
const GEM_BOX = 44;
const CROWN_OFFSET = 5;
// Lane header pill height: the PRO crest is 22 plus breathing room.
const LANE_H = 40;

const styles = StyleSheet.create({
  // The banner art is the card. `overflow: hidden` is what lets a cover image
  // sit under the rounded corners instead of squaring them off.
  header: {
    borderRadius: radius.card,
    borderWidth: 2.5,
    borderColor: toon.ink,
    overflow: 'hidden',
  },
  headerScrim: { backgroundColor: 'rgba(14,10,28,0.52)' },
  headerInner: { alignItems: 'center', padding: space.lg },
  // Always white: the panel underneath is the purple art plus a dark scrim in
  // both themes, so this can't take the theme's text colour.
  headerText: { color: '#ffffff' },
  headerSubText: { color: 'rgba(255,255,255,0.78)' },

  claimAllBtn: { minWidth: 118 },
  claimBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 2,
  },

  xpTrack: { height: 10, borderRadius: 5, overflow: 'hidden', alignSelf: 'stretch', marginTop: space.md },
  xpFill: { height: '100%', borderRadius: 5, backgroundColor: brand.pink },
  boxCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderWidth: 1.5, borderRadius: radius.card, padding: space.lg, marginTop: space.md,
  },
  passBanner: { marginTop: space.md, borderWidth: 1.5 },

  trackHead: { flexDirection: 'row', alignItems: 'center', marginTop: space.xl, marginBottom: space.sm },
  // Flat fills plus an ink border, hard shadow, and small highlight give the
  // labels the same tactile button language as the rest of the pass.
  ticket: {
    flex: 1, height: LANE_H, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2.5, borderColor: toon.ink, borderRadius: radius.pill,
    shadowColor: toon.ink, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1, shadowRadius: 0, elevation: 3,
  },
  ticketFree: { backgroundColor: brand.pink },
  ticketPro: { backgroundColor: GOLD },
  ticketHighlight: {
    position: 'absolute', top: 4, left: 12, right: 12, height: 7,
    borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.28)',
  },
  ticketText: { letterSpacing: 0.9 },
  ticketTextPro: { color: toon.ink },

  tierRow: { flexDirection: 'row', alignItems: 'stretch' },
  tile: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.card, padding: space.md, paddingBottom: space.lg + 6,
    // Grown with the artwork. The bottom padding still belongs to the
    // locked/claimed chip, which is the only thing that sits down there now.
    marginVertical: space.xs, minHeight: 132,
  },
  artRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: ART_SIZE + 4 },
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
  gemWrap: { width: GEM_BOX, height: GEM_BOX, alignItems: 'center', justifyContent: 'center' },
  // Bold, not semibold: at 14px on a saturated stone, semibold read as a smudge.
  gemNumber: { ...toonType.label, fontFamily: fonts.bold, fontSize: 15, letterSpacing: 0 },
  // Two digits get tighter tracking and a hair less size rather than a smaller
  // gem — the stones have to stay the same size down the whole spine.
  gemNumberWide: { fontSize: 13, letterSpacing: -0.5 },
  gemNumberBox: { position: 'absolute', width: GEM_BOX - 12, top: GEM_BOX / 2 - 11 - CROWN_OFFSET },
  // Slightly larger than the slot so the current tier's glow/sparkles read,
  // but kept inside SPINE_W (56) — at 60 it overhung the spine and collided
  // with the reward tiles either side.
  gemArt: { position: 'absolute', width: 52, height: 52 },
});
