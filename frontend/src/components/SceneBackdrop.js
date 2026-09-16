// SceneBackdrop — the roadside scene the runner is shown standing on. Used by
// the profile header and the avatar studio so both screens frame the character
// the same way.
//
// ONE LIGHT SCENE, TWO DARK SCENES: both screens use the daytime kerb
// (`profileBanner`) in light mode. In dark mode the You page uses its own wide
// lamp-lit street (`profileBannerDark`), while the avatar studio keeps the
// taller onboarding `stage` art it was composed around.
//
// ONE SHAPE FOR BOTH THEMES. The art is wildly mismatched — day is a 2.33:1
// letterbox, night a 0.84:1 portrait — and sizing the box to whichever one is
// showing made the header jump between a thin band and a full-screen wall as
// the theme changed. So the CALLER picks the shape and both scenes fill it
// with `cover`: the day art fits its box exactly, the night art crops. The
// profile header asks for the day aspect (which is why the two themes now
// match); the studio asks for a box tall enough to cover the whole runner.
//
// A box TALLER than the requested shape is covered by cropping the sides —
// fine for the studio, which wants the crop. The profile header opts out with
// `bleed` and gets road colour under the art instead; see the prop's note.
//
// The width is pinned to the WINDOW, not inherited from the parent, so the
// scene bleeds past the screen gutter without the caller having to unpick its
// own padding — `left: 50%` + a half-width offset lands it edge to edge
// whatever the parent measures. Absolutely positioned and non-interactive:
// the backdrop adds no layout height, screen content simply sits on top.

