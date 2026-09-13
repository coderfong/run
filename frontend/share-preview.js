import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { registerRootComponent } from 'expo';
import { useFonts } from 'expo-font';

import RunShareCard from './src/components/share/RunShareCard';
import { FONT_FILES } from './src/theme/fontFiles';

const PATH = Array.from({ length: 48 }, (_, i) => ({
  latitude: 1.29 + Math.sin((i / 48) * Math.PI * 2) * (0.0025 + 0.0007 * Math.sin(i * 1.7)),
  longitude: 103.84 + Math.cos((i / 48) * Math.PI * 2) * (0.0036 + 0.0008 * Math.cos(i * 1.3)),
}));

function Preview() {
  const [loaded] = useFonts(FONT_FILES);
  const { width, height } = useWindowDimensions();
  if (!loaded) return null;
  const cardWidth = Math.min(380, width * 0.9, height * 0.52);
  return (
    <View style={{ flex: 1, backgroundColor: '#10141A', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ backgroundColor: '#71879A', borderRadius: 24, overflow: 'hidden' }}>
        <RunShareCard
          width={cardWidth}
          team={{ fill: '#FDE7F1', stroke: '#EC4899', glow: '#EC4899' }}
          run={{ distanceM: 18230, durationS: 5401, areaM2: 0 }}
          path={PATH}
          rings={null}
          showCharacter={false}
        />
      </View>
    </View>
  );
}

registerRootComponent(Preview);
