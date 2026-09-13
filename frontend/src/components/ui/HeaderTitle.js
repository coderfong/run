// The title on the screens that keep a native stack header.
//
// Native-stack styles its own title's family, size and colour, but not its
// case, and every heading in the app is set in HEADING_CASE (lowercase, like
// the specimen sheet). So the title is drawn here instead. `tintColor` is the
// header's tint, the colour the native title used.
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { fonts, HEADING_CASE } from '../../theme';

export default function HeaderTitle({ children, tintColor }) {
  return (
    <Text numberOfLines={1} style={[styles.title, tintColor ? { color: tintColor } : null]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 18, textTransform: HEADING_CASE },
});
