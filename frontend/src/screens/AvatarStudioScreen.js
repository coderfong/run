// Avatar Studio — the character customizer. Entry points:
//   · profile (navigated): opened from You → settings; edits persist live,
//     the header back button is the exit. This is the live path.
//   · standalone: the legacy first-run setup. First-run character building
//     now happens step-by-step in `src/onboarding/` (CharacterStep), so
//     nothing renders this with `standalone` today — the branch is kept as a
//     working fallback.
//
// Layout: rig preview (tap = wave) on the roadside scene + randomize · slot
// chips · item grid with locked states (unlock condition shown on locked
// cells) · color swatches for colorable slots (hair/glasses/tops/bottoms).
// Items are real PNG art (assets/character); a swatch picks the palette INDEX,
// which selects that item's pre-rendered color variant. Skin stays the art's
// own tone.
//
// Themed, not dark-only: the preview stands on SceneBackdrop, which is the
// cream daytime kerb under a light theme. Chips and item cells read off the
// active palette so they don't stay dark-on-cream there.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Check,
  Crown,
  Footprints,
  Glasses,
  Layers,
  Lock,
  Scissors,
  Shirt,
  Smile,
  Sparkles,
} from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { radius, space, useTheme, useThemedStyles, useThemedType, withAlpha } from '../theme';
import { Button, Framed, Screen } from '../components/ui';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import { RARITY_COLOR } from '../components/RewardArt';
import SceneBackdrop, { useSceneBackdrop } from '../components/SceneBackdrop';
import { PressableScale, Reveal, haptic } from '../ui/motion';
import { toast } from '../ui/toast';
import { useAvatar } from '../state/avatar';
import { useClan } from '../state/clan';
import CharacterRig, { BODY_RATIO, PartThumb } from '../components/character/CharacterRig';
import {
  ITEMS,
  SLOTS,
  itemPreviewSources,
  itemVariantSources,
  unlockLabel,
} from '../config/cosmetics';
import { preloadImages } from '../utils/imagePreload';

// Rig preview size, shared with the stage so the backdrop can be sized to it.
const RIG_SIZE = 68;
const RIG_HEADROOM = 0.14; // matches HEADROOM in CharacterRig

const SLOT_ICONS = {
  face: Smile,
  hair: Scissors,
  headwear: Crown,
  glasses: Glasses,
  top: Shirt,
  bottom: Layers,
  footwear: Footprints,
  accessory: Sparkles,
};

