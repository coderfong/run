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
import Button from './Button';

export default function EmptyState({ icon, art, title, body, actionLabel, onAction, accent, dark = false, style }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const muted = dark ? 'rgba(255,255,255,0.66)' : colors.textMuted;
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', padding: space.xl }, style]}>
      {art ? (
        <View
          style={{
            width: 176,
            height: 176,
            borderRadius: 40,
            backgroundColor: '#ffffff',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: space.lg,
          }}
        >
          <Image source={art} style={{ width: 148, height: 148 }} resizeMode="contain" />
        </View>
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
          style={{ marginTop: space.lg }}
        />
      ) : null}
    </View>
  );
}
