// EmptyState — centered mascot (or icon) + title + body + optional action.
// Copy must direct action (constitution): titles state the situation, actions
// say what they do.
//
// `art` (an image source) shows a PASER mascot illustration. Because the
// illustrations are black-outlined on transparent, they'd disappear on the
// dark app background — so art sits on a soft light squircle that lets the
// ink read.

import React from 'react';
import { Text, View } from 'react-native';
import { Image } from '../../ui/image';

import { NB, darkColors, nbAccentFor, nbInk, radius, space, useTheme, useThemedType } from '../../theme';
import { frameVariant } from '../../ui/frameRegistry';
import Button from './Button';
import { Reveal } from '../../ui/motion';
import Framed from './Framed';
import HardShadow from './HardShadow';

// HOW BIG A BARE MASCOT IS, and why it is not simply the 176 the block was.
//
// The mascot files are 640x640 with the drawing floating in the middle of
// them: the figure in empty-runs.png measures 273x329 of that canvas, so 57%
// of the width and 49% of the height is transparent margin. `contain` fits the
// CANVAS, not the drawing, so sizing the Image alone mostly buys air — at 176
// the figure came out 76pt tall, visibly smaller than the 176pt block it had
// just replaced even though the numbers matched.
//
// So the box is set to what makes the DRAWING the right size (300 gives a
// 154pt figure, about the footprint the block occupied) and the dead margin is
// pulled back out of the layout with negative margins — the same bleed the
// Home hero uses on its own art. 300 * (1 - 0.514) / 2 is 73pt of transparent
// margin per side, so -56 leaves a little real air and reclaims the rest.
const BARE_ART = 300;
const BARE_BLEED = 56;

/**
 * `bare` drops the mascot's block and frame and stands the drawing straight on
 * the page. OPT IN, and deliberately so: the block is load bearing everywhere
 * else (see the art branch below), so this is a per screen decision about
 * whether the page underneath can carry black line art on its own. Home can —
 * it is painted, and the app opens in light mode — and the box was competing
 * with the drawn hero card a few hundred points above it.
 */
export default function EmptyState({ icon, art, title, body, actionLabel, onAction, accent, dark = false, bare = false, style }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const muted = dark ? 'rgba(255,255,255,0.66)' : colors.textMuted;
  // `dark` means this empty state is sitting on a forced-dark page (a map
  // overlay, the run screen), so its box has to take the dark card fill rather
  // than the scheme's — same contract the copy above follows.
  const iconFill = dark ? darkColors.card : colors.card;
  // The block the mascot stands on. It was a flat white squircle in every empty
  // state in the app, which is the one thing an empty screen cannot afford —
  // there is nothing else on the page to carry it. A colour dealt off the title
  // means the quiet feed, the empty club and the unclaimed map are three
  // different colours rather than three identical white pills.
  //
  // Safe to saturate because of what these illustrations ARE: black line art on
  // transparent. The outline is what has to survive, and it survives on any
  // mid-tone. `artFill` still feeds the frame's `on` below, so the drawn edge is
  // re-checked against whatever colour came up.
  const artFill = nbAccentFor(title || 'empty');
  return (
    <Reveal duration={380} style={[{ alignItems: 'center', justifyContent: 'center', padding: space.xl }, style]}>
      {art && bare ? (
        // Just the drawing, at the size the DRAWING should be rather than the
        // size the file is. See BARE_ART.
        <Image
          source={art}
          style={{
            width: BARE_ART,
            height: BARE_ART,
            marginTop: -BARE_BLEED,
            marginBottom: space.lg - BARE_BLEED,
          }}
          resizeMode="contain"
        />
      ) : art ? (
        // The mascot stands in a DRAWN box. The white squircle underneath is
        // load bearing and stays — the illustrations are black outlined on
        // transparent and vanish on the dark background without it — but a
        // plain white pill is the one place in the app where a piece of toon
        // art is presented by something that is not toon art at all. The
        // frame sits on its edge and boils: an empty screen is the one place
        // in the app with nothing else moving, so it can afford the motion,
        // and a page that says "nothing here yet" reads better alive.
        <Framed
          frame="card"
          // Drawn ON the mascot's block, so the ink has to read against THAT
          // rather than against the page. That is why this does not follow
          // `colors.text` the way the rest of the empty state does: in dark
          // mode that is near white, and the frame would vanish into the very
          // thing it is drawn around.
          //
          // Said to the frame instead of hoped for: `on` makes it check, so a
          // pale clan accent gets swapped for an ink that shows.
          on={artFill}
          tint={accent}
          boil
          inset={false}
          style={{ marginBottom: space.lg }}
        >
          <View
            style={{
              width: 176,
              height: 176,
              borderRadius: 40,
              backgroundColor: artFill,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Image source={art} style={{ width: 148, height: 148 }} resizeMode="contain" />
          </View>
        </Framed>
      ) : icon ? (
        // The art path gets a DRAWN box; this one gets the neo-brutalist box,
        // which is the same decision made twice for the two things this
        // component can be handed. It used to be neither: an 80 point view with
        // a radius, no fill and no edge, which is not a box at all — the icon
        // simply floated in the middle of the page with a rounded rectangle's
        // worth of nothing around it.
        //
        // A hard drop rather than the framed path's own depth, because this is
        // the plainer of the two empty states — the one a screen falls back to
        // when it has no mascot for the occasion — and it should read as
        // chrome rather than as an occasion.
        <HardShadow
          offset={NB.offset}
          radius={radius.lg}
          on={iconFill}
          style={{ marginBottom: space.lg }}
        >
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: radius.lg,
              backgroundColor: iconFill,
              borderWidth: NB.stroke,
              borderColor: nbInk(scheme, iconFill),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {icon}
          </View>
        </HardShadow>
      ) : null}
      <Text style={[type.title, dark && { color: '#fff' }, { textAlign: 'center', marginBottom: space.sm }]}>
        {title}
      </Text>
      {body ? (
        <Text style={[type.body, { color: muted, textAlign: 'center', lineHeight: 22 }]}>{body}</Text>
      ) : null}
      {actionLabel ? (
        <Button
          title={actionLabel}
          onPress={onAction}
          accent={accent}
          full={false}
          frame={frameVariant('action', actionLabel)}
          style={{ marginTop: space.lg }}
        />
      ) : null}
    </Reveal>
  );
}
