import React, { Component, useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { Image } from '../ui/image';
import { useReduceMotion } from '../ui/motion';
import AnimatedImageEffect from './AnimatedImageEffect';
import LottieEffect from './LottieEffect';
import SpriteAnimation from './SpriteAnimation';
import { getEffect } from './effectRegistry';
import { EFFECT_TYPE } from './effectTypes';

class EffectBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) { this.props.onError?.(error); }
  render() { return this.state.failed ? this.props.fallback ?? null : this.props.children; }
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

export function validateEffectSpec(spec) {
  if (!spec || typeof spec !== 'object') return { valid: false, reason: 'unknown effect' };
  if (spec.source == null) return { valid: false, reason: 'missing source' };
  if (spec.type === EFFECT_TYPE.SPRITE) {
    const integers = ['frameWidth', 'frameHeight', 'columns', 'rows', 'frameCount'];
    if (integers.some((key) => !Number.isInteger(spec[key]) || spec[key] <= 0)) {
      return { valid: false, reason: 'invalid sprite dimensions' };
    }
    if (!positive(spec.fps)) return { valid: false, reason: 'invalid sprite FPS' };
    if (spec.frameCount > spec.columns * spec.rows) {
      return { valid: false, reason: 'frame count exceeds sprite grid' };
    }
    return { valid: true, reason: null };
  }
  if ([EFFECT_TYPE.LOTTIE, EFFECT_TYPE.ANIMATED_IMAGE, EFFECT_TYPE.STATIC].includes(spec.type)) {
    return { valid: true, reason: null };
  }
  return { valid: false, reason: `unsupported effect type: ${String(spec.type)}` };
}

export function effectDurationMs(spec, speed = 1) {
  const safeSpeed = positive(speed) ? speed : 1;
  if (spec?.type === EFFECT_TYPE.SPRITE && positive(spec.frameCount) && positive(spec.fps)) {
    return (spec.frameCount / spec.fps / safeSpeed) * 1000;
  }
  if (positive(spec?.duration)) return spec.duration / safeSpeed;
  if (spec?.type === EFFECT_TYPE.ANIMATED_IMAGE && positive(spec?.frameCount) && positive(spec?.fps)) {
    return (spec.frameCount / spec.fps / safeSpeed) * 1000;
  }
  return 800;
}

function MissingEffect({ id, reason, onError }) {
  useEffect(() => {
    onError?.(new Error(`PASER effect ${id}: ${reason}`));
  }, [id, onError, reason]);
  return null;
}

function ReducedEffect({ onComplete }) {
  useEffect(() => { onComplete?.(); }, [onComplete]);
  return null;
}

export default function EffectPlayer({
  effect,
  size = 180,
  loop,
  speed = 1,
  scale,
  opacity = 1,
  playToken = 0,
  playing = true,
  reducedMotion,
  allowReducedMotion = false,
  style,
  fallback = null,
  onComplete,
  onError,
}) {
  const systemReduced = useReduceMotion();
  const reduced = reducedMotion ?? systemReduced;
  const spec = typeof effect === 'string' ? getEffect(effect) : effect;
  const validation = validateEffectSpec(spec);
  const identity = `${spec?.id || String(effect)}:${playToken}`;
  const shouldLoop = loop ?? !!spec?.loop;
  const effectiveSpeed = speed * (spec?.speed || 1);

  const mounted = useRef(true);
  const completed = useRef(false);
  const identityRef = useRef(identity);
  const completeRef = useRef(onComplete);
  const errorRef = useRef(onError);
  const [settledIdentity, setSettledIdentity] = useState(null);
  const settled = settledIdentity === identity;
  completeRef.current = onComplete;
  errorRef.current = onError;

  if (identityRef.current !== identity) {
    identityRef.current = identity;
    completed.current = false;
  }

  useEffect(() => () => { mounted.current = false; }, []);
  const completeOnce = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    if (mounted.current) setSettledIdentity(identityRef.current);
    completeRef.current?.();
  }, []);
  const failOnce = useCallback((error) => {
    if (completed.current) return;
    errorRef.current?.(error);
    completeOnce();
  }, [completeOnce]);

  // Native callbacks are best-effort. A corrupt Lottie, animated image, or
  // renderer regression must still release its texture and complete its slot.
  useEffect(() => {
    if (!validation.valid || shouldLoop || reduced || settled) return undefined;
    const expected = effectDurationMs(spec, effectiveSpeed);
    const timer = setTimeout(completeOnce, Math.min(12000, Math.max(600, expected + 650)));
    return () => clearTimeout(timer);
  }, [completeOnce, effectiveSpeed, reduced, settled, shouldLoop, spec, validation.valid]);

  if (settled) return null;
  if (!validation.valid) {
    return <MissingEffect id={String(spec?.id || effect)} reason={validation.reason} onError={failOnce} />;
  }
  if (reduced && !allowReducedMotion) return <ReducedEffect onComplete={completeOnce} />;

  const visualScale = positive(spec.visualScale) ? spec.visualScale : 1;
  const renderSize = size * visualScale;
  const visualStyle = {
    transform: [
      { translateX: size * (spec.visualOffsetX || 0) },
      { translateY: size * (spec.visualOffsetY || 0) },
    ],
  };
  const common = {
    source: spec.source,
    size: renderSize,
    loop: shouldLoop,
    speed: effectiveSpeed,
    opacity,
    playToken,
    style: [visualStyle, style],
    onComplete: completeOnce,
    onError: failOnce,
  };
  let player;
  if (spec.type === EFFECT_TYPE.SPRITE) {
    player = (
      <SpriteAnimation
        {...common}
        sheetWidth={spec.columns * spec.frameWidth}
        sheetHeight={spec.rows * spec.frameHeight}
        frameWidth={spec.frameWidth}
        frameHeight={spec.frameHeight}
        columns={spec.columns}
        rows={spec.rows}
        frameCount={spec.frameCount}
        fps={spec.fps}
        scale={scale == null ? undefined : scale * visualScale}
        playing={playing}
      />
    );
  } else if (spec.type === EFFECT_TYPE.LOTTIE) {
    player = <LottieEffect {...common} />;
  } else if (spec.type === EFFECT_TYPE.ANIMATED_IMAGE) {
    player = <AnimatedImageEffect {...common} duration={spec.duration} frameCount={spec.frameCount} fps={spec.fps} />;
  } else {
    player = <Image source={spec.source} resizeMode="contain" onError={failOnce} style={[{ width: renderSize, height: renderSize, opacity }, visualStyle, style]} />;
  }

  return (
    <EffectBoundary key={identity} fallback={fallback} onError={failOnce}>
      <View pointerEvents="none">{player}</View>
    </EffectBoundary>
  );
}
