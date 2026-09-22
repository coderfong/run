// PitStopScene — the animated hydration station the shop's stock stands in.
//
// One responsive container of absolutely-positioned layers, every one of them
// decorative: the whole scene is pointerEvents="none" and hidden from screen
// readers. WaterPointStage draws this component and then lays a second,
// interactive layer directly on top of it, in the same box (the nine
// products, the try-on mirror, the restock sign) — that sibling layer owns
// every touch target and every accessibility label the Water Point has.
// Nothing in HERE reads shop data except which item is selected (so the
// crew can react to it), and nothing in here can buy anything.
//
// THE STALL IS PAINTED; EVERYTHING THAT MOVES IS NOT. Two plates carry the
// environment (see PIT_STOP_PLATES) and the whole of the layer order exists to
// put the moving parts between them:
//
//   backdrop plate   sky, canopy, wall, shelves, counter top
//   hanging props    swinging off the painted canopy
//   the crew         cut off at the hip by...
//   counter plate    ...the same painting, from the counter's back edge down
//   the sign         nothing crosses the stall's name
//
// (WaterPointStage's interactive layer then adds the products ON TOP of all
// of this — on the shelves, on the counter, and on a dais dead centre.)
//
// That middle sandwich is the only reason the illustration is cut in two.

import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from '../../ui/image';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import {
  PIT_STOP_ANIM,
  PIT_STOP_COLORS,
  PIT_STOP_LAYOUT,
  PIT_STOP_PLATES,
  SCENE,
  SCENE_VIEW,
} from '../../config/pitStop';
import { useReduceMotion } from '../../ui/motion';
import {
  HangingBottleArt,
  HangingMedalArt,
  OfferCupArt,
  SparkleArt,
} from './PitStopArt';
import { MainAttendant, SupportCharacters } from './PitStopCrew';
import { useActionBeat, useShopkeeperDirector } from './useShopkeeperState';
import { OutlinedText } from '../ui';
import { toon, toonType } from '../../theme';

/** Reference-unit frame -> absolute device-pixel style. */
const layer = (f, scale) => ({
  position: 'absolute',
  left: f.x * scale,
  top: f.y * scale,
  width: f.width * scale,
  height: f.height * scale,
});

/**
 * The FULL scene box, for the two plates.
 *
 * They are sized from SCENE rather than left on `absoluteFill` so that the
 * plates are pinned to the same reference grid every frame is measured in.
 * The stage is exactly this box, but the visible container is NOT (the shop
 * crops the sky, see SCENE_VIEW), and a plate on `absoluteFill` would rescale
 * itself to the container and take the counter's edge out of register with
 * the crew standing behind it.
 */
const sceneBox = (scale) => ({
  position: 'absolute',
  left: 0,
  top: 0,
  width: SCENE.width * scale,
  height: SCENE.height * scale,
});

/** The full box, slid up so the sky above `cropTop` (scene units) leaves the frame. */
const stage = (scale, cropTop) => ({ ...sceneBox(scale), top: -cropTop * scale });

/**
 * One painted plate, laid on the scene box.
 *
 * `resizeMode="stretch"`, not `cover`: the plate IS the scene box, cut at
 * exactly this aspect by scripts/install-pit-stop-art.py, so stretch is a
 * no-op that maps corner to corner. `cover` would let a half-pixel of
 * rounding crop an edge, and the two plates have to agree on where the
 * counter's top line falls or the crew is cut in the wrong place.
 */
const Plate = memo(function Plate({ source, scale }) {
  if (!source) return null;
  return (
    <Image
      source={source}
      style={sceneBox(scale)}
      resizeMode="stretch"
      fadeDuration={0}
      pointerEvents="none"
    />
  );
});

// ---------------------------------------------------------------------------
// Hanging props
// ---------------------------------------------------------------------------

/**
 * A prop that swings from its STRAP, not its middle. Rotating a frame about
 * its centre makes a hanging bottle wag like a metronome needle; shifting the
 * origin to the top edge (down, rotate, back up) is what makes it read as
 * hanging.
 */
