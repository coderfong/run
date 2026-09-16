// PASER PRO — the first mention, and deliberately the weakest one.
//
// WHAT WAS WRONG WITH THIS SCREEN BEFORE, because it is worth recording:
//
//   1. It said "One payment. No subscription." PRO has been an auto renewing
//      subscription since 2026-08-16. Telling somebody there is no
//      subscription immediately before selling them one is not a stale string,
//      it is the kind of thing that gets a build rejected and a refund
//      requested, in that order.
//
//   2. Its three perks were "Double rewards, every level", "Rarer lootboxes"
//      and "More energy to claim with". Energy is the claim limiter
//      (backend/app/energy.py). Advertising more of it is advertising more
//      claims for money — pay to win, on the first-run screen, contradicting
//      the promise config/pro.js and entitlements.py both make in their
//      headers. The copy is fixed here; the REWARD LADDER still grants the
//      energy, and that is a live economy change which is not this branch's
//      to make. See docs/PRO_BACKEND.md, "Pay to win: open question".
//
// WHAT IT IS NOW. A soft introduction. The runner has not run yet, has no
// territory, has no rivals and no history — every single thing PRO sells is
// therefore meaningless to them today. The honest job of this screen is to
// name PRO so it is not a surprise later, and then get out of the way. The
// real pitch happens in the game, next to the feature, weeks from now.
//
// NO DARK PATTERNS. Both buttons are the same size and shape. Neither is
// dimmed, buried, or worded to make the other look like the only choice.
// Nothing auto-enrols, nothing starts a trial (there is no intro offer
// registered on either store, so a trial cannot be honestly promised), and
// "Continue" is not phrased as a loss.

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Check } from 'lucide-react-native';

import { space } from '../../theme';
import { OutlinedText, ToonButton, ToonGhostButton } from '../../components/ui';
import { useProEntitlement } from '../../pro/ProProvider';
import CharacterRig from '../../components/character/CharacterRig';
import { useAvatar } from '../../state/avatar';
import { art } from '../../config/onboardingArt';
import { ComicPanel } from '../ui';
import { toon, toonType } from '../toon';

// Three things, all of them depth. Kept short because the art is the pitch on
// this step and because none of it means anything to somebody who has not run
// yet — see the header.
const PERKS = [
  'Draw routes and preview territory before you run',
  'See rival, rank and territory history',
  'Unlock exclusive outfits and map styles',
];

export default function ProStep({ onContinue }) {
  const { equipped } = useAvatar();
  const { isPro, canShowPro, openPaywall } = useProEntitlement();
  // Somebody who subscribed from this very step (or who already had PRO on a
  // reinstall) must not still be looking at a button offering to sell it.
  const canBuy = canShowPro && !isPro;

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
          Plan smarter. See more. Stand out.
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

        {/* The line that makes the skip a real choice rather than a dare. */}
        <Text style={[toonType.body, styles.reassure]}>
          Running, claiming and the board are free, and stay free.
        </Text>

        {/* Both actions sit under the perks they answer, not pinned to the
            bottom edge of the screen. Equal weight, on purpose. */}
        <View style={styles.actions}>
          {canBuy ? (
            <ToonButton
              title="Try PASER PRO"
              variant="gold"
              onPress={() => openPaywall('onboarding')}
            />
          ) : null}
          <ToonGhostButton
            title={isPro ? 'Continue' : 'Continue with PASER'}
            onPress={onContinue}
          />
        </View>
      </ScrollView>
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
  actions: { marginTop: space.xl, gap: space.sm },
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
  reassure: {
    color: 'rgba(255,255,255,0.6)',
    marginTop: space.lg,
    fontSize: 14,
    lineHeight: 20,
  },
});
