// ProgressionScreen — the two-track reward pass over the permanent 1..50
// career ladder. Free track on the left, Premium (gold) on the right, tier
// diamonds down the middle. Tiers you've reached are tap-to-claim; premium
// tiers need PASER PRO (subscription, via BuyProSheet). Levels never reset —
// this is the battle-pass LOOK on career progression, not a season.
//
// Data is server-owned via /me/progression; claims persist in reward_claims.

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from '../ui/image';
import { Check, Info, Lock, X } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAvatar } from '../state/avatar';
import { NB, brand, fonts, nbRadius, radius, shadow, space, toon, toonType, useTheme, useThemedType, withAlpha } from '../theme';
import { Card, Framed, Row, Sheet, Skeleton, Screen, OutlinedText, ToonButton } from '../components/ui';
import { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import GameAnimation from '../components/GameAnimation';
import RewardArt, { RARITY_COLOR } from '../components/RewardArt';
import RewardReveal from '../components/RewardReveal';
import { useProEntitlement } from '../pro/ProProvider';
import { GOLD } from '../config/pro';
import { art } from '../config/onboardingArt';
import { MAX_LEVEL } from '../config/progression';
import { getItem, ITEMS } from '../config/cosmetics';
import { toast } from '../ui/toast';
import { Arrival, Bar, Pulse, useArrival, useReduceMotion } from '../ui/motion';
import { IAP_ENABLED } from '../config/releaseFeatures';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import RankCard from '../components/rank/RankCard';
import LootboxGamble from '../components/lootbox/LootboxGamble';
import { standingFrom } from '../config/rankLadder';
import { rollCosmetic } from '../config/lootboxRoll';

// `rollCosmetic` moved to config/lootboxRoll.js when the daily mission
// bonus became a second place boxes are opened — two copies of a payout
// rule is how two screens start quietly paying different things.

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
  const { colors } = useTheme();
  const type = useThemedType();
  const claimable = unlocked && !claimed && !gated;
  const dim = !unlocked || claimed;
  const shown = rewards.slice(0, 2);
  const cosmeticReward = rewards.find((reward) => reward.kind === 'cosmetic');
  const [cosmeticSlot, cosmeticId] = cosmeticReward?.key?.split(':') || [];
  const cosmeticRarity = getItem(cosmeticSlot, cosmeticId)?.rarity;
  // ART ONLY. A collectible tile shows the object and nothing else — its
  // rarity is said by the COLOUR OF THE BOX round it, not by a grey caption
  // under it. Fifty of those captions down the page was a column of small text
  // on a screen whose whole job is the artwork, and the shop and the studio
  // grids had already dropped theirs for the same reason.
  const rarityTint = cosmeticRarity ? RARITY_COLOR[cosmeticRarity] : null;
  // Rarity wins the ink when there is one; the claim state is still readable
  // off the heavier line, the tinted paper and the pulse.
  const tint = rarityTint || (claimable ? accent : colors.border);
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
        styles.tilePress,
        { opacity: dim ? 0.5 : 1 },
      ]}
      onPress={onPress}
      disabled={!unlocked || claimed || busy}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={rewards.map((r) => r.label).join(', ')}
      accessibilityState={{ disabled: !unlocked || claimed }}
    >
      <Framed
        frame={frameVariant('card', `${isPro ? 'pro' : 'free'}:${rewards.map((r) => r.key).join(':')}`)}
        tint={tint}
        fill={claimable ? withAlpha(tint, 0.16) : colors.card}
        weight={claimable ? INK.medium : INK.thin}
        pose={framePose(rewards.map((r) => r.key).join(':'))}
        inset={false}
        style={styles.tile}
        contentStyle={styles.tileContent}
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
      </Framed>
    </TouchableOpacity>
  );
}

// A lane heading — FREE on the left, PASER PRO on the right.
//
// Same construction as ToonButton: a drawn frame filled with the lane's colour,
// an outlined label, and the hard drop carried by the WRAPPER rather than by a
// HardShadow behind it. That distinction matters here — a framed box has a
// wobbly hand-inked silhouette, and a hard rectangle behind it shows at every
// corner where the ink wanders in, which is the tell these pills had.
function LaneHead({ label, fill, seed }) {
  return (
    <View style={styles.laneWrap}>
      <Framed
        frame={frameVariant('action', seed)}
        tint={toon.ink}
        fill={fill}
        weight={INK.base}
        pose={framePose(seed)}
        inset={false}
        style={styles.lane}
        contentStyle={styles.laneContent}
      >
        <OutlinedText
          style={styles.laneText}
          outline={toon.ink}
          width={2}
          fit
          minimumFontScale={0.7}
          numberOfLines={1}
          containerStyle={styles.laneLabel}
        >
          {label}
        </OutlinedText>
      </Framed>
    </View>
  );
}

