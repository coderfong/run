// ProLock — the one way to put a padlock on an EXISTING free feature.
//
// The rule this enforces, and why it is a component and not a pattern copied
// into six screens: a gate is three states, not one, and the two that are not
// "locked" are the ones a hand-rolled padlock always gets wrong.
//
//   canShowPro && !isPro   LOCKED. The feature is replaced by an affordance
//                          that names it, wears a PASER PRO padlock, and opens
//                          the paywall when tapped. Nobody is shown a value
//                          they did not pay for — see the note in ProTeaser on
//                          why a teaser must never invent a number.
//   isPro                  UNLOCKED. Render the real feature. They paid; show
//                          them what they paid for, with no chrome around it.
//   !canShowPro            UNLOCKED. PRO does not exist in this build (the
//                          store is off, the release switch is down). There is
//                          nothing to sell, so gating here would just hide a
//                          feature from EVERYONE for no reason. Render it.
//
// The middle and last states look identical from the outside — the feature is
// simply there — and that is correct. A build that cannot sell PRO must behave
// as though PRO was never invented.
//
// DEPTH, NOT POWER. Only wrap richer VIEWS and EXPRESSION: a splits table, an
// elevation read, a colour swatch. Never anything that changes what a run
// earns or where it stands — that line is the whole of config/pro.js, and a
// padlock on the wrong thing is pay-to-win however pretty the lock.
//
// The entitlement read and the impression/tap analytics are ProTeaser's
// `useProTeaser`, unchanged: a locked splits panel and a locked map layer are
// the same event in the funnel, and should stay one code path.
//
// ---------------------------------------------------------------------------
// FROSTING — showing that something is there without showing what it says.
// ---------------------------------------------------------------------------
//
// A padlock beside the words "PASER PRO" and nothing else tells a runner they
// are missing SOMETHING, which is the least persuasive thing a gate can say.
// The lock on the result card was worse than that: its label was laid out with
// `flex: 1` inside a row that shrinks to its content, so a flex basis of zero
// collapsed the one piece of text naming the feature, and the strip read as a
// bare "PASER PRO" and a padlock floating under the stats.
//
// So a lock now shows its own contents, obscured:
//
//   the NAMES stay sharp    "Best km", "Elev gain" — what exists, said plainly.
//   the VALUES are frosted  the real text, rendered as an unreadable smear.
//
// `ProFrosted` is that smear, and it takes REAL DATA ONLY. This does not bend
// ProTeaser's rule, it leans on it: a frosted value can never be revealed as a
// lie when it unlocks, because it was always the true value — the gate is the
// blur, not the number. Never hand it a plausible-looking placeholder to make
// a block look fuller. Where a surface genuinely has no value to hand (the
// server withheld it), pass no rows and let the lock name the feature instead.
//
// The blur is a text shadow behind a transparent glyph, not a real backdrop
// filter: expo-blur is a native module and this app already has enough of
// those waiting on a rebuild. It costs nothing and it is illegible.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Lock } from 'lucide-react-native';

import { GOLD } from '../config/pro';
import { useProTeaser } from './ProTeaser';
import { PressableShift } from '../ui/motion';
import { HardShadow } from './ui';
import {
  NB,
  nbInk,
  nbRadius,
  nbTextOn,
  space,
  useTheme,
  useThemedType,
  withAlpha,
} from '../theme';

// How hard the smear is. Seven points of shadow under 17pt tabular digits
// leaves a shape where the number was and no readable glyph inside it.
const FROST_BLUR = 7;

/**
 * Real text, rendered unreadable.
 *
 * REAL DATA ONLY — see the header. The blur is the gate; whatever is under it
 * has to be the value the runner gets on unlocking, or the first thing they
 * see as a subscriber is a number that moved.
 */
