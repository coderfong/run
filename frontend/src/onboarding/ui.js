// Shared first-run building blocks: the step chrome (back · progress · skip),
// the night stage the character stands on, and the comic panel / speech
// bubble / thumbnail used to frame illustration.
//
// Anything that takes a `source` degrades to a code-drawn panel when the art
// has not been generated yet (see config/onboardingArt.js).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from '../ui/image';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from 'lucide-react-native';

import { brand, space } from '../theme';
import { haptic, PressableScale } from '../ui/motion';
import { art } from '../config/onboardingArt';
import OutlinedText from '../components/ui/OutlinedText';
import ParallaxScene from '../components/ParallaxScene';
import { HAIR_COLORS } from '../config/cosmetics';
import { SCENES } from '../config/scenes';
import { toon, toonRadius, toonType } from './toon';

// Which landscape the first run is played against. One name, in one place, so
// swapping the scene is a one-line change rather than a sweep.
const FIRST_RUN_SCENE = 'nature5';

/**
 * The colour anything drawn over the first-run stage is sitting on.
 *
 * Exported for the drawn frames: they choose their ink by contrast, and a card
 * with a translucent white fill would otherwise be judged against WHITE and
 * given dark ink — when what it is really over is the scene. Read off the art
 * by the installer, so swapping the scene moves this with it.
 */
export const FIRST_RUN_SKY = SCENES[FIRST_RUN_SCENE]?.sky || '#03091C';

// ---------------------------------------------------------------------------
// Step chrome — circular back button, progress track, right-hand text action.
// ---------------------------------------------------------------------------

