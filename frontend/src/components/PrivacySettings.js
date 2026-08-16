// Route privacy — the controls for what other people see of your runs.
//
// A GPS trace is a home address. The server trims the ends of a published
// route, blanks anything inside a privacy circle, and withholds a route for a
// few hours after the run; this is where a runner sees and changes that.
//
// The defaults are protective and already in force before anyone opens this
// screen, so nothing here is a prerequisite for being safe — it exists so the
// protection is visible and adjustable, not so it can be switched on.

import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { MapPinOff, Trash2 } from 'lucide-react-native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { radius, space, useTheme, useThemedType } from '../theme';
import { Card, Row, Button, SectionHeader, Segmented, Skeleton } from './ui';
import { Arrival, PressableScale, useArrival } from '../ui/motion';
import { toast } from '../ui/toast';

// Offered values. "Off" is deliberately available — this is the runner's call,
// and a control that only goes one way is not a setting.
const TRIM_OPTIONS = [
  { key: 0, label: 'Off' },
  { key: 250, label: '250 m' },
  { key: 500, label: '500 m' },
];
const DELAY_OPTIONS = [
  { key: 0, label: 'Live' },
  { key: 3, label: '3 h' },
  { key: 24, label: '24 h' },
];

// Snap an arbitrary server value onto the nearest offered option, so a value
// set on another device (or by a future default) still shows as selected
// rather than leaving every segment looking off.
function nearest(options, value) {
  let best = options[0].key;
  for (const o of options) {
    if (Math.abs(o.key - value) < Math.abs(best - value)) best = o.key;
  }
  return best;
}

export default function PrivacySettings() {
  const { colors } = useTheme();
  const type = useThemedType();
  const { data, setData, refresh } = useQuery('me:privacy', api.privacy);
  const [busy, setBusy] = useState(false);
  const arriving = useArrival(!data);

  if (!data) {
    return (
      <>
        <SectionHeader title="Privacy" style={{ marginTop: space.xl, marginBottom: space.md }} />
        <Skeleton width="100%" height={140} style={{ borderRadius: radius.card }} />
      </>
    );
  }

  const zones = data.zones || [];

  // Optimistic: the controls are toggles and a round trip makes them feel
  // broken. A failure puts the old value back and says so.
  const save = async (patch) => {
    const before = data;
    setData({ ...data, ...patch });
    setBusy(true);
    try {
      setData(await api.setPrivacy(patch));
    } catch (e) {
      setData(before);
      toast.error(e.message || "Couldn't save that");
    } finally {
      setBusy(false);
    }
  };

  const addZoneHere = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const asked = await Location.requestForegroundPermissionsAsync();
        if (asked.status !== 'granted') {
          toast.error('Location is needed to mark this spot private');
          return;
        }
      }
      if (zones.length >= (data.max_zones ?? 10)) {
        toast.error(`That's the maximum of ${data.max_zones} private areas`);
        return;
      }
      setBusy(true);
      const loc = await Location.getCurrentPositionAsync({});
      await save({
        zones: [
          ...zones,
          {
            lat: loc.coords.latitude,
            lon: loc.coords.longitude,
            radius_m: Math.max(150, data.min_zone_radius_m ?? 100),
            label: 'Private area',
          },
        ],
      });
      toast.success('This area is now hidden from your published routes');
    } catch (e) {
      toast.error(e.message || "Couldn't read your location");
    } finally {
      setBusy(false);
    }
  };

  const removeZone = (i) => {
    Alert.alert('Remove private area?', 'Routes through it will be published again.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => save({ zones: zones.filter((_, j) => j !== i) }),
      },
    ]);
  };

  return (
    <>
      {/* The header is drawn over the placeholder too, so it stays OUTSIDE the
          fade — taking a title that never left and ramping it up from nothing
          reads as a blink, not as an entrance. Only the controls arrive. */}
      <SectionHeader title="Privacy" style={{ marginTop: space.xl, marginBottom: space.md }} />

      <Arrival active={arriving}>
      {/* Age floors are enforced server-side; saying so is better than letting
          a control snap back with no explanation. */}
      {data.minor ? (
        <Card style={{ marginBottom: space.md, borderLeftWidth: 4, borderLeftColor: colors.primary }}>
          <Text style={type.bodySmBold}>Extra protection is on</Text>
          <Text style={[type.caption, { marginTop: 2 }]}>
            Because of your age, more of each route stays hidden and it's published later.
            You can make these stricter, but not weaker.
          </Text>
        </Card>
      ) : null}

      <Card>
        <Text style={type.labelSm}>Hide the start and end of my routes</Text>
        <Text style={[type.caption, { marginTop: 2, marginBottom: space.md }]}>
          Other runners never see this much of each end. Your own runs always show in full.
        </Text>
        <Segmented
          options={TRIM_OPTIONS.map((o) => ({ ...o, key: String(o.key) }))}
          value={String(nearest(TRIM_OPTIONS, data.route_trim_m ?? 0))}
          onChange={(k) => save({ route_trim_m: Number(k) })}
          labelSuffix="of route hidden"
        />
      </Card>

      <Card style={{ marginTop: space.md }}>
        <Text style={type.labelSm}>Publish my routes after</Text>
        <Text style={[type.caption, { marginTop: 2, marginBottom: space.md }]}>
          A delay keeps anyone from seeing where you are while you're still out there.
        </Text>
        <Segmented
          options={DELAY_OPTIONS.map((o) => ({ ...o, key: String(o.key) }))}
          value={String(nearest(DELAY_OPTIONS, data.publish_delay_h ?? 0))}
          onChange={(k) => save({ publish_delay_h: Number(k) })}
          labelSuffix="delay"
        />
      </Card>

      <Card style={{ marginTop: space.md }}>
        <Text style={type.labelSm}>Private areas</Text>
        <Text style={[type.caption, { marginTop: 2, marginBottom: space.md }]}>
          Home, school, work. Anything you run through inside one of these is cut out
          before anyone else sees the route.
        </Text>

        {zones.length === 0 ? (
          <Text style={[type.caption, { color: colors.textDim, marginBottom: space.md }]}>
            None yet.
          </Text>
        ) : (
          zones.map((z, i) => (
            <Row between key={`${z.lat},${z.lon},${i}`} style={styles.zoneRow}>
              <Row gap={10} style={{ flex: 1 }}>
                <MapPinOff size={18} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={type.bodySmBold} numberOfLines={1}>
                    {z.label || 'Private area'}
                  </Text>
                  <Text style={type.caption}>
                    {Math.round(z.radius_m)} m around {z.lat.toFixed(3)}, {z.lon.toFixed(3)}
                  </Text>
                </View>
              </Row>
              <PressableScale
                onPress={() => removeZone(i)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${z.label || 'private area'}`}
              >
                <Trash2 size={18} color={colors.danger} />
              </PressableScale>
            </Row>
          ))
        )}

        <Button
          title="Hide my current area"
          variant="secondary"
          size="sm"
          loading={busy}
          disabled={busy}
          onPress={addZoneHere}
          style={{ marginTop: space.sm }}
        />
      </Card>
      </Arrival>
    </>
  );
}

const styles = StyleSheet.create({
  zoneRow: { paddingVertical: space.sm },
});
