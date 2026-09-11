// CharacterRig — the layered paper-doll avatar, composited from real PNG art
// (assets/character/*). The base body is one image; face / hair / glasses /
// top / bottom layers are placed over it using fractions of the body box
// (constants derived offline from the art's measured landmarks — see the
// asset pipeline notes). All layers share centre-x.
//
// Imperative API (via ref):  rig.play('wave' | 'thumbs' | 'celebrate')
// Props: equipped, size (px width of the body), animate (idle bob),
// animateSwaps (the WHOLE runner springs whenever a changed part finishes
// loading — for the screens where somebody is dressing them, see SwapLayer),
// headOnly (draw the head and what is worn on it, nothing below the jaw),
// clanColor (accepted for API compat; the art is not tinted).

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Image as RNImage, View } from 'react-native';
import { Image as ExpoImage } from '../../ui/image';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { BODY_IMG, DEFAULT_EQUIPPED, HAIR_COLORS, HEAD_IMG, getItem, itemBackImage, itemImage, itemPreviewImage, itemWornImage } from '../../config/cosmetics';
import { useOnScreen, useReduceMotion } from '../../ui/motion';
import { useTheme } from '../../theme';

// Body art is 248×640 after trimming.
export const BODY_RATIO = 640 / 248;
// Headroom above the body for hair overflow (fraction of body height) —
// sized for the tallest updo (high pony lifts -0.13 above the body top).
export const HEADROOM = 0.14;

// Layer placement, as fractions of the body box: `w` = layer width / body
// width (centre-x aligned); `cy` centres the layer at that body-height
// fraction, `top` pins its top edge there. Height follows the art's aspect.
// Items can override any of these via their `layout` field in cosmetics.js
// (buns/ponytails, hoodies, overalls, skirt — tuned per item offline).
// Face proportions, measured off the reference head, as fractions of the HEAD
// (not the body). Everything that draws a face derives from these, so the
// body and the picker chip cannot drift apart.
// The hair swatch a thumbnail falls back to on a dark surface, looked up by
// value rather than written as the index it happens to sit at. Palette 0 is
// #26282B, which on a dark sheet is a drawing of nothing.
const LEGIBLE_HAIR_ON_DARK = Math.max(0, HAIR_COLORS.indexOf('#E8D06B'));

const FACE_W_OF_HEAD = 0.59;    // outer brow to outer brow / head width
const FACE_TOP_OF_HEAD = 0.34;  // top of the eyebrows / head height
// Smiley is the approved proportion reference. Tall expressions keep their
// aspect ratio but cannot exceed the smile's feature-box height.
const FACE_REFERENCE_ASPECT = 494 / 512;
const EYE_LINE_OF_HEAD = 0.46;  // eye centres / head height — glasses sit here
// Eyewear spans wider than the eyes themselves — it reaches almost to the
// temples. Derived from the head like the face, rather than a body fraction,
// so a change to the head can't leave the glasses undersized again.
const GLASSES_W_OF_HEAD = 0.86;
// The head drawn inside body.png: skull 157 wide, 218 tall, its top edge 8px
// down the 248x640 art. Rebuilt 2026-08-01 by scripts/build-body-2.py. The
// shoulders sit at 214, tucked right up under the chin, leaving only a sliver
// of neck — enough to poke out of a collar, not enough to look stretched.
const HEAD = { w: 157, h: 218, top: 8 };
const headFrac = (f) => (HEAD.top + f * HEAD.h) / 640;
const faceWidthOfBody = (FACE_W_OF_HEAD * HEAD.w) / 248;
const LAYOUT = {
  face: {
    w: faceWidthOfBody,
    top: headFrac(FACE_TOP_OF_HEAD),
    maxH: (faceWidthOfBody * 248 * FACE_REFERENCE_ASPECT) / 640,
  },
  glasses: { w: (GLASSES_W_OF_HEAD * HEAD.w) / 248, cy: headFrac(EYE_LINE_OF_HEAD) },
  hair: { w: 0.92, top: -0.025 }, // lifted so the forehead shows
  headwear: { w: 0.85, top: -0.07 }, // sits over the hair
  top: { w: 0.9718, top: 0.3169 },
  bottom: { w: 0.62, top: 0.554 },
  onepiece: { w: 0.62, top: 0.4197 },
  // Shoes sit on the sole line: the body's feet start flaring at y=600 of 640.
  // Every installed pair carries its own measured layout, so this is only the
  // fallback for an item that ships without one.
  footwear: { w: 0.66, top: 0.9297 },
  accessory: { w: 0.9, top: 0.32 }, // per-item layout does the real placement
};

