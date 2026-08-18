// OverflowMenu — a "…" button and the small list of actions it opens.
//
// WHY THIS EXISTS. A feed row had grown five buttons on one line: share, edit,
// react, comment, kudos. Five 40pt targets plus their counts is over 200pt of
// the ~318pt a card has inside its padding, so the header could not fit the
// runner's name and the actions on the same line and dropped the buttons to a
// second row. The card got taller, the actions moved depending on WHOSE run it
// was (your own carries five, somebody else's three), and the two that people
// actually use — react and kudos — were sharing a row with three that they do
// not.
//
// So the row keeps the two immediate actions and everything else moves in
// here. The card gets its single-line header back and the actions stop moving
// around between rows.
//
// PLACEMENT IS MEASURED, NOT LAID OUT. Exactly the reasoning ReactionBar's
// picker already carries: a menu laid out inside the card is clipped by the
// card, and on Android a child drawn outside its parent's bounds renders but
// cannot be tapped. So the trigger is measured with `measureInWindow` and the
// sheet is drawn in a transparent Modal at those coordinates, held clear of
// every screen edge. It prefers to hang BELOW the trigger, because the trigger
// is in a card header near the top of a row, and flips above when it would run
// off the bottom.
//
// One menu is open at a time by construction: it owns its own visibility and
// closes on any outside press.

import React, { useCallback, useRef, useState } from 'react';
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MoreHorizontal } from 'lucide-react-native';

import { nbInk, nbRadius, NB } from '../../theme/nb';
import { radius, space, useTheme, useThemedType } from '../../theme';
import { PressableScale, haptic } from '../../ui/motion';
import HardShadow from './HardShadow';
import AppIcon from '../AppIcon';

const MENU_W = 208;
const ROW_H = 46;
// The trigger matches the 40pt minimum every other action button in a card
// header uses, so the row's rhythm does not break where it sits.
const TRIGGER = 40;

/**
 * @param {object[]} actions  [{ key, label, icon, onPress, destructive, hidden }]
 *                            `icon` is an AppIcon name when a sticker exists
 *                            for it, or a render function for anything else.
 * @param {string} label      accessibility label for the trigger
 */
export default function OverflowMenu({
  actions = [],
  label = 'More actions',
  onOpen,
  style,
  testID = 'overflow-menu-anchor',
}) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const anchorRef = useRef(null);
  const [at, setAt] = useState(null);

  const items = actions.filter((action) => action && !action.hidden);
  const open = !!at;

  const close = useCallback(() => setAt(null), []);

  const toggle = useCallback(() => {
    haptic.light();
    if (at) { setAt(null); return; }
    onOpen?.();
    anchorRef.current?.measureInWindow?.((x, y, width, height) => {
      const screen = Dimensions.get('window');
      const menuH = items.length * ROW_H + space.xs * 2;
      const below = y + height + space.xs;
      // Flip above only when below genuinely does not fit — a menu that flips
      // early appears to jump when the same card is tapped at two scroll
      // positions.
      const fitsBelow = below + menuH <= screen.height - space.lg;
      setAt({
        left: Math.max(
          space.md,
          Math.min(x + width / 2 - MENU_W / 2, screen.width - MENU_W - space.md)
        ),
        top: fitsBelow ? below : Math.max(space.lg, y - menuH - space.xs),
      });
    });
  }, [at, items.length, onOpen]);

  if (!items.length) return null;

  return (
    <>
      <View ref={anchorRef} testID={testID} collapsable={false} style={style}>
        <PressableScale
          onPress={toggle}
          style={styles.trigger}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={label}
          hitSlop={6}
        >
          <MoreHorizontal size={22} color={colors.text} strokeWidth={2.6} />
        </PressableScale>
      </View>

      {open ? (
        <Modal transparent visible animationType="none" onRequestClose={close}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          />
          {/* The neo-brutalist box: heavy stroke, hard offset drop, no blur. */}
          <HardShadow
            offset={NB.offsetSm}
            radius={nbRadius.sm}
            on={colors.card}
            style={[styles.menuWrap, { left: at.left, top: at.top }]}
          >
            <View
              style={[
                styles.menu,
                {
                  backgroundColor: colors.card,
                  borderColor: nbInk(scheme, colors.card),
                },
              ]}
            >
              {items.map((action) => (
                <Pressable
                  key={action.key}
                  onPress={() => {
                    close();
                    action.onPress?.();
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: colors.cardAlt || colors.bg },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <View style={styles.rowIcon}>
                    {typeof action.icon === 'function'
                      ? action.icon({ color: colors.text, size: 20 })
                      : action.icon
                        ? <AppIcon name={action.icon} size={24} />
                        : null}
                  </View>
                  <Text style={[type.bodySmBold, { color: colors.text }]} numberOfLines={1}>
                    {action.label}
                  </Text>
                  {action.count > 0 ? (
                    <Text style={[type.caption, styles.rowCount, { color: colors.textMuted }]}>
                      {action.count}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          </HardShadow>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minWidth: TRIGGER,
    minHeight: TRIGGER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuWrap: { position: 'absolute', width: MENU_W },
  menu: {
    width: MENU_W,
    borderWidth: NB.strokeThin,
    borderRadius: nbRadius.sm,
    paddingVertical: space.xs,
    overflow: 'hidden',
  },
  row: {
    height: ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  rowIcon: { width: 26, alignItems: 'center', justifyContent: 'center' },
  rowCount: { marginLeft: 'auto' },
});

export { MENU_W as OVERFLOW_MENU_WIDTH, ROW_H as OVERFLOW_ROW_HEIGHT };
