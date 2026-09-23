// SideRail — pass, shop, rivals and crossroads as shortcut tiles. Home uses the
// inline row; the original floating-column layout remains available.
//
// It exists because those screens were not reachable from Home. Anything it
// shows on a tile is a REAL state — claimable pass tiers, unseen crossed paths
// — never decoration.
//
// EACH TILE IS A SOLID BLOCK OF ITS OWN COLOUR, inside a hand-drawn box, with
// the sticker on top. It has been through two wrong answers: a gradient ring
// around a card-coloured middle (four empty outlines in a row rather than four
// buttons), then a full-bleed gradient inside a 2.5px rounded border, which was
// the only square-cornered chrome left on a page of drawn boxes.
//
// EVERY TILE SAYS WHAT IT IS. The inline row wears a word under each drawing —
// a sticker of a clipboard, a certificate, a shopfront, two gloves and a map
// pin are five nice drawings and no reader's first guess at "the reward ladder"
// or "runners whose route crossed yours". The rail is a NAVIGATION row, not a
// cosmetic grid: the art-only rule (cosmetics, borders) holds where the picture
// IS the thing being chosen, and it never applied to a set of shortcuts.
//
// The caption is the tab bar's own label recipe — labelSm at 11pt, sentence
// case — so the row of buttons at the top of Home and the row at the bottom of
// the window read as one system. The floating column keeps no captions: it is
// laid over content rather than on the page, and text over a map is a smear.
//
// Art is optional: each tile falls back to its sticker icon until the framed
// art lands (docs/ONBOARDING_ASSETS.md §7). All five have their own drawing
// now — cut off the tile masters by `scripts/cut-rail-art.py`, which prints the
// ground each was drawn on. THAT GROUND IS THE TILE'S `tint` MIDDLE STOP: the
// sticker is lit and shadowed for it, so the two are changed together.
//
// NO TILE CROSSES INTO ANOTHER TAB. Each one pushes onto the stack it was
// tapped from (App.js registers Progression, Rivals and Crossroads on the Home
// stack as well as the You stack), so back from any of them is the screen you
// came from. They used to be navigate('You', { screen: …, initial: false }),
// which walked you into the You tab: back went to the profile, and Home was
// two taps away. Shop is the exception and always has been — it lives at the
// ROOT, above the tabs, so it pops straight back to wherever it opened from.

import { Lock } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Image } from '../ui/image';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { brand, fonts, space, toon, useTheme, useThemedType } from '../theme';
import { haptic, PressableScale } from '../ui/motion';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import Framed from './ui/Framed';
import { art } from '../config/onboardingArt';
import { badgeLabel } from '../config/paserby';
import AppIcon from './AppIcon';

const GOLD = ['#FFD98A', '#F0A93C', '#A8631A'];

// ONE CAPTION SIZE FOR THE WHOLE ROW, measured off the slot rather than left to
// each label to settle for itself.
//
// The five slots divide the row evenly, so a slot is (screen - two gutters) / 5.
// "Crossroads" is the longest label the rail carries, and Inter SemiBold draws
// it at 5.59pt per point of size, plus the caption's 0.2 of tracking on each of
// its ten letters. Solving that against the slot, less 10pt so two labels can
// never end up touching, gives the largest size at which all five fit — and all
// five take it, which is the point: the row reads as one set of buttons instead
// of four at 11pt with a smaller one on the end.
//
// Clamped at labelSm's own 11 and at 9, below which a nav label stops being
// readable. The floor only starts to bite under ~351pt, and even at 9pt
// "Crossroads" is 52.3pt wide, so it still clears its slot on a 320pt phone.
const CROSSROADS_PER_PT = 5.59;
const CROSSROADS_TRACKING = 0.2 * 10;
const CAPTION_GUTTER = 10;

export function captionFor(screenWidth, count = 5) {
  const slot = (screenWidth - space.gutter * 2) / count;
  const fits = (slot - CAPTION_GUTTER - CROSSROADS_TRACKING) / CROSSROADS_PER_PT;
  return Math.max(9, Math.min(11, Math.round(fits * 2) / 2));
}

