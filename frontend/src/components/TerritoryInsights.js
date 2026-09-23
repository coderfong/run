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
//
// ---------------------------------------------------------------------------
// THE SHAPE, and why it is no longer a stack of hairlines.
// ---------------------------------------------------------------------------
//
// This panel sits between the personal records and the splits card, and it was
// the one surface on the result page with no stroke, no drop and no heading: a
// plain slab of six identically weighted rows, 4pt tall, divided by hairlines.
// Beside a 3pt framed record card and a gold strapped splits lock it read as a
// receipt pasted onto the page.
//
// Three changes, in the order they matter:
//
//   IT IS A BOX NOW. Ink stroke, hard offset drop, one heavy rule under the
//   masthead. The same three decisions as every other card (theme/nb.js).
//
//   ONE NUMBER LEADS. The first meaningful figure — new ground on the result
//   screen, total claimed when the run is read back later — is pulled out at
//   `type.stat` with its name as an eyebrow above it. A report where every
//   line carries the same weight has no answer to "so what happened", which is
//   the only question it exists to answer.
//
//   THE ROWS BREATHE. 12pt of vertical padding instead of 4, values on the
//   tabular stat face, and the comparison against your own form moved out of
//   the value string and into a chip. "0.064 km² · above your usual" as one
//   run on value was the row most likely to wrap on a small phone.
//
// 2026-09-23, ONE BOX, NOT THREE. Testers found the recap fragmented, and
// this card was a big part of it: a masthead rule, a divider under every row,
// and "Your form" as a gold box nested inside the card. Now there is one
// stroke (the card's), rows are separated by space alone, "Your form" is a
// labelled group under a single hairline, and every text takes its role from
// report/reportText.js, the scale the whole recap shares. On the result screen
// the lead is the STANDING: the ground is already the hero of the card above,
// and leading with it again was the repetition testers called out.
//
// The stranded "·" went with that. `Held against you by 2` used to render the
// empty value placeholder in the value column, so the row read as a fact whose
// number had failed to load. The count IS the figure, and now it says so.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../api/client';
import { GOLD } from '../config/pro';
import { useQuery } from '../hooks/useQuery';
import { useProEntitlement } from '../pro/ProProvider';
import { notableRun } from '../pro/notableRun';
import {
  NB,
  nbInk,
  nbRadius,
  space,
  useTheme,
  useThemedType,
  withAlpha,
} from '../theme';
import ProTeaser from './ProTeaser';
import { reportText } from './report/reportText';
import { HardShadow, Pill } from './ui';

const km2 = (m2) => {
  const v = Math.max(0, Number(m2) || 0) / 1e6;
  return `${v.toFixed(v >= 0.1 ? 2 : 3)} km²`;
};

const runners = (n) => `${n} ${n === 1 ? 'runner' : 'runners'}`;

