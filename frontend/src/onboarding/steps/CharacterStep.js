// One slot of the character creator: the lit rig on the night stage, a
// headline in the game's voice, and the docked picker sheet (colour swatches
// + item grid + Continue).
//
// Every step is the same component — `STEP_COPY` in ../steps.js supplies the
// slot key and the copy, so adding a slot to the flow is a one-line change.

import React, { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '../../theme';
import { ToonButton } from '../../components/ui';
import { toast } from '../../ui/toast';
import { haptic, PressableScale } from '../../ui/motion';
import CharacterRig, { PartThumb } from '../../components/character/CharacterRig';
import { ITEMS, SLOTS, unlockLabel } from '../../config/cosmetics';
import { useAvatar } from '../../state/avatar';
import { PickerSheet } from '../pickers';
import { StepHeadline } from '../ui';

export default function CharacterStep({
  slotKey,
  title,
  sub,
  sheetTitle,
  ctaLabel = 'Continue',
  onContinue,
  bottomInset = 0,
}) {
  const { equipped, setPart, isUnlocked } = useAvatar();
  const rigRef = useRef(null);
  const slot = useMemo(() => SLOTS.find((s) => s.key === slotKey), [slotKey]);
  const items = ITEMS[slotKey] || [];

  const pick = (item, unlocked) => {
    if (!unlocked) {
      haptic.light();
      toast.error(unlockLabel(item) || 'Locked — keep running to earn it');
      return;
    }
    haptic.light();
    setPart({ [slotKey]: item.id });
    rigRef.current?.play('thumbs');
  };

  return (
    <View style={styles.fill}>
      <StepHeadline title={title} sub={sub} style={styles.headline} />

      <View style={styles.stage}>
        <PressableScale
          onPress={() => { haptic.light(); rigRef.current?.play('wave'); }}
          accessibilityRole="button"
          accessibilityLabel="Your runner — tap to say hi"
        >
          <CharacterRig ref={rigRef} equipped={equipped} size={92} animate />
        </PressableScale>
      </View>

      <PickerSheet
        title={sheetTitle}
        items={items}
        selectedId={equipped[slotKey]}
        onSelect={pick}
        isUnlocked={isUnlocked}
        renderThumb={(item) => (
          <PartThumb slot={slotKey} item={item} equipped={equipped} size={64} />
        )}
        palette={slot?.palette}
        colorIndex={slot?.colorKey ? equipped[slot.colorKey] ?? 0 : 0}
        onPickColor={(i) => slot?.colorKey && setPart({ [slot.colorKey]: i })}
        maxHeight="58%"
        footer={
          <View style={{ paddingBottom: bottomInset + space.md }}>
            <ToonButton title={ctaLabel} onPress={onContinue} />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headline: { paddingHorizontal: space.gutter, paddingTop: space.md },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: space.sm },
});
