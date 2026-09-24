// SideRail — Home's shortcuts: missions, rewards and shop, then rivals,
// crossroads and pasers. Home uses the PAGED layout; the flat inline row and
// the original floating column remain available.
//
// It exists because those screens were not reachable from Home. Anything it
// shows on a tile is a REAL state — claimable pass tiers, unseen crossed paths,
// paser requests waiting on you — never decoration.
//
// TWO PAGES OF THREE, SWIPED (`paged`). Six shortcuts do not fit across a
// phone at a size worth drawing, and the old answer — three big tiles with
// Rivals and Crossroads shrunk to text pills underneath — made two of the six
// look like an afterthought and spent a second row of height on them. Now each
// page is exactly three, the same size, and a swipe snaps a whole page at a
// time (`pagingEnabled`), so there is never half a shortcut peeking in from
// the edge. A small PageDots under the row says there is a second page.
//
// NO BOX ROUND THE DRAWING on the paged row. The stickers are strong enough on
// their own; a drawn square round each one was a frame round a frame. The tap
// target is not smaller for it: the press area is the whole slot — a third of
// the row wide, drawing and word together — so the thumb has more to hit than
// the old 72pt tile gave it.
//
// THE WORD SITS ON THE DRAWING. The caption is a few points under the art, so
// icon and label read as one control rather than as a picture with a caption
// floating below it. One gap for every tile.
//
// The flat inline row and the floating column keep the older treatment: EACH
// TILE IS A SOLID BLOCK OF ITS OWN COLOUR, inside a hand-drawn box, with the
// sticker on top. THAT GROUND IS THE TILE'S `tint` MIDDLE STOP — the stickers
// were cut off their tile masters by `scripts/cut-rail-art.py` and are lit for
// it — so the two are changed together.
//
// EVERY TILE SAYS WHAT IT IS. A sticker of a clipboard, a certificate, a
// shopfront, two gloves and a map pin are five nice drawings and no reader's
// first guess at "the reward ladder" or "runners whose route crossed yours".
// The rail is a NAVIGATION row, not a cosmetic grid.
//
// NO TILE CROSSES INTO ANOTHER TAB. Each one pushes onto the stack it was
// tapped from (App.js registers Progression, Rivals, Crossroads and Pasers on
// the Home stack as well as the You stack), so back from any of them is the
// screen you came from. Shop is the exception and always has been — it lives
// at the ROOT, above the tabs, so it pops straight back to wherever it opened
// from.

import { Lock } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
} from 'react-native-reanimated';
import { Image } from '../ui/image';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { brand, fonts, space, toon, useTheme, useThemedType } from '../theme';
import { haptic, PressableScale } from '../ui/motion';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import Framed from './ui/Framed';
import PageDots from './ui/PageDots';
import { art } from '../config/onboardingArt';
import { badgeLabel } from '../config/paserby';
import AppIcon from './AppIcon';

const GOLD = ['#FFD98A', '#F0A93C', '#A8631A'];

// ONE CAPTION SIZE FOR THE WHOLE ROW, measured off the slot rather than left to
// each label to settle for itself.
//
// The slots divide the row evenly, so a slot is (screen - two gutters) / count.
// "Crossroads" is the longest label the rail carries, and Inter SemiBold draws
// it at 5.59pt per point of size, plus the caption's 0.2 of tracking on each of
// its ten letters. Solving that against the slot, less 10pt so two labels can
// never end up touching, gives the largest size at which all of them fit — and
// all of them take it, which is the point: the row reads as one set of buttons
// instead of four at 11pt with a smaller one on the end.
//
// Clamped at `max` (labelSm's own 11 for the five-across row) and at 9, below
// which a nav label stops being readable.
const CROSSROADS_PER_PT = 5.59;
const CROSSROADS_TRACKING = 0.2 * 10;
const CAPTION_GUTTER = 10;

export function captionFor(screenWidth, count = 5, max = 11) {
  const slot = (screenWidth - space.gutter * 2) / count;
  const fits = (slot - CAPTION_GUTTER - CROSSROADS_TRACKING) / CROSSROADS_PER_PT;
  return Math.max(9, Math.min(max, Math.round(fits * 2) / 2));
}