// The center spine: a continuous line with the tier diamond on it. Reached
// tiers fill solid; the NEXT tier gets the bright ring so the eye lands on
// what you're running toward.
// The tier diamond uses real gem art when it exists (drawn point-up, so it
// skips the 45° transform the code-drawn square needs) and falls back to the
// original rotated square otherwise.
//
// WHERE THE NUMBER GOES. Dead centre of the stone, on both axes, with an
// explicit line height so the centring is arithmetic rather than a guess at
// the platform's default leading. It used to ride up on the crown, which is
// the widest part of the gem — a defensible place to put type, but it read as
// a number that had slipped, and two digits at 13pt clear the taper anyway.
//
// PULSE. A tier you can collect breathes, the same slow swell the reward tiles
// use. That is the ONE thing the spine can say that the tiles either side of
// it cannot: with both tracks claimable the row has two pulsing tiles and no
// centre, and with one claimed and one not it has a single lopsided one.
function Spine({ level, reached, current, claimable = false }) {
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
        <Pulse active={claimable} style={styles.gemWrap}>
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
        </Pulse>
      ) : (
        <Pulse active={claimable} style={styles.gemWrap}>
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
        </Pulse>
      )}
    </View>
  );
}

// What Level, Rank and the two reward tracks actually mean. The header shows
// both numbers side by side with no explanation of why they move differently
// (level only ever climbs, rank can fall) or what claiming even does, so this
// is one tap away rather than a wall of text on a page that's mostly ladder.
const INFO_SECTIONS = [
  {
    title: 'Level',
    body: 'Run to earn XP and level up. Your level never goes down.',
  },
  {
    title: 'Rank',
    body: 'Take rival land or successfully defend yours to move up the ladder. Beating a stronger runner is worth more, and every gain is matched by their loss. Your portrait border shows the tier you are standing in.',
  },
  {
    title: 'Rewards',
    body: 'Level up to unlock gifts. Tap a bright gift to collect it. PRO members get extra gifts.',
  },
];

function ProgressionInfoSheet({ visible, onClose }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Row between style={{ marginBottom: space.sm }}>
        <Text style={type.heading}>Level, rank and rewards</Text>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <X size={22} color={colors.textMuted} />
        </TouchableOpacity>
      </Row>
      {INFO_SECTIONS.map((section) => (
        <View key={section.title} style={{ marginBottom: space.md }}>
          <Text style={[type.bodySmBold, { color: brand.pink, marginBottom: 2 }]}>{section.title}</Text>
          <Text style={[type.caption, { color: colors.textMuted, lineHeight: 18 }]}>{section.body}</Text>
        </View>
      ))}
    </Sheet>
  );
}

