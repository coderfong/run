// Deep-link target for territoryrun://clan/join/:code — Phase 1/2 stub.
// Phase 5 turns this into a real join-by-invite flow.

import React from 'react';
import { Text, View } from 'react-native';

import { Screen } from '../components/ui';
import { colors, space, type } from '../theme';

export default function ClubJoinScreen({ route }) {
  const code = route?.params?.code;
  return (
    <Screen center>
      <View style={{ alignItems: 'center' }}>
        <Text style={[type.labelSm, { marginBottom: space.sm }]}>Clan invite</Text>
        <Text style={[type.display, { letterSpacing: 4, marginBottom: space.lg }]}>{code || '—'}</Text>
        <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>
          Joining by invite arrives with the clan system in the next update.
        </Text>
      </View>
    </Screen>
  );
}
