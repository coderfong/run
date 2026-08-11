import React, { useEffect } from 'react';
import { Image } from 'expo-image';

export default function AnimatedImageEffect({
  source,
  size = 160,
  duration,
  frameCount,
  fps,
  loop = false,
  speed = 1,
  opacity = 1,
  playToken = 0,
  style,
  onComplete,
  onError,
}) {
  const durationMs = duration || (frameCount && fps ? (frameCount / fps) * 1000 : 1000);
  useEffect(() => {
    if (loop) return undefined;
    const timer = setTimeout(() => onComplete?.(), durationMs / Math.max(0.01, speed));
    return () => clearTimeout(timer);
  }, [durationMs, loop, onComplete, playToken, speed]);
  return (
    <Image
      key={playToken}
      source={source}
      autoplay
      contentFit="contain"
      recyclingKey={String(playToken)}
      onError={onError}
      style={[{ width: size, height: size, opacity }, style]}
    />
  );
}
