// shopStageLayout — where the nine products, the try-on mirror and the
// restock sign stand INSIDE the Water Point, measured against the real
// painted plates (assets/art/shop/pitstop-{backdrop,counter}.png) the same
// way every other frame in config/pitStop.js is.
//
// WHY THIS IS A SEPARATE FILE FROM pitStop.js. The environment's own layout
// (the crew, the hanging props, the sign) is a closed, already-tuned system —
// every number in PIT_STOP_LAYOUT was measured once against the painting and
// cross-checked against the crew's own geometry (see that file's landmark
// comment). Product placement is a different, newer problem — nine anchors
// that have to dodge three character bodies and two tent poles — and giving
// it its own file means changing a product's spot can never accidentally
// shift the sign or the hanging medal.
//
// THE COUNTER IS THE SHOP NOW. Both painted shelves are real estate, but the
// restocker and helper stand directly in front of most of each one — the
// crew's own bodies (see PIT_STOP_LAYOUT's landmark note: hips at
// `y + 1.79 * w`) cover roughly x310-525 on the left wall and x1002-1222 on
// the right, leaving only the narrow pocket at each end clear. That pocket is
// exactly one item wide, not three — so this puts ONE featured item on each
// shelf (where the old stopwatch/trophy icons stood) and the other SIX plus
// the legendary on the counter, which is clear along its whole width because
// the counter plate is drawn AFTER the crew specifically to cut them off at
// the hip (see PitStopScene's layer order note).
//
// THE CUP-OFFER LANE IS RESERVED. The keeper's idle cup-offer animation
// reaches to x960 (PIT_STOP_LAYOUT.cup); no product anchor may sit in
// x870-1050, offer cycle or not, or a present cup and a product pop at the
// same spot.

import { frame, PIT_STOP_LAYOUT, SCENE } from './pitStop';

// ---------------------------------------------------------------------------
// The nine product anchors
// ---------------------------------------------------------------------------
//
// `slot: 'legendary'` marks the one dais anchor — ShopStage always sends its
// HIGHEST-rarity shown item there, not literally "a legendary or nothing":
// SHELF_MIX guarantees a rarity spread, not that the server's current window
// contains one. The other eight fill in shelf-then-counter order.
//
// Every anchor is `{x, y}` in SCENE reference units (the same 1536x1490 box
// PIT_STOP_LAYOUT is measured in) plus `size`, the product art's width —
// height follows PartThumb's own square aspect. `anchor: 'bottom-center'`
// through `frame()` the same way every standing prop in pitStop.js is placed.

export const PRODUCT_ANCHORS = [
  // Shelf pockets — the one clear patch of wall on each side, where the
  // decorative stopwatch/trophy icons used to stand.
  { id: 'shelfLeft', region: 'shelf', ...frame({ x: 252, y: 920, width: 96, height: 96, anchor: 'bottom-center' }) },
  { id: 'shelfRight', region: 'shelf', ...frame({ x: 1276, y: 924, width: 96, height: 96, anchor: 'bottom-center' }) },

  // Counter, left of the legendary dais. Clear of the restocker (who stands
  // at x418, hips well behind the counter's own front edge).
  { id: 'counterL1', region: 'counter', ...frame({ x: 360, y: 1300, width: 92, height: 92, anchor: 'bottom-center' }) },
  { id: 'counterL2', region: 'counter', ...frame({ x: 470, y: 1300, width: 92, height: 92, anchor: 'bottom-center' }) },
  { id: 'counterL3', region: 'counter', ...frame({ x: 580, y: 1300, width: 92, height: 92, anchor: 'bottom-center' }) },

  // Counter, right of the cup lane. Clear of the helper (x1112) and the
  // right tent pole (x1410).
  { id: 'counterR1', region: 'counter', ...frame({ x: 1130, y: 1300, width: 92, height: 92, anchor: 'bottom-center' }) },
  { id: 'counterR2', region: 'counter', ...frame({ x: 1240, y: 1300, width: 92, height: 92, anchor: 'bottom-center' }) },
  { id: 'counterR3', region: 'counter', ...frame({ x: 1350, y: 1300, width: 92, height: 92, anchor: 'bottom-center' }) },

  // The dais. Dead centre, biggest footprint, directly in front of the
  // keeper — the one spot in the scene built to carry a "this is the good
  // one" read. Takes whatever the shelf is showing with the HIGHEST rarity.
  { id: 'dais', region: 'dais', slot: 'legendary', ...frame({ x: 768, y: 1300, width: 152, height: 152, anchor: 'bottom-center' }) },
];

// ---------------------------------------------------------------------------
// The try-on mirror
// ---------------------------------------------------------------------------
//
// Stood in the one gap wide enough for it: between the left tent pole
// (x96-126) and the restocker (who starts at roughly x310). A standing oval,
// scaled like a fourth crew member — same ground line as the restocker and
// helper (feet at SCENE's `counterTop`, the line the counter plate cuts
// everyone off at) so the runner inside it stands on the same floor they do.
// `centerX`/`bottom`, not a frame() box: the mirror's HEIGHT is a ratio of
// its own width (an oval sized to hold a standing runner), decided by the
// component, so there is no fixed height to hand frame() up front. `bottom`
// is the ground line every crew member's feet already stand on
// (SCENE.counterTop), so the runner inside the glass shares their floor.
export const TRY_ON_MIRROR = { centerX: 210, bottom: SCENE.counterTop, width: 150 };

// ---------------------------------------------------------------------------
// The restock sign
// ---------------------------------------------------------------------------
//
// A small board hanging off the awning's right half, clear of the WATER
// POINT sign (x448-1088) and clear of the painted bunting baked into the top
// of the plate itself (which sits above y260 in the source art — this board
// sits at y380-520, ON the striped canopy face, below the bunting's lowest
// point and above the crew's heads).
export const RESTOCK_SIGN = frame({ x: 1266, y: 450, width: 232, height: 150, anchor: 'bottom-center' });

// ---------------------------------------------------------------------------
// Dialogue bubble anchors — one per crew member, keyed to PIT_STOP_LAYOUT so
// they can never drift from where the body they're anchored to actually is.
// ---------------------------------------------------------------------------

export const DIALOGUE_ANCHOR = {
  seller: PIT_STOP_LAYOUT.keeper,
  friend: PIT_STOP_LAYOUT.helper,
  chill: PIT_STOP_LAYOUT.restocker,
};

export { SCENE };
