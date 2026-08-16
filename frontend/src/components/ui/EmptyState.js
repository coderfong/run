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

import { NB, darkColors, nbInk, radius, space, useTheme, useThemedType } from '../../theme';
import { frameVariant } from '../../ui/frameRegistry';
import Button from './Button';
import Framed from './Framed';
import HardShadow from './HardShadow';

export default function EmptyState({ icon, art, title, body, actionLabel, onAction, accent, dark = false, style }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const muted = dark ? 'rgba(255,255,255,0.66)' : colors.textMuted;
  // `dark` means this empty state is sitting on a forced-dark page (a map
  // overlay, the run screen), so its box has to take the dark card fill rather
  // than the scheme's — same contract the copy above follows.
  const iconFill = dark ? darkColors.card : colors.card;
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', padding: space.xl }, style]}>
      {art ? (
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
          // Drawn ON the white squircle, so the ink has to read against WHITE
          // rather than against the page. That is why this does not follow
          // `colors.text` the way the rest of the empty state does: in dark
          // mode that is near white, and the frame would vanish into the very
          // thing it is drawn around.
          //
          // Said to the frame now instead of hoped for: `on` makes it check,
          // so a pale clan accent gets swapped for an ink that shows rather
          // than drawing white on white.
          on="#ffffff"
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
              backgroundColor: '#ffffff',
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
    </View>
  );
}
