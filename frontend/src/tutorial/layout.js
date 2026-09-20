// Where the card and the runner go, given a hole in the screen.
//
// Pure functions, no React, no measuring — everything is decided from four
// numbers and handed back as absolute positions. That is what makes "the
// bubble must never run off a small phone" something a test can hold rather
// than something you find out on a borrowed iPhone SE.
//
// COORDINATES ARE WINDOW COORDINATES throughout: `measureInWindow` gives them,
// the overlay is a full-window absolute layer, so no conversion happens
// anywhere. If a caller ever has view-relative numbers it converts them before
// it gets here, not after.

// Breathing room between the spotlight and the card. Enough that the card
// reads as pointing at the hole rather than as touching it.
export const CARD_GAP = 14;
// Air kept between the card and the screen's usable edges.
export const EDGE = 16;
// The card never gets wider than this however big the phone is: a 420pt line
// of 15pt type is past the comfortable reading measure, and the copy here is
// deliberately two short sentences.
export const CARD_MAX_W = 340;
// What the card is assumed to be before it has measured itself. Only ever wrong
// for the first frame of an entrance that is fading in anyway.
export const CARD_ESTIMATE_H = 132;

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * The card's width for this screen.
 */
export function cardWidth(screen) {
  return Math.min(CARD_MAX_W, Math.max(240, screen.width - EDGE * 2));
}

/**
 * Place the speech card relative to a spotlight rect.
 *
 * `rect` is the spotlight (already padded), or null for a step with no target,
 * which centres the card. `insets` are the safe-area insets.
 *
 * Returns `{ top, left, width, side }`, where `side` is 'above' | 'below' |
 * 'center' — the card's own tail/arrow reads it, and so do the tests.
 *
 * THE RULE, in order:
 *   1. below the target, if the card fits between it and the bottom inset;
 *   2. above the target, if it fits between the top inset and it;
 *   3. whichever side has more room, clamped on screen. A target taller than
 *      the screen (the map board) lands here, and lands correctly: the card
 *      sits over the spotlight rather than off the edge of the phone.
 */
export function placeCard({ rect, screen, insets, height = CARD_ESTIMATE_H, gap = CARD_GAP }) {
  const width = cardWidth(screen);
  const minTop = insets.top + EDGE;
  const maxTop = screen.height - insets.bottom - EDGE - height;
  const left = clamp(
    rect ? rect.x + rect.width / 2 - width / 2 : screen.width / 2 - width / 2,
    insets.left + EDGE,
    screen.width - insets.right - EDGE - width
  );

  if (!rect) {
    return {
      left,
      top: clamp(screen.height / 2 - height / 2, minTop, Math.max(minTop, maxTop)),
      width,
      side: 'center',
    };
  }

  const below = rect.y + rect.height + gap;
  const above = rect.y - gap - height;

  // Clamped on BOTH branches, not just at the fallback. A target that is
  // partly off the top of the screen (a control under the notch, a view
  // measured mid transition) produces a "below" that is still above the safe
  // area, and an unclamped card would render under the status bar.
  if (below <= maxTop) return { left, top: Math.max(minTop, below), width, side: 'below' };
  if (above >= minTop) return { left, top: Math.min(maxTop, above), width, side: 'above' };

  // Neither side fits. Take the bigger gap and clamp into it; the card will
  // overlap the spotlight, which is the right failure — an unreadable card off
  // the bottom of the screen teaches nothing.
  const roomBelow = screen.height - insets.bottom - EDGE - (rect.y + rect.height);
  const roomAbove = rect.y - minTop;
  const side = roomBelow >= roomAbove ? 'below' : 'above';
  const top = side === 'below'
    ? clamp(below, minTop, Math.max(minTop, maxTop))
    : clamp(above, minTop, Math.max(minTop, maxTop));
  return { left, top, width, side };
}

/**
 * Where the runner stands, given the card that has just been placed.
 *
 * They stand ON the card's top edge, at whichever end is closer to the
 * spotlight, so the character reads as having walked over to point at it. A
 * card with no target puts them on the left, which is where they stand
 * everywhere else in the app.
 *
 * `facing` is +1 when the thing being explained is to their right, -1 when it
 * is to their left; the rig is mirrored by it, so the runner always looks
 * toward what the card is about.
 */
export function placeCoach({ rect, card, screen, insets, width, height, minHeight = 76 }) {
  const cardCenter = card.left + card.width / 2;
  const targetCenter = rect ? rect.x + rect.width / 2 : cardCenter;

  // Feet ON the card's top edge, with a little overlap so they are standing on
  // it rather than hovering above it.
  const overlapOf = (h) => Math.round(h * 0.07);
  const ceiling = insets.top + 2;

  // SHRINK BEFORE CLIPPING. When the card is near the top of the screen there
  // may not be room for a full-height runner above it; a clamped `top` would
  // slide them down over their own speech card and cover the first line of it.
  // So they get smaller instead, and below a floor they step off the screen
  // entirely — the card is the part that has to be readable.
  let h = height;
  let top = card.top - h + overlapOf(h);
  if (top < ceiling) {
    h = Math.max(0, card.top - ceiling + overlapOf(height));
    top = ceiling;
  }
  if (h < minHeight) return { visible: false, left: 0, top: 0, width: 0, height: 0, facing: 1 };

  const w = Math.round(width * (h / height));
  // Stand at the end of the card nearest the target, tucked in from the corner.
  const inset = Math.round(w * 0.25);
  const onLeft = targetCenter <= cardCenter;
  const left = clamp(
    onLeft ? card.left + inset : card.left + card.width - w - inset,
    EDGE,
    Math.max(EDGE, screen.width - EDGE - w)
  );

  // Looking at the hole. With no hole they look into their own card.
  const standCenter = left + w / 2;
  const facing = targetCenter >= standCenter ? 1 : -1;

  return { visible: true, left, top, width: w, height: h, facing };
}

