// Development controls for every PASER PRO state worth looking at.
//
// WHY THIS EXISTS. Most of the monetisation only appears under conditions that
// are slow or impossible to reach at a desk: three finished runs, a notable
// claim, a twenty hour gap since the last prompt, an exhausted planner
// allowance. Without this you check the "1 preview left" copy by planning two
// routes, and you check "free user" by cancelling a subscription.
//
// WHAT IT IS NOT. It does not replace any runtime logic. `devPro` is read in
// exactly one place (ProProvider) and only ever under `__DEV__`; the exposure
// setters write to the same real record the app reads, so what you are looking
// at IS the real screen in a real state, not a mock of one. Nothing here can
// grant entitlement on the server, and nothing here is reachable in a release
// build without the server naming the account.
//
// Gated exactly like DevRunSimulator: `__DEV__`, or an account the server has
// flagged with `dev_tools` on /me.

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { recentEvents } from '../analytics';
import { useAuth } from '../auth/AuthContext';
import { GOLD } from '../config/pro';
import { PRO_CONTEXTS } from '../config/proContexts';
import { FREE_PLANNER_PREVIEWS } from '../config/proExposure';
import { IAP_ENABLED } from '../config/releaseFeatures';
import { useProEntitlement } from '../pro/ProProvider';
import { devResetExposure, devSetExposure, exposureSnapshot } from '../pro/exposure';
import { devStoreOverride, setDevStoreOverride } from '../pro/storeAvailable';
import { radius, space, useTheme, useThemedType } from '../theme';
import { PressableScale } from '../ui/motion';

function Btn({ label, on, onPress, colors, type }) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      style={[
        styles.btn,
        { borderColor: on ? GOLD : colors.border, backgroundColor: on ? colors.cardAlt : 'transparent' },
      ]}
    >
      <Text style={[type.caption, { color: on ? GOLD : colors.textMuted }]}>{label}</Text>
    </PressableScale>
  );
}

export default function DevProPanel({ style }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const type = useThemedType();
  const {
    isPro,
    canSell,
    devPro,
    setDevPro,
    openPaywall,
    previewProWelcome,
    plannerPreviewsLeft,
    runCount,
  } = useProEntitlement();
  // Bumped to re-read the exposure record, which is a plain module object
  // rather than React state — nothing else would tell this panel it changed.
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);

  if (!__DEV__ && !user?.dev_tools) return null;

  const snap = exposureSnapshot();

  // Spends are recorded as a total, so "1 left" is the total minus one.
  const setPlanner = (left) => {
    devSetExposure({ plannerUses: Math.max(0, FREE_PLANNER_PREVIEWS - left) });
    refresh();
  };

  const events = recentEvents().slice(-6).reverse();

  return (
    <View style={[styles.panel, { borderColor: GOLD, backgroundColor: colors.card }, style]}>
      <Text style={[type.captionMedium, { color: GOLD }]}>DEV · PASER PRO</Text>
      <Text style={[type.caption, { color: colors.textMuted, marginBottom: space.sm }]}>
        {`store ${canSell ? (IAP_ENABLED ? 'on' : 'dev') : 'OFF'} · entitled ${isPro ? 'yes' : 'no'} · runs ${runCount ?? '·'} · session prompts ${snap.autoThisSession}`}
      </Text>

      {/* THE SWITCH THAT MAKES THE REST OF THIS PANEL USEFUL.
          `IAP_ENABLED` is false until a sandbox purchase has been taken end to
          end, and while it is false every PRO surface in the app renders
          nothing at all — the Home card, the Profile poster, the teasers, the
          padlocks and the popups. That is correct for a release and useless
          for looking at what was built, so this shows them without claiming a
          purchase would complete.

          Rendered only under `__DEV__`, unlike the rest of this panel: the
          override itself is a no-op in any other build (storeAvailable.js), so
          a `dev_tools` account on TestFlight would otherwise be looking at two
          buttons that do nothing. */}
      {__DEV__ ? (
        <>
          <Text style={[type.caption, { color: colors.textDim }]}>
            {`Store · release switch ${IAP_ENABLED ? 'ON' : 'off'}`}
          </Text>
          <View style={styles.row}>
            <Btn
              label="Hidden"
              on={!canSell}
              onPress={() => { setDevStoreOverride(false); refresh(); }}
              colors={colors}
              type={type}
            />
            <Btn
              label="Show PRO surfaces"
              on={devStoreOverride()}
              onPress={() => { setDevStoreOverride(true); refresh(); }}
              colors={colors}
              type={type}
            />
          </View>
        </>
      ) : null}

      <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>Entitlement</Text>
      <View style={styles.row}>
        <Btn label="Server truth" on={devPro === null} onPress={() => setDevPro(null)} colors={colors} type={type} />
        <Btn label="Free" on={devPro === false} onPress={() => setDevPro(false)} colors={colors} type={type} />
        <Btn label="PRO" on={devPro === true} onPress={() => setDevPro(true)} colors={colors} type={type} />
      </View>

      <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>
        {`Planner previews · ${plannerPreviewsLeft === Infinity ? 'unlimited' : plannerPreviewsLeft} left`}
      </Text>
      <View style={styles.row}>
        {[3, 1, 0].map((n) => (
          <Btn
            key={n}
            label={n === 0 ? 'Exhausted' : `${n} left`}
            on={plannerPreviewsLeft === n}
            onPress={() => setPlanner(n)}
            colors={colors}
            type={type}
          />
        ))}
        <Btn
          label="Reset all"
          onPress={() => { devResetExposure(); refresh(); }}
          colors={colors}
          type={type}
        />
      </View>

      <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>
        Paywall context
      </Text>
      <View style={styles.row}>
        {Object.keys(PRO_CONTEXTS).map((key) => (
          <Btn key={key} label={key} onPress={() => openPaywall(key)} colors={colors} type={type} />
        ))}
      </View>

      <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>
        Welcome ceremony
      </Text>
      <View style={styles.row}>
        <Btn label="New subscriber" onPress={() => previewProWelcome(false)} colors={colors} type={type} />
        <Btn label="Returning" onPress={() => previewProWelcome(true)} colors={colors} type={type} />
      </View>

      {/* The funnel, as it fires. Without a vendor attached this is the only
          way to see that an impression really was recorded and with which
          source — which is exactly what goes wrong silently. */}
      <Text style={[type.caption, { color: colors.textDim, marginTop: space.sm }]}>
        Recent events
      </Text>
      <ScrollView style={{ maxHeight: 96 }} showsVerticalScrollIndicator={false}>
        {events.length === 0 ? (
          <Text style={[type.caption, { color: colors.textMuted }]}>Nothing yet.</Text>
        ) : (
          events.map((e, i) => (
            <Text key={`${e.at}-${i}`} style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
              {`${e.name} · ${e.props.source || '·'}${e.props.feature ? ` · ${e.props.feature}` : ''}`}
            </Text>
          ))
        )}
      </ScrollView>
      <PressableScale onPress={refresh} accessibilityRole="button" style={{ paddingVertical: 6 }}>
        <Text style={[type.caption, { color: colors.textMuted, textDecorationLine: 'underline' }]}>
          Refresh
        </Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 2, borderRadius: radius.card, padding: space.md },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  btn: { borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
});
