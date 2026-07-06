// Row — horizontal flex arrangement. The only layout primitive screens use
// for side-by-side content. `list` gives the 56pt minimum list-row height.

import React from 'react';
import { View } from 'react-native';

import { PressableScale } from '../../ui/motion';

export default function Row({
  children,
  between = false,
  gap = 12,
  align = 'center',
  list = false,
  onPress,
  style,
  ...rest
}) {
  const layout = {
    flexDirection: 'row',
    alignItems: align,
    gap,
    justifyContent: between ? 'space-between' : 'flex-start',
    ...(list ? { minHeight: 56 } : {}),
  };

  if (onPress) {
    return (
      <PressableScale style={[layout, style]} onPress={onPress} {...rest}>
        {children}
      </PressableScale>
    );
  }
  return (
    <View style={[layout, style]} {...rest}>
      {children}
    </View>
  );
}