function SlotChips({ active, onChange, onWarm }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRail}
      style={{ flexGrow: 0 }}
    >
      {SLOTS.map((s) => {
        const on = s.key === active;
        const Icon = SLOT_ICONS[s.key];
        return (
          <PressableScale
            key={s.key}
            onPressIn={() => onWarm?.(s.key)}
            onPress={() => onChange(s.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={s.label}
            style={[styles.chip, on && styles.chipActive]}
          >
            <View style={[styles.chipIcon, on && styles.chipIconActive]}>
              <Icon size={17} strokeWidth={2.3} color={on ? colors.text : colors.textMuted} />
            </View>
            <Text style={[type.bodySmBold, styles.chipLabel, on && styles.chipLabelActive]}>
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
/**
 * `enabled` false keeps the row ON SCREEN but greys it out.
 *
 * It used to be removed entirely whenever the worn item had no colour variants
 * — which is most of the catalogue, because the authored multicolour pieces
 * only carry one image. The reasoning was sound (ten swatches that do nothing
 * are worse than none) and the result was not: the colour row appeared and
 * vanished as you moved along the grid, with nothing said, so the honest
 * reading from the outside was "I can't change the colours of anything".
 *
 * Shown and disabled says the true thing instead: this slot takes colour, this
 * particular item does not.
 */
function Swatches({ palette, value, onPick, enabled = true }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.swatchRow, !enabled && { opacity: 0.35 }]}>
      {palette.map((hex, i) => {
        const on = enabled && i === value;
        const light = hex === '#F4F4F5' || hex === '#E8D06B' || hex === '#EAB308';
        return (
          <PressableScale
            key={hex}
            onPress={() => enabled && onPick(i)}
            disabled={!enabled}
            accessibilityRole="button"
            accessibilityLabel={`Color ${i + 1}`}
            accessibilityState={{ selected: on, disabled: !enabled }}
            style={[
              styles.swatch,
              { backgroundColor: hex },
              on && { borderColor: colors.text, borderWidth: 2.5 },
            ]}
          >
            {on ? <Check size={14} color={light ? '#26272B' : '#fff'} strokeWidth={3} /> : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

// One cell of the item grid, factored out so `AvatarStudioScreen` can hand it
// to a `FlatList` as `renderItem`. Headwear alone runs 124 items — rendering
// every cell at once (the old `.map` inside a plain `View`) meant switching a
// slot chip mounted up to 124 real image views synchronously. `FlatList`
// below only mounts what's near the viewport.
// Same hand-drawn box the Shop uses for its own item grid (ShopProductCard) —
// this screen used to be the one place in the catalogue that showed items in
// a plain rounded rect instead of the app's frame language. Rarity tint
// matches Shop's too, so a legendary hat reads as legendary in both places it
// is browsed, not just the one you can buy it from.
const GridCell = React.memo(function GridCell({ item, slot, equipped, isUnlocked, onEquip, clanColor, colors, styles }) {
  const selected = equipped[slot.key] === item.id;
  const unlocked = isUnlocked(item);
  const tint = selected ? colors.text : (RARITY_COLOR[item.rarity] || colors.border);
  return (
    <View style={styles.cellWrap}>
      <PressableScale
        onPress={() => onEquip(item, unlocked)}
        accessibilityRole="button"
        accessibilityLabel={unlocked ? `Equip ${item.label}` : `${item.label}, locked: ${unlockLabel(item)}`}
        accessibilityState={{ selected }}
      >
        <Framed
          frame={frameVariant('card', `avatar:${slot.key}:${item.id}`)}
          tint={tint}
          fill={selected ? withAlpha(tint, 0.14) : colors.card}
          weight={selected ? INK.medium : INK.thin}
          pose={framePose(`avatar:${slot.key}:${item.id}`)}
          inset={false}
          style={styles.cell}
          contentStyle={styles.cellContent}
        >
          {/* Art only — no name or unlock caption. The lock icon still marks
              locked items, and tapping one toasts how to earn it, so the
              text is available on demand instead of under every tile. */}
          <View style={{ opacity: unlocked ? 1 : 0.28 }}>
            {/* `equipped` replaces the old `contrastHair` patch: the tile
                wears the colour the runner actually chose, so the grid
                agrees with the character standing above it. */}
            <PartThumb slot={slot.key} item={item} size={56} clanColor={clanColor} equipped={equipped} />
          </View>
          {!unlocked && (
            <View style={styles.lockWrap}>
              <Lock size={14} color={colors.textMuted} />
            </View>
          )}
        </Framed>
      </PressableScale>
    </View>
  );
});

export default function AvatarStudioScreen({ standalone = false, onDone }) {
  const { scheme, colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { equipped, setPart, randomize, save, isUnlocked } = useAvatar();
  const { color } = useClan();
  // The scene has to sit BEHIND the whole runner, not as a band under their
  // feet, so the stage asks for a box at least as tall as the rig draws:
  // body (size x BODY_RATIO) plus the headroom the rig reserves above it for
  // tall hair, plus the stage's own padding. `cover` crops whichever scene is
  // showing to that box, so light and dark stay the same height here too.
  const sceneMinH = RIG_SIZE * BODY_RATIO * (1 + RIG_HEADROOM) + space.md * 2;
  const { height: sceneH } = useSceneBackdrop({ minHeight: sceneMinH });
  const rigRef = useRef(null);
  const [slotKey, setSlotKey] = useState('hair');
  const [saving, setSaving] = useState(false);

  const slot = useMemo(() => SLOTS.find((s) => s.key === slotKey), [slotKey]);
  const items = useMemo(() => ITEMS[slotKey] || [], [slotKey]);
  const gridKeyExtractor = useCallback((item) => item.id, []);

  // Only the recolourable items carry `art` (ten pre-rendered variants). Most
  // of the catalogue is authored multicolour art that a swatch cannot touch,
  // so the colour row follows the WORN item, not the slot — otherwise picking
  // a striped tee leaves ten swatches on screen that do nothing at all.
  const colorable = useMemo(
    () => !!(ITEMS[slotKey] || []).find((item) => item.id === equipped[slotKey])?.art,
    [slotKey, equipped]
  );

  const warmSlot = useCallback(
    (key) => preloadImages(itemPreviewSources(
      key,
      key === 'hair' ? { hairColor: scheme === 'dark' ? 4 : 0 } : null
    )),
    [scheme]
  );

  useEffect(() => {
    warmSlot(slotKey);
    const selected = (ITEMS[slotKey] || []).find((item) => item.id === equipped[slotKey]);
    preloadImages(itemVariantSources(selected));
  }, [equipped, slotKey, warmSlot]);

  const equip = useCallback((item, unlocked) => {
    if (!unlocked) {
      haptic.light();
      toast.error(unlockLabel(item) || 'Locked');
      return;
    }
    haptic.light();
    setPart({ [slot.key]: item.id });
    // No rig.play() here. The runner reacts when the new art LANDS
    // (`animateSwaps`, see CharacterRig), which for anything not already in the
    // image cache is a beat after the tap — firing a second animation on the
    // tap itself just put a stutter in front of it. A colour swatch gets the
    // same reaction for free, which it never used to have.
  }, [slot, setPart]);

  const renderGridItem = useCallback(({ item }) => (
    <GridCell
      item={item}
      slot={slot}
      equipped={equipped}
      isUnlocked={isUnlocked}
      onEquip={equip}
      clanColor={color?.stroke}
      colors={colors}
      styles={styles}
    />
  ), [slot, equipped, isUnlocked, equip, color?.stroke, colors, styles]);

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

      {/* preview — the runner stands at the foot of the scene */}
      <View style={[styles.stage, { minHeight: sceneH }]}>
        {/* Bottom-anchored: the runner stands at the foot of this box, so the
            crop has to come off the sky rather than off the pavement. */}
        {/* Wind through the scene. Denser drift than the You page: this box
            is a stage rather than a header behind a stat wall. */}
        <SceneBackdrop minHeight={sceneMinH} anchor="bottom" ambient="leaves" ambientDensity={1.4} />
        {/* The runner is the subject, so they stand in the CENTRE of the scene.
            The dice used to sit in the same flex row, which pushed the
            character off-centre by half the button — on a scene composed around
            a middle it read as a mistake. It floats in the top-right corner now,
            clear of the character entirely, and takes no part in the layout. */}
        <View style={styles.runnerRow}>
          <Reveal>
            <PressableScale
              onPress={() => { haptic.light(); rigRef.current?.play('wave'); }}
              accessibilityRole="button"
              accessibilityLabel="Your character, tap to wave"
            >
              <CharacterRig ref={rigRef} equipped={equipped} size={RIG_SIZE} animate animateSwaps clanColor={color?.stroke} />
            </PressableScale>
          </Reveal>
        </View>
        <PressableScale
          onPress={doRandom}
          style={styles.diceBtn}
          accessibilityRole="button"
          accessibilityLabel="Randomize character"
        >
          <AppIcon name="randomize" size={32} />
        </PressableScale>
      </View>


      {/* slot chips */}
      <SlotChips active={slotKey} onChange={setSlotKey} onWarm={warmSlot} />

      {/* items + colors. FlatList rather than a ScrollView.map: headwear alone
          is 124 items, and mounting every cell at once made switching a slot
          chip a synchronous burst of up to 124 real image views. */}
      <FlatList
        key="avatar-item-grid"
        data={items}
        keyExtractor={gridKeyExtractor}
        renderItem={renderGridItem}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        style={{ flex: 1, marginTop: space.md }}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xl }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={18}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews
        ListHeaderComponent={slot.palette ? (
          <>
            <Text style={[type.labelSm, { marginBottom: space.sm }]}>Color</Text>
            <Swatches
              palette={slot.palette}
              value={equipped[slot.colorKey] ?? 0}
              onPick={pickColor}
              enabled={colorable}
            />
            {/* Says why, rather than leaving a dead row. No dashes in copy. */}
            {!colorable ? (
              <Text style={[type.caption, { marginTop: space.sm }]}>
                This one comes in its own colours. Pick another to recolour it.
              </Text>
            ) : null}
          </>
        ) : null}
      />

      {standalone && (
        <View style={{ paddingHorizontal: space.gutter, paddingTop: space.sm }}>
          <Button title="Save & continue" variant="gradient" loading={saving} onPress={finish} />
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  // flex-end so the rig's feet land on the road at the bottom of the scene
  // instead of floating in the sky above it.
  stage: { alignItems: 'center', justifyContent: 'flex-end', paddingVertical: space.md },
  // Full width so the runner is centred on the SCENE, not on whatever the row
  // happens to contain.
  runnerRow: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'flex-end' },
  // Floated, so adding or removing it can never shift the character again.
  // Top corner rather than bottom: the runner stands at the FOOT of the
  // scene, so bottom-right sat it right next to their shoulder on a narrow
  // phone. The sky above their head has the room the ground doesn't.
  diceBtn: {
    position: 'absolute',
    right: space.sm,
    top: space.md,
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },

  chipRail: {
    gap: space.sm,
    paddingHorizontal: space.gutter,
    paddingVertical: space.sm,
  },
  chip: {
    width: 72,
    minHeight: 66,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    borderRadius: radius.card,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cardAlt,
  },
  chipIconActive: { backgroundColor: colors.bg },
  chipLabel: { color: colors.textMuted, fontSize: 12 },
  chipLabelActive: { color: colors.bg },

  // `columnWrapperStyle` for the FlatList grid — applied to every row of 3.
  gridRow: { justifyContent: 'space-between', marginTop: 7 },
  cellWrap: { width: '31%' },
  // Sizing only — the frame itself draws the box now (see GridCell).
  cell: { width: '100%', minHeight: 88 },
  cellContent: { alignItems: 'center', justifyContent: 'center', padding: space.xs },
  lockWrap: { alignItems: 'center', marginTop: 2, gap: 1 },

  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
