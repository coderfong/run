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

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { GOLD } from '../config/pro';
import { useQuery } from '../hooks/useQuery';
import { useProEntitlement } from '../pro/ProProvider';
import { notableRun } from '../pro/notableRun';
import { radius, space, useTheme, useThemedType } from '../theme';
import ProTeaser from './ProTeaser';

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

/**
 * `allowAutoPrompt` is OFF by default and only ResultScreen turns it on.
 *
 * This panel is also shown on RunDetailScreen, where the run may be weeks old.
 * A paywall that opens itself because somebody scrolled back through their
 * history to look at a good run from last month is an ambush — the trigger is
 * meant to be "you just did something notable", and browsing is not that.
 */
/**
 * `hideClaimSummary` drops the two free lines that a result card already
 * shouts — the total claimed, and the ground taken off a rival. ResultScreen
 * sets it, because right above this panel the hero number IS the land claimed
 * and the delta row IS the steal; repeating them here is the "redundant
 * territory report" the panel was fairly accused of being. RunDetailScreen
 * leaves it off: read back a week later there is no hero card above it, so the
 * summary is the only place those numbers appear at all.
 *
 * What stays either way is the part a card never shows — new ground broken,
 * biggest single capture, where the run leaves you on the board — and, for a
 * subscriber, the form analytics that were always the actual depth here.
 */
export default function TerritoryInsights({ runId, style, allowAutoPrompt = false, hideClaimSummary = false }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const { openPaywall } = useProEntitlement();
  const promptedFor = useRef(null);

  const { data } = useQuery(runId ? `insights:${runId}` : null, () => api.runInsights(runId), {
    // A finished run's insights do not change; the only reason to refetch is
    // a subscription starting, which invalidates this key from the paywall.
    staleMs: 10 * 60 * 1000,
    fallback: null,
  });

  const pro = data?.pro;
  // A run that took no ground gets no panel at all (see the early return
  // below), so it must not get a prompt either — otherwise a runner whose
  // standing happens to be high is sold to after a run that achieved nothing.
  const claimedAny = (data?.territory_m2 || 0) > 0 || (data?.stolen_m2 || 0) > 0;
  const notable = claimedAny ? notableRun(data) : { notable: false, headline: null };

  // The one automatic prompt in the app. Everything else waits to be tapped.
  //
  // Four things all have to be true before this opens anything: the run was
  // notable on its own numbers (notableRun), the account is not already PRO
  // (openPaywall refuses otherwise), and the exposure rules agree — which
  // means at least three runs finished, none shown this session, and none in
  // the last twenty hours. Realistically that is once, after a run that
  // actually meant something.
  //
  // It runs in an effect, keyed on the run, so it fires once per result and
  // never re-fires when the panel re-renders behind the sheet.
  //
  // It deliberately does NOT interrupt the claim choreography: this component
  // is mounted well down the scrolled result body, long after the victory beat
  // and the leaderboard transition have finished.
  useEffect(() => {
    if (!allowAutoPrompt || !data || !notable.notable) return;
    if (promptedFor.current === data.run_id) return;
    promptedFor.current = data.run_id;
    openPaywall('run_insights', { automatic: true });
  }, [allowAutoPrompt, data, notable.notable, openPaywall]);

  if (!data) return null;
  const claimed = (data.territory_m2 || 0) > 0 || (data.stolen_m2 || 0) > 0;
  if (!claimed) return null;

  // The comparison is what makes a rate mean anything, so the rate is only
  // shown when there is something to compare it against.
  const better =
    pro?.m2_per_km != null && pro?.m2_per_km_30d != null
      ? pro.m2_per_km >= pro.m2_per_km_30d
      : null;

  return (
    <View style={[styles.panel, { backgroundColor: colors.card }, style]}>
      <Text style={[type.captionMedium, { color: colors.textMuted, marginBottom: space.xs }]}>
        TERRITORY REPORT
      </Text>

      {!hideClaimSummary ? (
        <Line label="Land claimed" value={km2(data.territory_m2)} colors={colors} type={type} />
      ) : null}
      {data.land_gained_m2 != null ? (
        <Line label="New ground" value={km2(data.land_gained_m2)} colors={colors} type={type} />
      ) : null}
      {!hideClaimSummary && data.rivals_taken > 0 ? (
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
      ) : (
        // The locked half. Every row is NAMED and none carries a number,
        // because the free response genuinely does not contain one to show:
        // `pro` is null server-side for a free account (see
        // backend/app/routes/insights.py). Inventing a plausible "Top 18%"
        // here would be a lie the runner discovers the moment they pay, so
        // these stay as titles until the endpoint offers a real teaser
        // subset. The exact contract for that is in docs/PRO_BACKEND.md.
        <ProTeaser
          context="run_insights"
          // On a notable run the teaser leads with what actually happened,
          // in the runner's own numbers, rather than with the offer. The
          // headline is built from the same real fields the panel above is
          // already showing them.
          title={notable.headline || 'See what this run means'}
          blurb="How this run compares with your recent form."
          rows={[
            { label: 'Territory efficiency' },
            { label: 'Personal best check' },
            { label: 'Your 30 day form' },
            { label: 'Land about to expire' },
          ]}
          cta="View full territory analysis"
          feature="run_insights"
          style={{ marginTop: space.md }}
        />
      )}
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
});