const ordinal = (n) => {
  const r100 = n % 100;
  if (r100 >= 11 && r100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
};

/**
 * One reported figure.
 *
 * `note` is the qualifier that used to be glued onto the label ("Taken from 2
 * runners"), `tag` the one that used to be glued onto the value. Both are kept
 * off the two main columns so the names stay a readable left edge and the
 * numbers stay a scannable right one.
 */
function StatLine({ label, note, value, tag, t }) {
  return (
    <View
      style={styles.line}
      accessible
      accessibilityLabel={[label, note, value, tag].filter(Boolean).join(', ')}
    >
      <View style={styles.lineLabel}>
        <Text style={t.rowLabel}>{label}</Text>
        {note ? <Text style={[t.body, styles.lineNote]}>{note}</Text> : null}
        {tag ? <Pill label={tag} color={GOLD} style={styles.lineTag} /> : null}
      </View>
      <Text style={[t.statValue, styles.lineValue]} numberOfLines={1}>
        {value}
      </Text>
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
 * Since 2026-09-23 it also drops new ground and biggest capture: a claim is
 * one shape, so both are the hero number again. What stays is where the run
 * leaves you on the board (promoted to the lead), who held against you, and,
 * for a subscriber, the form analytics that were always the actual depth here.
 */
export default function TerritoryInsights({ runId, style, allowAutoPrompt = false, hideClaimSummary = false }) {
  const { colors, scheme } = useTheme();
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

  const ink = nbInk(scheme, colors.card);
  const hairline = withAlpha(ink, 0.14);
  const t = reportText(type, colors);

  // The free half, built as data rather than as JSX so the FIRST figure can be
  // promoted to the headline without a second copy of the same conditions.
  const facts = [];
  if (!hideClaimSummary) {
    facts.push({ key: 'claimed', label: 'Land claimed', value: km2(data.territory_m2) });
  }
  if (!hideClaimSummary && data.land_gained_m2 != null) {
    facts.push({ key: 'gained', label: 'New ground', value: km2(data.land_gained_m2) });
  }
  if (!hideClaimSummary && data.rivals_taken > 0) {
    facts.push({
      key: 'taken',
      label: 'Taken from rivals',
      note: runners(data.rivals_taken),
      value: km2(data.stolen_m2),
    });
  }
  // A claim is one shape, so on the result screen its biggest capture IS the
  // hero number above; read back later it is still worth a line.
  if (!hideClaimSummary && data.biggest_capture_m2 > 0) {
    facts.push({ key: 'biggest', label: 'Biggest capture', value: km2(data.biggest_capture_m2) });
  }
  if (data.rivals_held > 0) {
    // No area to report here: this is the number of runners who held their
    // ground against you, and the count is the whole of the fact.
    facts.push({ key: 'held', label: 'Held against you', value: runners(data.rivals_held) });
  }
  if (data.standing_rank) {
    // Led with on the result screen, where the ground is already the hero.
    facts[hideClaimSummary ? 'unshift' : 'push']({
      key: 'standing',
      label: 'Current standing',
      value: `${ordinal(data.standing_rank)} of ${data.standing_field.toLocaleString()}`,
    });
  }
  const [lead, ...rest] = facts;

  // The comparison is what makes a rate mean anything, so the rate is only
  // shown when there is something to compare it against.
  const better =
    pro?.m2_per_km != null && pro?.m2_per_km_30d != null
      ? pro.m2_per_km >= pro.m2_per_km_30d
      : null;

  const form = [];
  if (pro?.m2_per_km != null) {
    form.push({
      key: 'rate',
      label: 'Land per kilometre',
      value: km2(pro.m2_per_km),
      tag: better == null ? null : better ? 'Above your usual' : 'Below your usual',
    });
  }
  if (pro) {
    form.push({
      key: 'last30',
      label: 'Last 30 days',
      note: `${((pro.distance_m_30d || 0) / 1000).toFixed(0)} km run`,
      value: `${pro.claims_30d} ${pro.claims_30d === 1 ? 'claim' : 'claims'}`,
    });
  }
  if (pro?.stolen_m2_30d > 0) {
    form.push({
      key: 'stolen30',
      label: 'Taken off rivals',
      note: 'Last 30 days',
      value: km2(pro.stolen_m2_30d),
    });
  }
  if (pro?.at_risk_count > 0) {
    form.push({
      key: 'risk',
      label: 'Expiring soon',
      note: `${pro.at_risk_count} ${pro.at_risk_count === 1 ? 'plot' : 'plots'}`,
      value: km2(pro.at_risk_m2),
    });
  }

  return (
    <HardShadow radius={nbRadius.sm} style={[styles.drop, style]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: ink }]}>
        <Text style={t.cardTitle} accessibilityRole="header">Territory report</Text>
        <Text style={t.cardSub}>What this run did to the map.</Text>

        {lead ? (
          <View
            style={styles.lead}
            accessible
            accessibilityLabel={[lead.label, lead.value, lead.note].filter(Boolean).join(', ')}
          >
            <Text style={t.statLabel}>{lead.label}</Text>
            <Text style={[t.leadValue, styles.leadValue]} numberOfLines={1} adjustsFontSizeToFit>
              {lead.value}
            </Text>
            {lead.note ? <Text style={[t.body, styles.lineNote]}>{lead.note}</Text> : null}
          </View>
        ) : null}

        {rest.map((f) => (
          <StatLine key={f.key} label={f.label} note={f.note} value={f.value} tag={f.tag} t={t} />
        ))}

        {pro ? (
          // The paid half: what the run MEANS rather than what it did. A
          // labelled group under one hairline, not a box of its own.
          <View style={[styles.form, { borderTopColor: hairline }]}>
            <View style={styles.formHead}>
              <Text style={t.sectionLabel} accessibilityRole="header">Your form</Text>
              {pro.is_personal_best ? <Pill label="Biggest claim yet" color={GOLD} /> : null}
            </View>
            {form.map((f) => (
              <StatLine key={f.key} label={f.label} note={f.note} value={f.value} tag={f.tag} t={t} />
            ))}
          </View>
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
            style={styles.teaser}
          />
        )}
      </View>
    </HardShadow>
  );
}

const styles = StyleSheet.create({
  // Room for the drop to fall into. Only the bottom is reserved: the 4pt to
  // the right lands in the screen gutter, and a marginRight here would fight
  // the marginHorizontal the call sites set.
  drop: { alignSelf: 'stretch', marginBottom: NB.offset },

  // One stroke, one padding. Everything inside is spaced, not boxed.
  card: {
    borderWidth: NB.stroke,
    borderRadius: nbRadius.sm,
    padding: space.lg,
  },

  lead: { marginTop: space.md, marginBottom: space.xs },
  leadValue: { marginTop: 2 },

  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    gap: space.md,
  },
  lineLabel: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  lineNote: { marginTop: 1 },
  lineValue: { flexShrink: 0, textAlign: 'right' },
  lineTag: { marginTop: 5 },

  form: {
    marginTop: space.sm,
    paddingTop: space.md,
    borderTopWidth: 1.5,
  },
  formHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.xs,
  },

  teaser: { marginTop: space.md },
});
