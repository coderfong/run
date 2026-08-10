// PASER PRO — the first-run upsell. Deliberately honest copy: the premium
// pass is a ONE-TIME purchase (see components/BuyPassSheet.js), so this screen
// never promises a free trial. If a subscription product with an intro offer
// is ever registered, swap the headline for the trial framing AND wire the
// real receipt check first (backend/app/routes/progression.py).

import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
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

// Three words each, near enough. The art is the pitch on this step; the detail
// (what exactly lands on which tier) lives on the pass itself and in the buy
// sheet, and repeating it here just buried the picture under a wall of text.
const PERKS = [
  'Double rewards, every level',
  'Rarer lootboxes',
  'More energy to claim with',
];

export default function ProStep({ onContinue }) {
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

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        <OutlinedText style={[toonType.hero, styles.wordmark]} outline={toon.ink} width={3}>
          PASER PRO
        </OutlinedText>
        <Text style={[toonType.body, styles.kicker]}>
          One payment. No subscription.
        </Text>

        <ComicPanel
          source={art('proHero')}
          // The art's own edge value, so the panel never flashes a colour the
          // picture does not land on.
          bg="#181316"
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

        {/* Both actions sit under the perks they answer, not pinned to the
            bottom edge of the screen. */}
        <View style={styles.actions}>
          <ToonButton title="Unlock PASER PRO" variant="gold" onPress={() => setSheet(true)} />
          <ToonGhostButton title="Maybe later" onPress={onContinue} />
        </View>
      </ScrollView>

      <BuyPassSheet visible={sheet} onClose={() => setSheet(false)} onPurchased={onContinue} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // flexGrow + centred content: the step sits in the middle of whatever room
  // it has, and scrolls instead of clipping when it doesn't have enough. The
  // Continue button lives INSIDE this column now, which is exactly the height
  // a small phone did not have spare.
  body: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: space.gutter,
    paddingVertical: space.lg,
  },
  actions: { marginTop: space.xl },
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

});
