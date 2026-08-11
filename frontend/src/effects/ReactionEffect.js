import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import EffectPlayer from './EffectPlayer';
import { getReactionEffect } from './reactionRegistry';

export default function ReactionEffect({ reaction, target, point, centered = false, size = 96, playToken = 0, style, onComplete }) {
  const [measured, setMeasured] = useState(point || null);
  useEffect(() => {
    if (point) {
      setMeasured(point);
      return;
    }
    target?.current?.measureInWindow?.((x, y, width) => setMeasured({ x: x + width / 2, y }));
  }, [point, target, playToken]);
  const effect = getReactionEffect(reaction);
  if (!effect || !measured) return null;
  return (
    <View pointerEvents="none" style={[{
      position: 'absolute',
      left: measured.x - size / 2,
      top: centered ? measured.y - size / 2 : measured.y - size,
    }, style]}>
      <EffectPlayer effect={effect} size={size} playToken={playToken} onComplete={onComplete} />
    </View>
  );
}
