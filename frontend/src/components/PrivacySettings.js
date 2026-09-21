// Route privacy — the controls for what other people see of your runs.
//
// A GPS trace is a home address. The server trims the ends of a published
// route, blanks anything inside a privacy circle, and withholds a route for a
// few hours after the run; this is where a runner sees and changes that.
//
// The defaults are protective and already in force before anyone opens this
// screen, so nothing here is a prerequisite for being safe — it exists so the
// protection is visible and adjustable, not so it can be switched on.

import React from 'react';
import { Text } from 'react-native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { radius, space, useTheme, useThemedType } from '../theme';
import { Card, SectionHeader, Segmented, Skeleton } from './ui';
import { Arrival, useArrival } from '../ui/motion';
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
function Heading({ nested }) {
  return (
    <SectionHeader
      title={nested ? 'Your routes' : 'Privacy'}
      framed={!nested}
      style={{ marginTop: nested ? space.md : space.xl, marginBottom: space.md }}
    />
  );
}
function nearest(options, value) {
  let best = options[0].key;
  for (const o of options) {
    if (Math.abs(o.key - value) < Math.abs(best - value)) best = o.key;
  }
  return best;
}

// `nested` says this block is inside a folded section of the You page rather
// than standing on its own. It changes the HEADING only: no drawn label box
// (the section's head is already one, and two stacked read as a box in a box),
// a tighter gap above, and the honest title for what this actually controls —
// "Privacy" is the name of the section it now sits in.
export default function PrivacySettings({ nested = false }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const { data, setData } = useQuery('me:privacy', api.privacy);
  const arriving = useArrival(!data);

  if (!data) {
    return (
      <>
        <Heading nested={nested} />
        <Skeleton width="100%" height={140} style={{ borderRadius: radius.card }} />
      </>
    );
  }

  // Optimistic: the controls are toggles and a round trip makes them feel
  // broken. A failure puts the old value back and says so.
  const save = async (patch) => {
    const before = data;
    setData({ ...data, ...patch });
    try {
      setData(await api.setPrivacy(patch));
    } catch (e) {
      setData(before);
      toast.error(e.message || "Couldn't save that");
    }
  };

  return (
    <>
      {/* The header is drawn over the placeholder too, so it stays OUTSIDE the
          fade — taking a title that never left and ramping it up from nothing
          reads as a blink, not as an entrance. Only the controls arrive. */}
      <Heading nested={nested} />

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
        <Segmented
          style={{ marginTop: space.md }}
          options={TRIM_OPTIONS.map((o) => ({ ...o, key: String(o.key) }))}
          value={String(nearest(TRIM_OPTIONS, data.route_trim_m ?? 0))}
          onChange={(k) => save({ route_trim_m: Number(k) })}
          labelSuffix="of route hidden"
        />
      </Card>

      <Card style={{ marginTop: space.md }}>
        <Text style={type.labelSm}>Publish my routes after</Text>
        <Segmented
          style={{ marginTop: space.md }}
          options={DELAY_OPTIONS.map((o) => ({ ...o, key: String(o.key) }))}
          value={String(nearest(DELAY_OPTIONS, data.publish_delay_h ?? 0))}
          onChange={(k) => save({ publish_delay_h: Number(k) })}
          labelSuffix="delay"
        />
      </Card>

      </Arrival>
    </>
  );
}
