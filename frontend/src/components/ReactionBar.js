// ReactionBar — the emotes on somebody else's run, and the popover for leaving
// one of your own.
//
// Kudos answers "did you see this" and nothing else, which is fine for one run
// and useless down a feed where every row has the same heart on it. This is the
// range: eight emotes, one per person, so a brutal hill lap and a gentle
// shuffle can be answered differently.
//
// The detail-page picker floats near its trigger. Feed-card pickers reserve a
// row inside their own card so they never cover the runner header or route.
//
// THE CHIPS ARE STILL FRAMES (EmoteIcon), not animations. A feed page can carry
// fifty rows and each row up to six chips; running three hundred sprite clocks
// to draw three hundred things that are not moving is how a scroll drops to
// fifteen frames a second. The animation is spent where it is worth something:
// one burst, over the bar, at the moment a reaction is left.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import EmoteIcon from '../effects/EmoteIcon';
import ReactionEffect from '../effects/ReactionEffect';
import { REACTION_PICKER, getReactionLabel } from '../effects/reactionRegistry';
import { radius, space, withAlpha, useTheme, useThemedStyles, useThemedType } from '../theme';
import { PressableScale, Reveal, haptic } from '../ui/motion';

// One row of eight. Sized so the strip stays narrower than a card on the
// smallest phone we support, because a popover that has to wrap is a panel
// again — and a popover that overflows the screen edge is worse.
const TILE = 38;
const TILE_GAP = 2;
const POPOVER_PAD = 5;
export const POPOVER_WIDTH = TILE * REACTION_PICKER.length
  + TILE_GAP * (REACTION_PICKER.length - 1)
  + POPOVER_PAD * 2;

function Chip({ row, onPress, color, styles, type, colors }) {
  return (
    <PressableScale
      onPress={() => onPress(row.emote)}
      style={[
        styles.chip,
        row.mine && { backgroundColor: withAlpha(color, 0.18), borderColor: color },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: !!row.mine }}
      accessibilityLabel={`${getReactionLabel(row.emote)}, ${row.count}`}
    >
      <EmoteIcon reaction={row.emote} size={22} />
      <Text style={[type.captionMedium, { color: row.mine ? color : colors.textMuted }]}>
        {row.count}
      </Text>
    </PressableScale>
  );
}

/**
 * The strip can float beside a detail-page trigger or sit inline in a feed
 * card. It is deliberately separate from the text comment composer.
 *
 * `anchor` which edge it lines up with. 'left' is the default; a trigger over
 *          on the right side of its row passes 'right' so the strip opens
 *          inward instead of off the screen.
 */
export function ReactionPopover({ selected, onPick, anchor = 'left', floating = true, style }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    // Short and rising: this is a thing that popped up next to your thumb, not
    // a section arriving. Long enough to be seen, short enough that a second
    // tap never feels blocked by it.
    <Reveal
      duration={160}
      from="down"
      style={[
        styles.popover,
        floating
          ? [styles.floatingPopover, anchor === 'right' ? { right: 0 } : { left: 0 }]
          : styles.inlinePopover,
        style,
      ]}
    >
      {REACTION_PICKER.map((emote) => (
        <PressableScale
          key={emote}
          onPress={() => onPick(emote)}
          style={[
            styles.tile,
            !floating && styles.inlineTile,
            selected === emote && { backgroundColor: withAlpha(colors.text, 0.16) },
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === emote }}
          accessibilityLabel={getReactionLabel(emote)}
        >
          <EmoteIcon reaction={emote} size={30} />
        </PressableScale>
      ))}
    </Reveal>
  );
}

/**
 * `reactions` the summary: [{ emote, count, mine }], loudest first.
 * `mine`      the viewer's own emote, or null.
 * `onReact`   called with an emote key. Tapping your own clears it.
 * `burst`     a rising token; each increment plays one emote over the bar.
 * `open`      controlled popover visibility. Leave it undefined and the bar
 *             owns its own — the run detail does that, the feed card drives it
 *             from a button in its action row.
 */
