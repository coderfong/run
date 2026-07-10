// CharacterRig — the layered paper-doll avatar, composited from real PNG art
// (assets/character/*). The base body is one image; face / hair / glasses /
// top / bottom layers are placed over it using fractions of the body box
// (constants derived offline from the art's measured landmarks — see the
// asset pipeline notes). All layers share centre-x.
//
// Imperative API (via ref):  rig.play('wave' | 'thumbs' | 'celebrate')
// Props: equipped, size (px width of the body), animate (idle bob), clanColor
// (accepted for API compat; the art is not tinted).

import React, { forwardRef, useEffect, useImperativeHandle } from 'react';
import { Image, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { BODY_IMG, getItem, itemImage } from '../../config/cosmetics';
import { useReduceMotion } from '../../ui/motion';

// Body art is 248×640 after trimming.
export const BODY_RATIO = 640 / 248;
// Headroom above the body for hair overflow (fraction of body height) —
// sized for the tallest updo (high pony lifts -0.13 above the body top).
const HEADROOM = 0.14;

// Layer placement, as fractions of the body box: `w` = layer width / body
// width (centre-x aligned); `cy` centres the layer at that body-height
// fraction, `top` pins its top edge there. Height follows the art's aspect.
// Items can override any of these via their `layout` field in cosmetics.js
// (buns/ponytails, hoodies, overalls, skirt — tuned per item offline).
const LAYOUT = {
  face: { w: 0.34, cy: 0.1813 },
  glasses: { w: 0.42, cy: 0.166 },
  hair: { w: 0.92, top: 0.0 },
  top: { w: 0.9718, top: 0.3169 },
  bottom: { w: 0.62, top: 0.555 },
  onepiece: { w: 0.62, top: 0.42 },
};

// Bust framing (profile picture): head-and-shoulders inside a circle of
// diameter D — head top at ~0.15 D, head width ~0.47 D, shirt at the bottom.
// Verified offline against the exact math above.
const BUST = { bodyScale: 0.58, top: -0.074 };

function Layer({ img, slot, fit, layout, bodyW, bodyH }) {
  if (!img) return null;
  const base = LAYOUT[fit || slot];
  if (!base) return null;
  const spec = layout ? { ...base, ...layout } : base;
  const src = Image.resolveAssetSource(img);
  const w = spec.w * bodyW;
  const h = w * (src.height / src.width);
  const top = spec.cy != null ? spec.cy * bodyH - h / 2 : spec.top * bodyH;
  return (
    <Image
      source={img}
      style={{
        position: 'absolute',
        width: w,
        height: h,
        left: bodyW / 2 - w / 2,
        top,
      }}
      resizeMode="contain"
      fadeDuration={0}
    />
  );
}

const CharacterRig = forwardRef(function CharacterRig(
  { equipped, size = 120, animate = false, clanColor, style },
  ref
) {
  const reduced = useReduceMotion();
  const bodyW = size;
  const bodyH = size * BODY_RATIO;
  const headroom = bodyH * HEADROOM;

  const bob = useSharedValue(0);
  const jump = useSharedValue(0);
  const pop = useSharedValue(1);

  // Idle bob.
  useEffect(() => {
    if (!animate || reduced) return undefined;
    bob.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    return () => {
      bob.value = 0;
    };
  }, [animate, reduced, bob]);

  // A springy hop: crouch (squash), launch up, land, small settle bounce.
  const doJump = (big) => {
    const up = big ? -0.34 : -0.26; // fraction of body height
    jump.value = withSequence(
      withTiming(bodyH * 0.05, { duration: 90, easing: Easing.out(Easing.quad) }),
      withSpring(bodyH * up, { damping: 9, stiffness: 260, velocity: -bodyH }),
      withSpring(0, { damping: 11, stiffness: 220 }),
      withTiming(bodyH * (big ? -0.09 : -0.06), { duration: 130, easing: Easing.out(Easing.quad) }),
      withSpring(0, { damping: 12, stiffness: 240 })
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
        // every tap/celebrate is a jump now (bigger for celebrate)
        doJump(name === 'celebrate');
      }
    },
  }));

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: jump.value + bob.value * 2.5 },
      { scale: pop.value },
    ],
  }));

  const it = {
    face: getItem('face', equipped.face),
    hair: getItem('hair', equipped.hair),
    glasses: getItem('glasses', equipped.glasses),
    top: getItem('top', equipped.top),
    bottom: getItem('bottom', equipped.bottom),
  };

  return (
    <Animated.View
      style={[{ width: bodyW, height: bodyH + headroom, overflow: 'visible' }, bodyStyle, style]}
    >
      <View style={{ position: 'absolute', top: headroom, width: bodyW, height: bodyH }}>
        <Image
          source={BODY_IMG}
          style={{ position: 'absolute', width: bodyW, height: bodyH }}
          resizeMode="contain"
          fadeDuration={0}
        />
        <Layer img={itemImage('bottom', it.bottom, equipped)} slot="bottom" layout={it.bottom.layout} bodyW={bodyW} bodyH={bodyH} />
        <Layer img={itemImage('top', it.top, equipped)} slot="top" fit={it.top.fit} layout={it.top.layout} bodyW={bodyW} bodyH={bodyH} />
        <Layer img={itemImage('face', it.face, equipped)} slot="face" layout={it.face.layout} bodyW={bodyW} bodyH={bodyH} />
        <Layer img={itemImage('hair', it.hair, equipped)} slot="hair" layout={it.hair.layout} bodyW={bodyW} bodyH={bodyH} />
        <Layer img={itemImage('glasses', it.glasses, equipped)} slot="glasses" layout={it.glasses.layout} bodyW={bodyW} bodyH={bodyH} />
      </View>
    </Animated.View>
  );
});

export default CharacterRig;

// ---------------------------------------------------------------------------
// CharacterBust — the avatar as a circular head-and-shoulders portrait (the
// user's profile picture). Renders the full rig behind a circular clip so
// only the head, headwear, face, and a bit of the shirt show.
// Props: equipped, size (circle diameter), ring (border color), bg.
// ---------------------------------------------------------------------------

export function CharacterBust({ equipped, size = 72, ring, bg = 'rgba(255,255,255,0.06)', style }) {
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
        style={{ position: 'absolute', left: (size - W) / 2, top: BUST.top * size }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// PartThumb — a single item preview for the customizer grid: the art itself
// in the loadout's currently chosen color, contained in a square. 'None'
// items render a simple empty slot ring.
// ---------------------------------------------------------------------------

export function PartThumb({ slot, item, equipped, size = 56, clanColor }) {
  const img = item ? itemImage(slot, item, equipped) : null;
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
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={img}
        style={{ width: size, height: size }}
        resizeMode="contain"
        fadeDuration={0}
      />
    </View>
  );
}
