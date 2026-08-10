// PitStopScene — the animated hydration station above the shop stock.
//
// One responsive container, fifteen bands of absolutely-positioned layers,
// every one of them decorative: the whole scene is pointerEvents="none" and
// hidden from screen readers, so the product grid below owns every touch
// target and every accessibility label. Nothing in here reads shop data except
// the selected item's art, and nothing in here can buy anything.
//
// Layer order follows the brief back-to-front, and the reason it matters is
// depth: the crew is drawn between the counter's top surface and its front
// face, so the counter cuts them off at the hip the way a real table would.

import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from '../../ui/image';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import {
  PIT_STOP_ANIM,
  PIT_STOP_ART_OVERRIDES,
  PIT_STOP_COLORS,
  PIT_STOP_ICON_PROPS,
  PIT_STOP_LAYOUT,
  SCENE,
  SCENE_ASPECT,
} from '../../config/pitStop';
import { art } from '../../config/onboardingArt';
import { ICONS } from '../AppIcon';
import { useReduceMotion } from '../../ui/motion';
import GameAnimation from '../GameAnimation';
import {
  BackgroundLayer,
  BackWallLayer,
  BuntingArt,
  CounterBaseLayer,
  CounterFrontLayer,
  HangingBottleArt,
  HangingMedalArt,
  OfferCupArt,
  RaceBibArt,
  RouteBoardArt,
  SparkleArt,
  TentLayer,
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
 * The FULL scene box, for layers that draw the whole 1536x1146.
 *
 * These cannot use `absoluteFill`. The container is deliberately shorter than
 * the scene — it crops the bottom of the counter skirt (SCENE.visibleHeight) —
 * and a full-scene SVG stretched to fill that shorter box would shrink its
 * viewBox to fit and slide every drawn edge out of register with the crew and
 * props, which are positioned in reference units. Pinning to SCENE.height
 * makes the container clip the art instead of resizing it.
 */
const sceneBox = (scale) => ({
  position: 'absolute',
  left: 0,
  top: 0,
  width: SCENE.width * scale,
  height: SCENE.height * scale,
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

// ---------------------------------------------------------------------------
// Ambient backdrop — the many small moving parts behind the crew
// ---------------------------------------------------------------------------

/**
 * A free-running 0->1 ramp. Linear on purpose: the easing belongs to each
 * part's own interpolation, and a ramp that eased would make everything
 * hanging on it pause in step. Only the sky uses it now — the garland that
 * used to share it is a self-animating clip.
 */
function useAmbientClock(active, reduced, duration) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!active || reduced) {
      cancelAnimation(t);
      t.value = withTiming(0, { duration: 300 });
      return;
    }
    t.value = 0;
    t.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [active, reduced, duration, t]);
  return t;
}

// The band is one still frame of a repeating cloud strip. Resolving its real
// pixel size rather than hardcoding a ratio means recropping the art can never
// silently squash the sky.
const CLOUD_BAND = art('pitStopCloudBand');
const CLOUD_BAND_SIZE = CLOUD_BAND ? Image.resolveAssetSource(CLOUD_BAND) : null;
const CLOUD_BAND_ASPECT =
  CLOUD_BAND_SIZE && CLOUD_BAND_SIZE.height
    ? CLOUD_BAND_SIZE.width / CLOUD_BAND_SIZE.height
    : 150 / 32;

/**
 * A seamlessly tiling strip of sky, scrolling behind the tent.
 *
 * The supplied clip was a rigid horizontal scroll of a repeating band, so the
 * band ships as ONE still frame and the scroll happens here. That is the whole
 * reason this is a strip rather than a clip: three layers share the one asset
 * at three speeds, and an animated WebP could only ever drift at the rate it
 * was authored at — for a decoder per layer and a megabyte of frames.
 *
 * Enough tiles are laid to cover the scene PLUS ONE, because the strip is
 * translated by up to a full tile: without the spare, the right edge would run
 * out of cloud at the moment before the phase wraps.
 */
