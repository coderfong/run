// WaterPointProduct — one item of stock, standing at its anchor in the scene
// rather than sitting in a grid cell.
//
// The touch target is bigger than the art (hitSlop), per the brief's
// responsiveness note — a 90-unit shelf pocket scales down to a genuinely
// small tap target on a compact phone, and this is a shop, not a puzzle.
//
// SELECTION READS THROUGH THREE CHANGES, all on the same shared value: the
// tapped item pops forward and up, everything else dims and sinks back a
// hair. No colour change and no border — rarity already has its own quiet
// signal (the coin tag's tint), and flooding the counter with a rarity
// palette on top of that is the "rainbow shop" the brief explicitly rules
// out.

import React, { memo, useEffect } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { PartThumb } from '../character/CharacterRig';
import AppIcon from '../AppIcon';
import { RARITY_COLOR } from '../RewardArt';
import { useReduceMotion } from '../../ui/motion';
import { nbInk, readableInk, useTheme, useThemedType, withAlpha } from '../../theme';

function sceneLayer(f, scale, cropTop) {
  return {
    position: 'absolute',
    left: f.x * scale,
    top: (f.y - cropTop) * scale,
    width: f.width * scale,
    height: f.height * scale,
  };
}

const WaterPointProduct = memo(function WaterPointProduct({
  item,
  cat,
  frame,
  scale,
  cropTop,
  selected,
  dimmed,
  disabled,
  featured = false,
  onSelect,
}) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const pop = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    const targetPop = selected ? 1.14 : dimmed ? 0.94 : 1;
    const targetOpacity = dimmed ? 0.5 : 1;
    if (reduced) {
      pop.value = targetPop;
      opacity.value = targetOpacity;
      return;
    }
    pop.value = withTiming(targetPop, { duration: 200, easing: Easing.out(Easing.quad) });
    opacity.value = withTiming(targetOpacity, { duration: 180 });
  }, [selected, dimmed, reduced, pop, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateY: (pop.value - 1) * -18 },
      { scale: pop.value },
    ],
  }));

  const tint = RARITY_COLOR[item.rarity] || colors.border;
  const artSize = frame.width * scale * (featured ? 0.72 : 0.68);

  return (
    <Animated.View
      style={[sceneLayer(frame, scale, cropTop), style, { alignItems: 'center' }]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        onPress={() => onSelect(item.item_id)}
        disabled={disabled}
        hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: !!disabled }}
        accessibilityLabel={`${cat?.label || item.item_id}, ${item.rarity}, ${
          item.owned ? 'owned' : `${item.price} coins`
        }`}
        accessibilityHint={item.owned ? undefined : 'Shows this item on the counter and the buy button'}
        style={{ alignItems: 'center' }}
      >
        <View
          style={{
            width: artSize,
            height: artSize,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PartThumb slot={item.slot} item={cat} size={artSize} />
        </View>
        {item.owned ? (
          <View
            style={{
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 8,
              backgroundColor: colors.cardAlt,
              borderWidth: 1.5,
              borderColor: nbInk(scheme, colors.cardAlt),
            }}
          >
            <Text style={[type.caption, { fontSize: 10, color: colors.textMuted }]}>Owned</Text>
          </View>
        ) : (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 8,
              backgroundColor: withAlpha(tint, 0.85),
              borderWidth: 1.5,
              borderColor: nbInk(scheme, tint),
            }}
          >
            <AppIcon name="coin" size={10} />
            <Text style={[type.caption, { fontSize: 10, color: readableInk(tint, { dark: '#0C0C10', light: '#FFFFFF' }) }]}>
              {item.price}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
});

export default WaterPointProduct;
