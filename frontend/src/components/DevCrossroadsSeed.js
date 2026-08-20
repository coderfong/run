// Development-only: fill the Crossroads plaza without crossing anyone's path.
//
// Crossroads (the "paserby" plaza) only has anyone in it after two runners
// pass each other in the real world, so at a desk it is empty — and the entry
// button is hidden until there is at least one encounter, so there is no way
// in to look at the screen at all. This seeds REAL encounter rows against a
// set of throwaway bot runners, then opens the plaza on them.
//
// Same shape as DevRunSimulator, one surface over: the client builds the
// synthetic input — here a batch of real equipped loadouts, so the seeded
// characters wear real cosmetics instead of the default look — and the server
// does the allowlisted mutation (/dev/paserby/seed). What the plaza then draws
// is the real screen reading the real tables, not a mock.
//
// WHY THE GATE IS NOT `__DEV__` ALONE, same as DevRunSimulator: a build flag is
// decided when the binary is made, so a TestFlight build would carry it and a
// release promotion would ship it. `dev_tools` comes from /me and is false for
// every account the server has not named (backend/app/devtools.py), and the
// endpoint enforces that same allowlist server-side — this card is only the
// convenience of not advertising it.

import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { useAuth } from '../auth/AuthContext';
import { useAvatar } from '../state/avatar';
import { randomEquipped } from '../config/cosmetics';
import { radius, space, useTheme, useThemedType } from '../theme';
import { PressableScale, haptic } from '../ui/motion';
import { toast } from '../ui/toast';

// One plaza is twenty; the choices bracket that so both the single-plaza and
// the paging (more than one plaza) cases are one tap away.
const COUNTS = [8, 24, 48];

export default function DevCrossroadsSeed({ onOpen, style }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const type = useThemedType();
  const { unlockCtx } = useAvatar();
  const [count, setCount] = useState(24);
  const [busy, setBusy] = useState(false);

  // Hooks first, then the gate — an early return above them would change the
  // hook order between an allowed and a disallowed account.
  if (!__DEV__ && !user?.dev_tools) return null;

  // Fresh Crossroads data supersedes whatever these caches hold, so drop them
  // before the screen (and Home's badge) read again.
  const refreshCrossroads = () => {
    invalidate('me:paserby');
  };

  const seed = async () => {
    if (busy) return;
    setBusy(true);
    try {
      haptic.light();
      // Real loadouts from the user's unlocked pool — variety is the whole
      // point of the plaza, and these render exactly like a runner's own
      // character does.
      const avatars = Array.from({ length: count }, () => randomEquipped(unlockCtx));
      const out = await api.devSeedCrossroads(avatars, count);
      refreshCrossroads();
      toast.success(`Seeded ${out.created} at the Crossroads`);
      onOpen?.();
    } catch (err) {
      toast.error(err.message || 'Could not seed the Crossroads');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.devClearCrossroads();
      refreshCrossroads();
      toast.success('Cleared the seeded Crossroads');
    } catch (err) {
      toast.error(err.message || 'Could not clear the Crossroads');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { borderColor: colors.border, backgroundColor: colors.cardAlt }, style]}>
      <View style={styles.headerRow}>
        <Text style={[type.caption, { color: colors.textMuted }]}>DEV · seed the Crossroads</Text>
        {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      </View>
      <Text style={[type.caption, { color: colors.textDim }]}>How many runners</Text>
      <View style={styles.row}>
        {COUNTS.map((n) => {
          const active = count === n;
          return (
            <PressableScale
              key={n}
              onPress={() => setCount(n)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.chip,
                {
                  borderColor: active ? colors.text : colors.border,
                  backgroundColor: active ? colors.text : 'transparent',
                  opacity: busy ? 0.4 : 1,
                },
              ]}
            >
              <Text style={[type.caption, { color: active ? colors.bg : colors.text }]}>{n}</Text>
            </PressableScale>
          );
        })}
      </View>
      <PressableScale
        onPress={seed}
        disabled={busy}
        accessibilityRole="button"
        style={[styles.seedButton, { borderColor: colors.text, opacity: busy ? 0.4 : 1 }]}
      >
        <Text style={[type.captionMedium, { color: colors.text }]}>SEED &amp; OPEN CROSSROADS</Text>
      </PressableScale>
      <Text style={[type.caption, { color: colors.textDim }]}>
        Creates real crossed-paths rows against throwaway bot runners, wearing a
        spread of cosmetics, clubs and familiarity. Opens the plaza on them.
      </Text>
      <PressableScale
        onPress={clear}
        disabled={busy}
        accessibilityRole="button"
        style={[styles.clearButton, { borderColor: colors.danger, opacity: busy ? 0.4 : 1 }]}
      >
        <Text style={[type.captionMedium, { color: colors.danger }]}>CLEAR SEEDED CROSSROADS</Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.md,
    gap: space.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  seedButton: {
    borderWidth: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  clearButton: {
    borderWidth: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