export default function ProgressionScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const reducedMotion = useReduceMotion();
  const { equipped, isUnlocked, refreshUnlocks } = useAvatar();
  // Shares the 'me:progression' key with the avatar context, which fetches the
  // same payload for its unlock gates — so opening the pass from You costs no
  // request at all and the ladder is drawn on the first frame.
  const { data, loading, error, refresh: load } = useQuery('me:progression', api.progression);
  const [opening, setOpening] = useState(false);
  const { openPaywall } = useProEntitlement();
  const [infoOpen, setInfoOpen] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [claimingAll, setClaimingAll] = useState(false);
  // { done, total } while the fallback sweep is walking tiers one at a time,
  // so a button that may sit there for a minute says how far it has got.
  const [sweep, setSweep] = useState(null);
  // What the reveal is currently showing: { rewards, accent, fromLootbox }.
  const [reveal, setReveal] = useState(null);
  // The server's roll for the box currently being tapped up, or null.
  const [gamble, setGamble] = useState(null);

  // OPENING IS NOW TWO STEPS, AND THE SPLIT IS THE FEATURE.
  //
  // The request settles the box: it is marked opened and its whole gamble is
  // decided server side in that one transaction (backend/app/lootbox.py). What
  // comes back is a rarity, one pre rolled outcome per tap, and the rarity it
  // therefore opens as. Nothing here rolls anything, so there is no re-roll to
  // be had by backgrounding the app mid sequence.
  //
  // Then the gamble screen spends those taps, and `onGambleOpened` below turns
  // whatever rarity it landed on into an actual item.
  const openBox = async () => {
    if (opening) return;
    setOpening(true);
    try {
      setGamble(await api.openLootbox());
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

  // The lid came off. `rarity` is what the taps actually bid it up to, not
  // what the box was granted at.
  const onGambleOpened = async (rarity) => {
    setGamble(null);
    try {
      const roll = rollCosmetic(rarity, isUnlocked);
      // The unlock is what you actually keep, so a failure to write it must
      // not be swallowed by the celebration that follows.
      await api.addUnlock(roll.item.id);
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
      toast.error(e.message || 'Could not open lootbox');
      load();
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
  const arriving = useArrival(loading);

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
  // Tier, division and the gap to the next rung, all derived from the one
  // rank payload the server already sends. See config/rankLadder.js.
  const standing = standingFrom(rank);
  const showPremium = premium_active || IAP_ENABLED;
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

  // Bound and wrapped at the end rather than in place: the ladder is 250 lines
  // of JSX and re-indenting it for one parent would bury the change.
  const page = (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.gutter, paddingBottom: space.xxl }}>
      {/* The header IS the banner. The purple crew art used to be a separate
          strip above a plain card, so the screen opened with two stacked
          blocks saying the same thing; now the card sits ON the art and the
          portrait has something to sit against. */}
      <Framed
        frame={frameVariant('header', 'levels-and-rewards')}
        tint={brand.pink}
        weight={INK.medium}
        pose={framePose('levels-and-rewards')}
        // The one frame on this screen that boils. Fifty tiles down the page
        // is not a place for a crawling line on each of them, but the page's
        // single hero card can carry the hand animated look on its own.
        boil
        inset={false}
        style={styles.header}
        contentStyle={styles.headerClip}
      >
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
        <TouchableOpacity
          style={styles.infoBtn}
          onPress={() => setInfoOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="How level, rank and rewards work"
        >
          {/* A squared white NB tile, not the translucent black disc it was —
              the same call the back button made. No drop: it floats over busy
              header art, where a hard shadow reads as muck. */}
          <Info size={18} color={NB.ink} />
        </TouchableOpacity>
        <View style={styles.headerInner}>
          <PortraitBorder borderKey={rank?.key || 'wood'} size={104}>
            <CharacterBust equipped={equipped} size={104} bg={withAlpha('#000000', 0.35)} />
          </PortraitBorder>
          <Text style={[type.title, styles.headerText, { marginTop: space.sm }]}>Level {level}</Text>
          {/* Rank, not level. At the top tier it is just the name — it used to
              read "Mythic · top rank", which said the same thing twice. */}
          <Text style={[type.caption, styles.headerSubText]}>
            {standing.isTop
              ? standing.name
              : `${standing.name} · ${Number(standing.toNext).toLocaleString()} to climb`}
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
      </Framed>

      {/* The ladder in miniature. Tapping it opens the full column — this
          card answers "what am I", the ladder answers "what is next". */}
      <RankCard
        title="Rank"
        standing={standing}
        equipped={equipped}
        onPress={() => navigation?.navigate?.('RankLadder')}
        style={{ marginTop: space.lg }}
      />

      {/* What there is to collect, and one button that collects it. This used
          to be a small pill under the portrait, which is a strange way to
          mention eighty-five unclaimed rewards. */}
      {claimableCount > 0 && (
        <Framed
          frame={frameVariant('box', 'claim-bar')}
          tint={brand.pink}
          fill={colors.card}
          // A hero row on the busiest screen in the app, drawn at the hairline
          // the small chips wear: the line was finer than the ink on the button
          // sitting inside it. Base is this box's weight.
          weight={INK.base}
          pose={framePose('claim-bar')}
          // The frame was drawn tight to its contents — CLAIM ALL's own hard
          // drop landed ON the pink line, and the wording had no air above or
          // below it. `inset` is breathing room ON TOP of the ink clearance, so
          // this is the number that fixes it rather than a padding on the row.
          inset={space.md}
          style={styles.claimBar}
          contentStyle={styles.claimBarContent}
        >
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
        </Framed>
      )}

      {/* The PRO pitch, shown only to non-holders. There is no "premium pass
          active" banner any more: once you own it the whole gold track is
          unlocked down the page, which says it better than a bar does. */}
      {IAP_ENABLED && !premium_active && (
        <Card
          frame={frameVariant('featured', 'pro-pitch')}
          frameTint={GOLD}
          frameWeight={INK.thin}
          framePose={framePose('pro-pitch')}
          style={styles.passBanner}
        >
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
                Every tier pays twice: exclusive cosmetics, rarer boxes and
                bigger energy packs, all the way to level 50.
              </Text>
            </View>
          </Row>
          <ToonButton
            title="Unlock PASER PRO"
            variant="gold"
            size="sm"
            onPress={() => openPaywall('progression')}
            style={{ marginTop: space.md }}
          />
        </Card>
      )}

      {/* unopened lootboxes */}
      {pending_lootboxes.length > 0 && (
        <TouchableOpacity onPress={openBox} activeOpacity={0.85} disabled={opening} style={styles.boxCard}>
          <Framed
            frame={frameVariant('box', 'lootbox-row')}
            tint={brand.pink}
            fill={colors.card}
            weight={INK.thin}
            pose={framePose('lootbox-row')}
            contentStyle={styles.boxCardContent}
          >
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
          </Framed>
        </TouchableOpacity>
      )}

      {/* The lane headings wear the drawn frames, like everything else on this
          page. They were the last two code-drawn rounded pills on a screen made
          of hand-inked boxes, and a perfect radius next to fifty wobbly ones is
          exactly the seam the pack exists to remove. */}
      <View style={styles.trackHead}>
        <LaneHead label="FREE" fill={brand.pink} seed="lane-free" />
        {showPremium ? (
          <>
            <View style={{ width: SPINE_W }} />
            <LaneHead label="PASER PRO" fill={GOLD} seed="lane-pro" />
          </>
        ) : null}
      </View>

      {/* the two-track ladder */}
      {ladder.map((row) => {
        const reached = level >= row.level;
        const current = level + 1 === row.level;
        const freeOpen = reached && !claimed.has(`${row.level}:free`);
        const proOpen = reached && premium_active && !claimed.has(`${row.level}:premium`);
        // Either side of the spine still having something on it is what makes
        // the stone breathe. Gated premium tiers do NOT count: that tier opens
        // a paywall, not a reward, and a gem beckoning at it would be a lie.
        const rowClaimable = freeOpen || proOpen;
        return (
          <View key={row.level} style={[styles.tierRow, !showPremium && styles.singleTierRow]}>
            {!showPremium ? (
              <Spine level={row.level} reached={reached} current={current} claimable={rowClaimable} />
            ) : null}
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
            {showPremium ? (
              <>
                <Spine level={row.level} reached={reached} current={current} claimable={rowClaimable} />
                <TrackTile
                  rewards={row.premium}
                  accent={GOLD}
                  unlocked={reached}
                  claimed={claimed.has(`${row.level}:premium`)}
                  gated={!premium_active}
                  busy={busyKey === `${row.level}:premium`}
                  onPress={() => (premium_active ? claim(row.level, 'premium') : openPaywall('progression'))}
                  equipped={equipped}
                  isPro
                />
              </>
            ) : null}
          </View>
        );
      })}

      {/* The paywall used to be mounted here. It lives at the app root now
          (src/pro/ProProvider.js) and is opened with `openPaywall`, so the
          IAP_ENABLED check moved there too. */}
      <ProgressionInfoSheet visible={infoOpen} onClose={() => setInfoOpen(false)} />
      <LootboxGamble
        visible={!!gamble}
        sequence={gamble}
        onOpened={onGambleOpened}
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
    </ScrollView>
  );

  return (
    <Arrival active={arriving} style={{ flex: 1 }}>
      {page}
    </Arrival>
  );
}

const SPINE_W = 60;
// Reward art: ONE size for every kind, so the ladder is a grid rather than an
// assortment. Up from 64/46 — the tile is nothing but the object now that the
// caption has gone, so the object is what should have the room.
const ART_SIZE = 76;
// A two-reward tier has to fit both objects plus the gap inside the narrowest
// tile the ladder ever draws — a 375pt phone leaves ~137 per column once the
// gutter and the spine are taken out, and 54 overran it.
const ART_SIZE_PAIR = 50;
// The gem box, and the line the level number is set on. Both explicit, because
// the number is centred by arithmetic: (box - line) / 2 on each axis.
const GEM_BOX = 48;
const GEM_LINE = 22;
// Lane header height. Taller than the 40 the code-drawn pill used: a drawn
// frame spends real height on its own ink, and 40 left the label sitting in the
// line rather than inside the box.
const LANE_H = 48;

const styles = StyleSheet.create({
  // The banner art is the card. `overflow: hidden` is what lets a cover image
  // sit under the rounded corners instead of squaring them off.
  header: {
    minHeight: 248,
  },
  headerClip: { flex: 1, borderRadius: radius.card, overflow: 'hidden' },
  headerScrim: { backgroundColor: 'rgba(14,10,28,0.52)' },
  infoBtn: {
    position: 'absolute', top: space.md, right: space.md, zIndex: 1,
    width: 32, height: 32, borderRadius: nbRadius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: NB.strokeThin, borderColor: NB.ink,
  },
  headerInner: { alignItems: 'center', padding: space.lg },
  // Always white: the panel underneath is the purple art plus a dark scrim in
  // both themes, so this can't take the theme's text colour.
  headerText: { color: '#ffffff' },
  headerSubText: { color: 'rgba(255,255,255,0.78)' },

  claimAllBtn: { minWidth: 132 },
  claimBar: { marginTop: space.lg },
  claimBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },

  xpTrack: { height: 10, borderRadius: 5, overflow: 'hidden', alignSelf: 'stretch', marginTop: space.md },
  xpFill: { height: '100%', borderRadius: 5, backgroundColor: brand.pink },
  boxCard: { marginTop: space.md },
  boxCardContent: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  passBanner: { marginTop: space.md },

  trackHead: { flexDirection: 'row', alignItems: 'center', marginTop: space.xl, marginBottom: space.md },
  // The hard drop rides on the wrapper, not on a HardShadow behind the box —
  // see LaneHead. shadow.hard is iOS-only by design (theme/tokens.js); on
  // Android the frame's own ink carries the weight.
  laneWrap: { flex: 1, ...shadow.hard(NB.ink, NB.offsetSm) },
  lane: { height: LANE_H },
  laneContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  laneLabel: { alignSelf: 'stretch' },
  laneText: { ...toonType.button, fontSize: 16, letterSpacing: 0.9, color: '#ffffff' },

  tierRow: { flexDirection: 'row', alignItems: 'stretch' },
  singleTierRow: { paddingRight: SPINE_W },
  // Tiers stand apart rather than touching: the ladder is fifty framed boxes,
  // and at 4pt of gap the drawn lines of neighbouring rows read as one grid
  // rule between them.
  tilePress: { flex: 1, marginVertical: space.sm },
  tile: { flex: 1, minHeight: 132 },
  tileContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: space.md, paddingBottom: space.xl,
    // The bottom padding belongs to the locked/claimed chip, which is the only
    // thing that sits down there now that the caption has gone.
  },
  artRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: ART_SIZE + 4 },
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
  // Art variant: no rotation, and the gem is drawn larger than its slot so the
  // glow/sparkles can bleed past the spine without clipping.
  gemWrap: { width: GEM_BOX, height: GEM_BOX, alignItems: 'center', justifyContent: 'center' },
  // Bold, not semibold: at 14px on a saturated stone, semibold read as a smudge.
  // The line height is stated so the box below can centre it exactly.
  gemNumber: { ...toonType.label, fontFamily: fonts.bold, fontSize: 16, lineHeight: GEM_LINE, letterSpacing: 0 },
  // Two digits get tighter tracking and a hair less size rather than a smaller
  // gem — the stones have to stay the same size down the whole spine. The line
  // height does NOT change with it, so the centring holds either way.
  gemNumberWide: { fontSize: 14, letterSpacing: -0.5 },
  // Dead centre of the stone. `alignItems: center` on gemWrap places an
  // absolute child horizontally, so only the vertical needs stating.
  gemNumberBox: { position: 'absolute', width: GEM_BOX - 10, top: (GEM_BOX - GEM_LINE) / 2 },
  // Slightly larger than the slot so the current tier's glow/sparkles read,
  // but kept inside SPINE_W — overhang collides with the reward tiles either
  // side, and the pulse now swells it by another 7% at the top of its breath.
  gemArt: { position: 'absolute', width: 54, height: 54 },
});
