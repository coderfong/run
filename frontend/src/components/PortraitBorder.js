// PortraitBorder — a rank-tier frame drawn AROUND a character portrait. Wraps
// a CharacterBust (or any circular child) and lays the tier's ring on top.
// Most callers want RankedAvatar (components/identity/RankedAvatar.js), which
// pairs this with the bust; this is the geometry underneath it.
//
// ONE SQUARE, ONE CENTRE. The component is a single square box, and BOTH layers
// are placed from that box's centre: the portrait is centred in it, and the
// ring art is positioned so its OPENING's centre lands on the same point. Every
// sibling that lines itself up against the avatar (a name beside it in a row,
// the rank rail's stem, a feed card's header) is therefore lining up with the
// face, not with the ring art's canvas.
//
// That is the bug this layout replaced. The old wrapper centred the ART'S
// CANVAS in the box and pushed the portrait to the opening's centre (cx/cy in
// config/borderArt.js). The openings are not concentric with their canvases —
// Mythic's flame and Prismatic's crystals push the ring down, Gold's medal
// pushes it up — so the face sat several points above or below the middle of
// its own box, and any ring or row drawn around that box (the feed card wore
// an accent circle round it) was visibly off-centre from the portrait.
//
// THE BOX IS THE SAME FOR EVERY TIER. It is `size * FRAME_BOX` whichever frame
// is worn, so a list of runners in different tiers keeps its names on one
// left edge and the rows do not change height with rank. The ring is sized so
// its opening covers the portrait exactly (see measure-border-holes-3.py for
// why "covers" rather than "fits"); ornaments that reach past the box (Onyx's
// spikes, Ember's flames) overflow it, like a sticker, rather than shrinking
// every other tier to make room for them. The two most ornate frames are held
// to FRAME_MAX, and when that cap bites the portrait shrinks WITH the ring, so
// the fit is identical at every size.
//
// Fully proportional: nothing here is a point offset, so a 24pt rail marker
// and a 112pt hero wear the same frame the same way.

import React from 'react';
import { View } from 'react-native';
import { Image } from '../ui/image';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { borderForLevel, borderByKey } from '../config/progression';
import { BORDER_ART } from '../config/borderArt';

// The footprint, as a multiple of the portrait's diameter. Fits the band of
// every tier from Wood (1.10) to Prismatic (1.31) within a point or two.
export const FRAME_BOX = 1.25;
// The largest the ring art may be drawn, as a multiple of the portrait. Onyx
// and Ember have small openings (0.62, 0.65 of their art), so fitting their
// opening to the portrait would draw them at 1.6x; they stop here instead.
export const FRAME_MAX = 1.5;

/**
 * Where everything goes, as pure arithmetic, so a caller can reserve room
 * before layout and tests can check it without mounting anything.
 *
 * @param {string} tierKey  border art key (wood..mythic); unknown keys get the
 *                          drawn SVG ring, which is concentric by construction
 * @param {number} size     the portrait's nominal diameter
 * @returns {{ box, portrait, ring, ringLeft, ringTop, art }}
 *   box       the component's square footprint
 *   portrait  the diameter the portrait is actually drawn at
 *   ring      the ring art's square side (0 without art)
 *   ringLeft/ringTop  where the ring art's canvas starts inside the box
 */
export function frameGeometry(tierKey, size) {
  const box = size * FRAME_BOX;
  const art = BORDER_ART[tierKey];
  if (!art) return { box, portrait: size, ring: 0, ringLeft: 0, ringTop: 0, art: null };
  const natural = size / art.hole;
  const ring = Math.min(natural, size * FRAME_MAX);
  const portrait = size * (ring / natural);
  const cx = art.cx ?? 0.5;
  const cy = art.cy ?? 0.5;
  return {
    box,
    portrait,
    ring,
    // The opening's centre is (cx, cy) of the canvas; put it on the box's.
    ringLeft: box / 2 - cx * ring,
    ringTop: box / 2 - cy * ring,
    art,
  };
}