// Bust framing (profile picture): head-and-shoulders inside a circle of
// diameter D — head top at ~0.15 D, head width ~0.47 D, shirt at the bottom.
// Verified offline against the exact math above.
const BUST = { bodyScale: 0.58, top: -0.074 };

// One global dial to raise EVERY hairstyle (base + per-item overrides) so
// more forehead shows. Negative = higher.
//
// Was -0.05, which sat every style too far up the skull — combined with the
// base `hair.top` of -0.025 that lifted the art by 7.5% of body height and
// left a band of bare forehead under the hairline. -0.02 keeps some forehead
// showing without the hair floating off the head.
const HAIR_LIFT = -0.02;

// How the runner reacts to a change of gear. THE WHOLE CHARACTER animates, not
// the part that changed: a new pair of shoes is thirty pixels at the bottom of
// a 68pt rig, and popping only those reads as a glitch in the art rather than
// as the runner putting something on.
const SWAP_SPRING = { damping: 10, stiffness: 260, mass: 0.6 };
const SWAP_FROM = 0.85;
// One change usually means several layers reloading at once — a colour swatch
// repaints every variant of a garment, and Randomize deals a whole new outfit.
// Their loads arrive over a handful of frames, so the first one owns the
// animation and the rest of the burst is folded into it. Comfortably shorter
// than a deliberate second tap, which still gets its own.
const SWAP_COALESCE_MS = 180;

// A layer that REPORTS its swaps rather than animating them. It draws the same
// plain image as the static path; all it adds is the load callback and the
// bookkeeping to know that this load replaced something. Kept out of `Layer`
// because that bails out early for an empty slot and hooks cannot live behind
// a return, and kept off the static path because every bust in the feed draws
// ten of these.
function SwapLayer({ img, frame, entered, onSwapIn, captureSafe, crisp = false }) {
  // The art currently on screen. A layer's FIRST load is the rig drawing
  // itself, not a change, so it must arrive plainly; only art that replaces
  // different art counts.
  const shown = useRef(img);
  // …except for a layer that MOUNTS after the rig is already on screen, which
  // is what equipping into an empty slot looks like — headwear, glasses,
  // footwear and accessories all start at 'none', so their layer does not
  // exist until you pick one, and there is no previous source for the effect
  // below to compare against. `entered` is the rig saying it has already
  // painted, so this is a change rather than the initial draw. It also covers
  // hair reappearing when a hat that hid it comes off.
  const armed = useRef(!!entered);

  useEffect(() => {
    if (shown.current === img) return;
    shown.current = img;
    armed.current = true;
  }, [img]);

  // Fired by expo-image once the new PNG is decoded and ready to draw —
  // including straight from its memory cache, which is the usual case here
  // because the studio warms the whole slot on the chip press. Reacting to the
  // source change instead would start the animation against the OLD art and
  // finish before an uncached part had appeared at all.
  const onLoad = () => {
    if (!armed.current) return;
    armed.current = false;
    onSwapIn?.();
  };

  const Img = captureSafe ? RNImage : ExpoImage;
  return (
    <Img source={img} style={frame} resizeMode="contain" fadeDuration={0} crisp={crisp} onLoad={onLoad} />
  );
}

function Layer({ img, slot, fit, layout, bodyW, bodyH, swap = false, entered = false, onSwapIn, captureSafe = false, crisp = false }) {
  if (!img) return null;
  const base = LAYOUT[fit || slot];
  if (!base) return null;
  const spec = layout ? { ...base, ...layout } : base;
  // Metadata only — RN's own resolver and expo-image's re-export of it return
  // the same thing, so which Image component is drawing has no bearing here.
  const src = RNImage.resolveAssetSource(img);
  let w = spec.w * bodyW;
  let h = w * (src.height / src.width);
  if (spec.maxH != null && h > spec.maxH * bodyH) {
    h = spec.maxH * bodyH;
    w = h * (src.width / src.height);
  }
  let top = spec.cy != null ? spec.cy * bodyH - h / 2 : spec.top * bodyH;
  if (slot === 'hair') top += HAIR_LIFT * bodyH;
  // `dx` shifts asymmetric art (e.g. a side ponytail) off centre.
  const left = bodyW / 2 - w / 2 + (spec.dx || 0) * bodyW;
  const frame = { position: 'absolute', width: w, height: h, left, top };
  if (swap) {
    return (
      <SwapLayer
        img={img}
        frame={frame}
        entered={entered}
        onSwapIn={onSwapIn}
        captureSafe={captureSafe}
        crisp={crisp}
      />
    );
  }
  const Img = captureSafe ? RNImage : ExpoImage;
  return <Img source={img} style={frame} resizeMode="contain" fadeDuration={0} crisp={crisp} />;
}

