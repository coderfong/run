// Deep-link target for territoryrun://clan/join/:code — join by invite.

import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../api/client';
import { useClan } from '../state/clan';
import { colors, space, type } from '../theme';
import { Screen, Button } from '../components/ui';
import { toast } from '../ui/toast';

export default function ClubJoinScreen({ route, navigation }) {
  const code = route?.params?.code;
  const { clan, refresh } = useClan();
  const [busy, setBusy] = useState(false);

  const join = async () => {
    if (!code) return;
    setBusy(true);
    try {
      await api.joinByCode(code);
      await refresh();
      toast.success('Joined clan');
      navigation.navigate('ClubMain');
    } catch (e) {
      toast.error(e.message || 'Invalid or expired code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen center>
      <View style={{ alignItems: 'center', width: '100%' }}>
        <Text style={[type.labelSm, { marginBottom: space.sm }]}>Clan invite</Text>
        <Text style={[type.display, { letterSpacing: 4, marginBottom: space.lg }]}>{code || '—'}</Text>
        {clan?.clan_id ? (
          <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>
            Leave your current clan first to accept a new invite.
          </Text>
        ) : (
          <Button title="Join clan" onPress={join} loading={busy} disabled={!code} />
        )}
      </View>
    </Screen>
  );
}