/**
 * @param {object} tier       a BORDER_TIERS entry (or pass borderKey / level)
 * @param {string} borderKey  tier key
 * @param {number} level      derive the tier from a level
 * @param {number} size       the portrait's diameter
 * @param {number} width      stroke width of the drawn SVG ring (no-art tiers)
 * @param {'portrait'|'art'} anchor
 *   'portrait' (default) centres the portrait and moves the ring to it.
 *   'art' centres the ring ART in the box instead — for showing a ring on its
 *   own (a border reward), where there is no face to line up with and the
 *   whole drawing, crown included, should sit in the middle of its tile.
 */
export default function PortraitBorder({
  tier,
  level,
  borderKey,
  size = 72,
  width,
  anchor = 'portrait',
  children,
  style,
  accessible,
  accessibilityLabel,
}) {
  const a11y = accessible ? { accessible: true, accessibilityRole: 'image', accessibilityLabel } : null;
  const t = tier || (borderKey ? borderByKey(borderKey) : borderForLevel(level || 0));
  const geo = frameGeometry(t.key, size);

  if (geo.art) {
    const { box, portrait, ring, art } = geo;
    // For 'art', slide both layers together so the canvas is centred; the
    // portrait still sits exactly in the opening.
    const shiftX = anchor === 'art' ? box / 2 - (geo.ringLeft + ring / 2) : 0;
    const shiftY = anchor === 'art' ? box / 2 - (geo.ringTop + ring / 2) : 0;
    const scale = portrait / size;
    return (
      <View style={[{ width: box, height: box }, style]} {...a11y}>
        {/* The portrait: laid out at the caller's `size` (so a bust decodes
            and positions its layers exactly as it would anywhere else) and
            scaled about the box's centre only when the frame cap bites. */}
        <View
          style={{
            position: 'absolute',
            left: (box - size) / 2 + shiftX,
            top: (box - size) / 2 + shiftY,
            width: size,
            height: size,
            alignItems: 'center',
            justifyContent: 'center',
            transform: scale === 1 ? undefined : [{ scale }],
          }}
        >
          {children}
        </View>
        <Image
          source={art.src}
          style={{
            position: 'absolute',
            left: geo.ringLeft + shiftX,
            top: geo.ringTop + shiftY,
            width: ring,
            height: ring,
          }}
          resizeMode="contain"
          fadeDuration={0}
          pointerEvents="none"
        />
      </View>
    );
  }

  // No art for this tier: a drawn ring, concentric with the portrait by
  // construction, in the same box every other tier uses.
  const box = geo.box;
  const w = width || Math.max(2, Math.round(size * 0.055));
  const isGradient = Array.isArray(t.ring);
  const stops = isGradient ? t.ring : [t.ring, t.ring];
  const r = size / 2 - w / 2;
  const c = box / 2;
  const gid = `pb-${t.key}-${size}`;
  return (
    <View style={[{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }, style]} {...a11y}>
      {children}
      <Svg
        width={box}
        height={box}
        style={{ position: 'absolute', left: 0, top: 0 }}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            {stops.map((col, i) => (
              <Stop key={i} offset={`${(i / Math.max(1, stops.length - 1)) * 100}%`} stopColor={col} stopOpacity="1" />
            ))}
          </LinearGradient>
        </Defs>
        {/* soft halo for premium tiers */}
        {t.glow && (
          <Circle
            cx={c}
            cy={c}
            r={r}
            stroke={isGradient ? t.ring[t.ring.length - 1] : t.ring}
            strokeWidth={w * 2.2}
            strokeOpacity={0.28}
            fill="none"
          />
        )}
        <Circle cx={c} cy={c} r={r} stroke={`url(#${gid})`} strokeWidth={w} fill="none" />
      </Svg>
    </View>
  );
}
