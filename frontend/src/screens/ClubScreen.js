// Club tab — Phase 1 placeholder. Phase 5 replaces this with the full clan
// system (directory, create/join, member hub). Kept honest and on-brand.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Shield } from 'lucide-react-native';

import { colors, radius, space, type } from '../theme';
import { useAccent } from '../hooks/useAccent';

export default function ClubScreen() {
  const accent = useAccent();
  return (
    <View style={styles.container}>
      <View style={[styles.badge, { borderColor: accent }]}>
        <Shield size={40} color={accent} strokeWidth={2} />
      </View>
      <Text style={styles.title}>Clans are coming</Text>
      <Text style={styles.body}>
        Real run clubs replace teams. Create one, invite your crew, and take
        territory together.{'\n\n'}Solo land is grey. Clan land conquers.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  badge: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  title: { ...type.title, marginBottom: space.sm },
  body: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
});