import React from 'react';
import { useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from '../ui/image';

import { art } from '../config/onboardingArt';
import AmbientLayer from '../effects/AmbientLayer';
import { useOnScreen } from '../ui/motion';
import { useTheme } from '../theme';

// Sky colour at each scene's top edge, so a scene shorter than the box it is
// given (or a stray rounding pixel) reads as more sky rather than as a seam.
const SKY = { light: '#F7EDCB', dark: '#0E2340' };
// The same skies at zero alpha — the far end of the `skyAbove` fade. A plain
// 'transparent' would fade through black on iOS.
const SKY_CLEAR = { light: 'rgba(247,237,203,0)', dark: 'rgba(14,35,64,0)' };
// How far down into the art that fade reaches.
const SKY_FADE = 28;

// Road colour at each scene's BOTTOM edge, for `bleed` (below). Both scenes end
// on flat tarmac, so a box taller than the art reads as a longer road.
const GROUND = { light: '#5B5A5B', dark: '#0C121D' };

// The day scene's own shape is the house shape — read off the art so it can't
// drift if the banner is regenerated.
const DAY_SRC = art('profileBanner');
const DAY_META = DAY_SRC ? Image.resolveAssetSource(DAY_SRC) : null;
const DAY_ASPECT = DAY_META?.height ? DAY_META.width / DAY_META.height : 1400 / 600;

/**
 * `aspect`    width/height of the box to draw the scene in. Defaults to the
 *             day scene's shape, which is what keeps light and dark identical.
 * `minHeight` floor for the box — the studio uses it to guarantee the scene
 *             covers the runner no matter how wide the window is.
 */
export function useSceneBackdrop({ aspect = DAY_ASPECT, minHeight = 0, variant = 'studio', skyAbove = 0 } = {}) {
  const { scheme } = useTheme();
  const { width } = useWindowDimensions();

  const darkKey = variant === 'profile' ? 'profileBannerDark' : 'stage';
  const source = art(scheme === 'light' ? 'profileBanner' : darkKey);
  // `sceneHeight` is the box the caller ASKED for; `height` is what it gets
  // once minHeight and any sky above it are applied. They differ only when the
  // caller wants a taller box than the shape holds — which is what `bleed`
  // fills.
  const sceneHeight = width / (aspect || DAY_ASPECT);
  const height = Math.max(minHeight, sceneHeight + skyAbove);

  return {
    source,
    width,
    height,
    sceneHeight,
    sky: SKY[scheme] || SKY.dark,
    clear: SKY_CLEAR[scheme] || SKY_CLEAR.dark,
    ground: GROUND[scheme] || GROUND.dark,
  };
}

/**
 * `bleed` changes how a box TALLER than `aspect` is filled. Without it the
 * scene covers the whole box, so the extra height is paid for by cropping the
 * sides — on the profile header that ate the trees framing the runner. With
 * it the scene keeps its shape at the top and the leftover strip below is the
 * road colour, so the header can reach past the art without zooming into it.
 */
/**
 * `anchor` decides WHICH PART of an over-tall scene survives the crop.
 *
 * `cover` centres, which is right for a texture and wrong for a place. The
 * night scene is a 1170x1400 portrait; in the studio's 390x232 box it covers to
 * 390x467, so centring throws away 117pt off the TOP and 117pt off the BOTTOM
 * — and the bottom is where the pavement is. The runner then stands at the foot
 * of a box whose ground has been cropped out from under them, which is the
 * "character isn't on the pavement" bug.
 *
 * `anchor="bottom"` pins the art's bottom edge to the box's bottom edge, so the
 * crop is taken entirely off the sky. Any scene a character STANDS on wants
 * this; a decorative band does not, so the default is unchanged.
 */
/**
 * `ambient` a preset from the ambient registry drifting over the scene, or
 *           null for a still one. Opt in per caller, and draws nothing at all
 *           when its art is not in the build, so a caller never has to check.
 *
 * `playing` false parks everything moving in the scene. The scene ALSO parks
 *           itself whenever its screen is not the one in front (useOnScreen),
 *           so a caller only passes this for a reason of its own. Both profile
 *           pages used to read focus themselves and hand it down, which
 *           re-rendered each whole page on every tab switch to tell one leaf
 *           layer to stop.
 */
/**
 * `skyAbove` points of sky drawn ABOVE the scene's top edge, for a header that
 *           runs up under the status bar. Moving the art up instead would put
 *           the kerb behind the portrait, and covering the taller box would
 *           crop the trees off the sides, so the scene stays where it was and
 *           the sky simply continues upward. The day art's left tree is cut
 *           off by its top edge, so that edge fades into the sky rather than
 *           ending on a hard line through the canopy.
 */
export default function SceneBackdrop({
  aspect,
  minHeight,
  variant = 'studio',
  bleed = false,
  anchor = 'center',
  skyAbove = 0,
  ambient = null,
  ambientDensity = 1,
  playing = true,
  style,
}) {
  const { source, width, height, sceneHeight, sky, clear, ground } = useSceneBackdrop({ aspect, minHeight, variant, skyAbove });
  // Only a scene with something moving in it listens for focus at all.
  const onScreen = useOnScreen(!!ambient && playing);
  if (!source || !height) return null;

  const live = playing && onScreen;
  const artHeight = bleed ? sceneHeight : height - skyAbove;

  // The living layers, shared by both of the branches below so the two paths
  // through this component cannot drift apart. Non-interactive and clipped by
  // whichever wrapper renders them.
  const life = (
    <>
      {ambient ? (
        <AmbientLayer
          preset={ambient}
          width={width}
          height={height}
          density={ambientDensity}
          playing={live}
          // Seeded off the scene's own size so the same screen arranges its
          // drift the same way every time you open it, and the You page and
          // the studio do not get identical fields.
          seed={Math.round(width + height)}
        />
      ) : null}
    </>
  );

  if (anchor === 'bottom' && !bleed) {
    // The art's OWN shape, drawn at cover width and hung from the bottom.
    const meta = Image.resolveAssetSource(source);
    const natural = meta?.height ? meta.width / meta.height : null;
    const coverH = natural ? width / natural : height;
    if (coverH > height) {
      return (
        <View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: '50%',
              marginLeft: -width / 2,
              width,
              height,
              backgroundColor: sky,
              overflow: 'hidden',
            },
            style,
          ]}
        >
          <Image
            source={source}
            style={{ position: 'absolute', bottom: 0, width, height: coverH }}
            resizeMode="cover"
            fadeDuration={0}
          />
          {/* Hung from the bottom, the art already reaches the top of the box,
              so the sky goes OVER its upper edge rather than above it. Same
              flat strip and fade as below, so a header reads the same on the
              tall night scene as on the day one. */}
          {skyAbove > 0 ? (
            <>
              <View style={{ position: 'absolute', top: 0, width, height: skyAbove, backgroundColor: sky }} />
              <LinearGradient
                colors={[sky, clear]}
                style={{ position: 'absolute', top: skyAbove, width, height: SKY_FADE }}
              />
            </>
          ) : null}
          {life}
        </View>
      );
    }
  }

  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: '50%',
          marginLeft: -width / 2,
          width,
          height,
          backgroundColor: bleed && height > sceneHeight + skyAbove ? ground : sky,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {skyAbove > 0 ? (
        <View style={{ position: 'absolute', top: 0, width, height: skyAbove, backgroundColor: sky }} />
      ) : null}
      <Image
        source={source}
        style={{ marginTop: skyAbove, width, height: artHeight }}
        resizeMode="cover"
        fadeDuration={0}
      />
      {skyAbove > 0 ? (
        <LinearGradient
          colors={[sky, clear]}
          style={{ position: 'absolute', top: skyAbove, width, height: SKY_FADE }}
        />
      ) : null}
      {life}
    </View>
  );
}
