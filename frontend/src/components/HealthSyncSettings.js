// Apple Health — the switch that copies a finished run into the phone's own
// health record.
//
// Off by default and useless until the runner says yes twice: once here, once
// on Apple's permission sheet. The switch only moves after Health itself
// reports write access, so it can never sit on while nothing is being written.
//
// The component renders nothing on a device with no health store, which is
// every Android phone, the simulator, and iPad.

import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, View } from 'react-native';
import { HeartPulse } from 'lucide-react-native';

import { space, useTheme, useThemedType } from '../theme';
import { Card, Button, SectionHeader } from './ui';
import { toast } from '../ui/toast';
import {
  getHealthEnabled,
  healthSyncSupported,
  requestHealthPermission,
  setHealthEnabled,
} from '../health';

// `nested` — see PrivacySettings. This one keeps its own heading either way
// rather than letting the caller draw one: the whole component renders nothing
// on a device with no health store, and a heading printed outside it would be
// a lone "Apple Health" with nothing under it on every Android phone.
export default function HealthSyncSettings({ nested = false }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const supported = healthSyncSupported();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set once Apple has already been asked and refused. The permission sheet
  // is shown only the first time, so from then on the only way back is the
  // Health app and the copy has to say so.
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let alive = true;
    if (supported) getHealthEnabled().then((v) => alive && setOn(v));
    return () => {
      alive = false;
    };
  }, [supported]);

  if (!supported) return null;

  const toggle = async (next) => {
    if (busy) return;
    if (!next) {
      setOn(false);
      await setHealthEnabled(false);
      return;
    }
    setBusy(true);
    try {
      const granted = await requestHealthPermission();
      if (!granted) {
        setBlocked(true);
        toast.error('Apple Health did not allow writing');
        return;
      }
      await setHealthEnabled(true);
      setOn(true);
      setBlocked(false);
      toast.success('Your runs will be saved to Apple Health');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHeader
        title="Apple Health"
        framed={!nested}
        style={{ marginTop: nested ? space.md : space.xl, marginBottom: space.md }}
      />
      <Card>
        <View style={styles.row}>
          <View style={styles.label}>
            <Text style={type.body}>Save my runs to Apple Health</Text>
          </View>
          <Switch
            value={on}
            onValueChange={toggle}
            disabled={busy}
            trackColor={{ true: colors.primary }}
            accessibilityLabel="Save my runs to Apple Health"
          />
        </View>

        {blocked ? (
          <>
            <View style={styles.blockedRow}>
              <HeartPulse size={18} color={colors.textMuted} />
              <Text style={[type.caption, { flex: 1 }]}>
                Writing is turned off for PASER in the Health app. Open Health, then Sharing,
                then Apps, and allow PASER to write workouts.
              </Text>
            </View>
            <Button
              title="Open Settings"
              variant="secondary"
              size="sm"
              full={false}
              onPress={() => Linking.openSettings().catch(() => {})}
              style={{ marginTop: space.sm, alignSelf: 'flex-start' }}
            />
          </>
        ) : null}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { flex: 1, paddingRight: space.md },
  blockedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: space.md },
});
