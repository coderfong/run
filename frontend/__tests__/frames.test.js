import { frameMiddle, frameScale, sliceLayout } from '../src/ui/ArtFrame';
import {
  FRAME,
  FRAMES,
  FRAME_GROUP,
  framePadding,
  framePose,
  frameVariant,
  getFrame,
} from '../src/ui/frameRegistry';
import { applyReaction } from '../src/hooks/useRunReactions';
import {
  REACTIONS,
  REACTION_PICKER,
  REACTION_STILL_FRAME_INDEX,
  getReactionEffect,
  isReaction,
} from '../src/effects/reactionRegistry';
import { getEffect } from '../src/effects/effectRegistry';

const byKey = (layout) => Object.fromEntries(layout.map((s) => [s.key, s]));

describe('hand-drawn frame registry', () => {
  test('every named frame resolves to art with measured insets', () => {
    for (const name of Object.keys(FRAME)) {
      const spec = getFrame(name);
      expect(spec).toBeTruthy();
      expect(spec.source).toBeTruthy();
      expect(spec.frameCount).toBeGreaterThan(0);
      for (const side of ['left', 'right', 'top', 'bottom']) {
        expect(spec.insets[side]).toBeGreaterThan(0);
      }
      // An inset deeper than half the drawing leaves no middle to stretch, so
      // the frame could only ever be drawn at its source size.
      expect(spec.insets.left + spec.insets.right).toBeLessThan(spec.frameWidth);
      expect(spec.insets.top + spec.insets.bottom).toBeLessThan(spec.frameHeight);
    }
  });

  test('the registry only exposes frames whose art is bundled', () => {
    for (const spec of Object.values(FRAMES)) expect(spec.source).toBeTruthy();
  });

  test('every frame ships both halves — the outline and its paper', () => {
    // A frame with no paper cannot be filled, and a caller that asks for a fill
    // would silently get a frame with a see-through middle.
    for (const spec of Object.values(FRAMES)) expect(spec.paper).toBeTruthy();
  });

  test('the nine slice middle is clear of ink on every frame', () => {
    // Asserted on the numbers the cutter measured rather than on the pixels:
    // if a rule or a stray tick were left inside the insets, it would land in a
    // band that stretches and smear down the side of any box drawn bigger than
    // the source. `cut_frames.py` grows the insets until this holds; this is
    // the check that the manifest it wrote still does.
    for (const spec of Object.values(FRAMES)) {
      expect(spec.minWidth).toBe(spec.insets.left + spec.insets.right);
      expect(spec.minHeight).toBe(spec.insets.top + spec.insets.bottom);
      expect(spec.minWidth).toBeLessThan(spec.frameWidth);
      expect(spec.minHeight).toBeLessThan(spec.frameHeight);
    }
  });

  test('padding clears the ink, and is not the nine slice inset', () => {
    for (const name of Object.keys(FRAME)) {
      const spec = getFrame(name);
      const pad = framePadding(name);
      for (const side of ['left', 'right', 'top', 'bottom']) {
        const key = `padding${side[0].toUpperCase()}${side.slice(1)}`;
        expect(pad[key]).toBeGreaterThanOrEqual(spec.ink[side]);
      }
    }
    // The banner is the case that shows why the two are different numbers: a
    // 45pt bottom inset over a 16pt line, because the inset also has to cover
    // the clipped corner. Padding by the inset put 29pt of dead air under every
    // banner in the app.
    const banner = getFrame('banner');
    expect(banner.insets.bottom).toBeGreaterThan(banner.ink.bottom * 2);
  });

  test('a group deals the same frame for the same seed, and spreads them out', () => {
    expect(frameVariant('chip', 'Runs')).toBe(frameVariant('chip', 'Runs'));
    for (const [group, names] of Object.entries(FRAME_GROUP)) {
      for (const name of names) expect(getFrame(name)).toBeTruthy();
      const dealt = new Set(
        Array.from({ length: 60 }, (_, i) => frameVariant(group, `row-${i}`))
      );
      // Every frame in the group has to come up, or the group is decoration
      // that only ever shows one drawing.
      expect(dealt.size).toBe(names.length);
    }
    expect(frameVariant('nope', 'x')).toBeNull();
  });

  test('still poses are deterministic and use every hand-redrawn source frame', () => {
    expect(framePose('Sign in')).toBe(framePose('Sign in'));
    const dealt = new Set(Array.from({ length: 60 }, (_, i) => framePose(`surface-${i}`)));
    expect(dealt).toEqual(new Set([0, 1, 2]));
    expect(framePose('anything', 1)).toBe(0);
  });
});

