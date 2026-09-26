// PitStopScene — the animated Water Point the shop is staged in.
//
// PURE ENVIRONMENT. Everything in here is decorative: the whole scene is
// pointerEvents="none" and hidden from screen readers, and nothing in it can
// buy anything. The stock lives in ShopScreen's storefront panel, BELOW the
// scene; nothing is placed on the counter or the shelves any more. The only
// shop state read here is which item is selected and how a purchase went, so
// the crew can react to it.
//
// THE MOVIE IS THE STALL. A looping Seedance clip paints the sky, canopy,
// sign board, shelves, hanging bottles and counter stock (see SHOP_VIDEO in
// config/pitStop.js) — but it is one flat clip, so the counter and the crew
// standing at it both come from the same layer. Drawn over it, in order:
//
//   the crew          live CharacterRigs, clipped at the counter's top edge
//   the offered cup   the keeper's idle gesture
//   the counter       the SAME clip, cropped to the counter strip and drawn
//                      again on top, so the counter and its stock cut the
//                      crew off at the hip instead of the crew painting over
//                      them — what the old two-plate art did for free
//   the chalkboard    a specials line, chalked onto the movie's blank slate
//   the sign          the stall's name, lettered onto the movie's blank board
//
// The background layer and the counter crop share ONE video player
// (`useVideoPlayer` in PitStopScene, passed down), so the two can never
// drift out of sync with each other.

import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Image } from '../../ui/image';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import {
  PIT_STOP_ANIM,
  PIT_STOP_COLORS,
  PIT_STOP_LAYOUT,
  SCENE,
  SCENE_VIEW,
  SHOP_VIDEO_OFFSET,
  SHOP_VIDEO_SCENE_HEIGHT,
} from '../../config/pitStop';
import { useReduceMotion } from '../../ui/motion';
import { OfferCupArt, SparkleArt } from './PitStopArt';
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
 * The FULL scene box. The stage is this box slid up by the crop, so every
 * frame keeps the coordinates it was measured in.
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

/** Everything above the counter's top edge: the crew stand behind it. */
const behindCounter = (scale) => ({
  position: 'absolute',
  left: 0,
  top: 0,
  width: SCENE.width * scale,
  height: SCENE.counterTop * scale,
  overflow: 'hidden',
});

// The movie sits SHOP_VIDEO_OFFSET units above the scene origin; see that
// constant for the measurement. `origin` is how far (scene units) the box
// this is drawn inside sits below the stage itself — 0 for the full-scene
// background, `SCENE.counterTop` for the counter crop below, which needs the
// same video shifted up an extra `counterTop` to keep register with it.
const videoBox = (scale, origin = 0) => ({
  position: 'absolute',
  left: 0,
  top: (-SHOP_VIDEO_OFFSET - origin) * scale,
  width: SCENE.width * scale,
  height: SHOP_VIDEO_SCENE_HEIGHT * scale,
});

// From the counter's back edge down: the counter itself and whatever sits on
// it. Painted plates used to ship as two crops (see PIT_STOP_PLATES) with the
// counter drawn AFTER the crew, so it cut them off at the hip instead of the
// crew painting over the counter stock. The Seedance movie replaced both
// plates with one clip, which lost that ordering — this crops the SAME clip
// to the counter strip and draws it again, on top, to put it back.
const counterForeground = (scale) => ({
  position: 'absolute',
  left: 0,
  top: SCENE.counterTop * scale,
  width: SCENE.width * scale,
  height: (SCENE.height - SCENE.counterTop) * scale,
  overflow: 'hidden',
});

const SHOP_BACKGROUND_VIDEO = require('../../../assets/video/shop-water-point-loop.mp4');
// The clip's own first frame: what shows before the movie decodes, and all
// that shows under Reduce Motion.
const SHOP_BACKGROUND_STILL = require('../../../assets/art/shop/water-point-still.jpg');

const AnimatedEnvironment = memo(function AnimatedEnvironment({ player, scale, reduced }) {
  return (
    <>
      <Image
        source={SHOP_BACKGROUND_STILL}
        style={videoBox(scale)}
        resizeMode="stretch"
        fadeDuration={0}
        pointerEvents="none"
      />
      {!reduced ? (
        <VideoView
          player={player}
          style={videoBox(scale)}
          contentFit="fill"
          nativeControls={false}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
          pointerEvents="none"
        />
      ) : null}
    </>
  );
});