// Footwear, one shoe at a time.
//
// A pair drawn as a single image can only be moved and scaled as a block, so
// the two shoes can never be angled onto two feet — and the body's feet point
// slightly outward. Items carrying `feet` ship the pair split in half
// (footL / footR) with a placement each, in the same units a Layer uses plus
// `rot` in degrees. Everything without `feet` — the four pairs whose art would
// not separate, and every older shoe — still draws as one image, so this is
// additive rather than a migration. That one image is the WORN one where the
// item has it: open footwear is cut so the leg shows through its mouth, and
// only the picker wants the shoe whole.
//
// Drawn TWICE, once with `back`. A shoe is cut in two along its collar
// (scripts/split-shoe-collars.py) so the ankle can pass through it: the far rim
// draws before the body, the rest after, and the leg lands between them. Drawn
// as one layer the whole collar ring sits in front of the leg and reads as an
// empty ring beside the ankle instead of around it. The two pieces tile, so a
// shoe with no back piece is simply the old single layer.
function Feet({ item, equipped, bodyW, bodyH, back = false, captureSafe = false, crisp = false, ...rest }) {
  const feet = item?.feet;
  if (!feet) {
    const img = back ? item?.backImg : itemWornImage('footwear', item, equipped);
    return (
      <Layer
        img={img}
        slot="footwear"
        layout={item?.layout}
        bodyW={bodyW}
        bodyH={bodyH}
        captureSafe={captureSafe}
        crisp={crisp}
        {...rest}
      />
    );
  }
  const Img = captureSafe ? RNImage : ExpoImage;
  return (
    <>
      {['l', 'r'].map((side) => {
        const img = back
          ? (side === 'l' ? item.footLBack : item.footRBack)
          : (side === 'l' ? item.footL : item.footR);
        const spec = feet[side];
        if (!img || !spec) return null;
        const src = RNImage.resolveAssetSource(img);
        const w = spec.w * bodyW;
        const h = w * (src.height / src.width);
        const left = bodyW / 2 - w / 2 + (spec.dx || 0) * bodyW;
        return (
          <Img
            key={side}
            source={img}
            style={{
              position: 'absolute',
              width: w,
              height: h,
              left,
              top: spec.top * bodyH,
              // Keep the prop's shape stable when swapping shoes. Fabric
              // represents a removed processed style as `null`; in dev,
              // React Native's transform validator then calls `.forEach` on
              // that null value. Several shoes intentionally have rot: 0, so
              // always send a valid transform array instead of dropping it.
              transform: [{ rotate: `${spec.rot || 0}deg` }],
            }}
            resizeMode="contain"
            fadeDuration={0}
            crisp={crisp}
          />
        );
      })}
    </>
  );
}

