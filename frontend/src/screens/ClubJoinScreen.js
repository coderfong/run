// Deep-link target for pacer://clan/join/:code — join by invite.

import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { api } from '../api/client';
import { useClan } from '../state/clan';
import { space, useTheme, useThemedStyles, useThemedType } from '../theme';
import { Screen, Button } from '../components/ui';
import { toast } from '../ui/toast';
import { Reveal } from '../ui/motion';

export default function ClubJoinScreen({ route, navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const code = route?.params?.code;
  const { clan, refresh } = useClan();
  const [busy, setBusy] = useState(false);

  const join = async () => {
    if (!code) return;
    setBusy(true);
    try {
      await api.joinByCode(code);
      await refresh();
      toast.success('Joined club');
      navigation.navigate('ClubMain');
    } catch (e) {
      toast.error(e.message || 'Invalid or expired code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen center>
      {/* You arrive here from a link outside the app, so this is the first
          PASER frame someone sees. The label, the code and the action arrive in
          that order rather than all at once. */}
      <View style={{ alignItems: 'center', width: '100%' }}>
        <Reveal>
          <Text style={[type.labelSm, { marginBottom: space.sm }]}>Club invite</Text>
        </Reveal>
        <Reveal delay={90}>
          <Text style={[type.display, { letterSpacing: 4, marginBottom: space.lg }]}>{code || '······'}</Text>
        </Reveal>
        <Reveal delay={200} style={{ width: '100%', alignItems: 'center' }}>
          {clan?.clan_id ? (
            <Text style={[type.body, { color: colors.textMuted, textAlign: 'center' }]}>
              Leave your current club first to accept a new invite.
            </Text>
          ) : (
            <Button title="Join club" onPress={join} loading={busy} disabled={!code} />
          )}
        </Reveal>
      </View>
    </Screen>
  );
}