// The same clip, cropped to just the counter strip and drawn AFTER the crew
// (see `counterForeground` above). Bound to the SAME player as the
// background layer — expo-video keeps every view a player drives in sync —
// so the two crops never drift apart.
const CounterForeground = memo(function CounterForeground({ player, scale, reduced }) {
  const inner = videoBox(scale, SCENE.counterTop);
  return (
    <View style={counterForeground(scale)} pointerEvents="none">
      <Image
        source={SHOP_BACKGROUND_STILL}
        style={inner}
        resizeMode="stretch"
        fadeDuration={0}
        pointerEvents="none"
      />
      {!reduced ? (
        <VideoView
          player={player}
          style={inner}
          contentFit="fill"
          nativeControls={false}
          allowsFullscreen={false}
          allowsPictureInPicture={false}
          pointerEvents="none"
        />
      ) : null}
    </View>
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
// The sign
// ---------------------------------------------------------------------------

/**
 * The station's name, lettered onto the blank wooden board the movie hangs
 * across the canopy. Real type rather than paint: it stays sharp at every
 * scale and reads to a screen reader. It is the page's title; the shop has
 * no header text of its own.
 */
const StationSign = memo(function StationSign({ scale }) {
  const f = PIT_STOP_LAYOUT.sign;
  return (
    <View
      style={[layer(f, scale), styles.sign]}
      pointerEvents="none"
      accessible
      accessibilityRole="header"
      accessibilityLabel="Water point"
    >
      <OutlinedText
        style={[toonType.label, { color: '#FFFFFF', fontSize: Math.max(14, 70 * scale) }]}
        outline={toon.ink}
        width={Math.max(2, 4 * scale)}
        containerStyle={{ width: '100%' }}
        fit
      >
        WATER POINT
      </OutlinedText>
    </View>
  );
});

// ---------------------------------------------------------------------------
// The chalkboard
// ---------------------------------------------------------------------------

/**
 * A market-stall specials line, chalked onto the blank slate the movie hangs
 * on the post beside the counter. White straight onto black already has all
 * the contrast a real chalkboard has, so unlike the sign this carries no
 * outline ring.
 */
const ChalkboardText = memo(function ChalkboardText({ scale }) {
  const f = PIT_STOP_LAYOUT.board;
  return (
    <View
      style={[layer(f, scale), styles.board]}
      pointerEvents="none"
      accessible
      accessibilityRole="text"
      accessibilityLabel="Today's special"
    >
      <OutlinedText
        style={[toonType.label, { color: '#FFFFFF', fontSize: Math.max(9, 26 * scale), lineHeight: Math.max(11, 30 * scale) }]}
        width={0}
        containerStyle={{ width: '100%' }}
        numberOfLines={2}
      >
        {"TODAY'S\nSPECIAL"}
      </OutlinedText>
    </View>
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
 *   cropTop               — scene units of sky cut off the top (shopSceneLayout)
 *   height                — points of scene to show
 */
const PitStopScene = memo(function PitStopScene({
  selectedProductId = null,
  selectedRarity = null,
  isSelectedUnavailable = false,
  purchaseStatus = 'idle',
  active = true,
  cropTop = SCENE_VIEW.signTop - 40,
  height,
}) {
  const reduced = useReduceMotion();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(window.width);
  const scale = width / SCENE.width;

  // One player drives both crops of the clip (the background and the
  // counter foreground below) so they can never fall out of sync with one
  // another.
  const player = useVideoPlayer(SHOP_BACKGROUND_VIDEO, (instance) => {
    instance.loop = true;
    instance.muted = true;
  });
  useEffect(() => {
    if (active && !reduced) {
      player.play();
      return;
    }
    player.pause();
    player.currentTime = 0;
  }, [active, player, reduced]);

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
      style={[styles.scene, { height: height ?? (SCENE_VIEW.panelLine - cropTop) * scale }]}
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
        {/* 01 the fixed-camera movie: the whole stall, props and all. */}
        <AnimatedEnvironment player={player} scale={scale} reduced={reduced} />

        {/* 02 the crew, standing behind the movie's counter: clipped at its
            top edge so nothing below the hip is drawn over the counter. */}
        <View style={behindCounter(scale)}>
          <SupportCharacters
            state={state}
            scale={scale}
            active={active}
            reduced={reduced}
            restockBeat={restockBeat}
            presentBeat={presentBeat}
          />
          <MainAttendant
            state={state}
            offerPhase={offerPhase}
            scale={scale}
            active={active}
            reduced={reduced}
          />
        </View>

        {/* 03 the cup the keeper offers, and its sparkle. */}
        <OfferCup scale={scale} offerPhase={offerPhase} reduced={reduced} />
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

        {/* 04 the counter itself, cropped from the same clip and drawn after
            the crew and the cup so it cuts them off at the hip instead of
            the other way round (see `counterForeground` above). */}
        <CounterForeground player={player} scale={scale} reduced={reduced} />

        {/* 05 the specials line, chalked onto the movie's board beside the
            counter, and the station's name on the sign above it — both
            drawn last so nothing crosses them. */}
        <ChalkboardText scale={scale} />
        <StationSign scale={scale} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  sign: { alignItems: 'center', justifyContent: 'center' },
  board: { alignItems: 'center', justifyContent: 'center' },
  scene: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: PIT_STOP_COLORS.plateSky,
  },
});

export default PitStopScene;