// Memoized: a rig re-assembles up to 8 layers (LAYOUT + getItem lookups) on
// every render, and it is mounted a LOT at once — a feed of busts, up to 6
// bodies during a capture cutscene. Without this, an unrelated re-render
// anywhere above (a reaction toggle, a tab-bar pulse) re-runs that assembly
// for every rig on screen even though nothing about it changed. Safe as a
// plain shallow memo: `equipped` comes from data (a loadout object) at every
// real call site rather than being rebuilt inline, so reference equality is
// the common case; a call site that DOES rebuild it inline just falls back to
// today's always-re-render behaviour, never worse.
const CharacterRig = React.memo(forwardRef(function CharacterRig(
  {
    // A DEFAULT PARAMETER IS NOT ENOUGH HERE. `users.avatar` is nullable, so
    // every payload that carries a runner can carry `avatar: null` — a runner
    // who never opened the studio. A default only fires on `undefined`, so
    // `equipped={runner.avatar}` handed this a null and the loadout read below
    // took the whole screen down. Normalised in the body instead.
    equipped: equippedProp,
    size = 120,
    animate = false,
    animateSwaps = false,
    headOnly = false,
    clanColor,
    style,
    // For the one caller (LogoRunner, on the share card) whose output gets
    // rasterised by react-native-view-shot rather than just looked at.
    // expo-image's async, GPU-backed decode is what every other rig instance
    // wants — see ui/image.js — but a view being screenshotted the instant it
    // mounts cannot assume that decode has finished, so this swaps every
    // layer back to RN's own synchronous Image for that one render tree only.
    captureSafe = false,
    // FULL-RESOLUTION DECODE. Off unless the rig's own scale can move.
    //
    // Every layer used to be drawn `crisp` — that is, with expo-image's
    // `allowDownscaling` turned OFF, decoding the source PNG at its full size
    // whatever the view draws at. The character art is ~512px square, so one
    // layer is about a megabyte of bitmap and a dressed runner is eight of
    // them. In the studio that is correct and deliberate: the rig springs to
    // 1.12 on a tap and on a part landing, and a bitmap decoded for the
    // resting size magnifies into mush. See ui/image.js.
    //
    // But the rig is drawn far more often as a 30-40pt PORTRAIT that never
    // moves — a bust on every feed card, over every territory on the map,
    // beside every leaderboard row. Those were each paying eight full-size
    // decodes to draw a thumbnail, which is most of what made a screenful of
    // runners expensive to build and to hold in memory.
    //
    // The default is the honest test of whether it is needed: `animateSwaps`
    // is the studio's part-landing spring, and a `ref` is the only route to
    // the imperative `play()` nod. A rig with neither cannot change its own
    // scale, so there is nothing for a full decode to protect. A caller whose
    // PARENT scales it (RunningScreen's live marker sits in a Pulse) can ask
    // for it by hand.
    crisp,
  },
  ref
) {
  const equipped = equippedProp || DEFAULT_EQUIPPED;
  const reduced = useReduceMotion();
  const bodyW = size;
  const bodyH = size * BODY_RATIO;
  const headroom = bodyH * HEADROOM;

  // Has the rig drawn once? A layer that appears BEFORE this is part of the
  // runner arriving; one that appears after is a part being put on. A ref, not
  // state, because flipping it must not itself cause a render — every layer
  // that could care is mounted by a render that has already happened.
  const painted = useRef(false);
  useEffect(() => {
    painted.current = true;
  }, []);

  const bob = useSharedValue(0);
  const jump = useSharedValue(0);
  const pop = useSharedValue(1);
  const swapScale = useSharedValue(1);
  // Happy face while jumping (reverts when they land).
  const [happy, setHappy] = useState(false);
  const happyTimer = useRef(null);
  useEffect(() => () => clearTimeout(happyTimer.current), []);

  // Idle bob. Parked while its screen is not the one being looked at: the
  // studio stays mounted behind whatever tab you went to, and a runner bobbing
  // there is a whole-tree commit every frame for nobody (see useOnScreen).
  const bobbing = useOnScreen(animate && !reduced);
  useEffect(() => {
    if (!animate || reduced || !bobbing) return undefined;
    bob.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    return () => {
      bob.value = 0;
    };
  }, [animate, reduced, bobbing, bob]);

  // A layer has finished loading art that replaced something. The RUNNER
  // reacts, whole, springing back up to size — which is legible whichever slot
  // changed, including the ones that are a few pixels at the far edge of the
  // body.
  const lastSwapAt = useRef(0);
  const onSwapIn = useCallback(() => {
    const now = Date.now();
    if (now - lastSwapAt.current < SWAP_COALESCE_MS) return;
    lastSwapAt.current = now;
    swapScale.value = SWAP_FROM;
    swapScale.value = withSpring(1, SWAP_SPRING);
  }, [swapScale]);

  // Geometry every layer needs, plus whether this rig is one somebody is
  // DRESSING (the studio, the two onboarding steps) rather than one being
  // looked at. Off everywhere else: a feed of twenty busts must not run a load
  // callback per layer as it scrolls.
  const decodeCrisp = crisp ?? (animateSwaps || !!ref);
  const layerBox = {
    bodyW,
    bodyH,
    swap: animateSwaps && !reduced,
    entered: painted.current,
    onSwapIn,
    captureSafe,
    crisp: decodeCrisp,
  };

  // A short hop: up, back down to where they stood — with a happy face.
  const doJump = () => {
    setHappy(true);
    clearTimeout(happyTimer.current);
    happyTimer.current = setTimeout(() => setHappy(false), 600);
    jump.value = withSequence(
      withTiming(-bodyH * 0.14, { duration: 180, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) })
    );
  };

  useImperativeHandle(ref, () => ({
    play(name) {
      if (reduced) return;
      if (name === 'thumbs') {
        pop.value = withSequence(
          withSpring(1.07, { damping: 12, stiffness: 300 }),
          withSpring(1, { damping: 14, stiffness: 220 })
        );
      } else {
        // wave/celebrate = the short happy jump
        doJump();
      }
    },
  }));

  // `pop` (the imperative nod) and `swapScale` (a part landing) multiply rather
  // than share a value, so one can start while the other is still settling
  // instead of the second one snatching the scale mid-spring.
  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: jump.value + bob.value * 2.5 },
      { scale: pop.value * swapScale.value },
    ],
  }));

  const it = {
    face: happy ? getItem('face', 'laugh') : getItem('face', equipped.face),
    hair: getItem('hair', equipped.hair),
    headwear: getItem('headwear', equipped.headwear || 'none'),
    glasses: getItem('glasses', equipped.glasses),
    top: getItem('top', equipped.top),
    bottom: getItem('bottom', equipped.bottom),
    footwear: getItem('footwear', equipped.footwear || 'none'),
    accessory: getItem('accessory', equipped.accessory || 'none'),
  };
  // Accessories carry a z: wings/capes/packs go BEHIND the body, medals/vests
  // in front of the top garment.
  const accImg = itemImage('accessory', it.accessory, equipped);
  const accBack = it.accessory.z === 'back' ? accImg : null;
  const accFront = it.accessory.z !== 'back' ? accImg : null;
  // Wrap-around split layers: the far side of a band/ribbon renders behind
  // the body so the item reads as going around the head/neck.
  const accBackHalf = itemBackImage('accessory', it.accessory, equipped);
  const hatBackHalf = itemBackImage('headwear', it.headwear, equipped);
  // Full-coverage hats hide all hair; crown-enclosing hats (caps, hard hat)
  // also hide bulky updos/afros that would jut out of the hat outline. Open
  // headwear (sweatband, visor, crown, bandana) lets bulky hair show — a
  // sweatband under an afro or a top knot through a visor reads naturally.
  const hideHair =
    it.headwear.hideHair || (it.headwear.hidesBulky && it.hair.bulky);

  const Img = captureSafe ? RNImage : ExpoImage;

  return (
    <Animated.View
      style={[
        {
          width: bodyW,
          height: bodyH + headroom,
          overflow: 'visible',
          // Scale from the SOLES. The studio and both onboarding steps stand
          // the runner on a drawn road; scaling about the centre lifts the feet
          // off it, so the spring read as the character floating up rather than
          // as it settling into new gear.
          transformOrigin: 'bottom center',
        },
        bodyStyle,
        style,
      ]}
    >
      <View style={{ position: 'absolute', top: headroom, width: bodyW, height: bodyH }}>
        {/* `headOnly` draws the head and only the head — the plate, the face,
            the hair, the glasses and the hat. Everything below the jaw is
            skipped at the SOURCE rather than clipped away by the caller: a
            rectangular window over the whole rig cuts the shoulders and the
            shirt collar off in a straight line (they sit at y=214 of 640,
            ABOVE the chin at 226, so even a window cut exactly at the chin
            still shows a band of them) and cuts long hair off flat with it.
            See LogoRunner, which wears the player's head on the brand mark. */}
        {!headOnly && (
          <>
            <Layer img={accBack} slot="accessory" layout={it.accessory.layout} {...layerBox} />
            <Layer img={accBackHalf} slot="accessory" layout={it.accessory.layout} {...layerBox} />
          </>
        )}
        <Layer img={hatBackHalf} slot="headwear" layout={it.headwear.layout} {...layerBox} />
        {!headOnly && (
          <>
            {/* The far rim of the shoe's collar, behind the leg. See Feet. */}
            <Feet item={it.footwear} equipped={equipped} back {...layerBox} />
            <Img
              source={BODY_IMG}
              style={{ position: 'absolute', width: bodyW, height: bodyH }}
              resizeMode="contain"
              fadeDuration={0}
              crisp={decodeCrisp}
            />
            {/* Shoes under the trouser hem, the way a hem falls over a shoe: a
                trouser leg ends ON the foot, so drawing the shoe over it cuts
                the hem off in a straight line and the leg reads as tucked into
                the shoe. Under the top as well, so a long one-piece covers
                boots the way it does in the source art. */}
            <Feet item={it.footwear} equipped={equipped} {...layerBox} />
            {/* A one-piece (robe, jumpsuit, armour) IS the legs — drawing a
                separate bottom under it only pokes trouser cuffs out of the
                hem. */}
            {!it.top.hidesBottom && (
              <Layer img={itemImage('bottom', it.bottom, equipped)} slot="bottom" layout={it.bottom.layout} {...layerBox} />
            )}
            <Layer img={itemImage('top', it.top, equipped)} slot="top" fit={it.top.fit} layout={it.top.layout} {...layerBox} />
            {/* Everything worn below the jaw — vests, sashes, bags, and all the
                neckwear. These go UNDER the head plate, so the jaw is in front
                of them. Their art was also nudged down in cosmetics.js to start
                at the chin line: clipping alone left a bow tie as a sliver,
                because most of it had been sitting ON the jaw rather than below
                it. */}
            <Layer img={it.accessory.atNeck ? null : accFront} slot="accessory" layout={it.accessory.layout} {...layerBox} />
          </>
        )}
        {/* Replay the exact transparent head after every below-jaw layer. A
            rectangular crop of BODY_IMG stopped at the shoulder join and
            lost the bottom 13px of the chin; extending that crop also pulled
            the shoulders over the shirt. The dedicated plate contains the
            complete head silhouette and nothing below it. */}
        <Img
          source={HEAD_IMG}
          style={{ position: 'absolute', width: bodyW, height: bodyH }}
          resizeMode="contain"
          fadeDuration={0}
          crisp={decodeCrisp}
          pointerEvents="none"
        />
        {/* `atNeck` now means worn ON THE HEAD — the headset alone. It sits
            over the ears, 140px above the chin, so it is the one thing the
            plate would erase outright and the one thing that is not "below
            the jaw". Everything else was moved down instead. */}
        <Layer img={it.accessory.atNeck ? accFront : null} slot="accessory" layout={it.accessory.layout} {...layerBox} />
        <Layer img={itemImage('face', it.face, equipped)} slot="face" layout={it.face.layout} {...layerBox} />
        {!hideHair && (
          <Layer img={itemImage('hair', it.hair, equipped)} slot="hair" layout={it.hair.layout} {...layerBox} />
        )}
        <Layer img={itemImage('glasses', it.glasses, equipped)} slot="glasses" layout={it.glasses.layout} {...layerBox} />
        <Layer img={itemImage('headwear', it.headwear, equipped)} slot="headwear" layout={it.headwear.layout} {...layerBox} />
      </View>
    </Animated.View>
  );
}));

