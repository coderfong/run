// First-run pickers: the docked item/colour sheet used by the character
// steps, and the three-column date wheel used by the birthday step.
//
// Both are presentational — state lives in the step that renders them.

import React, { useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, Lock } from 'lucide-react-native';

import { space } from '../theme';
import { haptic, PressableScale } from '../ui/motion';
import { toon, toonRadius, toonType } from './toon';

// ---------------------------------------------------------------------------
// PickerSheet — the bottom sheet that docks under the character stage:
// title bar · optional colour swatches · item grid · footer (the CTA).
// ---------------------------------------------------------------------------

export function PickerSheet({
  title,
  items,
  selectedId,
  onSelect,
  isUnlocked = () => true,
  renderThumb,
  palette,
  colorIndex = 0,
  onPickColor,
  footer,
  maxHeight,
}) {
  return (
    <View style={[styles.sheet, maxHeight ? { maxHeight } : null]}>
      <View style={styles.sheetHeader}>
        <Text style={[toonType.sub, { color: '#fff' }]}>{title}</Text>
      </View>

      {palette ? (
        <View style={styles.swatchRow}>
          {palette.map((hex, i) => {
            const on = i === colorIndex;
            const light = ['#F4F4F5', '#E8D06B', '#EAB308'].includes(hex);
            return (
              <PressableScale
                key={hex}
                onPress={() => { haptic.light(); onPickColor?.(i); }}
                accessibilityRole="button"
                accessibilityLabel={`Colour ${i + 1}`}
                accessibilityState={{ selected: on }}
                style={[styles.swatch, { backgroundColor: hex }, on && styles.swatchOn]}
              >
                {on ? <Check size={14} color={light ? toon.ink : '#fff'} strokeWidth={3.5} /> : null}
              </PressableScale>
            );
          })}
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {items.map((item) => {
          const on = item.id === selectedId;
          const unlocked = isUnlocked(item);
          return (
            <PressableScale
              key={item.id}
              onPress={() => onSelect(item, unlocked)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: on }}
              style={[styles.cell, on && styles.cellOn]}
            >
              <View style={{ opacity: unlocked ? 1 : 0.3 }}>{renderThumb(item)}</View>
              {!unlocked ? (
                <View style={styles.lock}>
                  <Lock size={12} color="rgba(255,255,255,0.8)" />
                </View>
              ) : null}
            </PressableScale>
          );
        })}
      </ScrollView>

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// DateWheel — month / day / year snap columns. `value` is {y, m, d} with m
// 1-based; `onChange` fires with the whole clamped date on every settle.
// ---------------------------------------------------------------------------

const ITEM_H = 42;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

function Column({ data, index, onIndex, width, align = 'center' }) {
  const ref = useRef(null);

  useEffect(() => {
    ref.current?.scrollTo({ y: index * ITEM_H, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow externally-clamped values (e.g. Feb 30 → Feb 28).
  useEffect(() => {
    ref.current?.scrollTo({ y: index * ITEM_H, animated: true });
  }, [index]);

  const settle = (e) => {
    const next = Math.max(0, Math.min(data.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H)));
    if (next !== index) {
      haptic.light();
      onIndex(next);
    }
  };

  return (
    <ScrollView
      ref={ref}
      style={{ width }}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      contentContainerStyle={{ paddingVertical: ITEM_H * 2 }}
      onMomentumScrollEnd={settle}
      onScrollEndDrag={settle}
      nestedScrollEnabled
    >
      {data.map((label, i) => (
        <View key={label} style={styles.wheelItem}>
          <Text
            numberOfLines={1}
            style={[
              toonType.sub,
              styles.wheelText,
              { textAlign: align, opacity: i === index ? 1 : 0.38 },
            ]}
          >
            {label}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

export function DateWheel({ value, onChange, minYear = 1925, maxYear = new Date().getFullYear() }) {
  const years = useMemo(
    () => Array.from({ length: maxYear - minYear + 1 }, (_, i) => String(minYear + i)),
    [minYear, maxYear]
  );
  const days = useMemo(
    () => Array.from({ length: daysInMonth(value.y, value.m) }, (_, i) => String(i + 1)),
    [value.y, value.m]
  );

  const set = (patch) => {
    const next = { ...value, ...patch };
    next.d = Math.min(next.d, daysInMonth(next.y, next.m));
    onChange(next);
  };

  return (
    <View style={styles.wheel}>
      <View pointerEvents="none" style={styles.wheelBand} />
      <Column
        data={MONTHS}
        index={value.m - 1}
        onIndex={(i) => set({ m: i + 1 })}
        width="44%"
        align="left"
      />
      <Column data={days} index={value.d - 1} onIndex={(i) => set({ d: i + 1 })} width="22%" />
      <Column
        data={years}
        index={Math.max(0, years.indexOf(String(value.y)))}
        onIndex={(i) => set({ y: minYear + i })}
        width="34%"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: toon.sheet,
    borderTopLeftRadius: toonRadius.sheet,
    borderTopRightRadius: toonRadius.sheet,
    overflow: 'hidden',
  },
  sheetHeader: {
    backgroundColor: toon.sheetHeader,
    paddingVertical: space.md,
    alignItems: 'center',
  },

  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.gutter,
    paddingTop: space.md,
    justifyContent: 'center',
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.35)',
  },
  swatchOn: { borderColor: '#fff', borderWidth: 3 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    padding: space.lg,
    justifyContent: 'flex-start',
  },
  cell: {
    width: '31.5%',
    aspectRatio: 1,
    borderRadius: toonRadius.cell,
    backgroundColor: toon.cell,
    borderWidth: 2.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cellOn: { borderColor: '#fff' },
  lock: { position: 'absolute', top: 6, right: 6 },

  footer: { paddingHorizontal: space.gutter, paddingTop: space.sm },

  wheel: { flexDirection: 'row', height: ITEM_H * 5, paddingHorizontal: space.gutter },
  wheelBand: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    top: ITEM_H * 2,
    height: ITEM_H,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  wheelItem: { height: ITEM_H, justifyContent: 'center' },
  wheelText: { color: '#fff', fontSize: 20, lineHeight: 26 },
});
