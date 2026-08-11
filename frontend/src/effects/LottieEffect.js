import React, { useEffect, useRef } from 'react';
import LottieView from 'lottie-react-native';

export default function LottieEffect({
  source,
  size = 160,
  loop = false,
  speed = 1,
  opacity = 1,
  playToken = 0,
  style,
  onComplete,
  onError,
}) {
  const animationRef = useRef(null);
  useEffect(() => () => animationRef.current?.reset?.(), [playToken, source]);
  return (
    <LottieView
      ref={animationRef}
      key={playToken}
      source={source}
      autoPlay
      loop={loop}
      speed={speed}
      resizeMode="contain"
      onAnimationFailure={onError}
      onAnimationFinish={(cancelled) => { if (!cancelled) onComplete?.(); }}
      style={[{ width: size, height: size, opacity }, style]}
    />
  );
}
