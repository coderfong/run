// Accordion — a page section that starts folded away.
//
// The You page is the reason this exists. It carried the runner, the stat
// wall, the land card, the streak, the trophies, the whole run history and
// eight blocks of settings as ONE column, and the settings were most of it:
// reaching the bottom of your own profile meant scrolling past every
// preference in the app. Folded, that column is five words you can read at a
// glance and open one at a time.
//
// THE LABEL IS THE SAME LABEL. The head is SectionHeader's own drawn box (see
// SectionLabel) with a chevron beside it, not a new kind of row. A page that
// folds some of its sections and leaves others open must not look like two
// pages stitched together.
//
// A CLOSED SECTION IS NOT RENDERED. Not hidden, not measured at zero: its
// children are never mounted. That is most of the point of folding THESE
// sections — each settings block runs its own query and its own switches, and
// a `display: none` version would have cost exactly what the long column cost
// minus the scrolling. The trade is that children mount fresh on every open,
// so a section holding an in-progress edit loses it when it is closed. That is
// acceptable here because closing is a deliberate tap on the section's own
// heading, never something that happens underneath the runner.
//
// OPENING IS ANIMATED, CLOSING IS INSTANT. An exit would have to hold the
// section's height open while its children are already gone, and a fold that
// lingers reads as lag on the tap that closed it.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';

import { space, useTheme, useThemedType } from '../../theme';
import { PressableScale, Reveal, Turn, haptic } from '../../ui/motion';
import { SectionLabel } from './SectionHeader';

/**
 * One section. `open` and `onToggle` are the caller's — the screen owns which
 * section is showing, so it can keep exactly one open at a time (which is what
 * makes the folded list short) without this component having to know about its
 * siblings.
 *
 * `last` closes the list off with a rule under the final row. Without it the
 * group ends on whatever the last section happened to be, and a stack of rows
 * divided at the top only reads as a list while something is below it.
 */
export default function AccordionSection({
  title,
  subtitle,
  open = false,
  onToggle,
  frameTint,
  last = false,
  children,
  style,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  // Hairline, not the neo-brutalist stroke. These rules divide rows inside one
  // list; drawing them at 3pt would box each section separately and turn the
  // group into a table. Same call toon.js's own Divider makes.
  const rule = {
    borderTopColor: colors.border,
    ...(last ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border } : null),
  };
  return (
    <View style={[styles.section, rule, style]}>
      <PressableScale
        onPress={() => { haptic.light(); onToggle?.(); }}
        // Barely a press, on purpose: the head contains a hand-drawn box, and
        // scaling ink scales the line weight with it. Enough to answer the
        // thumb, not enough to visibly thin the frame.
        scaleTo={0.99}
        style={styles.head}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        accessibilityState={{ expanded: !!open }}
      >
        <View style={styles.headText}>
          <SectionLabel title={title} frameTint={frameTint} />
          {subtitle ? (
            <Text style={[type.caption, styles.sub]} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Turn on={open}>
          <ChevronDown size={22} color={colors.textMuted} strokeWidth={3} />
        </Turn>
      </PressableScale>
      {open ? (
        <Reveal duration={260} style={styles.body}>
          {children}
        </Reveal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: StyleSheet.hairlineWidth },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.lg,
    // A folded section is a one line row, and a row you open by touching it
    // has to be worth aiming at.
    minHeight: 64,
  },
  headText: { flex: 1, alignItems: 'flex-start' },
  // The subtitle says what is inside without opening it. It is the whole
  // reason five closed rows are navigable rather than five nouns.
  sub: { marginTop: space.xs },
  body: { paddingBottom: space.lg },
});