// `size` is only ever passed for the inline row, and only because the row
// grew to five: five 64pt tiles do not fit across a 320pt phone. Sized by the
// caller rather than by a media query here, so the rail stays the one place
// that knows how many tiles it has.
function RailTile({ icon, artKey, label, badge, tint = GOLD, onPress, inline = false, size, captionSize, locked = false, quiet = false }) {
  const src = art(artKey);
  const { colors } = useTheme();
  const type = useThemedType();
  const badgePulse = useSharedValue(1);
  
  // Pulse animation for badge when present
  const hasBadge = badge && !locked;
  
  React.useEffect(() => {
    if (hasBadge) {
      badgePulse.value = withRepeat(
        withSpring(1.15, { damping: 8, stiffness: 400 }),
        -1,
        true
      );
    } else {
      badgePulse.value = 1;
    }
    return () => cancelAnimation(badgePulse);
  }, [hasBadge, badgePulse]);
  
  const badgeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgePulse.value }],
  }));
  
  return (
    <View style={[styles.slot, inline && styles.inlineSlot]}>
      {/* THE WORD IS PART OF THE BUTTON, not a caption beside it: the press
          area is the tile AND its label, so the thing a thumb aims at is the
          thing the eye reads. The tile keeps its own fixed box inside — the
          badge hangs off that corner, and a badge pinned to the slot instead
          would drift out to the row's gutter. */}
      <PressableScale
        onPress={() => { if (!locked) { haptic.light(); onPress?.(); } }}
        disabled={locked}
        accessibilityState={{ disabled: locked }}
        accessibilityHint={locked ? 'Complete your first run to unlock' : undefined}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}${locked ? ', locked. Complete your first run to unlock' : ''}${badge ? `, ${badge}` : ''}` : 'Open'}
        style={[styles.press, locked && { opacity: 0.55 }]}
      >
        <View style={[styles.tileWrap, inline && styles.inlineTileWrap, size ? { width: size, height: size } : null]}>
          {/* A drawn box, like everything else on this page — not a rounded
              rectangle with a 2.5px border pretending to be one.
              The fill is FLAT, and it has to be: the frame's paper is the tile's
              shape, and a gradient cannot be painted into a wobbly silhouette
              without a mask layer this app does not ship. Behind the frame it
              would simply be a square of colour showing at every corner, which
              is the bleed this pass exists to remove. The middle stop of each
              tile's ramp is the colour the ramp reads as anyway.
              Each tile is dealt its own drawing and pose off its label, so five
              in a row are five boxes rather than one box copied five times. */}
          <Framed
            frame={frameVariant('chip', label)}
            tint={toon.ink}
            fill={quiet ? colors.card : tint[1]}
            weight={INK.thin}
            pose={framePose(`rail:${label}`)}
            inset={false}
            style={[styles.tile, inline && styles.inlineTile]}
            contentStyle={styles.tileInner}
          >
            {src ? (
              <Image source={src} style={styles.tileArt} resizeMode="contain" />
            ) : (
              <AppIcon name={icon} style={styles.tileIcon} />
            )}
          </Framed>
          {locked ? (
            <View style={[styles.badge, { backgroundColor: colors.card }]}>
              <Lock size={14} color={colors.text} />
            </View>
          ) : badge ? (
            <Animated.View style={[styles.badge, styles.badgeProminent, badgeAnimatedStyle]}>
              <Text style={[styles.badgeText, styles.badgeTextProminent]} numberOfLines={1}>{badge}</Text>
            </Animated.View>
          ) : null}
        </View>
        {/* Already in the pressable's accessibility label, so it is not read
            twice; this is the sighted half of the same name.
            THE SIZE COMES FROM THE ROW, not from this Text. It used to shrink
            itself with `adjustsFontSizeToFit`, which sizes each label on its
            own: "Crossroads" measures 63.5pt at 11pt and its slot is 67pt on a
            375pt phone, so that one word dropped to 8.8pt while the four beside
            it stayed at 11 — five buttons in a row wearing two different sizes,
            sitting on two different baselines. See `captionFor`. */}
        {inline && label ? (
          <Text
            style={[type.labelSm, styles.caption, { color: colors.text, fontSize: captionSize }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        ) : null}
      </PressableScale>
    </View>
  );
}

export function SecondaryShortcut({ label, badge, locked, onPress }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <Pressable
      onPress={() => { if (!locked) { haptic.light(); onPress?.(); } }}
      disabled={locked}
      style={({ pressed }) => [
        styles.secondaryShortcut,
        {
          borderColor: colors.border,
          backgroundColor: pressed ? colors.cardAlt : 'transparent',
          opacity: locked ? 0.5 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: locked }}
      accessibilityLabel={`${label}${locked ? ', locked. Complete your first run to unlock' : ''}${badge ? `, ${badge}` : ''}`}
    >
      <Text style={[type.captionMedium, { color: colors.text, fontSize: 11 }]} numberOfLines={1}>{label}</Text>
      {badge ? <Text style={[type.captionMedium, styles.secondaryBadge]} numberOfLines={1}>{badge}</Text> : null}
    </Pressable>
  );
}

export default function SideRail({ navigation, onOpenShop, style, inline = false, firstRunComplete = true, primaryOnly = false }) {
  const [claimable, setClaimable] = useState(0);
  // Today's missions, for the badge. Same rule as the pass tile: the number is
  // what is WAITING TO BE COLLECTED, not how many missions exist — a badge
  // that is permanently on says nothing.
  const { data: missions } = useQuery('me:missions', api.missions);
  const missionsWaiting = (missions?.missions || [])
    .filter((m) => m.complete && !m.claimed).length
    + (missions?.all_complete && !missions?.bonus_claimed ? 1 : 0);
  // PASERBY's entry point. Seeded from cache (useQuery) and refreshed on focus
  // like everything else on the rail, so the "3 NEW" badge is there on the
  // first frame after a run rather than a round trip later.
  const { data: paserby } = useQuery('me:paserby', api.paserby, {
    fallback: { enabled: true, unseen: 0, total: 0 },
  });

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
        })
        .catch(() => {});
      return () => { alive = false; };
    }, [])
  );

  const primaryCount = primaryOnly ? 3 : 5;
  const size = inline ? (primaryOnly ? 72 : 58) : undefined;
  // Measured here, once, and handed to all five — see captionFor.
  const { width } = useWindowDimensions();
  const captionSize = inline ? captionFor(width, primaryCount) : undefined;

  return (
    <View style={style} pointerEvents="box-none">
      <View style={inline ? styles.inlineRail : styles.rail} pointerEvents="box-none">
      {/* Missions first: it is the only tile whose contents change every day,
          so it is the one worth looking at on the way past.
          GREEN, though the clipboard master is drawn on yellow: the pass tile
          next to it is gold, and two yellows in a row read as one wide tile
          rather than two. Green is also the colour this tile has always worn.
          The clipboard's ink is black outlines with a blue clip and a pink
          star, none of which the swap touches. */}
      <RailTile
        icon="verified"
        artKey="railMissions"
        label="Missions"
        badge={missionsWaiting ? String(missionsWaiting) : null}
        tint={['#A5F3D0', '#3faf74', '#116343']}
        onPress={() => navigation.navigate('Missions')}
        inline={inline}
        size={size}
        captionSize={captionSize}
        quiet={primaryOnly}
      />
      <RailTile
        icon="award"
        artKey="railPass"
        label="Rewards"
        badge={claimable ? String(claimable) : null}
        onPress={() => navigation.navigate('Progression')}
        inline={inline}
        size={size}
        captionSize={captionSize}
        quiet={primaryOnly}
      />
      <RailTile
        icon="energy"
        artKey="railShop"
        label="Shop"
        tint={['#7FF0DE', brand.teal, '#128476']}
        onPress={onOpenShop}
        inline={inline}
        size={size}
        captionSize={captionSize}
        quiet={primaryOnly}
      />
      {!primaryOnly ? (
        <>
      <RailTile
        icon="steal"
        artKey="railRivals"
        label="Rivals"
        locked={!firstRunComplete}
        tint={['#C4B5FD', brand.purple, '#5B21B6']}
        onPress={() => navigation.navigate('Rivals')}
        inline={inline}
        size={size}
        captionSize={captionSize}
      />
      {/* Crossed paths. The badge is a REAL state — encounters this runner has
          not looked at yet — never decoration, same rule as the pass tile.
          PINK, not the amber the Crossroads header wears: once the tiles became
          solid blocks of colour, an amber crossroads sat at one end of the rail
          looking like the gold pass at the other. Pink is the fourth colour the
          rail did not have, and it is in the plaza's own paths and blossom. */}
      <RailTile
        icon="route"
        artKey="railCrossroads"
        label="Crossroads"
        locked={!firstRunComplete}
        badge={badgeLabel(paserby?.unseen)}
        tint={['#FBA6CD', brand.pink, '#9D1458']}
        onPress={() => navigation.navigate('Crossroads')}
        inline={inline}
        size={size}
        captionSize={captionSize}
      />
        </>
      ) : null}
      </View>
      {primaryOnly ? (
        <View style={styles.secondaryRow}>
          <SecondaryShortcut
            label="Rivals"
            locked={!firstRunComplete}
            onPress={() => navigation.navigate('Rivals')}
          />
          <SecondaryShortcut
            label="Crossroads"
            locked={!firstRunComplete}
            badge={badgeLabel(paserby?.unseen)}
            onPress={() => navigation.navigate('Crossroads')}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', right: space.sm, gap: space.md, alignItems: 'center' },
  // `flex-start` on the cross axis, not `center`: with a caption under every
  // tile the slots are the same height anyway, and centring would float a
  // badged tile's row against an unbadged one the moment one of them wraps.
  inlineRail: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around', gap: space.sm },
  slot: { alignItems: 'center', width: 62 },
  // The press area is the tile and its word together, so it is the column that
  // centres them rather than the slot.
  press: { alignItems: 'center', alignSelf: 'stretch' },
  inlineSlot: { flex: 1, width: 'auto' },
  tileWrap: { width: 56, height: 56 },
  inlineTileWrap: { width: 64, height: 64 },
  // No radius and no border: the frame is both. `overflow` stays visible too —
  // clipping the sticker to a rectangle would cut the corners the drawn box is
  // supposed to round off.
  tile: {
    width: 56,
    height: 56,
  },
  inlineTile: { width: 64, height: 64 },
  tileInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Inset from the frame rather than filling it — the art reads as sitting in
  // the tile instead of being cropped by its rounded corners.
  tileArt: { width: '84%', height: '84%' },
  // The tab bar's label, to the point: labelSm at 11pt, sentence case rather
  // than the token's uppercase, and the page's own text colour rather than
  // `textMuted` — these name buttons, they are not a caption on a picture.
  // The 11 is the ceiling and the fallback; the size the row actually draws at
  // comes from `captionFor` and is passed in per render.
  caption: {
    fontSize: 11,
    letterSpacing: 0.2,
    textTransform: 'none',
    marginTop: 6,
    textAlign: 'center',
    width: '100%',
  },
  // Fallback stickers fill the frame instead: unlike the rail art, they are
  // trimmed to ~80% of their own canvas, so the extra 16% here only spends the
  // sticker's baked-in margin and lands the drawing at tileArt's visual size.
  tileIcon: { width: '100%', height: '100%' },
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
  badgeProminent: {
    backgroundColor: '#ef4444',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  badgeText: { color: '#fff', fontSize: 11, fontFamily: fonts.bold },
  badgeTextProminent: {
    color: '#fff',
    fontSize: 12,
    fontFamily: fonts.black,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
  secondaryShortcut: {
    minHeight: 34,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  secondaryBadge: {
    color: '#fff',
    backgroundColor: '#ef4444',
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 5,
    fontSize: 10,
  },
});
