// Rank Progression Screen - Shows rank and XP progression after a claim
//
// This screen displays the rank and XP progression that was previously shown
// in the ClaimPayoff modal. It provides a dedicated space for users to see
// their progression details without cluttering the main claim celebration.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ScrollView, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { space, useTheme, useThemedStyles, useThemedType, brand } from '../theme';
import { ToonButton } from '../components/ui';
import BackButton from '../components/ui/BackButton';
import RankProgress from '../components/rank/RankProgress';
import XpProgress from '../components/XpProgress';
import { CharacterBust } from '../components/character/CharacterRig';
import { useAvatar } from '../state/avatar';

export default function RankProgressionScreen({ route }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { equipped } = useAvatar();
  
  const { claim, runXpTotal, runXpGained } = route.params || {};
  
  const [rankPoints, setRankPoints] = useState(claim?.solo_elo || 0);
  const [rankDelta, setRankDelta] = useState(claim?.solo_elo_delta || 0);
  const [xpTotal, setXpTotal] = useState(claim?.xp || 0);
  const [xpGained, setXpGained] = useState(claim?.xp_gained || 0);
  const [runXpTotalState, setRunXpTotalState] = useState(runXpTotal || 0);
  const [runXpGainedState, setRunXpGainedState] = useState(runXpGained || 0);
  
  const rated = claim?.solo_elo != null && (claim?.solo_elo_delta || 0) !== 0;
  const hasXp = xpGained > 0 || runXpGainedState > 0;
  const totalXp = xpTotal + runXpTotalState;
  const totalXpGained = xpGained + runXpGainedState;
  
  useEffect(() => {
    // Animation could be added here for a smooth entrance
  }, []);
  
  const handleDone = () => {
    navigation.goBack();
  };
  
  if (!claim) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <View style={[styles.header, { paddingTop: insets.top }]}>
          <BackButton onPress={handleDone} />
        </View>
        <Text style={[styles.noData, { color: colors.text }]}>
          No progression data available
        </Text>
      </View>
    );
  }
  
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.headerBar, { paddingTop: insets.top }]}>
        <BackButton onPress={handleDone} />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: space.md, paddingBottom: insets.bottom + space.xl }
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            RANK PROGRESSION
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            See how your claim moved you up the ladder
          </Text>
        </View>
        
        {/* Character display */}
        <View style={styles.characterContainer}>
          <CharacterBust
            equipped={equipped}
            size={80}
            ring={colors.border}
            bg={colors.cardAlt}
          />
        </View>
        
        {/* Rank Progression */}
        {rated && (
          <View style={styles.progressionSection}>
            <RankProgress
              points={rankPoints}
              delta={rankDelta}
              label="RANK"
              delay={200}
              height={20}
            />
          </View>
        )}
        
        {/* XP Progression */}
        {hasXp && (
          <View style={styles.progressionSection}>
            <XpProgress
              xp={totalXp}
              gained={totalXpGained}
              accent="#00bcd4"
              delay={400}
            />
          </View>
        )}
        
        {/* If no progression data */}
        {!rated && !hasXp && (
          <View style={styles.noProgression}>
            <Text style={[styles.noProgressionText, { color: colors.textMuted }]}>
              This claim didn't affect your rank or XP
            </Text>
          </View>
        )}
        
        {/* Done button */}
        <ToonButton
          title="Done"
          onPress={handleDone}
          style={styles.doneButton}
        />
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: space.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: space.xl,
  },
  title: {
    ...type.headline,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: space.sm,
  },
  subtitle: {
    ...type.body,
    textAlign: 'center',
  },
  characterContainer: {
    alignItems: 'center',
    marginBottom: space.xl,
  },
  progressionSection: {
    marginBottom: space.lg,
  },
  noProgression: {
    alignItems: 'center',
    paddingVertical: space.xl,
    marginBottom: space.lg,
  },
  noProgressionText: {
    ...type.body,
    textAlign: 'center',
  },
  noData: {
    ...type.body,
    textAlign: 'center',
    marginTop: space.xl,
  },
  doneButton: {
    marginTop: space.lg,
    alignSelf: 'center',
  },
});