const CloudBand = memo(function CloudBand({ clock, spec, scale, reduced }) {
  const tileW = spec.width * scale;
  const tileH = tileW / CLOUD_BAND_ASPECT;
  const tiles = Math.ceil(SCENE.width / spec.width) + 1;

  const style = useAnimatedStyle(() => {
    if (reduced) return { transform: [{ translateX: 0 }] };
    const phase = (clock.value * spec.speed + spec.offset) % 1;
    return { transform: [{ translateX: -phase * tileW }] };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          top: spec.y * scale,
          width: tileW * tiles,
          height: tileH,
          flexDirection: 'row',
          opacity: spec.opacity,
        },
        style,
      ]}
      pointerEvents="none"
    >
      {Array.from({ length: tiles }, (_, i) => (
        <Image
          key={i}
          source={CLOUD_BAND}
          style={{ width: tileW, height: tileH }}
          resizeMode="stretch"
          fadeDuration={0}
        />
      ))}
    </Animated.View>
  );
});

/**
 * Clouds run on their OWN clock, an order of magnitude slower than the
 * garland's — sharing one ramp would have crossed the sky every 11 seconds,
 * which is weather, not drift.
 *
 * With no band art the sky is simply empty, which is the correct degradation:
 * the canopy leaves only a sliver of it showing in the first place.
 */
const DriftingClouds = memo(function DriftingClouds({ scale, active, reduced }) {
  const clock = useAmbientClock(active, reduced, PIT_STOP_ANIM.ambient.cloudTravel);
  if (!CLOUD_BAND) return null;
  return (
    <>
      {PIT_STOP_ANIM.ambient.clouds.map((spec, i) => (
        <CloudBand key={i} clock={clock} spec={spec} scale={scale} reduced={reduced} />
      ))}
    </>
  );
});

const FrontBunting = memo(function FrontBunting({ scale, active, reduced }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (!active || reduced) {
      t.value = withTiming(0, { duration: 300 });
      return;
    }
    t.value = withRepeat(
      withTiming(1, { duration: PIT_STOP_ANIM.sway.bunting.duration, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, [active, reduced, t]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * PIT_STOP_ANIM.sway.bunting.travel }],
  }));
  return (
    <Animated.View style={[sceneBox(scale), style]} pointerEvents="none">
      <BuntingArt />
    </Animated.View>
  );
});

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

const IconProp = memo(function IconProp({ name, frame, scale }) {
  const source = ICONS[name];
  if (!source) return null; // an icon key that no longer exists must not crash the shop
  return (
    <Image
      source={source}
      style={layer(frame, scale)}
      resizeMode="contain"
      fadeDuration={0}
    />
  );
});

/**
 * A full-scene layer that prefers painted art if any has been registered for
 * it, and falls back to the vector drawing otherwise. Today every override is
 * null, so every layer draws itself — this is the seam that lets painted art
 * land one file at a time without touching animation code.
 */
const OverridableLayer = memo(function OverridableLayer({ overrideKey, scale, children }) {
  const source = PIT_STOP_ART_OVERRIDES[overrideKey]?.();
  return (
    <View style={sceneBox(scale)} pointerEvents="none">
      {source ? (
        <Image source={source} style={StyleSheet.absoluteFillObject} resizeMode="cover" fadeDuration={0} />
      ) : (
        children
      )}
    </View>
  );
});

const StaticEnvironment = memo(function StaticEnvironment({ scale, active, reduced }) {
  return (
    <>
      <OverridableLayer overrideKey="background" scale={scale}>
        <BackgroundLayer />
      </OverridableLayer>
      {/* Clouds sit between the sky and the tent, so the canopy crops them —
          which is what reads as "outside" rather than "painted on the wall". */}
      <DriftingClouds scale={scale} active={active} reduced={reduced} />
      <OverridableLayer overrideKey="tent" scale={scale}>
        <TentLayer />
      </OverridableLayer>
      <OverridableLayer overrideKey="backWall" scale={scale}>
        <BackWallLayer />
      </OverridableLayer>
      <View style={layer(PIT_STOP_LAYOUT.routeBoard, scale)} pointerEvents="none">
        <RouteBoardArt />
      </View>
      <View style={layer(PIT_STOP_LAYOUT.raceBib, scale)} pointerEvents="none">
        <RaceBibArt />
      </View>
      <IconProp name={PIT_STOP_ICON_PROPS.stopwatch} frame={PIT_STOP_LAYOUT.stopwatch} scale={scale} />
    </>
  );
});

