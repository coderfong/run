// Avatar Studio — the character customizer. Two entry points:
//   · onboarding (standalone): shown once after the intro slides; gradient
//     "Save & continue" CTA completes setup via onDone.
//   · profile (navigated): opened from You → settings; edits persist live,
//     the header back button is the exit.
//
// Layout: rig preview (tap = wave) + randomize · slot chips · item grid with
// locked states (unlock condition shown on locked cells) · color swatches
// for colorable slots (hair/glasses/tops/bottoms). Items are real PNG art
// (assets/character); a swatch picks the palette INDEX, which selects that
// item's pre-rendered color variant. Skin stays the art's own tone.

import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, Lock } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { colors, radius, space, type } from '../theme';
import { Button, Screen } from '../components/ui';
import { PressableScale, Reveal, haptic } from '../ui/motion';
import { toast } from '../ui/toast';
import { useAvatar } from '../state/avatar';
import { useClan } from '../state/clan';
import CharacterRig, { PartThumb } from '../components/character/CharacterRig';
import { ITEMS, SLOTS, unlockLabel } from '../config/cosmetics';

function SlotChips({ active, onChange }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.gutter }}
      style={{ flexGrow: 0 }}
    >
      {SLOTS.map((s) => {
        const on = s.key === active;
        return (
          <PressableScale
            key={s.key}
            onPress={() => onChange(s.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={s.label}
            style={[styles.chip, on && { backgroundColor: colors.card, borderColor: colors.text }]}
          >
            <Text style={[type.bodySmBold, { color: on ? colors.text : colors.textMuted }]}>
              {s.label}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

// Color swatches — `value` is the selected palette INDEX (variants are
// pre-rendered per index, so the index is what gets stored/persisted).
function Swatches({ palette, value, onPick }) {
  return (
    <View style={styles.swatchRow}>
      {palette.map((hex, i) => {
        const on = i === value;
        const light = hex === '#F4F4F5' || hex === '#E8D06B' || hex === '#EAB308';
        return (
          <Reveal key={hex} from="none" delay={i * 22}>
            <PressableScale
              onPress={() => onPick(i)}
              accessibilityRole="button"
              accessibilityLabel={`Color ${i + 1}`}
              accessibilityState={{ selected: on }}
              style={[
                styles.swatch,
                { backgroundColor: hex },
                on && { borderColor: colors.text, borderWidth: 2.5 },
              ]}
            >
              {on ? <Check size={14} color={light ? '#26272B' : '#fff'} strokeWidth={3} /> : null}
            </PressableScale>
          </Reveal>
        );
      })}
    </View>
  );
}

function ItemGrid({ slot, equipped, isUnlocked, onEquip, clanColor }) {
  const items = ITEMS[slot.key] || [];
  return (
    <View style={styles.grid}>
      {items.map((item, i) => {
        const selected = equipped[slot.key] === item.id;
        const unlocked = isUnlocked(item);
        return (
          <Reveal key={item.id} delay={Math.min(i, 12) * 30} style={styles.cellWrap}>
          <PressableScale
            onPress={() => onEquip(item, unlocked)}
            accessibilityRole="button"
            accessibilityLabel={unlocked ? `Equip ${item.label}` : `${item.label}, locked: ${unlockLabel(item)}`}
            accessibilityState={{ selected }}
            style={[
              styles.cell,
              selected && { borderColor: colors.text, borderWidth: 2 },
            ]}
          >
            <View style={{ opacity: unlocked ? 1 : 0.28 }}>
              <PartThumb slot={slot.key} item={item} equipped={equipped} size={56} clanColor={clanColor} />
            </View>
            <Text style={[type.caption, { marginTop: 4, color: unlocked ? colors.text : colors.textDim }]} numberOfLines={1}>
              {item.label}
            </Text>
            {!unlocked && (
              <View style={styles.lockWrap}>
                <Lock size={14} color={colors.textMuted} />
                <Text style={[styles.lockLabel]} numberOfLines={2}>
                  {unlockLabel(item)}
                </Text>
              </View>
            )}
          </PressableScale>
          </Reveal>
        );
      })}
    </View>
  );
}

export default function AvatarStudioScreen({ standalone = false, onDone }) {
  const { equipped, setPart, randomize, save, isUnlocked } = useAvatar();
  const { color } = useClan();
  const rigRef = useRef(null);
  const [slotKey, setSlotKey] = useState('hair');
  const [saving, setSaving] = useState(false);

  const slot = useMemo(() => SLOTS.find((s) => s.key === slotKey), [slotKey]);

  const equip = (item, unlocked) => {
    if (!unlocked) {
      haptic.light();
      toast.error(unlockLabel(item) || 'Locked');
      return;
    }
    haptic.light();
    setPart({ [slot.key]: item.id });
    rigRef.current?.play('thumbs');
  };

  const pickColor = (idx) => {
    haptic.light();
    setPart({ [slot.colorKey]: idx });
  };

  const doRandom = () => {
    haptic.light();
    randomize();
    rigRef.current?.play('celebrate');
  };

  const finish = async () => {
    setSaving(true);
    try {
      await save();
      onDone?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen gutter={false} edges={standalone ? ['top', 'bottom'] : []} style={{ flex: 1 }}>
      {standalone && (
        <View style={{ paddingHorizontal: space.gutter, marginTop: space.md }}>
          <Text style={type.title}>Build your runner</Text>
          <Text style={[type.caption, { marginTop: 4 }]}>
            Earn more gear by running, claiming zones, and keeping streaks.
          </Text>
        </View>
      )}

      {/* preview */}
      <View style={styles.stage}>
        <Reveal>
          <PressableScale
            onPress={() => { haptic.light(); rigRef.current?.play('wave'); }}
            accessibilityRole="button"
            accessibilityLabel="Your character — tap to wave"
          >
            <CharacterRig ref={rigRef} equipped={equipped} size={68} animate clanColor={color?.stroke} />
          </PressableScale>
        </Reveal>
        <PressableScale
          onPress={doRandom}
          style={styles.diceBtn}
          accessibilityRole="button"
          accessibilityLabel="Randomize character"
        >
          <AppIcon name="randomize" size={22} />
        </PressableScale>
        <Text style={[type.caption, styles.hint]}>Tap your runner to say hi</Text>
      </View>

      {/* slot chips */}
      <SlotChips active={slotKey} onChange={setSlotKey} />

      {/* items + colors */}
      <ScrollView
        style={{ flex: 1, marginTop: space.md }}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xl }}
        showsVerticalScrollIndicator={false}
      >
        {slot.palette && (
          <>
            <Text style={[type.labelSm, { marginBottom: space.sm }]}>Color</Text>
            <Swatches palette={slot.palette} value={equipped[slot.colorKey] ?? 0} onPick={pickColor} />
            <View style={{ height: space.lg }} />
          </>
        )}
        <ItemGrid
          slot={slot}
          equipped={equipped}
          isUnlocked={isUnlocked}
          onEquip={equip}
          clanColor={color?.stroke}
        />
      </ScrollView>

      {standalone && (
        <View style={{ paddingHorizontal: space.gutter, paddingTop: space.sm }}>
          <Button title="Save & continue" variant="gradient" loading={saving} onPress={finish} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', paddingVertical: space.md },
  hint: { marginTop: 2, color: colors.textDim },
  diceBtn: {
    position: 'absolute',
    right: space.gutter,
    top: space.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: 'transparent',
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cellWrap: { width: '31%' },
  cell: {
    width: '100%',
    alignItems: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: 4,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: 'transparent',
    minHeight: 96,
  },
  lockWrap: { alignItems: 'center', marginTop: 2, gap: 1 },
  lockLabel: { ...type.caption, fontSize: 9.5, lineHeight: 12, color: colors.textDim, textAlign: 'center' },

  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
});
