// The payoff — the 4 seconds a 30-minute run is actually for.
//
// A claim used to end in a toast. This is the moment instead: your runner
// celebrating, the ground you took, the FACES you took it from, the XP, and
// the level bar moving. Everything here comes from the claim response, so it
// costs no extra round trip.
//
// The headline is earned, not decorative: if any of the runners you just hit
// had taken land off you before, this was a reclaim, and it says so.

import React, { useEffect, useRef } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldOff, Swords } from 'lucide-react-native';

import { brand, space, toon, toonType, useTheme, useThemedType } from '../theme';
import { Confetti, haptic } from '../ui/motion';
import { OutlinedText, ProgressTrack, ToonButton, ToonGhostButton } from './ui';
import CharacterRig, { CharacterBust } from './character/CharacterRig';
import PortraitBorder from './PortraitBorder';
import TerritoryStealBanner from './TerritoryStealBanner';
import GameAnimation, { AnimationStack } from './GameAnimation';
import { fmtArea } from './RivalCard';

function headline(claim) {
  const victims = claim?.victims || [];
  if (victims.some((v) => v.reclaimed && !v.defended)) return 'YOU TOOK IT BACK';
  if (victims.some((v) => !v.defended)) return 'LAND TAKEN';
  if (victims.length) return 'GROUND HELD AGAINST YOU';
  return 'TERRITORY CLAIMED';
}

export default function ClaimPayoff({ visible, claim, myAvatar, onClose, onViewMap }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const rigRef = useRef(null);

  useEffect(() => {
    if (!visible) return undefined;
    haptic.success();
    const t = setTimeout(() => rigRef.current?.play('celebrate'), 400);
    return () => clearTimeout(t);
  }, [visible]);

  if (!claim) return null;

  const victims = claim.victims || [];
  const taken = victims.filter((v) => !v.defended);
  const held = victims.filter((v) => v.defended);
  const area = claim.territory?.area_m2 || 0;
  const stolenArea = taken.reduce((sum, v) => sum + (v.area_m2 || 0), 0);
  const xpPct = claim.next_level_xp ? Math.min(1, (claim.xp || 0) / claim.next_level_xp) : 0;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <Confetti count={34} />

        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <OutlinedText style={[toonType.hero, { color: '#fff' }]} outline={toon.ink} width={3}>
            {headline(claim)}
          </OutlinedText>

          <View style={styles.stage}>
            <CharacterRig ref={rigRef} equipped={myAvatar} size={104} animate />
          </View>

          <OutlinedText
            style={[toonType.hero, { color: brand.teal, fontSize: 40, lineHeight: 48 }]}
            outline={toon.ink}
            width={3}
          >
            {`+${fmtArea(area)}`}
          </OutlinedText>

          {/* the steal itself, played out: bomb, blast, their heads thrown
              out of it and landing back in a row pulling a sad face */}
          {visible && taken.length > 0 && (
            <TerritoryStealBanner
              trigger={claim.territory?.id || claim.run_id || 'steal'}
              victims={taken}
              amount={fmtArea(stolenArea)}
              style={styles.stealBanner}
            />
          )}

          {/* the faces — the whole point of the rebuild */}
          {taken.length > 0 && (
            <View style={styles.block}>
              <OutlinedText
                style={[toonType.label, { color: brand.pink }]}
                outline={toon.ink}
                width={1.5}
              >
                {taken.length === 1
                  ? `YOU TOOK LAND FROM ${taken[0].username.toUpperCase()}`
                  : `YOU TOOK LAND FROM ${taken.length} RUNNERS`}
              </OutlinedText>
              {taken.map((v) => (
                <View key={v.user_id} style={styles.row}>
                  <PortraitBorder borderKey={v.rank_key || 'wood'} size={38}>
                    <CharacterBust
                      equipped={v.avatar}
                      size={38}
                      ring={v.clan_color?.stroke}
                      bg={colors.cardAlt}
                    />
                  </PortraitBorder>
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodyBold, { color: colors.text }]} numberOfLines={1}>
                      {v.username}
                    </Text>
                    {v.reclaimed ? (
                      <Text style={[type.caption, { color: brand.pink }]}>
                        took your land before, evened up
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[toonType.sub, { fontSize: 15, color: brand.teal }]}>
                    −{fmtArea(v.area_m2)}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* attacks that bounced — honest, and it sets up the rematch */}
          {held.length > 0 && (
            <View style={styles.block}>
              <View style={styles.heldHead}>
                <ShieldOff size={16} color={colors.textMuted} />
                <Text style={[type.caption, { color: colors.textMuted }]}>
                  {held.length === 1
                    ? `${held[0].username} held their ground`
                    : `${held.length} runners held their ground`}
                </Text>
              </View>
            </View>
          )}

          {/* XP + level */}
          {claim.xp_gained > 0 && (
            <View style={styles.block}>
              {claim.leveled_up ? (
                <View style={styles.levelFxRow} pointerEvents="none">
                  <AnimationStack
                    names={['confettiBurst', 'levelUpBronze']}
                    size={150}
                    trigger={`${visible}:${claim.level}`}
                    visible={visible}
                  />
                  <GameAnimation
                    name="trophyPodium"
                    size={104}
                    trigger={`${visible}:${claim.level}`}
                    visible={visible}
                    style={styles.levelTrophy}
                  />
                </View>
              ) : null}
              <OutlinedText
                style={[toonType.headline, { color: '#fff' }]}
                outline={toon.ink}
                width={2.5}
              >
                {`+${claim.xp_gained} XP`}
              </OutlinedText>
              {claim.leveled_up ? (
                <OutlinedText
                  style={[toonType.sub, { color: '#F5C451', marginTop: 2 }]}
                  outline={toon.ink}
                  width={2}
                >
                  {`LEVEL ${claim.level} REACHED`}
                </OutlinedText>
              ) : null}
              {/* Fills from empty: this panel exists to show you what the claim
                  paid, and the bar running up to where the XP landed is the
                  payoff. The delay lets the "+N XP" above land first. */}
              <ProgressTrack
                value={xpPct}
                height={16}
                animateOnMount
                delay={340}
                durationMs={760}
                style={{ marginTop: space.md }}
              />
              <Text style={[type.caption, { textAlign: 'center', marginTop: 6 }]}>
                {`Level ${claim.level} · ${(claim.xp || 0).toLocaleString()} / ${(claim.next_level_xp || 0).toLocaleString()} XP`}
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={[styles.actions, { paddingBottom: insets.bottom + space.lg }]}>
          <ToonButton
            title="See the map"
            variant="teal"
            icon={<Swords size={18} color="#fff" />}
            onPress={onViewMap}
          />
          <ToonGhostButton title="Done" onPress={onClose} color={colors.textMuted} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: space.gutter, alignItems: 'stretch' },
  stage: { alignItems: 'center', marginVertical: space.lg },
  // The banner throws heads outside its own bounds, so it never clips.
  stealBanner: { marginTop: space.md, overflow: 'visible' },
  block: { marginTop: space.xl },
  levelFxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: -8 },
  levelTrophy: { marginLeft: -34 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
  },
  heldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actions: { paddingHorizontal: space.gutter, gap: space.xs },
});