/**
 * A supplied prop clip standing in a layout frame.
 *
 * Every one of these is SCENERY, not a reaction, so each is registered
 * `selfLooping` in config/gameAnimations.js — which is what makes Reduce
 * Motion hold their first frame instead of clearing the counter. A prop that
 * vanished when you turned motion down would be a missing object, the same
 * rule the OPEN sign is built on.
 */
const PropClip = memo(function PropClip({ name, frame, scale }) {
  return <GameAnimation name={name} size={frame.width * scale} style={layer(frame, scale)} />;
});

/**
 * The station's name, on a board hanging at the peak of the tent.
 *
 * Drawn with real type rather than baked into the artwork: it stays sharp at
 * every scale, it reads to a screen reader, and the wording is a string rather
 * than a re-export of a PNG. The frame is the one the OPEN sign used to
 * occupy, which was already sized and positioned to be legible from the top of
 * the scene.
 */
const StationSign = memo(function StationSign({ scale }) {
  const f = PIT_STOP_LAYOUT.sign;
  // The reserved frame is square (it held a square badge); the board wants a
  // plank, hung under the peak rather than filling the hole.
  const w = f.width * scale;
  const h = f.height * scale * 0.34;
  return (
    <View
      style={[layer(f, scale), { height: h, justifyContent: 'flex-start' }]}
      pointerEvents="none"
      accessible
      accessibilityRole="header"
      accessibilityLabel="Water point"
    >
      <View
        style={{
          width: w,
          height: h,
          borderRadius: 10 * scale,
          borderWidth: Math.max(2, 3 * scale),
          borderColor: toon.ink,
          backgroundColor: PIT_STOP_COLORS.signBoard || '#2C6E8F',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <OutlinedText
          style={[toonType.label, { color: '#FFFFFF', fontSize: Math.max(11, 34 * scale) }]}
          outline={toon.ink}
          width={Math.max(1.5, 2.5 * scale)}
          numberOfLines={1}
        >
          WATER POINT
        </OutlinedText>
      </View>
    </View>
  );
});

const ForegroundCounter = memo(function ForegroundCounter({ scale, restockBeat, presentBeat, reduced }) {
  const lootbox = ICONS[PIT_STOP_ICON_PROPS.lootbox];
  return (
    <>
      <OverridableLayer overrideKey="counterForeground" scale={scale}>
        <CounterFrontLayer />
      </OverridableLayer>
      {/* Left to right along the counter. The lootbox and the soda ride the
          same beats as the characters holding them, so the hands never visibly
          detach from the prop. */}
      <PropClip name="propCoconut" frame={PIT_STOP_LAYOUT.coconut} scale={scale} />
      {lootbox ? (
        <BeatProp frame={PIT_STOP_LAYOUT.lootbox} scale={scale} beat={restockBeat} reduced={reduced} lift={10}>
          <Image source={lootbox} style={StyleSheet.absoluteFillObject} resizeMode="contain" fadeDuration={0} />
        </BeatProp>
      ) : null}
      <PropClip name="propWatermelon" frame={PIT_STOP_LAYOUT.watermelon} scale={scale} />
      <BeatProp frame={PIT_STOP_LAYOUT.sodaBottles} scale={scale} beat={presentBeat} reduced={reduced} lift={8}>
        <GameAnimation name="propSodaBottles" size={PIT_STOP_LAYOUT.sodaBottles.width * scale} />
      </BeatProp>
    </>
  );
});

const BeatProp = memo(function BeatProp({ frame, scale, beat, reduced, lift, children }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: reduced || !beat ? 0 : -beat.value * lift }],
  }));
  return (
    <Animated.View style={[layer(frame, scale), style]} pointerEvents="none">
      {children}
    </Animated.View>
  );
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
 */
