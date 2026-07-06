// Deep-link target for territoryrun://clan/join/:code — Phase 1 stub.
// Phase 5 turns this into a real "join clan by invite" flow (preview the
// clan, confirm, POST /clans/join-by-code).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, space, type } from '../theme';

export default function ClubJoinScreen({ route }) {
  const code = route?.params?.code;
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>Clan invite</Text>
      <Text style={styles.code}>{code || '—'}</Text>
      <Text style={styles.body}>
        Joining by invite arrives with the clan system in the next update.
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
  eyebrow: { ...type.labelSm, marginBottom: space.sm },
  code: { ...type.display, letterSpacing: 4, marginBottom: space.lg },
  body: { ...type.body, color: colors.textMuted, textAlign: 'center' },
});
