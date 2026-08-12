// The hand-drawn box frames, and where their nine slice cuts fall.
//
// Metro needs literal require() calls, so the sources are written out here and
// the geometry is read from the manifest the cutter emits — one file, generated
// by scripts/animations/cut_frames.py, so the insets can never drift from the
// art they were measured on.
//
// Each frame is TWO drawings: the ink (the outline) and the paper (the same box
// filled). They are separate layers because they are coloured separately — the
// ink takes a clan colour or the theme's line colour, the paper takes whatever
// surface the box is sitting on. See ArtFrame for how they stack.

import manifest from '../../assets/frames/frame-manifest.json';

const SOURCES = {
  frame_panel: [require('../../assets/frames/frame_panel.png'), require('../../assets/frames/frame_panel_paper.png')],
  frame_banner: [require('../../assets/frames/frame_banner.png'), require('../../assets/frames/frame_banner_paper.png')],
  frame_banner_left: [require('../../assets/frames/frame_banner_left.png'), require('../../assets/frames/frame_banner_left_paper.png')],
  frame_label: [require('../../assets/frames/frame_label.png'), require('../../assets/frames/frame_label_paper.png')],
  frame_card: [require('../../assets/frames/frame_card.png'), require('../../assets/frames/frame_card_paper.png')],
  frame_badge: [require('../../assets/frames/frame_badge.png'), require('../../assets/frames/frame_badge_paper.png')],
  frame_note: [require('../../assets/frames/frame_note.png'), require('../../assets/frames/frame_note_paper.png')],
  frame_header: [require('../../assets/frames/frame_header.png'), require('../../assets/frames/frame_header_paper.png')],
  frame_ticket: [require('../../assets/frames/frame_ticket.png'), require('../../assets/frames/frame_ticket_paper.png')],
  frame_bubble: [require('../../assets/frames/frame_bubble.png'), require('../../assets/frames/frame_bubble_paper.png')],
  frame_bubble_right: [require('../../assets/frames/frame_bubble_right.png'), require('../../assets/frames/frame_bubble_right_paper.png')],
  frame_stamp: [require('../../assets/frames/frame_stamp.png'), require('../../assets/frames/frame_stamp_paper.png')],
  frame_panel_right: [require('../../assets/frames/frame_panel_right.png'), require('../../assets/frames/frame_panel_right_paper.png')],
  frame_card_right: [require('../../assets/frames/frame_card_right.png'), require('../../assets/frames/frame_card_right_paper.png')],
  frame_ticket_right: [require('../../assets/frames/frame_ticket_right.png'), require('../../assets/frames/frame_ticket_right_paper.png')],
  frame_label_right: [require('../../assets/frames/frame_label_right.png'), require('../../assets/frames/frame_label_right_paper.png')],
  frame_stamp_right: [require('../../assets/frames/frame_stamp_right.png'), require('../../assets/frames/frame_stamp_right_paper.png')],
};

// Friendly names, so callers say what they MEAN rather than which drawing they
// happened to like. Swapping which art backs `panel` is then a one line change
// here instead of a sweep through every screen.
export const FRAME = Object.freeze({
  // Boxes to put things in.
  panel: 'frame_panel',
  panelRight: 'frame_panel_right',
  card: 'frame_card',
  cardRight: 'frame_card_right',
  ticket: 'frame_ticket',
  ticketRight: 'frame_ticket_right',
  // Wide runs: a heading, a hero row, a stat line.
  banner: 'frame_banner',
  bannerLeft: 'frame_banner_left',
  label: 'frame_label',
  labelRight: 'frame_label_right',
  // Wide, with a rule drawn parallel to one edge — a heading with a line under
  // it, or a caption with a line over it, without needing a second element.
  header: 'frame_header',
  note: 'frame_note',
  // Small squares. Three of them, and they are DELIBERATELY interchangeable:
  // see `frameVariant`.
  badge: 'frame_badge',
  stamp: 'frame_stamp',
  stampRight: 'frame_stamp_right',
  // Speech. The tail is at the bottom on the side the name says.
  bubble: 'frame_bubble',
  bubbleRight: 'frame_bubble_right',
});

export const FRAMES = Object.freeze(
  Object.fromEntries(
    Object.entries(manifest.frames)
      .filter(([id]) => SOURCES[id])
      .map(([id, spec]) => [id, Object.freeze({
        ...spec,
        // `source` is the ink, because that is the layer every caller draws;
        // the paper is optional and only appears when a fill is asked for.
        source: SOURCES[id][0],
        paper: SOURCES[id][1],
      })])
  )
);

export function getFrame(name) {
  if (!name) return null;
  return FRAMES[FRAME[name] || name] || null;
}