const PitStopScene = memo(function PitStopScene({
  selectedProductId = null,
  selectedRarity = null,
  isSelectedUnavailable = false,
  purchaseStatus = 'idle',
  active = true,
}) {
  const reduced = useReduceMotion();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const scale = width / SCENE.width;

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
      style={styles.scene}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* 01–03 background, drifting sky strips, tent, wall + shelves */}
      <StaticEnvironment scale={scale} active={active} reduced={reduced} />

      {/* 04 background hanging props. Nothing is strung across the wall now —
          the bunting on the canopy is the scene's only garland. */}
      <HangingProp
        frame={PIT_STOP_LAYOUT.hangBottleLeft}
        scale={scale}
        sway={PIT_STOP_ANIM.sway.bottleLeft}
        active={active}
        reduced={reduced}
      >
        <HangingBottleArt color={PIT_STOP_COLORS.bottleTeal} height={PIT_STOP_LAYOUT.hangBottleLeft.height} />
      </HangingProp>
      {/* 05 counter surface. Nothing stands on it behind the crew any more:
          the drawn cooler that used to sit here was in the same lane as the
          featured item, so a selected product covered it every time. */}
      <OverridableLayer overrideKey="counterBase" scale={scale}>
        <CounterBaseLayer />
      </OverridableLayer>

      {/* 07 support crew */}
      <SupportCharacters
        state={state}
        scale={scale}
        active={active}
        reduced={reduced}
        restockBeat={restockBeat}
        presentBeat={presentBeat}
      />

      {/* 08–10 the attendant and the cup they offer */}
      <MainAttendant
        state={state}
        offerPhase={offerPhase}
        scale={scale}
        active={active}
        reduced={reduced}
      />
      <OfferCup scale={scale} offerPhase={offerPhase} reduced={reduced} />

      {/* 11 counter front — cuts the crew off at the hip */}
      <ForegroundCounter
        scale={scale}
        restockBeat={restockBeat}
        presentBeat={presentBeat}
        reduced={reduced}
      />

      {/* 12 front hanging props */}
      <HangingProp
        frame={PIT_STOP_LAYOUT.hangBottleRight}
        scale={scale}
        sway={PIT_STOP_ANIM.sway.bottleRight}
        active={active}
        reduced={reduced}
      >
        <HangingBottleArt color={PIT_STOP_COLORS.bottlePink} height={PIT_STOP_LAYOUT.hangBottleRight.height} />
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

      {/* 13 effects.
          THE SELECTED PRODUCT IS NOT DRAWN HERE ANY MORE. It used to rise off
          the counter's left lane, which put the one thing on this screen you
          have to READ — art, name, rarity, price — inside a decorative,
          pointerEvents-none illustration, at whatever size the scene happened
          to be. It has its own card above the wallet now (ShopScreen), where
          the buy button sits next to it and the purchase burst plays over the
          item you actually bought. What is left in here is the crew's
          reaction, which is the part that belongs to the scene. */}
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

      {/* 14 front bunting. The balloons that used to hang beside it are gone
          — the canopy's own bunting is decoration enough, and they were the
          one prop with nothing to do but take a decoder. */}
      <FrontBunting scale={scale} active={active} reduced={reduced} />

      {/* 15 the station's name, on a board hanging from the peak.
          The OPEN sign used to hang here and was removed: the station is never
          closed, so it announced a state with no opposite. What the peak was
          always missing is the one thing a stall sign is for — saying what the
          stall IS. Drawn rather than baked into the art so it stays sharp at
          any scale and the wording can change without a new asset. */}
      <StationSign scale={scale} />
    </View>
  );
});

const styles = StyleSheet.create({
  scene: {
    width: '100%',
    aspectRatio: SCENE_ASPECT,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: PIT_STOP_COLORS.skyBottom,
  },
});

export default PitStopScene;
