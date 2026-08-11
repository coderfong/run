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

import { radius, space, useTheme, useThemedType } from '../../theme';
import { frameVariant } from '../../ui/frameRegistry';
import Button from './Button';
import Framed from './Framed';

export default function EmptyState({ icon, art, title, body, actionLabel, onAction, accent, dark = false, style }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const muted = dark ? 'rgba(255,255,255,0.66)' : colors.textMuted;
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
          tint={accent || '#1f2937'}
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
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: radius.lg,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: space.lg,
          }}
        >
          {icon}
        </View>
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