// Groups of frames that are interchangeable — same job, different drawing.
//
// This is the point of having three small squares that are nearly the same box.
// A row of eight badges all cut from ONE drawing reads as eight copies of a
// sticker, which is the giveaway that the hand-drawn look is a texture rather
// than a drawing. Dealing them round the group breaks that up.
export const FRAME_GROUP = Object.freeze({
  action: ['label', 'labelRight', 'banner', 'bannerLeft'],
  heading: ['label', 'labelRight'],
  chip: ['badge', 'stamp', 'stampRight'],
  box: ['panel', 'panelRight', 'card', 'cardRight', 'ticket', 'ticketRight'],
  featured: ['banner', 'bannerLeft', 'panel', 'panelRight'],
  bubble: ['bubble', 'bubbleRight'],
});

function seedHash(seed) {
  const key = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/**
 * Pick a frame from a group, the same way every time for the same `seed`.
 *
 * Deterministic on purpose: a list that re-rolled its frames on every render
 * would flicker between drawings as it re-renders, and a list that re-rolled on
 * scroll would do it while you watch. Seed it with whatever identifies the row
 * — an id, a name, an index.
 */
export function frameVariant(group, seed) {
  const names = FRAME_GROUP[group];
  if (!names?.length) return null;
  return names[seedHash(seed) % names.length];
}

/**
 * Pick one of the pack's three hand-redrawn poses without animating it.
 * Repeated frames therefore vary even when reduced motion is enabled and when
 * a full boil would be too busy. Like `frameVariant`, this is deterministic so
 * a row never changes shape while it re-renders or scrolls.
 */
export function framePose(seed, frameCount = 3) {
  const count = Math.max(1, Math.trunc(frameCount) || 1);
  return seedHash(`pose:${seed ?? ''}`) % count;
}

// INK WEIGHT.
//
// Every drawing in the pack was made at its own size, so at scale 1 they do not
// agree about how thick a line is: the banner is a 370px drawing with a 19px
// stroke, the badge a 44px drawing with a 12px one. Drawn at their natural size
// side by side, a full width hero wears a 19pt line and the chip next to it a
// 12pt one, and nothing on the screen looks like it came from the same pen.
//
// So a frame is scaled to a LINE WEIGHT rather than to a size. `weightScale`
// works out what scale makes a given drawing come out at `weight` points thick,
// and everything else — the corners, the padding — follows from that. The
// corners shrink with the line, which is right: a fine line drawn round a big
// box has small corners, exactly as it would on paper.
// The numbers are POINTS OF DRAWN LINE, so they read directly: `base` is a
// 5pt stroke, whichever of the pack's drawings is behind it.
//
// The first pass at this set was a third finer (2 / 2.75 / 3.5 / 4.5 / 6) and
// it was too timid — normalising the weights fixed the mismatch but left every
// box looking like a hairline sketch of itself rather than the confident marker
// line the art was drawn with. These are the drawn line's own proportions on a
// phone: a chip carries 3.5pt, a button 5, a hero 6.5.
export const INK = Object.freeze({
  hairline: 3,
  thin: 3.75,
  base: 5,
  bold: 6.5,
  heavy: 8.5,
});

function inkMean(name) {
  const ink = getFrame(name)?.ink;
  if (!ink) return 0;
  return (ink.left + ink.right + ink.top + ink.bottom) / 4;
}

/**
 * The scale at which `name` draws a line `weight` points thick.
 *
 * Returns 1 for an unknown frame or a falsy weight, so a caller that wants the
 * art at its own size just leaves `weight` off.
 */
export function weightScale(name, weight) {
  if (!weight) return 1;
  const mean = inkMean(name);
  if (!mean) return 1;
  return weight / mean;
}

/**
 * How far content has to sit from each edge to clear the drawn line.
 *
 * This is the frame's measured INK depth, and it is deliberately not its inset.
 * The two get confused because both are "a number per side measured off the
 * art", but they answer different questions: an inset is how much of the
 * drawing must not be stretched, ink depth is how thick the line is. The banner
 * is the case that shows the difference — a 45pt bottom inset over a 16pt line,
 * because the inset also has to cover the clipped corner. Padding by the inset
 * put 30pt of dead space under every banner and still let text touch the ink on
 * frames where the ratio went the other way.
 *
 * `extra` is the caller's own breathing room, on top of the clearance.
 */
export function framePadding(name, extra = 0, scale = 1) {
  const ink = getFrame(name)?.ink;
  if (!ink) return { padding: extra };
  const at = (side) => Math.round(ink[side] * scale) + extra;
  return {
    paddingLeft: at('left'),
    paddingRight: at('right'),
    paddingTop: at('top'),
    paddingBottom: at('bottom'),
  };
}
