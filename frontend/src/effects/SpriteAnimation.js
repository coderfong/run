import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';

const AnimatedImage = Animated.createAnimatedComponent(Image);

export function spriteFrameCoordinates(frameIndex, columns, frameCount) {
  'worklet';
  const safeColumns = Math.max(1, Math.floor(columns || 1));
  const safeCount = Math.max(1, Math.floor(frameCount || 1));
  const frame = Math.min(safeCount - 1, Math.max(0, Math.floor(frameIndex || 0)));
  return { column: frame % safeColumns, row: Math.floor(frame / safeColumns), frame };
}

export default function SpriteAnimation({
  source,
  sheetWidth,
  sheetHeight,
  frameWidth,
  frameHeight,
  columns,
  rows,
  frameCount,
  fps = 24,
  loop = false,
  speed = 1,
  size,
  scale,
  opacity = 1,
  playing = true,
  playToken = 0,
  style,
  onComplete,
  onError,
  pixelated = true,
}) {
  const frame = useSharedValue(0);
  const baseFrame = useSharedValue(0);
  const startedAt = useSharedValue(-1);
  const finished = useSharedValue(false);
  const controllerRef = useRef(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const safeColumns = Math.max(1, columns || Math.floor(sheetWidth / frameWidth));
  const safeRows = Math.max(1, rows || Math.ceil(frameCount / safeColumns));
  const safeCount = Math.max(1, Math.min(frameCount || safeColumns * safeRows, safeColumns * safeRows));
  const drawScale = useMemo(() => {
    if (scale != null) return scale;
    if (typeof size === 'number') return size / Math.max(frameWidth, frameHeight);
    return 1;
  }, [frameHeight, frameWidth, scale, size]);
  const viewport = {
    width: frameWidth * drawScale,
    height: frameHeight * drawScale,
  };

  const finishOnJS = useCallback(() => {
    controllerRef.current?.setActive?.(false);
    completeRef.current?.();
  }, []);

  const controller = useFrameCallback((clock) => {
    'worklet';
    if (finished.value) return;
    if (startedAt.value < 0) startedAt.value = clock.timestamp;
    const elapsedSeconds = Math.max(0, clock.timestamp - startedAt.value) / 1000;
    const next = baseFrame.value + Math.floor(elapsedSeconds * fps * Math.max(0.01, speed));
    if (loop) {
      frame.value = next % safeCount;
      return;
    }
    if (next >= safeCount) {
      frame.value = safeCount - 1;
      finished.value = true;
      runOnJS(finishOnJS)();
      return;
    }
    frame.value = next;
  }, false);
  controllerRef.current = controller;

  useEffect(() => {
    frame.value = 0;
    baseFrame.value = 0;
    startedAt.value = -1;
    finished.value = false;
    controller?.setActive?.(!!playing);
    return () => controller?.setActive?.(false);
  }, [playToken, source]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (finished.value) return undefined;
    if (playing) {
      baseFrame.value = frame.value;
      startedAt.value = -1;
    }
    controller?.setActive?.(!!playing);
    return undefined;
  }, [playing, controller, baseFrame, finished, frame, startedAt]);

  const imageStyle = useAnimatedStyle(() => {
    const position = spriteFrameCoordinates(frame.value, safeColumns, safeCount);
    return {
      transform: [
        { translateX: -position.column * viewport.width },
        { translateY: -position.row * viewport.height },
      ],
    };
  }, [safeColumns, viewport.height, viewport.width]);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.viewport,
        viewport,
        { opacity },
        style,
      ]}
    >
      <AnimatedImage
        source={source}
        resizeMode="stretch"
        fadeDuration={0}
        onError={onError}
        style={[
          {
            position: 'absolute',
            left: 0,
            top: 0,
            width: sheetWidth * drawScale,
            height: sheetHeight * drawScale,
          },
          pixelated ? styles.pixelated : null,
          imageStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { overflow: 'hidden' },
  // Android respects resizeMode/nearest-neighbour source pixels here; web
  // additionally reads this style key. Native ignores unknown web-only keys.
  pixelated: { imageRendering: 'pixelated' },
});
