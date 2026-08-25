import { frameMiddle, frameScale, sliceLayout } from '../src/ui/ArtFrame';
import {
  FRAME,
  FRAMES,
  FRAME_GROUP,
  INK,
  framePadding,
  framePose,
  frameVariant,
  getFrame,
  weightScale,
} from '../src/ui/frameRegistry';
import { fillFor } from '../src/components/ui/Button';
import { frameInkFor } from '../src/components/ui/Framed';
import {
  INK_MIN_CONTRAST,
  brand,
  contrastRatio,
  darkColors,
  lightColors,
  luminance,
  readableInk,
} from '../src/theme';
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

  test('one weight draws the same line on every drawing in the pack', () => {
    // THE BUG THIS EXISTS FOR. Every box in the pack was drawn at its own size,
    // so at scale 1 they disagree wildly about how thick a line is: the banner
    // is a 370px drawing with a ~17px stroke, the badge a 44px drawing with a
    // ~12px one. Drawn at their natural sizes, a full-width hero wore a 17pt
    // line and the chip beside it a 12pt one — "the frame weight doesn't match
    // the buttons", and on a 52pt button the banner's bottom band was over half
    // the button's height with the clipped corner smeared across it as a rule.
    //
    // A weight is a request in POINTS, and it has to come out the same on all
    // seventeen or the whole idea does not work.
    for (const name of Object.keys(FRAME)) {
      const ink = getFrame(name).ink;
      const scale = weightScale(name, INK.base);
      const mean = (ink.left + ink.right + ink.top + ink.bottom) / 4;
      expect(mean * scale).toBeCloseTo(INK.base, 5);
    }
  });

  test('the drawn line spread across the pack collapses under one weight', () => {
    const at = (weight) => Object.keys(FRAME).map((name) => {
      const ink = getFrame(name).ink;
      const mean = (ink.left + ink.right + ink.top + ink.bottom) / 4;
      return mean * weightScale(name, weight);
    });
    const natural = Object.keys(FRAME).map((name) => {
      const ink = getFrame(name).ink;
      return (ink.left + ink.right + ink.top + ink.bottom) / 4;
    });
    const spread = (xs) => Math.max(...xs) - Math.min(...xs);
    // Natural sizes differ by points; normalised they are one number.
    expect(spread(natural)).toBeGreaterThan(3);
    expect(spread(at(INK.base))).toBeCloseTo(0, 5);
  });

  test('no weight means the art at its own size', () => {
    expect(weightScale('panel', false)).toBe(1);
    expect(weightScale('panel', 0)).toBe(1);
    // An unknown frame cannot be measured, so it is left alone rather than
    // scaled to zero — a caller naming a frame that is not in the build should
    // draw nothing, not draw something wrong.
    expect(weightScale('not-a-frame', INK.base)).toBe(1);
  });

  // `undefined` used to be part of the case above, and that is exactly how a
  // real bug stayed invisible: seven call sites asked for `INK.medium`, which
  // was not on the scale, and an undefined lookup on a frozen object is silent.
  // Every one of them landed in "no weight given" and drew the art at its own
  // size — a 12 to 19pt stroke where 3.75 to 6.5 had been asked for.
  //
  // So saying "no weight" and saying nothing are now different. `false` and `0`
  // are somebody stating an intention; `undefined` can only be a property that
  // is not on the scale, so it takes the base line and complains in dev.
  test('a weight that is not on the scale is a mistake, not a request', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(weightScale('panel', undefined)).toBeCloseTo(weightScale('panel', INK.base), 10);
    expect(weightScale('panel', NaN)).toBeCloseTo(weightScale('panel', INK.base), 10);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // Named because it was missing while being used. Every key the app asks for
  // has to resolve to a number, or `weightScale` cannot do its job.
  test('every ink weight the app asks for is on the scale', () => {
    for (const [name, value] of Object.entries(INK)) {
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value) && value > 0).toBe(true);
      expect(name).toBeTruthy();
    }
    expect(INK.medium).toBeGreaterThan(INK.base);
    expect(INK.medium).toBeLessThan(INK.bold);
  });

  test('heavier weights ask for bigger frames, in proportion', () => {
    expect(weightScale('banner', INK.bold) / weightScale('banner', INK.thin))
      .toBeCloseTo(INK.bold / INK.thin, 5);
  });

  test('padding follows the weight, so content clears the line it actually got', () => {
    // Padding is computed at the resolved scale by Framed. If the two ever
    // disagree, either the text sits on the ink or there is a band of dead air
    // round every framed thing in the app — both have shipped before.
    for (const name of Object.keys(FRAME)) {
      const scale = weightScale(name, INK.base);
      const pad = framePadding(name, 0, scale);
      for (const side of ['Left', 'Right', 'Top', 'Bottom']) {
        expect(pad[`padding${side}`]).toBeGreaterThan(0);
        // Nothing needs more than a few points of clearance at this weight;
        // the 30pt banner gutters are what the old inset-based padding gave.
        expect(pad[`padding${side}`]).toBeLessThanOrEqual(Math.ceil(INK.base * 2));
      }
    }
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

describe('a framed button never paints its own background', () => {
  // The bleed this pass exists for: the frame's paper IS the fill — the
  // outline's own wobbly silhouette — so anything underneath it that paints a
  // rounded rectangle shows at every place the drawn line wanders inward.
  test('a hollow variant asks for no paper at all', () => {
    // 'transparent' is a truthy string, which is exactly the trap: it would
    // switch the paper layer on and tint eight Images with it.
    expect(fillFor('outline', 'transparent')).toBeUndefined();
    expect(fillFor('ghost', 'transparent')).toBeUndefined();
    expect(fillFor('primary', undefined)).toBeUndefined();
  });

  test('a filled variant hands its own colour to the paper', () => {
    expect(fillFor('secondary', '#eef0f4')).toBe('#eef0f4');
    expect(fillFor('destructive', '#c8544f')).toBe('#c8544f');
  });

  test('the brand CTA resolves to a flat colour, not a gradient', () => {
    // A gradient cannot be painted into a wobbly silhouette without a mask
    // layer this app does not ship, so the paper takes the first stop. Both
    // stops are the same pink anyway.
    expect(fillFor('gradient', 'anything')).toBe(brand.gradient[0]);
    expect(typeof fillFor('gradient', 'anything')).toBe('string');
  });
});

describe('a drawn line has to be visible on what it is drawn on', () => {
  // The hole this closes: with no tint at all a frame drew its art's own
  // near-black blue, so every unstyled box vanished the moment the app went
  // dark. And a tint chosen once at a call site is right for exactly one
  // surface — a pale clan accent on a white card, or the theme's muted line on
  // a dark one, is a box you cannot see.
  const LIGHT = '#ffffff';
  const DARK = '#0b0d10';

  test('no surface and no tint falls back to the theme, both ways', () => {
    expect(frameInkFor({ scheme: 'dark' })).not.toBe(frameInkFor({ scheme: 'light' }));
    // Light ink on dark, dark ink on light — not the reverse.
    expect(contrastRatio(frameInkFor({ scheme: 'dark' }), DARK)).toBeGreaterThan(4);
    expect(contrastRatio(frameInkFor({ scheme: 'light' }), LIGHT)).toBeGreaterThan(4);
  });

  test('a legible tint is kept, whatever it is', () => {
    // The app would flatten to two colours if this overrode everything.
    expect(frameInkFor({ tint: brand.pink, surface: LIGHT })).toBe(brand.pink);
    expect(frameInkFor({ tint: '#0C0C10', surface: LIGHT })).toBe('#0C0C10');
    expect(frameInkFor({ tint: '#ffffff', surface: '#026493' })).toBe('#ffffff');
  });

  test('an invisible tint is replaced by one that shows', () => {
    const onWhite = frameInkFor({ tint: '#fdfdfd', surface: LIGHT });
    expect(onWhite).not.toBe('#fdfdfd');
    expect(contrastRatio(onWhite, LIGHT)).toBeGreaterThanOrEqual(INK_MIN_CONTRAST);

    const onDark = frameInkFor({ tint: '#111318', surface: DARK });
    expect(onDark).not.toBe('#111318');
    expect(contrastRatio(onDark, DARK)).toBeGreaterThanOrEqual(INK_MIN_CONTRAST);
  });

  test('every surface in the app gets an ink that shows on it', () => {
    const surfaces = [
      lightColors.card, lightColors.bg, lightColors.cardAlt,
      darkColors.card, darkColors.bg, darkColors.cardAlt,
      brand.pink, brand.purple, brand.teal,
      '#026493', // the first-run meadow's sky
      '#000000', '#ffffff',
    ];
    for (const surface of surfaces) {
      for (const tint of [undefined, brand.pink, '#0C0C10', '#ffffff', lightColors.textMuted]) {
        const ink = frameInkFor({ tint, surface, scheme: 'light' });
        expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(INK_MIN_CONTRAST);
      }
    }
  });

  test('an unparseable surface leaves the caller alone rather than guessing', () => {
    expect(frameInkFor({ tint: brand.pink, surface: 'not-a-colour' })).toBe(brand.pink);
    expect(readableInk(undefined, { prefer: brand.teal })).toBe(brand.teal);
  });

  test('translucent colours are understood, not treated as opaque black', () => {
    // GenderStep's cards fill with rgba white over the scene; a parser that
    // failed here would report the surface as unknown and skip the check.
    expect(luminance('rgba(255,255,255,0.16)')).toBeCloseTo(luminance('#ffffff'), 5);
    expect(luminance('#F4F4F7')).toBeGreaterThan(luminance('#0C0C10'));
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
