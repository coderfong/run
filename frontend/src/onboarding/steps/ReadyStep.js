// "You're all set" — the payoff screen that closes the intro: the finished
// runner takes a bow under confetti, then the app opens.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { space } from '../../theme';
import { ToonButton } from '../../components/ui';
import { Confetti, haptic } from '../../ui/motion';
import CharacterRig from '../../components/character/CharacterRig';
import { useAvatar } from '../../state/avatar';
import { StepHeadline } from '../ui';
import { toonType } from '../toon';

export default function ReadyStep({ name, onContinue, bottomInset = 0 }) {
  const { equipped } = useAvatar();
  const rigRef = useRef(null);

  useEffect(() => {
    haptic.success();
    const t = setTimeout(() => rigRef.current?.play('celebrate'), 350);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.fill}>
      <Confetti count={30} />

      <View style={styles.body}>
        <StepHeadline
          title={name ? `Looking good, ${name}!` : 'Looking good!'}
          sub="Your runner is ready to claim some ground."
        />
        <View style={styles.stage}>
          <CharacterRig ref={rigRef} equipped={equipped} size={110} animate />
        </View>
        <Text style={[toonType.body, styles.note]}>
          Change your look any time in You → Your runner. New gear unlocks as you run.
        </Text>
      </View>

      <View style={[styles.footer, { paddingBottom: bottomInset + space.lg }]}>
        <ToonButton title="Let's run" onPress={onContinue} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'space-between' },
  body: { paddingHorizontal: space.gutter, paddingTop: space.xl, alignItems: 'stretch' },
  stage: { alignItems: 'center', marginTop: space.lg },
  note: { color: 'rgba(255,255,255,0.6)', marginTop: space.lg },
  footer: { paddingHorizontal: space.gutter },
});