describe('nine-slice layout', () => {
  const spec = getFrame('panel');

  test('nothing to draw without a spec or a size', () => {
    expect(sliceLayout(null, 100, 100)).toBeNull();
    expect(sliceLayout(spec, 0, 100)).toBeNull();
    expect(sliceLayout(spec, 100, 0)).toBeNull();
  });

  test('corners are never stretched at a size that has room for them', () => {
    const at = byKey(sliceLayout(spec, 320, 240));
    for (const key of ['tl', 'tr', 'bl', 'br']) {
      // sheetW/sheetH equal to the source frame means a scale factor of 1 —
      // the corner is drawn exactly as it was painted. This is the invariant
      // that separates a nine slice from a stretched image.
      expect(at[key].box.sheetW).toBeCloseTo(spec.frameWidth, 5);
      expect(at[key].box.sheetH).toBeCloseTo(spec.frameHeight, 5);
    }
  });

  test('edges stretch on one axis and match their corners on the other', () => {
    const at = byKey(sliceLayout(spec, 320, 240));
    // The top edge takes its height from the corners it runs between, and only
    // its width changes. Getting this the wrong way round is what makes a
    // frame look like a squashed screenshot of itself.
    expect(at.top.box.sheetH).toBeCloseTo(at.tl.box.sheetH, 5);
    expect(at.bottom.box.sheetH).toBeCloseTo(at.bl.box.sheetH, 5);
    expect(at.left.box.sheetW).toBeCloseTo(at.tl.box.sheetW, 5);
    expect(at.right.box.sheetW).toBeCloseTo(at.tr.box.sheetW, 5);
    expect(at.top.box.sheetW).toBeGreaterThan(spec.frameWidth);
  });

  test('the eight slices tile the border with no gap and no overlap', () => {
    const width = 300;
    const height = 220;
    const at = byKey(sliceLayout(spec, width, height));
    const drawn = (slice) => ({
      left: slice.box.left,
      top: slice.box.top,
      width: slice.rect.w * (slice.box.sheetW / spec.frameWidth),
      height: slice.rect.h * (slice.box.sheetH / spec.frameHeight),
    });

    const tl = drawn(at.tl);
    const tr = drawn(at.tr);
    const top = drawn(at.top);
    const bl = drawn(at.bl);
    const left = drawn(at.left);

    // Top run: corner, edge, corner — meeting exactly, and spanning the box.
    expect(tl.left + tl.width).toBeCloseTo(top.left, 5);
    expect(top.left + top.width).toBeCloseTo(tr.left, 5);
    expect(tr.left + tr.width).toBeCloseTo(width, 5);
    // Left run does the same vertically.
    expect(tl.top + tl.height).toBeCloseTo(left.top, 5);
    expect(left.top + left.height).toBeCloseTo(bl.top, 5);
    expect(bl.top + bl.height).toBeCloseTo(height, 5);
  });

  test('a box smaller than its own corners splits it instead of overlapping', () => {
    // 20pt wide against a panel whose corners are dozens of points: the two
    // corners have to share the width rather than each taking their full size
    // and crossing over the middle.
    const layout = sliceLayout(spec, 20, 20);
    const at = byKey(layout);
    const w = (slice) => slice.rect.w * (slice.box.sheetW / spec.frameWidth);
    expect(w(at.tl) + w(at.tr)).toBeLessThanOrEqual(20 + 1e-6);
    // Zero-length edges are dropped rather than drawn as empty images.
    for (const slice of layout) {
      expect(slice.box.sheetW).toBeGreaterThan(0);
      expect(slice.box.sheetH).toBeGreaterThan(0);
    }
  });
});