export default CharacterRig;

// ---------------------------------------------------------------------------
// CharacterBust — the avatar as a circular head-and-shoulders portrait (the
// user's profile picture). Renders the full rig behind a circular clip so
// only the head, headwear, face, and a bit of the shirt show.
// Props: equipped, size (circle diameter), ring (border color), bg.
// ---------------------------------------------------------------------------

export const CharacterBust = React.memo(function CharacterBust({ equipped, size = 72, ring, bg = 'rgba(255,255,255,0.06)', style, crisp }) {
  const W = size * BUST.bodyScale;
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          backgroundColor: bg,
          alignItems: 'center',
        },
        ring ? { borderWidth: 2, borderColor: ring } : null,
        style,
      ]}
    >
      <CharacterRig
        equipped={equipped}
        size={W}
        animate={false}
        // Left off, a bust decodes to the size it draws at — which is the
        // point of a bust. Set it where the CALLER animates the portrait's
        // scale, since the rig cannot see that from in here.
        crisp={crisp}
        style={{ position: 'absolute', left: (size - W) / 2, top: BUST.top * size }}
      />
    </View>
  );
});

// ---------------------------------------------------------------------------
// PartThumb — a single item preview for the customizer grid, contained in a
// square. 'None' items render an empty slot ring.
//
// IT WEARS THE RUNNER'S OWN COLOUR when the caller knows it (`equipped`).
//
// This used to refuse to, on the reasoning below — and the reasoning is not
// wrong about clothes, but it was wrong about the thing people actually
// noticed. Palette index 0 for hair is #26282B, so every hair tile was drawn
// near-black on a near-black sheet: the grid read as a row of empty cells while
// the character above it was blonde, and picking a style meant guessing at
// silhouettes you could not see. The studio already had a `contrastHair` patch
// for exactly this, and onboarding never passed it.
//
// Showing the chosen colour is also simply the truth: the tile is what you will
// get if you tap it. Shape still separates the items — a bob and a mohawk do
// not become the same drawing because they are the same colour.
//
// The old note, kept because it is the reason to be careful here:
//
// > Deliberately ignores the equipped colour. Tinting every swatch-driven item
// > to the current selection turned the whole grid one colour — a wall of teal
// > glasses, a wall of yellow hats — so nothing could be told apart while
// > browsing. The colour picker previews on the CHARACTER, which is the thing
// > you are actually colouring; the grid stays a catalogue.
// ---------------------------------------------------------------------------

