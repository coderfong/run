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
function StatLine({ label, note, value, tag, tint, divider, colors, type, last }) {
  return (
    <View style={[styles.line, !last && { borderBottomWidth: 1.5, borderBottomColor: divider }]}>
      <View style={styles.lineLabel}>
        <Text style={[type.bodySm, { color: colors.textMuted }]}>{label}</Text>
        {note ? (
          <Text style={[type.caption, { color: colors.textDim, marginTop: 2 }]}>{note}</Text>
        ) : null}
      </View>
      <View style={styles.lineValue}>
        <Text style={[type.statSm, tint ? { color: tint } : null]} numberOfLines={1}>
          {value}
        </Text>
        {tag ? <Pill label={tag} color={GOLD} style={styles.lineTag} /> : null}
      </View>
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
  const rule = withAlpha(ink, 0.16);

  // The free half, built as data rather than as JSX so the FIRST figure can be
  // promoted to the headline without a second copy of the same conditions.
  const facts = [];
  if (!hideClaimSummary) {
    facts.push({ key: 'claimed', label: 'Land claimed', value: km2(data.territory_m2) });
  }
  if (data.land_gained_m2 != null) {
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
  if (data.biggest_capture_m2 > 0) {
    facts.push({ key: 'biggest', label: 'Biggest capture', value: km2(data.biggest_capture_m2) });
  }
  if (data.rivals_held > 0) {
    // No area to report here: this is the number of runners who held their
    // ground against you, and the count is the whole of the fact.
    facts.push({ key: 'held', label: 'Held against you', value: runners(data.rivals_held) });
  }
  if (data.standing_rank) {
    facts.push({
      key: 'standing',
      label: 'You now stand',
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
      tint: better === true ? GOLD : undefined,
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
      label: 'Taken off rivals, 30 days',
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
        {/* The masthead. A full weight rule under it rather than a hairline:
            it is the one line on the card that says where the report starts. */}
        <View style={[styles.head, { borderBottomColor: ink }]}>
          <Text style={[type.title, { color: colors.text }]}>Territory report</Text>
          <Text style={[type.caption, { color: colors.textMuted, marginTop: 3 }]}>
            What this run did to the map.
          </Text>
        </View>

        <View style={styles.body}>
          {lead ? (
            <View style={[styles.lead, { borderBottomColor: rule }]}>
              <Text style={[type.labelSm, { color: colors.textMuted }]}>{lead.label}</Text>
              <Text style={[type.stat, { color: colors.text, marginTop: 2 }]} numberOfLines={1}>
                {lead.value}
              </Text>
              {lead.note ? (
                <Text style={[type.caption, { color: colors.textDim, marginTop: 2 }]}>
                  {lead.note}
                </Text>
              ) : null}
            </View>
          ) : null}

          {rest.map((f, i) => (
            <StatLine
              key={f.key}
              {...f}
              divider={rule}
              colors={colors}
              type={type}
              last={i === rest.length - 1}
            />
          ))}
        </View>

        {pro ? (
          // The paid half, boxed in a gold washed block of its own. Underneath
          // the free figures, and visibly a different kind of thing: what the
          // run MEANS rather than what it did.
          <View
            style={[
              styles.form,
              {
                borderColor: withAlpha(GOLD, 0.85),
                backgroundColor: withAlpha(GOLD, scheme === 'dark' ? 0.09 : 0.06),
              },
            ]}
          >
            <Text style={[type.labelSm, { color: GOLD }]}>Your form</Text>
            {pro.is_personal_best ? (
              <Pill label="Biggest claim yet" color={GOLD} style={styles.best} />
            ) : null}
            <View style={styles.formLines}>
              {form.map((f, i) => (
                <StatLine
                  key={f.key}
                  {...f}
                  divider={withAlpha(GOLD, 0.35)}
                  colors={colors}
                  type={type}
                  last={i === form.length - 1}
                />
              ))}
            </View>
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

  card: {
    borderWidth: NB.stroke,
    borderRadius: nbRadius.sm,
    // The masthead rule runs edge to edge, so the padding lives on the pieces
    // inside rather than on the box.
    overflow: 'hidden',
  },

  head: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: NB.stroke,
  },

  body: { paddingHorizontal: space.lg, paddingBottom: space.md },

  lead: { paddingVertical: space.md, borderBottomWidth: 1.5 },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    gap: space.md,
  },
  lineLabel: { flex: 1 },
  lineValue: { alignItems: 'flex-end', flexShrink: 0 },
  lineTag: { alignSelf: 'flex-end', marginTop: 6 },

  form: {
    margin: space.lg,
    marginTop: space.xs,
    borderWidth: NB.strokeThin,
    borderRadius: nbRadius.sm,
    paddingHorizontal: space.md,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  formLines: { marginTop: space.xs },
  best: { marginTop: space.sm },

  teaser: { margin: space.lg, marginTop: space.xs },
});
