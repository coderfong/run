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
// TILES ARE ART ONLY: no caption under them, matching the cosmetic and border
// grids. The label is still passed for the accessibility name.
//
// Art is optional: each tile falls back to its sticker icon until the framed
// art lands (docs/ONBOARDING_ASSETS.md §7).
//
// NO TILE CROSSES INTO ANOTHER TAB. Each one pushes onto the stack it was
// tapped from (App.js registers Progression, Rivals and Crossroads on the Home
// stack as well as the You stack), so back from any of them is the screen you
// came from. They used to be navigate('You', { screen: …, initial: false }),
// which walked you into the You tab: back went to the profile, and Home was
// two taps away. Shop is the exception and always has been — it lives at the
// ROOT, above the tabs, so it pops straight back to wherever it opened from.

import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from '../ui/image';
import { useFocusEffect } from '@react-navigation/native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { brand, space, toon } from '../theme';
import { haptic, PressableScale } from '../ui/motion';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import Framed from './ui/Framed';
import { art } from '../config/onboardingArt';
import { badgeLabel } from '../config/paserby';
import AppIcon from './AppIcon';

const GOLD = ['#FFD98A', '#F0A93C', '#A8631A'];

// `size` is only ever passed for the inline row, and only because the row
// grew to five: five 64pt tiles do not fit across a 320pt phone. Sized by the
// caller rather than by a media query here, so the rail stays the one place
// that knows how many tiles it has.
function RailTile({ icon, artKey, label, badge, tint = GOLD, onPress, inline = false, size }) {
  const src = art(artKey);
  return (
    <View style={[styles.slot, inline && styles.inlineSlot]}>
      <PressableScale
        onPress={() => { haptic.light(); onPress?.(); }}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}${badge ? `, ${badge}` : ''}` : 'Open'}
        style={[styles.tileWrap, inline && styles.inlineTileWrap, size ? { width: size, height: size } : null]}
      >
        {/* A drawn box, like everything else on this page — not a rounded
            rectangle with a 2.5px border pretending to be one.
            The fill is FLAT, and it has to be: the frame's paper is the tile's
            shape, and a gradient cannot be painted into a wobbly silhouette
            without a mask layer this app does not ship. Behind the frame it
            would simply be a square of colour showing at every corner, which is
            the bleed this pass exists to remove. The middle stop of each tile's
            ramp is the colour the ramp reads as anyway.
            Each tile is dealt its own drawing and pose off its label, so four in
            a row are four boxes rather than one box copied four times. */}
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
          {src ? (
            <Image source={src} style={styles.tileArt} resizeMode="contain" />
          ) : (
            <AppIcon name={icon} style={styles.tileIcon} />
          )}
        </Framed>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={1}>{badge}</Text>
          </View>
        ) : null}
      </PressableScale>
    </View>
  );
}

export default function SideRail({ navigation, onOpenShop, style, inline = false }) {
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

  // Five across, so the inline tiles come down a few points.
  const size = inline ? 58 : undefined;

  return (
    <View style={[inline ? styles.inlineRail : styles.rail, style]} pointerEvents="box-none">
      {/* Missions first: it is the only tile whose contents change every day,
          so it is the one worth looking at on the way past. */}
      <RailTile
        icon="verified"
        artKey="railMissions"
        label="Missions"
        badge={missionsWaiting ? String(missionsWaiting) : null}
        tint={['#A5F3D0', '#3faf74', '#116343']}
        onPress={() => navigation.navigate('Missions')}
        inline={inline}
        size={size}
      />
      <RailTile
        icon="award"
        artKey="railPass"
        label="Pass"
        badge={claimable ? String(claimable) : null}
        onPress={() => navigation.navigate('Progression')}
        inline={inline}
        size={size}
      />
      <RailTile
        icon="energy"
        artKey="railShop"
        label="Shop"
        tint={['#7FF0DE', brand.teal, '#128476']}
        onPress={onOpenShop}
        inline={inline}
        size={size}
      />
      {/* `railRivals` art doesn't exist yet, so this falls back to the steal
          sticker — the same one RivalCard uses. */}
      <RailTile
        icon="steal"
        artKey="railRivals"
        label="Rivals"
        tint={['#C4B5FD', brand.purple, '#5B21B6']}
        onPress={() => navigation.navigate('Rivals')}
        inline={inline}
        size={size}
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
        badge={badgeLabel(paserby?.unseen)}
        tint={['#FBA6CD', brand.pink, '#9D1458']}
        onPress={() => navigation.navigate('Crossroads')}
        inline={inline}
        size={size}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { position: 'absolute', right: space.sm, gap: space.md, alignItems: 'center' },
  inlineRail: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  slot: { alignItems: 'center', width: 62 },
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
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
