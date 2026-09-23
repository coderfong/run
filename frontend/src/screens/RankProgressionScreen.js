// Rank Progression — where a claim left you on the ladder.
//
// RANK ONLY. This page used to carry the XP bar as well, which put the
// treadmill (levels only ever go up) next to the competition (rank moves both
// ways) and made a claim that cost ground read like a win because the blue bar
// still filled. XP has its own home on the pass; this page answers one
// question: did the claim move your rung, and which way.
//
// Drawn from the same parts as the rank ladder page so the two agree about what
// a tier looks like: the panel header in the tier's colour, the runner in that
// tier's frame with their division stars, the nameplate, and the bar that
// travels from where they stood to where they stand now.

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen, ToonButton, ToonCard, ToonHeader } from '../components/ui';
import RankBadge, { RankPlaque } from '../components/rank/RankBadge';
import RankProgress from '../components/rank/RankProgress';
import { bandAt, rankBands } from '../config/rankLadder';
import { fonts, space, useTheme, useThemedStyles, useThemedType } from '../theme';
import { useAvatar } from '../state/avatar';

export default function RankProgressionScreen({ navigation, route }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { equipped } = useAvatar();

  const { claim } = route?.params || {};
  const points = claim?.solo_elo;
  const delta = Number(claim?.solo_elo_delta) || 0;
  const rated = points != null;

  // The rung the claim left the runner on, off the same bands the bar travels
  // across, so the badge, plaque and bar can never name different tiers.
  const band = useMemo(() => {
    const bands = rankBands();
    return bands[bandAt(rated ? points : 0, bands)];
  }, [points, rated]);

  const back = () => navigation?.goBack?.();

  const moved = delta > 0 ? 'up' : delta < 0 ? 'down' : 'none';
  const deltaCopy = moved === 'none'
    ? 'No change'
    : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()} rank points`;
  const deltaColor = moved === 'up' ? colors.ok : moved === 'down' ? colors.danger : colors.textMuted;

  return (
    <Screen gutter={false} edges={[]}>
      <ToonHeader
        panel
        compact
        title="Rank progression"
        subtitle={rated ? 'Where this claim left you on the ladder' : undefined}
        solid={band.color}
        top={insets.top}
        titleStyle={type.title}
        onBack={navigation?.canGoBack?.() ? back : undefined}
        style={styles.header}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {rated ? (
          <ToonCard style={styles.card}>
            <View style={styles.hero}>
              <RankBadge
                tierKey={band.key}
                equipped={equipped}
                size={112}
                division={band.division}
                color={band.color}
              />
              <RankPlaque
                name={band.name}
                color={band.color}
                ink={band.ink}
                width={220}
                height={44}
                style={styles.plaque}
              />
              <Text style={[styles.delta, { color: deltaColor }]}>{deltaCopy}</Text>
              <Text style={[type.caption, styles.total]}>
                {`${Number(points).toLocaleString()} total`}
              </Text>
            </View>

            <RankProgress points={points} delta={delta} label="THIS CLAIM" delay={300} height={18} />
          </ToonCard>
        ) : (
          <ToonCard style={styles.card}>
            <Text style={[type.heading, styles.emptyTitle]}>Not ranked yet</Text>
            <Text style={[type.caption, styles.emptyCopy]}>
              This claim didn't move your rank. Take and hold ground to climb the ladder.
            </Text>
          </ToonCard>
        )}

        <Text style={[type.caption, styles.footnote]}>
          Rank points come from ground taken and held. They fall when you stop.
        </Text>

        <ToonButton title="Done" onPress={back} style={styles.done} />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (colors) => StyleSheet.create({
  header: { paddingBottom: space.sm, marginBottom: space.sm },
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.gutter, paddingTop: space.md, paddingBottom: space.xl },
  card: { alignSelf: 'stretch' },
  hero: { alignItems: 'center', marginBottom: space.lg },
  plaque: { marginTop: space.md },
  delta: { fontFamily: fonts.display, fontSize: 18, marginTop: space.sm },
  total: { color: colors.textMuted, marginTop: 2 },
  emptyTitle: { textAlign: 'center' },
  emptyCopy: { textAlign: 'center', marginTop: space.xs },
  footnote: { color: colors.textDim, textAlign: 'center', marginTop: space.lg },
  done: { marginTop: space.lg },
});
