// PaserMark — the brand mark: the running figure from the app icon.
//
// Replaces the old `LoopMark` pink ring, which survived in the result card and
// the share image long after the icon changed. One asset serves every colour:
// `assets/brand/paser-mark.png` is a transparent, all-white silhouette, so
// `tintColor` paints it (see scripts/make-brand-mark.py for how it is cut).
//
// Plain RN `Image`, deliberately — this renders inside `captureRef` share
// cards, and `expo-image`'s async decode is what makes captured art come out
// blank.

import React from 'react';
import { Image } from 'react-native';

const MARK = require('../../assets/brand/paser-mark.png');

export default function PaserMark({ size = 28, color = '#FFFFFF', style }) {
  return (
    <Image
      source={MARK}
      style={[{ width: size, height: size, tintColor: color }, style]}
      resizeMode="contain"
      fadeDuration={0}
    />
  );
}