/**
 * Grow a measured target rect into the spotlight that will be drawn around it.
 *
 * `pad` is the 8 to 16 points of air the spec asks for; small targets get the
 * generous end of it so a 34pt icon does not end up with a cutout that traces
 * its edges. Clamped to the window so a target running off screen (a control
 * under the notch) still produces a drawable rect.
 */
export function spotlightRect(rect, screen, { pad = 12, minPad = 8, maxPad = 18 } = {}) {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const small = Math.min(rect.width, rect.height);
  const p = clamp(small < 56 ? pad + 4 : pad, minPad, maxPad);
  const x = rect.x - p;
  const y = rect.y - p;
  const width = rect.width + p * 2;
  const height = rect.height + p * 2;

  // Trim, rather than shift: a spotlight that slid back on screen would stop
  // being over the thing it is pointing at.
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(screen.width, x + width);
  const bottom = Math.min(screen.height, y + height);
  if (right - left <= 0 || bottom - top <= 0) return null;

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    // Rounded, and never more than half the short side, or the corner arcs
    // meet and the rect renders as a lozenge with a pinched middle.
    radius: Math.min(22, (bottom - top) / 2, (right - left) / 2),
  };
}

/**
 * The four blocker slabs around a hole: everything except the hole itself.
 *
 * React Native has no way to make one view transparent to touches in the
 * middle and opaque at the edges, so the scrim that BLOCKS is four views with
 * a gap in them, and the scrim that is SEEN is a separate, touch-transparent
 * drawing on top. Keeping them apart is what lets the real Start button under
 * the hole take a real press — there is simply nothing over it.
 */
export function blockerSlabs(rect, screen, { safeTop = 0 } = {}) {
  // NOTHING IS EVER BLOCKED ABOVE `safeTop`. That strip is where the close
  // button and the back button live, and an action step that covered it would
  // be a trap: a runner who wants to discard the run the tutorial is talking
  // about could not reach the one control that does it. The dim is still drawn
  // up there — it is only the touches that pass.
  if (!rect) {
    return [{ left: 0, top: safeTop, width: screen.width, height: Math.max(0, screen.height - safeTop) }];
  }
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const sideTop = Math.max(rect.y, safeTop);
  const sideHeight = Math.max(0, bottom - sideTop);
  return [
    { left: 0, top: safeTop, width: screen.width, height: Math.max(0, rect.y - safeTop) },
    { left: 0, top: bottom, width: screen.width, height: Math.max(0, screen.height - bottom) },
    { left: 0, top: sideTop, width: Math.max(0, rect.x), height: sideHeight },
    { left: right, top: sideTop, width: Math.max(0, screen.width - right), height: sideHeight },
  ].filter((s) => s.width > 0 && s.height > 0);
}

/**
 * The scrim path: the whole window, with a rounded rectangle cut out of it.
 *
 * ONE PATH WITH TWO SUBPATHS AND `fillRule="evenodd"`, not an SVG <Mask> and
 * not a <ClipPath>. The same choice, for the same reason, as the claim reveal
 * (components/claim/TerritoryRevealCanvas.js): a ClipPath's children union
 * rather than subtract, and Mask support has been the patchier of the two
 * across platforms. Evenodd is plain path data — it draws identically
 * everywhere and animates as a string.
 */
// A WORKLET, AND SELF CONTAINED. The spotlight rebuilds this string on the UI
// thread as the hole travels between two targets, which is the technique the
// claim reveal already ships (components/claim/TerritoryRevealCanvas.js builds
// its clip `d` in a worklet).
//
// It calls NOTHING. The obvious shape — a worklet calling the exported
// `roundedRectPath` below — does not survive: the imported binding is not
// captured, and the call comes back "roundedRectPath is not a function". That
// is a caught test failure here and a silent SIGABRT in a release build, where
// Reanimated's worklet error guard is compiled out. So the rectangle is built
// inline, with nothing but arithmetic and template literals in reach, and
// `roundedRectPath` stays a plain function for the JS-side callers and for the
// test that holds the two to the same output.
export function scrimPath(rect, screen) {
  'worklet';

  const outer = `M0,0 H${screen.width} V${screen.height} H0 Z`;
  if (!rect) return outer;

  const { x, y, width, height } = rect;
  const radius = rect.radius || 0;
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const hole = r <= 0
    ? `M${x},${y} H${x + width} V${y + height} H${x} Z`
    : `M${x + r},${y} `
      + `H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} `
      + `V${y + height - r} A${r},${r} 0 0 1 ${x + width - r},${y + height} `
      + `H${x + r} A${r},${r} 0 0 1 ${x},${y + height - r} `
      + `V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
  return `${outer} ${hole}`;
}

/**
 * A closed rounded-rectangle subpath.
 *
 * The readable version, used off the UI thread and by the test that pins
 * `scrimPath`'s inlined copy to it. Keep the two in step: the test fails if
 * they ever disagree.
 */
export function roundedRectPath({ x, y, width, height, radius = 0 }) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (r <= 0) return `M${x},${y} H${x + width} V${y + height} H${x} Z`;
  return (
    `M${x + r},${y} ` +
    `H${x + width - r} A${r},${r} 0 0 1 ${x + width},${y + r} ` +
    `V${y + height - r} A${r},${r} 0 0 1 ${x + width - r},${y + height} ` +
    `H${x + r} A${r},${r} 0 0 1 ${x},${y + height - r} ` +
    `V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`
  );
}
