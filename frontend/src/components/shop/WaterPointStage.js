// WaterPointStage — the whole immersive Water Point: the painted scene
// (PitStopScene, unchanged) plus everything interactive layered over it —
// the nine products standing at their anchors, the try-on mirror, the
// restock sign, the crew's speech bubbles, and small taps on the crew
// themselves.
//
// TWO LAYERS, ONE BOX, NEITHER MEASURING THE OTHER. PitStopScene keeps
// measuring its own width exactly as it always has (self-contained, so this
// file never has to reach into it); this component's interactive layer
// measures ITS OWN width the same way, on the same full-width box the parent
// hands both of them. Because they are laid on top of each other by the
// parent rather than nested, their measured widths are always identical —
// which is what lets a product anchor and the painted shelf it sits on stay
// registered without this component and PitStopScene sharing any state.
//
// PitStopScene stays exactly what it was: decorative, pointerEvents="none",
// hidden from screen readers. This layer is the opposite of all three —
// it owns every touch target and every accessibility label the Water Point
// has, the same job the old grid used to do below the fold.

import React, { useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';

import PitStopScene from './PitStopScene';
import WaterPointProduct from './WaterPointProduct';
import TryOnMirror from './TryOnMirror';
import RestockSign from './RestockSign';
import NPCSpeechBubble from './NPCSpeechBubble';
import { useShopDialogue } from './useShopDialogue';
import { getShopStage, SHOP_STAGE } from './shopStateMachine';
import { DIALOGUE_ANCHOR, PRODUCT_ANCHORS, RESTOCK_SIGN, SCENE, TRY_ON_MIRROR } from '../../config/shopStageLayout';
import { SCENE_VIEW, SHOP_VIDEO_SCENE_HEIGHT } from '../../config/pitStop';
import { BODY_RATIO, HEADROOM } from '../character/CharacterRig';

const RARITY_RANK = { common: 0, rare: 1, epic: 2, legendary: 3 };

export function shopCoverLayout(viewport, headroom) {
  const renderWidth = Math.max(
    viewport.width,
    Math.max(0, viewport.height - headroom + 1) * SCENE.width
      / (SHOP_VIDEO_SCENE_HEIGHT - SCENE_VIEW.top)
  );
  const scale = renderWidth / SCENE.width;
  const cropTop = Math.max(0, SCENE_VIEW.top - headroom / scale);
  return {
    renderWidth,
    scale,
    cropTop,
    renderHeight: (SHOP_VIDEO_SCENE_HEIGHT - cropTop) * scale,
    left: (viewport.width - renderWidth) / 2,
  };
}

// A CREW anchor (PIT_STOP_LAYOUT.keeper/restocker/helper) stores `x` as the
// character's CENTRE and no height — the same convention PitStopCrew's own
// `crewFrame()` reads, so a tap target laid over one has to use the same
// math or it lands beside the body instead of on it.
//
// CAPPED AT THE COUNTER LINE. The rig's full height reaches well below
// `SCENE.counterTop` — that is the whole point of the counter plate, it cuts
// the crew off at the hip — and the counter product anchors sit in that same
// occluded band. Left uncapped, a tap meant for a counter item next to the
// restocker would hit their (invisible, counter-cut) legs instead, because
// this target renders after the products in the stack. Capping the hitbox to
// what is actually ON SCREEN of the character fixes that without having to
// reason about paint order between the two lists at all.
function crewTapFrame(a, scale, cropTop) {
  const w = a.width * scale;
  const fullHeight = w * BODY_RATIO * (1 + HEADROOM);
  const visibleHeight = Math.max(0, SCENE.counterTop - a.y) * scale;
  return {
    position: 'absolute',
    left: (a.x - a.width / 2) * scale,
    top: (a.y - cropTop) * scale,
    width: w,
    height: Math.min(fullHeight, visibleHeight),
  };
}

/**
 * Highest-rarity item to the dais, the next two to the shelves, the rest
 * along the counter in the order PRODUCT_ANCHORS lists them — see that
 * file's header for why the dais does not literally require a legendary.
 */
function assignAnchors(items) {
  const ranked = [...items].sort((a, b) => (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0));
  const rest = PRODUCT_ANCHORS.filter((a) => a.slot !== 'legendary');
  const pairs = [];
  ranked.forEach((item, i) => {
    const anchor = i === 0 ? PRODUCT_ANCHORS.find((a) => a.slot === 'legendary') : rest[i - 1];
    if (anchor) pairs.push({ item, anchor, featured: i === 0 });
  });
  return pairs;
}

export default function WaterPointStage({
  items,
  selectedId,
  selected,
  affordable,
  coins,
  purchaseStatus,
  equipped,
  headroom = 0,
  expiresAt,
  onExpire,
  onSelect,
  active = true,
}) {
  const window = useWindowDimensions();
  const [viewport, setViewport] = useState({ width: window.width, height: window.height });
  const { renderWidth, renderHeight, scale, cropTop, left } = shopCoverLayout(viewport, headroom);

  const placements = useMemo(() => assignAnchors(items), [items]);

  const { bubbles, pokeSeller, pokeFriend, pokeChill } = useShopDialogue({
    selected,
    purchaseStatus,
    coins,
  });

  // The named stage — AMBIENT / TRY_ON / READY_TO_BUY / BUYING /
  // PURCHASE_REACTION — derived from state ShopScreen already owns rather
  // than tracked separately; see shopStateMachine.js for why. BUYING is the
  // one branch this layer actually needs: every tap target locks while the
  // purchase mutation is in flight, so a second tap during the request
  // cannot fire a second buy.
  const stage = getShopStage({ selected, affordable, purchaseStatus });
  const disabled = stage === SHOP_STAGE.BUYING;

  return (
    <View style={styles.stage} onLayout={(e) => setViewport(e.nativeEvent.layout)}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left,
          width: renderWidth,
          height: renderHeight,
        }}
      >
      <PitStopScene
        selectedProductId={selectedId}
        selectedRarity={selected?.rarity || null}
        isSelectedUnavailable={!!selected && (selected.owned || !affordable)}
        purchaseStatus={purchaseStatus}
        active={active}
        headroom={headroom}
        viewportHeight={renderHeight}
      />

      {/* Everything below owns touches; nothing above this line does.
          ORDER IS TOUCH PRIORITY, not just paint order: the crew's own "small
          talk" targets render FIRST so the products and the mirror — the
          things a shopper is actually here to tap — win every pixel they
          overlap with a character's hitbox (the legendary dais sits close
          enough to the keeper that the two boxes do overlap by a few units;
          see PRODUCT_ANCHORS's header). A decorative one-liner losing a tap
          to a real purchase is the right trade; the reverse would not be. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <CrewTapTarget frame={DIALOGUE_ANCHOR.seller} scale={scale} cropTop={cropTop} label="Talk to the shopkeeper" onPress={pokeSeller} />
        <CrewTapTarget frame={DIALOGUE_ANCHOR.friend} scale={scale} cropTop={cropTop} label="Talk to your running friend" onPress={pokeFriend} />
        <CrewTapTarget frame={DIALOGUE_ANCHOR.chill} scale={scale} cropTop={cropTop} label="Talk to the other runner" onPress={pokeChill} />

        {placements.map(({ item, anchor, featured }) => (
          <WaterPointProduct
            key={item.item_id}
            item={item}
            cat={item.cat}
            frame={anchor}
            scale={scale}
            cropTop={cropTop}
            selected={selectedId === item.item_id}
            dimmed={!!selectedId && selectedId !== item.item_id}
            disabled={disabled}
            featured={featured}
            onSelect={onSelect}
          />
        ))}

        <TryOnMirror
          mirror={TRY_ON_MIRROR}
          scale={scale}
          cropTop={cropTop}
          equipped={equipped}
          item={selected}
          itemTick={selectedId}
        />

        <RestockSign
          frame={RESTOCK_SIGN}
          scale={scale}
          cropTop={cropTop}
          expiresAt={expiresAt}
          onExpire={onExpire}
        />

        <NPCSpeechBubble text={bubbles.seller?.text} tick={bubbles.seller?.tick} tone={bubbles.seller?.tone} anchor={DIALOGUE_ANCHOR.seller} scale={scale} cropTop={cropTop} />
        <NPCSpeechBubble text={bubbles.friend?.text} tick={bubbles.friend?.tick} tone={bubbles.friend?.tone} anchor={DIALOGUE_ANCHOR.friend} scale={scale} cropTop={cropTop} />
        <NPCSpeechBubble text={bubbles.chill?.text} tick={bubbles.chill?.tick} tone={bubbles.chill?.tone} anchor={DIALOGUE_ANCHOR.chill} scale={scale} cropTop={cropTop} />
      </View>
      </View>
    </View>
  );
}

function CrewTapTarget({ frame, scale, cropTop, label, onPress }) {
  return (
    <TouchableOpacity
      style={crewTapFrame(frame, scale, cropTop)}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={1}
    />
  );
}

const styles = StyleSheet.create({
  stage: { width: '100%', flex: 1, overflow: 'hidden', position: 'relative' },
});
