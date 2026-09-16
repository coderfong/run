// The rivalry alert — a banner that drops in from the top of the screen after
// a claim takes land off someone, then leaves.
//
// It replaced a permanent RivalCard pinned above the Home feed. That card was
// the first thing on Home forever, so the one moment it actually meant
// something — the minute after a steal — read exactly like the six days after
// it. A steal is an EVENT, so it gets event chrome: it arrives, it says who and
// how much, and it goes. The standing record lives on the Rivals page, which is
// where a tap on the banner sends you.
//
// Mounted once at the app root (App.js), driven by `rivalPopup.show(...)` from
// anywhere — same pattern as ui/toast.js.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';

import { brand, space, toon, toonRadius, toonType, useTheme, useThemedType } from '../theme';
import { haptic, PressableScale, useReduceMotion } from '../ui/motion';
import { CharacterBust } from './character/CharacterRig';
import PortraitBorder from './PortraitBorder';
import OutlinedText from './ui/OutlinedText';
import { fmtArea } from './RivalCard';

const SHOW_MS = 4600;

let listener = null;

export const rivalPopup = {
  /**
   * @param {object} p
   * @param {Array}  p.victims  claim victims you actually took land from —
   *                            { user_id, username, avatar, rank_key, area_m2 }
   * @param {object} p.myAvatar the attacker's equipped loadout
   */
  show({ victims, myAvatar }) {
    const taken = (victims || []).filter((v) => v && !v.defended);
    if (!taken.length) return;            // nothing was taken: nothing to say
    if (listener) listener({ taken, myAvatar, id: Date.now() });
  },
};

export function RivalPopupHost({ onOpen }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const [current, setCurrent] = useState(null);
  const y = useRef(new Animated.Value(-220)).current;
  const timer = useRef(null);

  useEffect(() => {
    listener = (payload) => setCurrent(payload);
    return () => {
      listener = null;
    };
  }, []);

  const hide = useCallback(
    (then) => {
      clearTimeout(timer.current);
      Animated.timing(y, {
        toValue: -220,
        duration: reduced ? 0 : 200,
        useNativeDriver: true,
      }).start(() => {
        setCurrent(null);
        then?.();
      });
    },
    [reduced, y]
  );

  useEffect(() => {
    if (!current) return undefined;
    haptic.light();
    y.setValue(-220);
    Animated.spring(y, {
      toValue: 0,
      damping: 16,
      stiffness: 180,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
    timer.current = setTimeout(() => hide(), SHOW_MS);
    return () => clearTimeout(timer.current);
  }, [current, hide, y]);

  if (!current) return null;

  const { taken, myAvatar } = current;
  const total = taken.reduce((sum, v) => sum + (v.area_m2 || 0), 0);
  const first = taken[0];
  const line =
    taken.length === 1
      ? `from ${first.username}`
      : `from ${taken.length} runners`;

  return (
    <Animated.View
      style={[styles.host, { top: insets.top + space.sm, transform: [{ translateY: y }] }]}
    >
      <PressableScale
        onPress={() => hide(() => onOpen?.())}
        accessibilityRole="button"
        accessibilityLabel={`You took ${fmtArea(total)} ${line}. Open rivals.`}
        style={styles.shadow}
      >
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <LinearGradient
            colors={[brand.pink, 'transparent']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.wash}
          />

          {/* the two faces, yours in front of theirs */}
          <View style={styles.faces}>
            <PortraitBorder borderKey="wood" size={38}>
              <CharacterBust equipped={first.avatar} size={38} bg={colors.cardAlt} />
            </PortraitBorder>
            <View style={styles.mine}>
              <CharacterBust equipped={myAvatar} size={38} bg={colors.cardAlt} />
            </View>
          </View>

          <View style={styles.text}>
            <OutlinedText
              style={[toonType.label, { color: brand.pink }]}
              outline={toon.ink}
              width={1.5}
              align="left"
              containerStyle={{ alignSelf: 'flex-start' }}
            >
              NEW RIVALRY
            </OutlinedText>
            <Text style={[toonType.sub, { fontSize: 15, color: colors.text, textAlign: 'left' }]}>
              You took {fmtArea(total)} {line}
            </Text>
            <Text style={[type.caption, { textAlign: 'left' }]} numberOfLines={1}>
              Tap to see the rivalry
            </Text>
          </View>

          <ChevronRight size={20} color={colors.textDim} />
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: space.md, right: space.md, zIndex: 90 },
  shadow: {
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: toonRadius.card,
    borderWidth: 2.5,
    borderColor: toon.ink,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    overflow: 'hidden',
  },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  faces: { flexDirection: 'row', alignItems: 'center', width: 62 },
  // Yours overlaps theirs — the shove is the whole story.
  mine: { marginLeft: -14, borderRadius: 19, overflow: 'hidden' },
  text: { flex: 1, gap: 1 },
});
