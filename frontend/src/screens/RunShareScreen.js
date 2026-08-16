// Sharing a run that is NOT the one you just finished — the share button on a
// run card in the home feed lands here.
//
// It is a root-stack full screen modal rather than a <Modal> inside the card
// for two reasons: the sheet is a full bleed screen (it positions itself with
// absoluteFill), so inside a feed row it would try to fill a 110pt card; and
// `captureRef` has to rasterise the preview, which is a great deal simpler when
// the view lives in the normal screen tree.
//
// The post-run version of this is mounted by ResultScreen instead — same sheet,
// same card, different way in.

import React from 'react';
import { StyleSheet, View } from 'react-native';

import RunShareSheet from '../components/share/RunShareSheet';
import { NEUTRAL } from '../state/clan';
import { useAvatar } from '../state/avatar';
import { useTheme } from '../theme';

export default function RunShareScreen({ navigation, route }) {
  const { colors } = useTheme();
  const { team, run, path, rings } = route.params || {};
  // The avatar always comes from local state, never through the params: this
  // screen is only ever opened for your OWN run, and the equipped set is a big
  // object that navigation would have to serialise on every push.
  const { equipped } = useAvatar();

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      <RunShareSheet
        visible
        onClose={() => navigation.goBack()}
        team={team || NEUTRAL}
        run={run || {}}
        path={path || []}
        rings={rings || null}
        equipped={equipped}
      />
    </View>
  );
}
