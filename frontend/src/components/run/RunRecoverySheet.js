// "RUN STILL OPEN" — what the runner sees when PASER comes back to a run
// nobody has been running: the app was reopened hours later, the process died,
// or the session went stale while it sat in a pocket.
//
// It never decides for them. Finish ends the run at the last running movement
// (not now); Resume carries on and treats the gap as a pause; Discard throws
// the run away. The copy is plain and never accusatory: forgetting to press
// stop is the most normal thing a runner does.

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { ToonButton } from '../ui';
import { fonts, space, toon } from '../../theme';

function clockTime(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

function ago(ms, now) {
  const min = Math.max(0, Math.round((now - ms) / 60000));
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min ago` : `${h} h ago`;
}

export default function RunRecoverySheet({
  visible, lastActiveAt, distanceM = 0, accent = '#ec4899', busy = false, now = Date.now(),
  onFinish, onResume, onDiscard,
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.scrim}>
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.kicker}>RUN STILL OPEN</Text>
          <Text style={styles.title}>Looks like you stopped running.</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Last running movement</Text>
            <Text style={[styles.value, { color: accent }]}>
              {lastActiveAt ? `${clockTime(lastActiveAt)} · ${ago(lastActiveAt, now)}` : '·'}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Distance so far</Text>
            <Text style={styles.value}>{(distanceM / 1000).toFixed(2)} km</Text>
          </View>
          <Text style={styles.body}>PASER stopped counting while you were inactive.</Text>

          <ToonButton
            title="Finish run"
            onPress={onFinish}
            disabled={busy}
            loading={busy}
            accessibilityLabel="Finish the run at your last running movement"
            fill={{ color: accent, border: toon.ink }}
            style={styles.primary}
          />
          <Pressable
            style={styles.secondary}
            onPress={onResume}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Resume the run. The time you were inactive is not counted."
          >
            <Text style={styles.secondaryText}>Resume run</Text>
          </Pressable>
          <Pressable
            style={styles.secondary}
            onPress={onDiscard}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Discard this run"
          >
            <Text style={[styles.secondaryText, styles.discard]}>Discard</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(8,8,14,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.gutter,
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: '#15151F',
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#2A2A3A',
    padding: space.lg,
  },
  kicker: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.6, color: '#9A9AB0' },
  title: { fontFamily: fonts.display, fontSize: 24, color: '#FFFFFF', marginTop: 4, marginBottom: space.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 6 },
  label: { fontFamily: fonts.medium || fonts.bold, fontSize: 14, color: '#B8B8CC' },
  value: { fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' },
  body: { fontFamily: fonts.medium || fonts.bold, fontSize: 14, color: '#B8B8CC', marginTop: space.md, marginBottom: space.lg },
  primary: { alignSelf: 'stretch' },
  secondary: { alignItems: 'center', paddingVertical: space.md },
  secondaryText: { fontFamily: fonts.bold, fontSize: 16, color: '#FFFFFF' },
  discard: { color: '#FF7A7A' },
});