// The paged row: three to a page, and a drawing this big. A third of a 335pt
// row is 111pt, so the art sits in the middle of a slot with room either side
// and the whole slot is the press area.
export const QUICK_PER_PAGE = 3;
const QUICK_ART = 60;
// The drawings are not all square — the rewards scroll is wide and short — so
// the box is a little wider than it is tall. Contained in a square, a wide
// drawing came out visibly smaller than a tall one beside it.
const QUICK_ART_W = Math.round(QUICK_ART * 1.25);
// Between the drawing and its word. Small on purpose: see "THE WORD SITS ON
// THE DRAWING" above.
const QUICK_LABEL_GAP = 2;

// `size` is only ever passed for the inline row, and only because the row
// grew to five: five 64pt tiles do not fit across a 320pt phone. Sized by the
// caller rather than by a media query here, so the rail stays the one place
// that knows how many tiles it has.
//
// `bare` drops the drawn box and the colour block: the paged row's look.
function RailTile({
  icon,
  artKey,
  label,
  badge,
  tint = GOLD,
  onPress,
  inline = false,
  bare = false,
  size,
  captionSize,
  locked = false,
}) {
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

  const drawing = src ? (
    <Image source={src} style={bare ? styles.bareArt : styles.tileArt} resizeMode="contain" />
  ) : (
    <AppIcon name={icon} style={styles.tileIcon} />
  );

  return (
    <View style={[styles.slot, (inline || bare) && styles.inlineSlot]}>
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
        style={[styles.press, bare && styles.barePress, locked && { opacity: 0.55 }]}
      >
        <View
          style={[
            styles.tileWrap,
            inline && styles.inlineTileWrap,
            size ? { width: bare ? QUICK_ART_W : size, height: size } : null,
          ]}
        >
          {bare ? (
            drawing
          ) : (
            // A drawn box, like everything else on this page — not a rounded
            // rectangle with a 2.5px border pretending to be one. The fill is
            // FLAT: the frame's paper is the tile's shape, and a gradient
            // cannot be painted into a wobbly silhouette without a mask layer
            // this app does not ship. Each tile is dealt its own drawing and
            // pose off its label, so five in a row are five boxes rather than
            // one box copied five times.
            <Framed
              frame={frameVariant('chip', label)}
              tint={toon.ink}
              fill={tint[1]}
              weight={INK.thin}
              pose={framePose(`rail:${label}`)}
              inset={false}
              style={[styles.tile, inline && styles.inlineTile]}
              contentStyle={styles.tileInner}
            >
              {drawing}
            </Framed>
          )}
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
            own, so one word dropped to 8.8pt while the rest stayed at 11 —
            buttons in a row wearing two different sizes on two baselines.
            See `captionFor`. */}
        {(inline || bare) && label ? (
          <Text
            style={[
              type.labelSm,
              styles.caption,
              bare && styles.bareCaption,
              { color: colors.text, fontSize: captionSize },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        ) : null}
      </PressableScale>
    </View>
  );
}

/**
 * @param {boolean} inline  a flat row of five framed tiles
 * @param {boolean} paged   two swiped pages of three bare tiles (Home)
 * @param {boolean} firstRunComplete  Rivals and Crossroads unlock after it
 */
export default function SideRail({
  navigation,
  onOpenShop,
  style,
  inline = false,
  paged = false,
  firstRunComplete = true,
}) {
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
  // Paser requests waiting on you. The same 'pasers' key the Pasers screen
  // reads, so accepting one there clears this badge on the way back. It used
  // to ride the "Add pasers" button on You, which moved here with the entry
  // point. Only the paged row carries a Pasers tile, so only it asks.
  const { data: pasers } = useQuery(paged ? 'pasers' : null, api.pasers);
  const requestsWaiting = pasers?.incoming?.length || 0;

  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);

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

  // Missions first: it is the only tile whose contents change every day, so it
  // is the one worth looking at on the way past.
  // GREEN, though the clipboard master is drawn on yellow: the pass tile next
  // to it is gold, and two yellows in a row read as one wide tile.
  const tiles = [
    {
      key: 'missions',
      icon: 'verified',
      artKey: 'railMissions',
      label: 'Missions',
      badge: missionsWaiting ? String(missionsWaiting) : null,
      tint: ['#A5F3D0', '#3faf74', '#116343'],
      onPress: () => navigation.navigate('Missions'),
    },
    {
      key: 'rewards',
      icon: 'award',
      artKey: 'railPass',
      label: 'Rewards',
      badge: claimable ? String(claimable) : null,
      onPress: () => navigation.navigate('Progression'),
    },
    {
      key: 'shop',
      icon: 'energy',
      artKey: 'railShop',
      label: 'Shop',
      tint: ['#7FF0DE', brand.teal, '#128476'],
      onPress: onOpenShop,
    },
    {
      key: 'rivals',
      icon: 'steal',
      artKey: 'railRivals',
      label: 'Rivals',
      locked: !firstRunComplete,
      tint: ['#C4B5FD', brand.purple, '#5B21B6'],
      onPress: () => navigation.navigate('Rivals'),
    },
    // Crossed paths. The badge is a REAL state — encounters this runner has
    // not looked at yet. PINK, not the amber the Crossroads header wears: an
    // amber crossroads sat at one end of the rail looking like the gold pass
    // at the other.
    {
      key: 'crossroads',
      icon: 'route',
      artKey: 'railCrossroads',
      label: 'Crossroads',
      locked: !firstRunComplete,
      badge: badgeLabel(paserby?.unseen),
      tint: ['#FBA6CD', brand.pink, '#9D1458'],
      onPress: () => navigation.navigate('Crossroads'),
    },
  ];
  if (paged) {
    // Your pasers: the friends showcase. The high five is the drawing the
    // Pasers panel already uses, so the shortcut and the page it opens match.
    tiles.push({
      key: 'pasers',
      icon: 'invite',
      artKey: 'panelPasers',
      label: 'Pasers',
      badge: requestsWaiting ? String(requestsWaiting) : null,
      onPress: () => navigation.navigate('Pasers'),
    });
  }

  if (paged) {
    const rowW = width - space.gutter * 2;
    const captionSize = captionFor(width, QUICK_PER_PAGE, 12);
    const pages = [];
    for (let i = 0; i < tiles.length; i += QUICK_PER_PAGE) pages.push(tiles.slice(i, i + QUICK_PER_PAGE));
    const onEnd = (e) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / rowW);
      if (next !== page) setPage(next);
    };
    return (
      <View style={style}>
        <ScrollView
          horizontal
          pagingEnabled
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onEnd}
          accessibilityLabel="Shortcuts"
        >
          {pages.map((row, i) => (
            <View key={i} style={[styles.page, { width: rowW }]}>
              {row.map(({ key, ...tile }) => (
                <RailTile key={key} {...tile} bare size={QUICK_ART} captionSize={captionSize} />
              ))}
            </View>
          ))}
        </ScrollView>
        <PageDots count={pages.length} index={page} style={styles.pageDots} />
      </View>
    );
  }

  // Five across, so the inline tiles come down a few points.
  const size = inline ? 58 : undefined;
  // Measured here, once, and handed to all five — see captionFor.
  const captionSize = inline ? captionFor(width) : undefined;

  return (
    <View style={[inline ? styles.inlineRail : styles.rail, style]} pointerEvents="box-none">
      {tiles.map(({ key, ...tile }) => (
        <RailTile key={key} {...tile} inline={inline} size={size} captionSize={captionSize} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', right: space.sm, gap: space.md, alignItems: 'center' },
  // `flex-start` on the cross axis, not `center`: with a caption under every
  // tile the slots are the same height anyway, and centring would float a
  // badged tile's row against an unbadged one the moment one of them wraps.
  inlineRail: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around' },
  // One page of the paged row: three equal slots across its full width.
  page: { flexDirection: 'row', alignItems: 'flex-start' },
  pageDots: { marginTop: space.sm },
  slot: { alignItems: 'center', width: 62 },
  // The press area is the tile and its word together, so it is the column that
  // centres them rather than the slot.
  press: { alignItems: 'center', alignSelf: 'stretch' },
  // The paged row's press area runs the whole slot, with a little air above
  // and below the drawing, so losing the box costs no touch area.
  barePress: { paddingVertical: space.xs },
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
  // With no box to sit in, the drawing takes the whole tile.
  bareArt: { width: '100%', height: '100%' },
  // The tab bar's label, to the point: labelSm, sentence case rather than the
  // token's uppercase, and the page's own text colour rather than `textMuted`
  // — these name buttons, they are not a caption on a picture. The size the
  // row actually draws at comes from `captionFor` and is passed in per render.
  caption: {
    fontSize: 11,
    letterSpacing: 0.2,
    textTransform: 'none',
    marginTop: 6,
    textAlign: 'center',
    width: '100%',
  },
  bareCaption: { marginTop: QUICK_LABEL_GAP },
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
    // Poppins Black: the app's heavy face. This named `fonts.black`, which
    // is not a token, so the count fell back to the system font.
    fontFamily: fonts.hero,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
