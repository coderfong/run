// The PRO teaser — one component, every "there is more here" surface.
//
// THE RULE THIS COMPONENT ENFORCES, and the reason it exists rather than each
// screen rolling its own locked rows: A TEASER MAY NEVER SHOW A NUMBER THAT IS
// NOT REAL.
//
// It is trivially easy, and very tempting, to write `Territory efficiency: Top
// 18% 🔒` as a static string because it looks good. Then somebody subscribes,
// the real panel loads, and it says something else. That is a lie told to a
// paying customer in the first thirty seconds of their subscription, and it is
// the single fastest way to earn refunds and a one-star review that says the
// app makes numbers up.
//
// So a row here is one of exactly two things:
//
//   * It has a `preview` — a value the CALLER got from the server and has
//     decided to give away. It renders in full, unlocked, as free content.
//   * It has no `preview` — it renders as a NAME and a padlock. What the
//     runner is told is that this analysis exists, which is true.
//
// There is no third mode where the component invents a plausible-looking
// value, and `rows` deliberately has nowhere to put one.
//
// IMPRESSIONS. Each mounted teaser fires `pro_teaser_impression` exactly once
// per mount, tagged with its context. Without that the funnel has a
// denominator problem: tap counts alone cannot distinguish a teaser nobody
// wants from a teaser nobody ever saw.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';

import { EVENTS, track } from '../analytics';
import { GOLD } from '../config/pro';
import { proContext } from '../config/proContexts';
import { useProEntitlement } from '../pro/ProProvider';
import { noteTeaserSeen } from '../pro/exposure';
import { radius, space, useTheme, useThemedType } from '../theme';
import { ToonButton } from './ui';

/**
 * One locked line. `preview` is real data or nothing at all.
 */
function LockRow({ label, preview, colors, type }) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[type.caption, { color: colors.textMuted, flex: 1 }]} numberOfLines={1}>
        {label}
      </Text>
      {preview ? (
        <Text style={[type.bodySmBold, { color: colors.text }]} numberOfLines={1}>
          {preview}
        </Text>
      ) : null}
      <Lock size={13} color={colors.textDim} strokeWidth={2.5} />
    </View>
  );
}

/**
 * @param {string}   context  key from config/proContexts.js. Decides both the
 *                            paywall's pitch and the analytics `source`.
 * @param {string}   title    what the runner would get. Not "Go PRO".
 * @param {string}   [blurb]  one sentence of why.
 * @param {Array}    [rows]   [{ label, preview? }] — see the header.
 * @param {string}   [cta]    button copy. Defaults to the context's own.
 * @param {string}   [feature] finer-grained name for analytics when one
 *                            context has several entry points (the map has
 *                            one context and seven layers).
 * @param {boolean}  [compact] drop the button; the whole card is the target.
 * @param {function} [onPress] override. Defaults to opening the paywall.
 */
export default function ProTeaser({
  context,
  title,
  blurb,
  rows,
  cta,
  feature,
  compact = false,
  style,
  onPress,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const { isPro, canShowPro, openPaywall } = useProEntitlement();
  const pitch = proContext(context);
  const fired = useRef(false);

  const hidden = !canShowPro || isPro;

  useEffect(() => {
    // Not in the render body: an impression is a side effect, and firing it
    // during render would double-count under StrictMode and fire for a
    // component React then throws away.
    if (hidden || fired.current) return;
    fired.current = true;
    const first = noteTeaserSeen(context);
    track(EVENTS.TEASER_IMPRESSION, {
      source: pitch.source,
      context,
      feature: feature || context,
      first_time: first,
    });
  }, [hidden, context, feature, pitch.source]);

  // The store being off is not a reason to show a dead button, and a
  // subscriber must never be sold their own subscription. Both render nothing.
  if (hidden) return null;

  const open = () => {
    track(EVENTS.TEASER_TAP, {
      source: pitch.source,
      context,
      feature: feature || context,
    });
    if (onPress) onPress();
    else openPaywall(context);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: GOLD }, style]}>
      <Text style={[type.captionMedium, { color: GOLD }]}>PASER PRO</Text>
      <Text style={[type.bodySmBold, { marginTop: 2 }]}>{title}</Text>
      {blurb ? (
        <Text style={[type.caption, { color: colors.textMuted, marginTop: 4 }]}>{blurb}</Text>
      ) : null}

      {rows?.length ? (
        <View style={{ marginTop: space.sm }}>
          {rows.map((row) => (
            <LockRow
              key={row.label}
              label={row.label}
              preview={row.preview}
              colors={colors}
              type={type}
            />
          ))}
        </View>
      ) : null}

      {compact ? null : (
        <ToonButton
          title={cta || pitch.cta || 'See the plans'}
          variant="gold"
          size="sm"
          onPress={open}
          style={{ marginTop: space.sm }}
        />
      )}
    </View>
  );
}

/**
 * The same impression/tap bookkeeping without the card, for surfaces that
 * already have their own chrome (a padlocked filter chip, a map layer row).
 * Returns `{ open, hidden }`.
 */
export function useProTeaser(context, feature) {
  const { isPro, canShowPro, openPaywall } = useProEntitlement();
  const pitch = proContext(context);
  const hidden = !canShowPro || isPro;
  const fired = useRef(false);

  useEffect(() => {
    if (hidden || fired.current) return;
    fired.current = true;
    const first = noteTeaserSeen(context);
    track(EVENTS.TEASER_IMPRESSION, {
      source: pitch.source,
      context,
      feature: feature || context,
      first_time: first,
    });
  }, [hidden, context, feature, pitch.source]);

  const open = (opts = {}) => {
    track(EVENTS.TEASER_TAP, { source: pitch.source, context, feature: feature || context });
    openPaywall(context, opts);
  };

  return { open, hidden, isPro };
}

const styles = StyleSheet.create({
  card: { borderWidth: 2, borderRadius: radius.card, padding: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.sm,
  },
});