describe('fitting a frame to a box too small for it', () => {
  // This is the bug the fit exists for. `label` is a 150x61 drawing whose top
  // and bottom corners want 33pt between them; drawn round a line of heading
  // text about 30pt tall, the eight slices had nothing left between them and
  // piled up into a blot with the title sitting on top of it.
  const label = getFrame('label');

  test('the corners always leave a middle to stretch, at any size', () => {
    for (const name of Object.keys(FRAME)) {
      const frame = getFrame(name);
      for (const [width, height] of [[320, 240], [140, 44], [90, 30], [40, 28], [24, 24]]) {
        const middle = frameMiddle(frame, width, height);
        expect(middle.width).toBeGreaterThan(0);
        expect(middle.height).toBeGreaterThan(0);
        // Every slice still lands inside the box it was given.
        for (const s of sliceLayout(frame, width, height)) {
          const drawnW = s.rect.w * (s.box.sheetW / frame.frameWidth);
          const drawnH = s.rect.h * (s.box.sheetH / frame.frameHeight);
          expect(s.box.left + drawnW).toBeLessThanOrEqual(width + 1e-6);
          expect(s.box.top + drawnH).toBeLessThanOrEqual(height + 1e-6);
        }
      }
    }
  });

  test('a roomy box is drawn at the scale it was asked for', () => {
    expect(frameScale(label, 320, 240)).toBe(1);
    expect(frameScale(label, 320, 240, 2)).toBe(2);
  });

  test('a cramped box scales the whole frame down rather than clipping corners', () => {
    // 30pt tall against 33pt of corner. Scaling down is what keeps this a
    // drawing of a box instead of two corners meeting in the middle.
    const fitted = frameScale(label, 300, 30);
    expect(fitted).toBeLessThan(1);
    const at = byKey(sliceLayout(label, 300, 30));
    // Both corners keep their aspect: scaled equally on x and y, never squashed
    // on one axis to fit.
    for (const key of ['tl', 'tr', 'bl', 'br']) {
      const sx = at[key].box.sheetW / label.frameWidth;
      const sy = at[key].box.sheetH / label.frameHeight;
      expect(sx).toBeCloseTo(sy, 1);
    }
  });

  test('the fit only ever shrinks — it never inflates a frame to fill a box', () => {
    expect(frameScale(label, 4000, 4000)).toBe(1);
  });

  test('nothing to fit without a spec or a size', () => {
    expect(frameScale(null, 100, 100)).toBe(0);
    expect(frameScale(label, 0, 100)).toBe(0);
    expect(frameMiddle(label, 100, 0)).toBeNull();
  });
});

describe('emote reactions', () => {
  test('every offered emote has art', () => {
    for (const emote of REACTION_PICKER) {
      expect(isReaction(emote)).toBe(true);
      expect(getEffect(getReactionEffect(emote))?.source).toBeTruthy();
    }
  });

  test('every key the server may send back still resolves to art', () => {
    // The allowlist in backend/app/reactions.py accepts every key the client
    // can DRAW, not just the eight on the picker — retired keys are already
    // sitting in people's reaction rows. One that no longer maps to a sheet
    // is a blank box on a feed card, so the whole table has to hold.
    for (const emote of Object.keys(REACTIONS)) {
      expect(getEffect(getReactionEffect(emote))?.source).toBeTruthy();
    }
  });

  test('the shared still frame is inside every sheet', () => {
    // One index for the whole pack only works because every sheet in it runs
    // the same timing. If a future pack breaks that, this catches it before a
    // chip renders an empty padding cell.
    for (const emote of Object.keys(REACTIONS)) {
      const spec = getEffect(getReactionEffect(emote));
      expect(REACTION_STILL_FRAME_INDEX).toBeLessThan(spec.frameCount);
      expect(REACTION_STILL_FRAME_INDEX).toBeGreaterThanOrEqual(0);
    }
  });

  test('leaving a reaction adds it and marks it as yours', () => {
    expect(applyReaction([], null, 'love')).toEqual([{ emote: 'love', count: 1, mine: true }]);
  });

  test('swapping moves the count rather than adding a second of yours', () => {
    const before = [
      { emote: 'love', count: 2, mine: true },
      { emote: 'brutal', count: 1, mine: false },
    ];
    const after = applyReaction(before, 'love', 'brutal');
    expect(after).toEqual([
      { emote: 'brutal', count: 2, mine: true },
      { emote: 'love', count: 1, mine: false },
    ]);
  });

  test('clearing removes the emote entirely when you were the only one', () => {
    expect(applyReaction([{ emote: 'love', count: 1, mine: true }], 'love', null)).toEqual([]);
  });

  test('clearing leaves everybody else behind', () => {
    const after = applyReaction([{ emote: 'love', count: 3, mine: true }], 'love', null);
    expect(after).toEqual([{ emote: 'love', count: 2, mine: false }]);
  });

  test('only one emote is ever marked as yours', () => {
    const after = applyReaction(
      [{ emote: 'love', count: 1, mine: true }, { emote: 'wow', count: 4, mine: false }],
      'love',
      'wow'
    );
    expect(after.filter((row) => row.mine)).toHaveLength(1);
    expect(after.find((row) => row.mine).emote).toBe('wow');
  });

  test('chips stay ordered loudest first, so they do not reshuffle on sync', () => {
    const after = applyReaction(
      [{ emote: 'love', count: 1, mine: false }, { emote: 'wow', count: 5, mine: false }],
      null,
      'love'
    );
    expect(after.map((row) => row.emote)).toEqual(['wow', 'love']);
  });
});
