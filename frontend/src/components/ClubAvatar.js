// A club's crest, wherever a club is named.
//
// Clubs are made with an uploaded photo, so that is what this draws. The
// lucide badge is the fallback for clubs that predate photos or removed
// theirs, and for the moment a photo fails to load — the crest is a layout
// anchor in lists, so it must always paint something.

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { apiImageUri } from '../api/client';
import { Image } from '../ui/image';
import { radius } from '../theme';
import ClanBadge from './ClanBadge';

export default function ClubAvatar({
  photoUrl,
  badgeIcon,
  color,
  size = 44,
  round = false,
  style,
}) {
  const [failed, setFailed] = useState(false);
  const uri = failed ? null : apiImageUri(photoUrl);
  const box = {
    width: size,
    height: size,
    borderRadius: round ? size / 2 : radius.md,
    backgroundColor: color?.fill,
  };

  return (
    <View style={[styles.chip, box, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          // The URL is versioned by the upload, so a cached crest is always
          // the current one and never needs a re-fetch to prove it.
          cachePolicy="memory-disk"
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <ClanBadge icon={badgeIcon} size={Math.round(size * 0.5)} color={color?.stroke} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
