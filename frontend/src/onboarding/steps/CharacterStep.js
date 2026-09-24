// One slot of the character creator: the lit rig on the night stage, a
// headline in the game's voice, and the docked picker sheet (colour swatches
// + item grid + Continue).
//
// Every step is the same component — `STEP_COPY` in ../steps.js supplies the
// slot key and the copy, so adding a slot to the flow is a one-line change.

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '../../theme';
import { ToonButton } from '../../components/ui';
import { toast } from '../../ui/toast';
import { haptic, PressableScale } from '../../ui/motion';
import CharacterRig, { PartThumb } from '../../components/character/CharacterRig';
import {
  ITEMS,
  SLOTS,
  firstRunItems,
  itemPreviewSources,
  itemVariantSources,
  unlockLabel,
} from '../../config/cosmetics';
import { listedItems } from '../../config/hiddenCosmetics';
import { useAvatar } from '../../state/avatar';
import { preloadImages } from '../../utils/imagePreload';
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
  // Hidden items (hiddenCosmetics.js) are left out, bar the one being worn.
  const all = useMemo(() => listedItems(ITEMS[slotKey], equipped[slotKey]), [slotKey, equipped]);

  // First run shows only what the runner can actually wear. A wall of padlocks
  // is a shop pitch, and this is the five minutes where they are meeting their
  // character — the locked catalogue is the Avatar Studio's job. The equipped
  // item is always kept, so a server-granted piece can never vanish mid-flow.
  //
  // Then narrowed again to the STARTER RACK (`firstRunItems`): unlocked is not
  // the same question as "worth showing now". Free covers dozens of colourways
  // per slot, and scrolling forty pairs of shorts before the first run both
  // buries the choice and spends the wardrobe the pass and the boxes are meant
  // to hand out later. The rest is met in the Avatar Studio, already unlocked.
  const items = useMemo(
    () => firstRunItems(
      slotKey,
      all.filter((item) => isUnlocked(item) || item.id === equipped[slotKey]),
      equipped[slotKey]
    ),
    [all, isUnlocked, equipped, slotKey]
  );

  useEffect(() => {
    preloadImages(itemPreviewSources(slotKey));
    const selected = items.find((item) => item.id === equipped[slotKey]);
    preloadImages(itemVariantSources(selected));
  }, [equipped, items, slotKey]);

  const pick = (item, unlocked) => {
    if (!unlocked) {
      haptic.light();
      toast.error(unlockLabel(item) || 'Locked. Keep running to earn it');
      return;
    }
    haptic.light();
    setPart({ [slotKey]: item.id });
    // The runner reacts when the art lands, not when the cell is tapped — see
    // `animateSwaps` in CharacterRig, and the note in AvatarStudioScreen.
  };

  return (
    <View style={styles.fill}>
      <StepHeadline title={title} sub={sub} style={styles.headline} />

      <View style={styles.stage}>
        <PressableScale
          onPress={() => { haptic.light(); rigRef.current?.play('wave'); }}
          accessibilityRole="button"
          accessibilityLabel="Your runner, tap to say hi"
        >
          <CharacterRig ref={rigRef} equipped={equipped} size={92} animate animateSwaps />
        </PressableScale>
      </View>

      <PickerSheet
        title={sheetTitle}
        items={items}
        selectedId={equipped[slotKey]}
        onSelect={pick}
        isUnlocked={isUnlocked}
        renderThumb={(item, size) => (
          // Wearing the runner's own colour. Without `equipped` the grid drew
          // every hair tile at palette index 0 — near-black on a near-black
          // sheet — while the runner above it was blonde, so the grid read as
          // a row of empty cells and picking a style was guesswork.
          <PartThumb slot={slotKey} item={item} size={size} equipped={equipped} />
        )}
        palette={slot?.palette}
        colorIndex={slot?.colorKey ? equipped[slot.colorKey] ?? 0 : 0}
        // Only items shipping ten pre-rendered variants can take a swatch. The
        // row stays visible either way; see PickerSheet.
        colorable={!!items.find((item) => item.id === equipped[slotKey])?.art}
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