/**
 * `equipped`     the runner's loadout. Only the colour index for THIS slot is
 *                read, so a caller can pass the whole thing.
 * `contrastHair` what to draw when there is no loadout to read — a shop shelf,
 *                a reward tile. Hair's palette index 0 is near-black, which is
 *                invisible on a dark card, so the fallback picks a legible
 *                stand-in instead. On by default: every caller without a
 *                loadout wants it, and the one that had it was patching this
 *                same hole by hand.
 */
// `crisp` is OFF here, unlike on the rig's own layers, and the reason is that
// nothing ever magnifies a tile. The grid is a wall of these — a slot can hold
// most of the 294-item catalogue — and each one was decoding a ~512px source
// PNG (about a megabyte of bitmap) to draw a 56pt chip. The one thing that
// moves them is PressableScale, which only ever goes DOWN (scaleTo 0.97), and
// a bitmap decoded for the resting size is more than enough for a shrink.
export function PartThumb({ slot, item, size = 56, clanColor, equipped = null, contrastHair = true, crisp = false }) {
  const { scheme } = useTheme();
  const previewEquipped = equipped
    || (slot === 'hair' && contrastHair
      ? { hairColor: scheme === 'dark' ? LEGIBLE_HAIR_ON_DARK : 0 }
      : null);
  const img = item
    ? (previewEquipped ? itemImage(slot, item, previewEquipped) : itemPreviewImage(slot, item))
    : null;
  if (!img) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: size * 0.55,
            height: size * 0.55,
            borderRadius: size * 0.275,
            borderWidth: 2,
            borderStyle: 'dashed',
            borderColor: 'rgba(127,127,127,0.45)',
          }}
        />
      </View>
    );
  }
  // Face art is black ink on transparency — give it a white "head" circle so
  // it reads against the dark card.
  if (slot === 'face') {
    // The chip has to wear the face the way the BODY wears it, or picking one
    // is guesswork. Centring the art in the circle (what this used to do) drops
    // the features into the middle with equal margins above and below — a real
    // head has a tall forehead and a short chin. So use the rig's own anchors:
    // width FACE_W of the head, brows FACE_TOP down it. Percentages are of the
    // circle here rather than of 160x196, which is close enough at chip sizes.
    const d = size * 0.92;
    const meta = RNImage.resolveAssetSource(img);
    let fw = d * FACE_W_OF_HEAD;
    const fh = meta?.width ? fw * (meta.height / meta.width) : fw;
    let fittedFh = fh;
    const maxFh = d * FACE_W_OF_HEAD * FACE_REFERENCE_ASPECT;
    if (fittedFh > maxFh) {
      fittedFh = maxFh;
      fw = meta?.height ? fittedFh * (meta.width / meta.height) : fw;
    }
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: d,
            height: d,
            borderRadius: d / 2,
            backgroundColor: '#FAF7F2',
            overflow: 'hidden',
          }}
        >
          <ExpoImage
            source={img}
            style={{
              position: 'absolute',
              left: (d - fw) / 2,
              top: d * FACE_TOP_OF_HEAD,
              width: fw,
              height: fittedFh,
            }}
            resizeMode="contain"
            fadeDuration={0}
            crisp={crisp}
          />
        </View>
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <ExpoImage
        source={img}
        style={{ width: size, height: size }}
        resizeMode="contain"
        fadeDuration={0}
        crisp={crisp}
      />
    </View>
  );
}
