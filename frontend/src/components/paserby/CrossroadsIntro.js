// CROSSROADS INTRO — the card that explains the plaza, once.
//
// The screen behind it is beautiful and says nothing: strangers stand around a
// painted square with no labels under them (that is deliberate, see
// screens/CrossroadsScreen.js), so a first time visitor has no way to learn
// that the characters are tappable, that crossing again promotes somebody, or
// what those runners can see of them. This is where that is said.
//
// Shown by CrossroadsScreen while `profile.crossroadsIntroSeen` is false, which
// is one flag per account in state/profile.js — every account gets it once,
// including accounts that predate the feature. ANY dismissal counts as read:
// the button, the scrim and the Android back button all mark it seen, because
// a popup that comes back because you closed it the wrong way is worse than no
// popup at all.
//
// A CARD, not a full stage. The plaza is already drawn behind it and is what
// the copy is pointing AT, so the card sits over it, dimmed, and lets the
// header's own art (the same cut-out on the same yellow) tie the two together.

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Hand, ShieldCheck, TrendingUp, Users } from 'lucide-react-native';

import { radius, space, toon, toonType, useTheme, useThemedType } from '../../theme';
import { Image } from '../../ui/image';
import { ToonButton } from '../ui';
import { art, ART_BG } from '../../config/onboardingArt';
import { COPY, INTRO_BEATS } from '../../config/paserby';
import { useReduceMotion } from '../../ui/motion';

// One icon per beat in `INTRO_BEATS`. Kept here rather than in the config,
// which is deliberately React free.
const ICONS = {
  plaza: Users,
  tap: Hand,
  ladder: TrendingUp,
  privacy: ShieldCheck,
};

// The art band's height. The cut-out is wide (the crossroads panel is painted
// landscape) and this is `contain`, so it is a band rather than a square.
const ART_H = 120;

export default function CrossroadsIntro({ visible, onClose }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const panelArt = art('panelCrossroads');

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* Dimming the plaza is the point: it is still there, it is just not
            the thing to read yet. Tapping it dismisses. */}
        <Pressable
          style={[StyleSheet.absoluteFill, styles.scrim]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />

        <Animated.View
          style={[styles.card, { backgroundColor: colors.card }]}
          entering={reduced ? undefined : FadeInDown.duration(260)}
        >
          {panelArt ? (
            <View style={[styles.artBand, { backgroundColor: ART_BG.panelCrossroads }]}>
              <Image
                source={panelArt}
                style={styles.artImg}
                resizeMode="contain"
                accessible={false}
              />
            </View>
          ) : null}

          <View style={styles.body}>
            <Text style={[toonType.title, styles.title, { color: colors.text }]}>
              {COPY.introTitle}
            </Text>

            {INTRO_BEATS.map((beat, i) => {
              const Icon = ICONS[beat.key];
              return (
                <Animated.View
                  key={beat.key}
                  style={styles.beat}
                  entering={reduced ? undefined : FadeIn.delay(120 + i * 70).duration(220)}
                >
                  <View style={[styles.bullet, { backgroundColor: colors.cardAlt }]}>
                    {Icon ? <Icon size={18} color={colors.text} strokeWidth={2.2} /> : null}
                  </View>
                  <Text style={[type.bodySm, styles.beatText]}>{beat.text}</Text>
                </Animated.View>
              );
            })}

            <ToonButton title={COPY.introCta} onPress={onClose} style={styles.cta} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center', paddingHorizontal: space.gutter },
  scrim: { backgroundColor: 'rgba(6,6,10,0.62)' },

  card: {
    borderRadius: radius.sheet,
    borderWidth: 3,
    borderColor: toon.ink,
    overflow: 'hidden',
  },
  artBand: { height: ART_H, alignItems: 'center', justifyContent: 'center' },
  // The band is the art's box; `contain` inside it keeps the cut-out whole
  // whatever the asset's ratio turns out to be.
  artImg: { width: '100%', height: '100%' },

  body: { padding: space.lg, gap: space.md },
  // Left aligned, like the beats under it. `toonType.sub` is centred, and a
  // centred heading over four left-set lines reads as two designs.
  title: { fontSize: 20, lineHeight: 27 },

  beat: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  bullet: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The icon chip is 34 tall and the line is 13pt type, so a couple of points
  // of top padding is what puts the first line on the icon's centre.
  beatText: { flex: 1, lineHeight: 19, paddingTop: 3 },

  cta: { marginTop: space.xs },
});
