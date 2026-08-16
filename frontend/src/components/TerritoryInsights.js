// TerritoryInsights — what the run you just finished actually achieved.
//
// This is the "show the accomplishment, paywall the rabbit hole" panel, and
// the order of the two halves is the whole idea:
//
//   FREE, and first — what you DID. Land claimed, taken off whom, your biggest
//   capture, and where that leaves you on the board. Nobody pays to find out
//   what happened in their own run, and nobody pays to find out whether they
//   are winning.
//
//   PRO, underneath — what it MEANS. This run against your own recent form,
//   whether it was your best, and which of your land is about to decay.
//
// It renders nothing at all for a run that claimed no ground: a panel of
// zeroes after a run that was never going to claim anything is noise, and the
// screen above it already says why there was no claim.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { GOLD } from '../config/pro';
import { IAP_ENABLED } from '../config/releaseFeatures';
import usePro from '../hooks/usePro';
import { useQuery } from '../hooks/useQuery';
import { radius, space, useTheme, useThemedType } from '../theme';
import BuyProSheet from './BuyProSheet';
import { ToonButton } from './ui';

const km2 = (m2) => {
  const v = Math.max(0, Number(m2) || 0) / 1e6;
  return `${v.toFixed(v >= 0.1 ? 2 : 3)} km²`;
};

const ordinal = (n) => {
  const r100 = n % 100;
  if (r100 >= 11 && r100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};

function Line({ label, value, colors, type, tint }) {
  return (
    <View style={[styles.line, { borderBottomColor: colors.border }]}>
      <Text style={[type.caption, { color: colors.textMuted, flex: 1 }]}>{label}</Text>
      <Text style={[type.bodySmBold, tint ? { color: tint } : null]}>{value}</Text>
    </View>
  );
}

export default function TerritoryInsights({ runId, style }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const { isPro } = usePro();
  const [payOpen, setPayOpen] = useState(false);

  const { data } = useQuery(runId ? `insights:${runId}` : null, () => api.runInsights(runId), {
    // A finished run's insights do not change; the only reason to refetch is
    // a subscription starting, which invalidates this key from the paywall.
    staleMs: 10 * 60 * 1000,
    fallback: null,
  });

  if (!data) return null;
  const claimed = (data.territory_m2 || 0) > 0 || (data.stolen_m2 || 0) > 0;
  if (!claimed) return null;

  const pro = data.pro;
  // The comparison is what makes a rate mean anything, so the rate is only
  // shown when there is something to compare it against.
  const better =
    pro?.m2_per_km != null && pro?.m2_per_km_30d != null
      ? pro.m2_per_km >= pro.m2_per_km_30d
      : null;

  return (
    <View style={[styles.panel, { backgroundColor: colors.card }, style]}>
      <Text style={[type.captionMedium, { color: colors.textMuted, marginBottom: space.xs }]}>
        TERRITORY
      </Text>

      <Line label="Land claimed" value={km2(data.territory_m2)} colors={colors} type={type} />
      {data.land_gained_m2 != null ? (
        <Line label="New ground" value={km2(data.land_gained_m2)} colors={colors} type={type} />
      ) : null}
      {data.rivals_taken > 0 ? (
        <Line
          label={`Taken from ${data.rivals_taken} ${data.rivals_taken === 1 ? 'runner' : 'runners'}`}
          value={km2(data.stolen_m2)}
          colors={colors}
          type={type}
        />
      ) : null}
      {data.biggest_capture_m2 > 0 ? (
        <Line label="Biggest capture" value={km2(data.biggest_capture_m2)} colors={colors} type={type} />
      ) : null}
      {data.rivals_held > 0 ? (
        <Line
          label={`Held against you by ${data.rivals_held}`}
          value="·"
          colors={colors}
          type={type}
        />
      ) : null}
      {data.standing_rank ? (
        <Line
          label="You now stand"
          value={`${ordinal(data.standing_rank)} of ${data.standing_field.toLocaleString()}`}
          colors={colors}
          type={type}
        />
      ) : null}

      {pro ? (
        <>
          <Text style={[type.captionMedium, { color: GOLD, marginTop: space.md, marginBottom: space.xs }]}>
            YOUR FORM
          </Text>
          {pro.is_personal_best ? (
            <Line label="Personal best" value="Biggest claim yet" colors={colors} type={type} tint={GOLD} />
          ) : null}
          {pro.m2_per_km != null ? (
            <Line
              label="Land per kilometre"
              value={
                better == null
                  ? km2(pro.m2_per_km)
                  : `${km2(pro.m2_per_km)} · ${better ? 'above' : 'below'} your usual`
              }
              colors={colors}
              type={type}
              tint={better === true ? GOLD : undefined}
            />
          ) : null}
          <Line
            label="Last 30 days"
            value={`${pro.claims_30d} ${pro.claims_30d === 1 ? 'claim' : 'claims'} · ${((pro.distance_m_30d || 0) / 1000).toFixed(0)} km`}
            colors={colors}
            type={type}
          />
          {pro.stolen_m2_30d > 0 ? (
            <Line label="Taken off rivals, 30 days" value={km2(pro.stolen_m2_30d)} colors={colors} type={type} />
          ) : null}
          {pro.at_risk_count > 0 ? (
            <Line
              label={`${pro.at_risk_count} ${pro.at_risk_count === 1 ? 'plot' : 'plots'} expiring soon`}
              value={km2(pro.at_risk_m2)}
              colors={colors}
              type={type}
            />
          ) : null}
        </>
      ) : IAP_ENABLED && !isPro ? (
        <View style={[styles.teaser, { borderColor: GOLD }]}>
          <Text style={[type.bodySmBold]}>See how this run compares</Text>
          <Text style={[type.caption, { color: colors.textMuted, marginTop: 2 }]}>
            Your form over the last 30 days, whether this was your best claim yet, and which of your land is about to decay.
          </Text>
          <ToonButton
            title="See the plans"
            variant="gold"
            size="sm"
            onPress={() => setPayOpen(true)}
            style={{ marginTop: space.sm }}
          />
        </View>
      ) : null}

      <BuyProSheet visible={payOpen} onClose={() => setPayOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.card, padding: space.md },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
  teaser: {
    marginTop: space.md,
    borderWidth: 2,
    borderRadius: radius.card,
    padding: space.md,
  },
});