export function ProFrosted({ children, style, blur = FROST_BLUR }) {
  const { colors } = useTheme();
  return (
    <Text
      numberOfLines={1}
      // None of this is legible, so a screen reader announcing the raw string
      // would hand out the whole locked feature in the one mode where the
      // blur does not apply. The lock's own label says what is missing.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        style,
        {
          color: 'transparent',
          textShadowColor: withAlpha(colors.text, 0.62),
          textShadowOffset: { width: 0, height: 0 },
          textShadowRadius: blur,
        },
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * The gold strip every lock ends on. Flat fill, ink text, no gradient — the
 * three decisions in theme/nb.js applied to the one control on the page that
 * is asking for money, so it reads as a button rather than as a warning.
 */
function ProStrip({ type, tight }) {
  const ink = nbTextOn(GOLD);
  return (
    <View style={[styles.strip, tight && styles.stripTight, { backgroundColor: GOLD }]}>
      <Lock size={13} color={ink} strokeWidth={3} />
      <Text style={[type.labelSm, { color: ink, flex: 1 }]}>PASER PRO</Text>
      <Text style={[type.labelSm, { color: ink, opacity: 0.7 }]}>Tap to unlock</Text>
    </View>
  );
}

/**
 * Gate a whole feature behind PRO, swapping it for a lock card when locked.
 *
 * @param {string}   context  key from config/proContexts.js — decides the
 *                            paywall pitch and the analytics `source`.
 * @param {string}   [feature] finer-grained analytics name when one context
 *                            gates several things (the run has splits AND
 *                            elevation, both under `run_detail`).
 * @param {string}   title    the feature's own name. What they are missing,
 *                            not "Go PRO" — "Splits", "Elevation & pace depth".
 * @param {string}   [blurb]  one line of what it is.
 * @param {node}     [peek]   the feature itself, drawn frosted behind the
 *                            lock. Build it from REAL data with its values
 *                            passed through `ProFrosted`, and give it a bare
 *                            variant carrying no heading of its own — the lock
 *                            already has one, and two read as a duplicated
 *                            section rather than as a preview.
 * @param {node}     children the real feature. Rendered whenever NOT locked.
 */
export function ProLockedSection({ context, feature, title, blurb, peek, children, style }) {
  const { open, hidden } = useProTeaser(context, feature);
  const { colors, scheme } = useTheme();
  const type = useThemedType();

  // hidden === (!canShowPro || isPro) === "not locked". See the header: both of
  // those states render the real feature, and only those two.
  if (hidden) return children;

  return (
    <HardShadow accent={GOLD} radius={nbRadius.sm} style={[styles.drop, style]}>
      <PressableShift
        offset={NB.offset}
        onPress={() => open()}
        accessibilityRole="button"
        accessibilityLabel={`${title}, PASER PRO. Tap to unlock.`}
        style={[styles.card, { backgroundColor: colors.card, borderColor: GOLD }]}
      >
        <View style={styles.cardHead}>
          <Text style={[type.title, { color: colors.text }]}>{title}</Text>
          {blurb ? (
            <Text style={[type.caption, { color: colors.textMuted, marginTop: 3 }]}>{blurb}</Text>
          ) : null}
        </View>

        {/* The feature itself, behind frosted glass. Boxed off with a rule of
            its own so it reads as a sample of the thing rather than as more
            of the card's own copy. */}
        {peek ? (
          <View
            pointerEvents="none"
            style={[
              styles.peek,
              {
                borderColor: withAlpha(nbInk(scheme, colors.card), 0.18),
                backgroundColor: withAlpha(GOLD, scheme === 'dark' ? 0.08 : 0.05),
              },
            ]}
          >
            {peek}
          </View>
        ) : null}

        <ProStrip type={type} />
      </PressableShift>
    </HardShadow>
  );
}

/**
 * The slim variant, for gating a feature that lives INSIDE another surface
 * where a whole card would be too loud — a row of secondary stats on the
 * result card, a control in a settings block.
 *
 * @param {array}  [preview] `[{ label, value, unit }]`, REAL values only. Rendered
 *                           as sharp names over frosted numbers, so the block
 *                           says exactly which stats sit behind the lock.
 * @param {string} [label]   fallback when there is nothing to frost: one line
 *                           naming what is missing.
 */
export function ProInlineLock({ context, feature, label, preview, style }) {
  const { open, hidden } = useProTeaser(context, feature);
  const { colors } = useTheme();
  const type = useThemedType();

  if (hidden) return null;

  const rows = (Array.isArray(preview) ? preview : []).filter((r) => r && r.label);
  const named = rows.length ? rows.map((r) => r.label).join(', ') : label;

  return (
    <HardShadow
      offset={NB.offsetSm}
      accent={GOLD}
      radius={nbRadius.sm}
      style={[styles.dropSm, style]}
    >
      <PressableShift
        offset={NB.offsetSm}
        onPress={() => open()}
        accessibilityRole="button"
        accessibilityLabel={`${named}. PASER PRO. Tap to unlock.`}
        style={[styles.inline, { backgroundColor: colors.card, borderColor: GOLD }]}
      >
        {rows.length ? (
          <View style={styles.inlineRow}>
            {rows.map((r) => (
              <View key={r.label} style={styles.inlineCell}>
                <Text style={[type.labelSm, { color: colors.textDim }]} numberOfLines={1}>
                  {r.label}
                </Text>
                {/* Unit inside the smear rather than sharp beside it. A
                    frosted "6:25" alone is a thin smudge; with its unit it
                    has the width of the real value it is hiding. */}
                <ProFrosted style={[type.statSm, styles.inlineValue]}>
                  {r.unit ? `${r.value} ${r.unit}` : r.value}
                </ProFrosted>
              </View>
            ))}
          </View>
        ) : (
          <Text
            style={[type.bodySmBold, { color: colors.text, padding: space.md }]}
            numberOfLines={1}
          >
            {label}
          </Text>
        )}
        <ProStrip type={type} tight />
      </PressableShift>
    </HardShadow>
  );
}

const styles = StyleSheet.create({
  // Room for the drop to fall into, and stretch. These get dropped into
  // centring parents — the result card is `alignItems: 'center'` — where a
  // content-sized lock collapses the text inside it.
  drop: { alignSelf: 'stretch', marginBottom: NB.offset, marginRight: NB.offset },
  dropSm: { alignSelf: 'stretch', marginBottom: NB.offsetSm, marginRight: NB.offsetSm },

  card: {
    borderWidth: NB.stroke,
    borderRadius: nbRadius.sm,
    // The gold strip runs edge to edge along the bottom, so the padding lives
    // on the pieces above it rather than on the box.
    overflow: 'hidden',
  },
  cardHead: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm },
  peek: {
    marginHorizontal: space.md,
    marginBottom: space.md,
    borderWidth: NB.strokeThin,
    borderRadius: nbRadius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },

  inline: {
    borderWidth: NB.strokeThin,
    borderRadius: nbRadius.sm,
    overflow: 'hidden',
  },
  inlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  inlineCell: { flex: 1, alignItems: 'center' },
  // The smear needs air around it, or the shadow clips against the strip.
  inlineValue: { marginTop: 5, marginBottom: 3 },

  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: 9,
  },
  stripTight: { paddingVertical: 7 },
});

export default ProLockedSection;
