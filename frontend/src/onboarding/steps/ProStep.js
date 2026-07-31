// PASER PRO — the first-run upsell. Deliberately honest copy: the premium
// pass is a ONE-TIME purchase (see components/BuyPassSheet.js), so this screen
// never promises a free trial. If a subscription product with an intro offer
// is ever registered, swap the headline for the trial framing AND wire the
// real receipt check first (backend/app/routes/progression.py).

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check } from 'lucide-react-native';

import { space } from '../../theme';
import { OutlinedText, ToonButton, ToonGhostButton } from '../../components/ui';
import BuyPassSheet from '../../components/BuyPassSheet';
import CharacterRig from '../../components/character/CharacterRig';
import { useAvatar } from '../../state/avatar';
import { art } from '../../config/onboardingArt';
import { ComicPanel } from '../ui';
import { toon, toonType } from '../toon';

const PERKS = [
  'A second reward on every level — forever',
  'Rarer lootboxes on every box tier',
  'Bonus energy, so you claim more often',
];

export default function ProStep({ onContinue, bottomInset = 0 }) {
  const { equipped } = useAvatar();
  const [sheet, setSheet] = useState(false);

  return (
    <View style={styles.fill}>
      <LinearGradient
        colors={['#1A1206', '#0C0C10']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <View style={styles.body}>
        <OutlinedText style={[toonType.hero, styles.wordmark]} outline={toon.ink} width={3}>
          PASER PRO
        </OutlinedText>
        <Text style={[toonType.body, styles.kicker]}>
          Everything you earn, twice over — one payment, no subscription.
        </Text>

        <ComicPanel
          source={art('proHero')}
          bg="#2A1B06"
          aspect={4 / 3}
          style={styles.panel}
          fallback={
            <View style={styles.fallbackRig}>
              <CharacterRig equipped={equipped} size={78} animate />
            </View>
          }
        />

        <View style={styles.perks}>
          {PERKS.map((p) => (
            <View key={p} style={styles.perk}>
              <View style={styles.tick}>
                <Check size={14} color={toon.ink} strokeWidth={4} />
              </View>
              <Text style={[toonType.body, styles.perkText]}>{p}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.footer, { paddingBottom: bottomInset + space.lg }]}>
        <ToonButton title="Unlock PASER PRO" variant="gold" onPress={() => setSheet(true)} />
        <ToonGhostButton title="Maybe later" onPress={onContinue} />
      </View>

      <BuyPassSheet visible={sheet} onClose={() => setSheet(false)} onPurchased={onContinue} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'space-between' },
  body: { paddingHorizontal: space.gutter, paddingTop: space.lg },
  wordmark: { color: '#F5C451' },
  kicker: { color: 'rgba(255,255,255,0.72)', marginTop: space.sm },
  panel: { marginTop: space.lg },
  fallbackRig: { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8 },

  perks: { marginTop: space.lg, gap: space.md },
  perk: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tick: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F5C451',
    borderWidth: 2,
    borderColor: toon.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: { color: '#fff', flex: 1, textAlign: 'left' },

  footer: { paddingHorizontal: space.gutter },
});