const HangingProp = memo(function HangingProp({ frame, scale, sway, active, reduced, children }) {
  const t = useSharedValue(0);
  const height = frame.height * scale;

  useEffect(() => {
    if (!active || reduced) {
      t.value = withTiming(0.5, { duration: 300 });
      return;
    }
    // Start at the configured `from` angle. Beginning at 0.5 made Reanimated
    // reverse between the midpoint and `to`, so the prop only used half of
    // its intended arc. On resume, ease back to `from` before looping.
    t.value = withSequence(
      withTiming(0, { duration: sway.duration * 0.25, easing: Easing.inOut(Easing.sin) }),
      withRepeat(
        withTiming(1, { duration: sway.duration, easing: Easing.inOut(Easing.sin) }),
        -1,
        true
      )
    );
  }, [active, reduced, sway.duration, t]);

  const style = useAnimatedStyle(() => {
    const angle = sway.from + (sway.to - sway.from) * t.value;
    return {
      transform: [
        { translateY: -height / 2 },
        { rotateZ: `${angle}deg` },
        { translateY: height / 2 },
      ],
    };
  });

  return (
    <Animated.View style={[layer(frame, scale), style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
});

// The ambient backdrop layers that used to live here — three seamlessly
// tiling cloud strips drifting behind the canopy, and a vector bunting row
// swaying above it — are gone with the vector sky they were drawn on. The
// painting has its own weather, its own sun and its own bunting, and a strip
// crossing it would slide clouds in front of the treetops. See PIT_STOP_ANIM's
// `sway` block in config/pitStop.js for the rest of that note.

// ---------------------------------------------------------------------------
// The offered cup
// ---------------------------------------------------------------------------

const OfferCup = memo(function OfferCup({ scale, offerPhase, reduced }) {
  const p = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      p.value = 0;
      return;
    }
    const { rise, lower, prep } = PIT_STOP_ANIM.offer;
    if (offerPhase === 'present') {
      p.value = withTiming(1, { duration: rise, easing: Easing.out(Easing.back(1.6)) });
    } else if (offerPhase === 'prep') {
      p.value = withTiming(0.12, { duration: prep, easing: Easing.inOut(Easing.quad) });
    } else {
      p.value = withTiming(0, { duration: lower, easing: Easing.inOut(Easing.quad) });
    }
  }, [offerPhase, reduced, p]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: -4 * p.value },
      { translateY: -10 * p.value },
      { rotateZ: `${-5 * p.value}deg` },
      { scale: 1 + 0.06 * p.value },
    ],
  }));

  return (
    <Animated.View style={[layer(PIT_STOP_LAYOUT.cup, scale), style]} pointerEvents="none">
      <OfferCupArt />
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// Effects — featured glow, sparkles, rare reveal
// ---------------------------------------------------------------------------

const SPARK_SPOTS = [
  { dx: 0.04, dy: 0.1 }, { dx: 0.86, dy: 0.06 }, { dx: 0.5, dy: -0.12 },
  { dx: -0.1, dy: 0.52 }, { dx: 0.98, dy: 0.46 }, { dx: 0.22, dy: -0.06 },
  { dx: 0.72, dy: 0.86 }, { dx: 0.1, dy: 0.88 },
];

/** A one-shot spark burst. Replays whenever `trigger` changes. */
const SparkBurst = memo(function SparkBurst({ frame, scale, trigger, count, color, reduced }) {
  const p = useSharedValue(0);

  useEffect(() => {
    if (!trigger || !count) return;
    if (reduced) {
      // Reduce Motion still gets the feedback, as a plain fade.
      p.value = withSequence(withTiming(1, { duration: 160 }), withDelay(220, withTiming(0, { duration: 260 })));
      return;
    }
    p.value = withSequence(
      withTiming(1, { duration: 140, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 520, easing: Easing.in(Easing.quad) })
    );
  }, [trigger, count, reduced, p]);

  const spots = SPARK_SPOTS.slice(0, count);
  const size = frame.width * scale * 0.22;

  return (
    <View style={layer(frame, scale)} pointerEvents="none">
      {spots.map((s, i) => (
        <Spark key={i} p={p} spot={s} frame={frame} scale={scale} size={size} color={color} index={i} reduced={reduced} />
      ))}
    </View>
  );
});

const Spark = memo(function Spark({ p, spot, frame, scale, size, color, index, reduced }) {
  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [
      { translateY: reduced ? 0 : -p.value * (10 + index * 3) },
      { scale: 0.5 + p.value * 0.7 },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: spot.dx * frame.width * scale - size / 2,
          top: spot.dy * frame.height * scale - size / 2,
          width: size,
          height: size,
        },
        style,
      ]}
      pointerEvents="none"
    >
      <SparkleArt color={color} />
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// Static furniture
// ---------------------------------------------------------------------------

/**
 * The painted stall. Its two shelf pockets — where a stopwatch and a trophy
 * icon used to stand purely as decoration — carry real stock now: see
 * WaterPointStage, which lays two of the nine products at exactly those
 * spots (config/shopStageLayout.js's `shelfLeft`/`shelfRight`), on top of
 * this plate. The route board and race bib that used to hang on the vector
 * wall are gone with the wall's own drawing; the painted wall is bare by
 * design, and three heads in front of it leave no strip wide enough for a
 * readable board.
 */
const StaticEnvironment = memo(function StaticEnvironment({ scale }) {
  return <Plate source={PIT_STOP_PLATES.backdrop()} scale={scale} />;
});

/**
 * The station's name, on a board across the canopy.
 *
 * Drawn with real type rather than baked into the artwork: it stays sharp at
 * every scale, it reads to a screen reader, and the wording is a string rather
 * than a re-export of a PNG. That matters more now than it did — the painting
 * carries no lettering at all, by the rule in docs/SHOP_ASSETS.md, so this is
 * the only place the stall says what it is.
 */
const StationSign = memo(function StationSign({ scale }) {
  const f = PIT_STOP_LAYOUT.sign;
  return (
    <View
      style={layer(f, scale)}
      pointerEvents="none"
      accessible
      accessibilityRole="header"
      accessibilityLabel="Water point"
    >
      <View
        style={{
          flex: 1,
          borderRadius: 18 * scale,
          borderWidth: Math.max(2, 5 * scale),
          borderColor: toon.ink,
          backgroundColor: PIT_STOP_COLORS.signBoard,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* `fit`, because the board is sized in scene units and the type is
            not: at 320pt the size floor lands the word within a few points of
            the board's inner width, and a stall sign that ellipsises is worse
            than one set a little smaller. */}
        <OutlinedText
          style={[toonType.label, { color: '#FFFFFF', fontSize: Math.max(14, 76 * scale) }]}
          outline={toon.ink}
          width={Math.max(2, 4 * scale)}
          containerStyle={{ width: '84%' }}
          fit
        >
          WATER POINT
        </OutlinedText>
      </View>
    </View>
  );
});

/**
 * The counter, from its back edge down. Used to also carry four decorative
 * food/loot props (a coconut, a lootbox, a watermelon, a rack of soda) —
 * they are gone with the counter space they stood in, which is real stock
 * now: WaterPointStage lays six products and the legendary dais along this
 * same plate, ON TOP of it, the same way those props used to stand on it.
 * `restockBeat`/`presentBeat` stay on the SUPPORT CHARACTERS (see
 * SupportCharacters below) — the restocker and helper still bounce on them,
 * they just are not lifting a prop into frame while they do.
 */
const ForegroundCounter = memo(function ForegroundCounter({ scale }) {
  return <Plate source={PIT_STOP_PLATES.counter()} scale={scale} />;
});

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

/**
 * Every prop here feeds the CREW'S REACTION and nothing else — the scene no
 * longer draws the product itself, so it takes what it needs to choose a face
 * and no more.
 *
 * props:
 *   selectedProductId     — which product, only so a NEW pick re-triggers
 *   selectedRarity        — how hard to react when one is bought
 *   isSelectedUnavailable — owned, or not affordable (the apologetic face)
 *   purchaseStatus        — 'idle' | 'pending' | 'success' | 'error'
 *   active                — false when the screen is not focused
 *   headroom              — points of chrome floating over the scene's top
 */
const PitStopScene = memo(function PitStopScene({
  selectedProductId = null,
  selectedRarity = null,
  isSelectedUnavailable = false,
  purchaseStatus = 'idle',
  active = true,
  headroom = 0,
}) {
  const reduced = useReduceMotion();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const scale = width / SCENE.width;
  // The crop, in scene units. Whatever the floating chrome covers is handed
  // back as sky, so the canopy starts below the buttons rather than under
  // them; on a notched phone that is the whole painting.
  const cropTop = Math.max(0, SCENE_VIEW.top - headroom / scale);

  const { state, offerPhase } = useShopkeeperDirector({
    active,
    purchaseStatus,
    selectedProductId,
    selectedRarity,
    isSelectedUnavailable,
  });

  const restockBeat = useActionBeat({
    active: active && !reduced,
    minGap: PIT_STOP_ANIM.restock.minGap,
    maxGap: PIT_STOP_ANIM.restock.maxGap,
    duration: PIT_STOP_ANIM.restock.duration,
  });
  const presentBeat = useActionBeat({
    active: active && !reduced,
    minGap: PIT_STOP_ANIM.present.minGap,
    maxGap: PIT_STOP_ANIM.present.maxGap,
    duration: PIT_STOP_ANIM.present.duration,
  });

  return (
    <View
      style={[styles.scene, { height: (SCENE.height - cropTop) * scale }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* THE STAGE. Every layer below is placed in the FULL scene box; the
          stage is that box slid up by `cropTop`, and this container clips
          what rises past its top edge. That is the whole crop: no frame is
          re-measured for it. */}
      <View style={stage(scale, cropTop)}>
        {/* 01 the painted stall. */}
        <StaticEnvironment scale={scale} />

        {/* 02 hanging props, swinging off the canopy's lower edge in the two
            lanes the crew leaves clear. Both are BEHIND the crew, which is
            what keeps a swinging bottle from crossing a face. */}
        <HangingProp
          frame={PIT_STOP_LAYOUT.hangBottle}
          scale={scale}
          sway={PIT_STOP_ANIM.sway.bottle}
          active={active}
          reduced={reduced}
        >
          <HangingBottleArt color={PIT_STOP_COLORS.bottleTeal} height={PIT_STOP_LAYOUT.hangBottle.height} />
        </HangingProp>
        <HangingProp
          frame={PIT_STOP_LAYOUT.hangMedal}
          scale={scale}
          sway={PIT_STOP_ANIM.sway.medal}
          active={active}
          reduced={reduced}
        >
          <HangingMedalArt />
        </HangingProp>

        {/* 03 support crew */}
        <SupportCharacters
          state={state}
          scale={scale}
          active={active}
          reduced={reduced}
          restockBeat={restockBeat}
          presentBeat={presentBeat}
        />

        {/* 04 the attendant and the cup they offer */}
        <MainAttendant
          state={state}
          offerPhase={offerPhase}
          scale={scale}
          active={active}
          reduced={reduced}
        />
        <OfferCup scale={scale} offerPhase={offerPhase} reduced={reduced} />

        {/* 05 the counter, from its back edge down — the same painting, cut
            here so it lands in FRONT of the crew and takes their legs. The
            products WaterPointStage lays on top of it are what stand on it
            now. */}
        <ForegroundCounter scale={scale} />

        {/* 06 effects.
            THE PRODUCTS ARE NOT DRAWN HERE. This whole component stays
            pointerEvents="none" and hidden from screen readers — the nine
            items, the try-on mirror and the restock sign are a SIBLING
            interactive layer WaterPointStage draws on top of this one (see
            that file's header for why two layers rather than one). What
            stays in here is the crew's own reaction, which is scenery. */}
        {offerPhase === 'present' ? (
          <SparkBurst
            frame={PIT_STOP_LAYOUT.cup}
            scale={scale}
            trigger={`cup-${offerPhase}`}
            count={2}
            color={PIT_STOP_COLORS.stripe}
            reduced={reduced}
          />
        ) : null}

        {/* 07 the station's name, across the canopy, drawn last so nothing
            in the scene crosses it. The art carries no lettering by design
            (see docs/SHOP_ASSETS.md), so this is the stall's only signage —
            and being type rather than paint, it stays sharp at any width and
            reads to a screen reader. */}
        <StationSign scale={scale} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  scene: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: PIT_STOP_COLORS.plateSky,
  },
});

export default PitStopScene;
