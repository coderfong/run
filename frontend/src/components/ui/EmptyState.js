// EmptyState — centered icon + title + body + optional action. Copy must
// direct action (constitution): titles state the situation, actions say what
// they do.

import React from 'react';
import { Text, View } from 'react-native';

import { colors, radius, space, type } from '../../theme';
import Button from './Button';

export default function EmptyState({ icon, title, body, actionLabel, onAction, accent, dark = false, style }) {
  const muted = dark ? 'rgba(255,255,255,0.66)' : colors.textMuted;
  return (
    <View style={[{ alignItems: 'center', justifyContent: 'center', padding: space.xl }, style]}>
      {icon ? (
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