export function StepChrome({ step, total, onBack, onSkip, skipLabel = 'Skip', top = 0 }) {
  const pct = total > 0 ? Math.max(0.04, (step + 1) / total) : 0;
  const w = useSharedValue(pct);
  React.useEffect(() => {
    w.value = withTiming(pct, { duration: 320 });
  }, [pct, w]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));

  return (
    <View style={[styles.chrome, { paddingTop: top + space.sm }]}>
      <View style={styles.chromeSide}>
        {onBack ? (
          <PressableScale
            onPress={() => { haptic.light(); onBack(); }}
            style={styles.roundBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft size={24} color="#fff" />
          </PressableScale>
        ) : null}
      </View>

      <View style={styles.track}>
        <Animated.View style={[styles.trackFill, fillStyle]}>
          <LinearGradient
            colors={[brand.pink, '#F97CBB']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>

      <View style={[styles.chromeSide, { alignItems: 'flex-end' }]}>
        {onSkip ? (
          <PressableScale
            onPress={() => { haptic.light(); onSkip(); }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={skipLabel}
          >
            <Text style={[toonType.label, { color: 'rgba(255,255,255,0.75)' }]}>{skipLabel}</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// StageBackdrop — the lit night ground the character is previewed on. Uses
// `stage.png` when it exists, otherwise draws the gradient + horizon in code.
// ---------------------------------------------------------------------------

// The art is a 1170x1400 portrait scene (0.84 wide) — a phone is 0.46. Filling
// the screen with `cover` threw away 40% of the width: the fence, the house and
// both verges were cropped off and the lit path ended up somewhere behind the
// picker sheet. So the scene is pinned to the BOTTOM at its own aspect ratio,
// full width, and the sky above it is continued in code with a gradient that
// starts on the art's own top colour (#010F27) — the seam is invisible and
// nothing in the drawing is ever cut off.
const STAGE_ASPECT = 1170 / 1400;
const STAGE_SKY = '#010F27';

// The hair colour the first run starts on: the light blonde.
//
// Looked up by VALUE rather than written as the index it happens to sit at.
// This used to be a bare `4`, which is correct only for as long as nobody
// inserts a swatch above it — and the failure is silent and cosmetic, so it
// would ship. HAIR_COLORS is the source of truth; this is a question asked of
// it, and the fallback is the first swatch rather than an index that may no
// longer exist.
//
// It started as a property of the NIGHT stage — the default loadout's near
// black (#26282B) was all but the old sky's own colour, so the runner being
// built read as bald. The stage is a daylight meadow now and the reason is
// simply that blonde is the friendlier starting point; the seed is applied by
// OnboardingFlow and re-applied by each gender option, and the hair step's own
// swatches override it the moment they are touched.
const BLONDE = '#E8D06B';
export const FIRST_RUN_HAIR = Math.max(0, HAIR_COLORS.indexOf(BLONDE));

export function StageBackdrop({ children, style }) {
  const bg = art('stage');
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const { width } = size;
  const scene = SCENES[FIRST_RUN_SCENE];
  return (
    <View
      style={[styles.stage, style]}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setSize((prev) => (
          Math.abs(prev.width - w) < 1 && Math.abs(prev.height - h) < 1
            ? prev
            : { width: w, height: h }
        ));
      }}
    >
      {scene ? (
        // The meadow, drawn as its own layers so the clouds and the trees move
        // independently of each other. It replaces the hand-drawn night street:
        // the flow reads as somewhere you would go for a run rather than as a
        // dark room, and it is the one screen in the app with the time to earn
        // a moving backdrop.
        <ParallaxScene
          scene={FIRST_RUN_SCENE}
          width={size.width}
          height={size.height}
          style={styles.fillAbs}
        />
      ) : bg ? (
        <>
          {/* sky continued above the art — it ends on the art's own top
              colour, so the join reads as one continuous night */}
          <LinearGradient colors={['#03091C', STAGE_SKY]} style={styles.fillAbs} />
          {width > 0 ? (
            <Image
              source={bg}
              style={{
                position: 'absolute',
                left: 0,
                bottom: 0,
                width,
                height: width / STAGE_ASPECT,
              }}
              resizeMode="contain"
            />
          ) : null}
        </>
      ) : (
        <>
          <LinearGradient colors={toon.stage} style={styles.fillAbs} />
          {/* horizon + ground band */}
          <View style={styles.ground} />
          <View style={styles.groundEdge} />
          {/* two roadside bushes, mirrored */}
          <View style={[styles.bush, { left: -18 }]} />
          <View style={[styles.bush, { right: -18 }]} />
        </>
      )}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ComicPanel — a rounded, ink-outlined illustration panel. `fit="contain"`
// keeps art with a baked background whole; `bg` fills the letterbox.
// ---------------------------------------------------------------------------

export function ComicPanel({
  source,
  bg = '#241B2E',
  fit = 'contain',
  aspect = 4 / 3,
  fallback = null,
  style,
  children,
}) {
  return (
    <View style={[styles.panel, { aspectRatio: aspect, backgroundColor: bg }, style]}>
      {source ? (
        <Image source={source} style={styles.fillAbs} resizeMode={fit} />
      ) : (
        <>
          <LinearGradient
            colors={[bg, '#0C0C10']}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.fallback}>{fallback}</View>
        </>
      )}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// SpeechBubble — comic bubble with a tail, for panels drawn in code.
// ---------------------------------------------------------------------------

export function SpeechBubble({ children, style, tail = 'left' }) {
  return (
    <View style={[styles.bubbleWrap, style]}>
      <View style={styles.bubble}>
        <Text style={[toonType.sub, { color: toon.ink }]}>{children}</Text>
      </View>
      <View
        style={[
          styles.tail,
          tail === 'left' ? { left: 26 } : { right: 26 },
        ]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// StepArt — the characters above a form step's headline. They stand ON the
// night stage: no tile, no border, no background of their own.
// ---------------------------------------------------------------------------

// This used to be a 132pt squircle filled with the art's own baked orange, and
// the flow read as a night scene with two daylight stickers pasted over it. The
// art is cut out now (see `cutName` and friends in config/onboardingArt.js), so
// the only box left is the one the layout needs.
//
// Sized by HEIGHT, not into a square: the three cut-outs trim to their own
// shapes (a 286x300 handshake, a 203x346 birthday, a 347x287 sprinter), and a
// square box with `contain` would draw the tall one two thirds the size of the
// wide one for no reason. Equal height is what reads as equal size.
//
// The fallback tile stays for a step whose art has not been generated: a
// gradient square is a placeholder, and a placeholder should look like one.
export function StepArt({ source, fallback, height = 208, style }) {
  const meta = source ? Image.resolveAssetSource(source) : null;
  const ratio = meta?.width && meta?.height ? meta.width / meta.height : 1;
  if (!source) {
    return (
      <View style={[styles.thumb, { width: height, height, backgroundColor: '#F26A3A' }, style]}>
        <LinearGradient
          colors={['#F9A03F', '#F2542D']}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.fallback}>{fallback}</View>
      </View>
    );
  }
  return (
    <Image
      source={source}
      style={[{ height, width: height * ratio, alignSelf: 'center' }, style]}
      resizeMode="contain"
      accessible={false}
    />
  );
}

// ---------------------------------------------------------------------------
// StepHeadline — the outlined headline + optional sub-line used by every step.
// ---------------------------------------------------------------------------

export function StepHeadline({ title, sub, color = '#FFFFFF', style }) {
  return (
    <View style={style}>
      <OutlinedText style={[toonType.headline, { color }]} outline={toon.ink} width={2.5}>
        {title}
      </OutlinedText>
      {sub ? (
        <OutlinedText
          style={[toonType.sub, { color: 'rgba(255,255,255,0.85)', marginTop: 4 }]}
          outline={toon.ink}
          width={2}
        >
          {sub}
        </OutlinedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Images need a definite box. `StyleSheet.absoluteFill` is a registered
  // style ID with no width/height, and an <Image> handed one fell back to its
  // INTRINSIC size — a 1536px hero pinned top-left inside a 340px panel, which
  // is why every framed illustration showed one zoomed-in corner of itself.
  fillAbs: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },

  chrome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingBottom: space.sm,
  },
  chromeSide: { width: 56, justifyContent: 'center' },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    flex: 1,
    height: 12,
    borderRadius: toonRadius.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  trackFill: { height: '100%', borderRadius: toonRadius.pill, overflow: 'hidden' },

  stage: { flex: 1, overflow: 'hidden' },
  ground: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '26%',
    backgroundColor: toon.ground,
  },
  groundEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '26%',
    height: 2,
    backgroundColor: toon.groundLine,
  },
  bush: {
    position: 'absolute',
    bottom: '20%',
    width: 120,
    height: 64,
    borderRadius: 40,
    backgroundColor: 'rgba(8,26,24,0.75)',
  },

  panel: {
    width: '100%',
    borderRadius: toonRadius.panel,
    borderWidth: 3,
    borderColor: toon.ink,
    overflow: 'hidden',
  },
  fallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },

  bubbleWrap: { alignSelf: 'flex-start' },
  bubble: {
    backgroundColor: '#fff',
    borderRadius: 22,
    borderWidth: 3,
    borderColor: toon.ink,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    maxWidth: 240,
  },
  tail: {
    width: 22,
    height: 22,
    backgroundColor: '#fff',
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderColor: toon.ink,
    transform: [{ rotate: '45deg' }],
    marginTop: -12,
  },

  thumb: {
    borderRadius: 28,
    borderWidth: 3,
    borderColor: toon.ink,
    overflow: 'hidden',
    alignSelf: 'center',
  },
});