export default function ReactionBar({
  reactions = [],
  mine = null,
  onReact,
  burst = 0,
  color,
  compact = false,
  inlinePicker = false,
  open,
  onRequestClose,
  style,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const [ownOpen, setOwnOpen] = useState(false);
  // Falls back to the text colour, not to `primary`: the caller normally hands
  // in the runner's clan colour, and a chip that turns pure white on selection
  // in dark mode reads as disabled rather than as chosen.
  const tint = color || colors.text;
  const pickerOpen = open === undefined ? ownOpen : open;

  const close = () => {
    setOwnOpen(false);
    onRequestClose?.();
  };

  const pick = (emote) => {
    haptic.light();
    onReact?.(emote);
    // Picking closes it; UNPICKING (tapping the one you already left) leaves it
    // up, so taking one off and putting another on is one gesture, not two.
    if (emote !== mine) close();
  };

  const hasChips = reactions.length > 0;
  if (compact && !hasChips && !pickerOpen) return null;

  return (
    <View style={[styles.wrap, style]}>
      {/* The burst. Absolutely positioned over the bar and non-interactive, so
          it never eats the tap that started it. `centered` because there is no
          character here for it to pop above — it plays where the chips are. */}
      {burst > 0 && mine ? (
        <ReactionEffect
          reaction={mine}
          point={{ x: 34, y: 0 }}
          centered
          size={72}
          playToken={burst}
          style={styles.burst}
        />
      ) : null}

      {hasChips ? (
        <View style={styles.chips}>
          {reactions.map((row) => (
            <Chip
              key={row.emote}
              row={row}
              onPress={pick}
              color={tint}
              styles={styles}
              type={type}
              colors={colors}
            />
          ))}
        </View>
      ) : null}

      {pickerOpen ? (
        <ReactionPopover selected={mine} onPick={pick} floating={!inlinePicker} />
      ) : null}
    </View>
  );
}

// The button that opens the popover, for callers that put the trigger in their
// own action row (the feed card keeps it beside comment and kudos). Shows the
// viewer's own emote once they have one, so the row says what you left without
// having to find your chip.
export function ReactionTrigger({ mine, active, onPress, color, size = 30 }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      onPress={onPress}
      style={[styles.trigger, active && { backgroundColor: withAlpha(color || colors.text, 0.12) }]}
      accessibilityRole="button"
      accessibilityState={{ expanded: !!active }}
      accessibilityLabel={mine ? `Reacted ${getReactionLabel(mine)}. Change it` : 'Add a reaction'}
    >
      {mine ? (
        <EmoteIcon reaction={mine} size={size - 4} />
      ) : (
        // The placeholder is a face rather than a plus: a plus next to a heart
        // and a speech bubble reads as "add something", which is not what this
        // does. Held at a step down so it does not compete with the two
        // actions that are always available. It stays fully saturated: a faded
        // face reads as disabled even though this is an active control.
        <EmoteIcon reaction="happy" size={size - 4} />
      )}
    </PressableScale>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  wrap: { position: 'relative' },
  burst: { zIndex: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.bgElevated,
  },
  // Floating. `bottom: '100%'` hangs it off the top edge of the bar, so it
  // costs no layout and nothing below it moves when it opens. Deliberately NOT
  // one of the hand-drawn frames — a drawn box belongs to something that stays
  // on the page, and putting one round a transient popover was what made the
  // old picker read as a section of the card.
  //
  // `cardAlt` and not `bgElevated`: in dark those two are the SAME step, so a
  // popover floating over a card would be the card's own colour and the strip
  // would have no edge at all. cardAlt is the nested step, which is exactly
  // what this is. No shadow — dark gets its depth from surface colour, and
  // border-plus-shadow together is against the house rules anyway.
  popover: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TILE_GAP,
    padding: POPOVER_PAD,
    borderRadius: radius.lg,
    backgroundColor: colors.cardAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  floatingPopover: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: space.xs,
    zIndex: 20,
  },
  // In feed cards the picker reserves its own row, so it stays inside the card
  // without hiding either the runner header or the route.
  inlinePopover: {
    position: 'relative',
    alignSelf: 'stretch',
    marginTop: space.sm,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Share the available card width instead of overflowing narrower devices.
  // The 30px art still has breathing room at the smallest supported width.
  inlineTile: {
    flex: 1,
    minWidth: 0,
  },
  trigger: {
    minWidth: 40,
    minHeight: 40,
    paddingHorizontal: 5,
    paddingVertical: 5,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
