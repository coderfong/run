// ClaimFx — the level-unlocked "explosion" that plays when a claim lands.
//
// Art-driven: each FX key maps to a Lottie JSON in CLAIM_FX_SOURCES. That map
// is intentionally EMPTY until you generate the animations — drop a file in and
// uncomment its line and the effect turns on with zero other changes. While a
// key has no source, this renders nothing (the ResultScreen keeps its Confetti
// as the baseline celebration), so there are never broken require()s.
//
// TODO(assets): assets/lottie/claim-burst.json, claim-shockwave.json,
// claim-fireworks.json, claim-supernova.json.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

let LottieView = null;
try { LottieView = require('lottie-react-native').default; } catch { LottieView = null; }

// key → require('../../assets/lottie/claim-<key>.json'). Empty until art lands.
export const CLAIM_FX_SOURCES = {
  // burst: require('../../assets/lottie/claim-burst.json'),
  // shockwave: require('../../assets/lottie/claim-shockwave.json'),
  // fireworks: require('../../assets/lottie/claim-fireworks.json'),
  // supernova: require('../../assets/lottie/claim-supernova.json'),
};

export default function ClaimFx({ fx = 'burst', play = false, onDone }) {
  const ref = useRef(null);
  const source = CLAIM_FX_SOURCES[fx];

  useEffect(() => {
    if (play && LottieView && source) ref.current?.play?.();
  }, [play, source]);

  if (!LottieView || !source || !play) return null;
  return (
    <View pointerEvents="none" style={styles.overlay}>
      <LottieView
        ref={ref}
        source={source}
        autoPlay
        loop={false}
        onAnimationFinish={onDone}
        style={styles.anim}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  anim: { width: '100%', height: '100%' },
});
