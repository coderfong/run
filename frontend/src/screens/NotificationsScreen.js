// Notifications inbox (the bell). Marks everything read on open.

import React, { useEffect } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoNotifications from 'expo-notifications';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Check, X } from 'lucide-react-native';
import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { brand, fonts, NB, nbInk, radius, space, useTheme, useThemedType, useThemedStyles } from '../theme';
import { Screen, Skeleton, EmptyState, Button } from '../components/ui';
import BackButton from '../components/ui/BackButton';
import AppIcon, { STEAL_ICON_SIZE } from '../components/AppIcon';
import PortraitBorder from '../components/PortraitBorder';
import { CharacterBust } from '../components/character/CharacterRig';
import { PressableScale, shouldStagger, staggerDelay, useReduceMotion } from '../ui/motion';
import { timeAgo } from '../utils/time';
import { targetForNotification } from '../notifications/route';

// category → generated sticker icon (assets/icons/*).
const CATEGORY_ICON = {
  stolen: 'steal',
  defended: 'clan-shield',
  captured: 'claim',
  reminder: 'streak',
  clan_goal: 'clan-shield',
  kudos: 'like',
  season: 'trophy',
  recap: 'bell',
  pasers: 'invite',
  paserby: 'route',
};

// The face of whoever did it, when there is one. A steal, a kudos, a paser
// request — these are people, and a row of identical category stickers made
// the inbox read like a system log. The category icon rides along as a small
// badge so you can still tell WHAT happened at a glance, and system notices
// (season, recap) fall back to the sticker on its own.
function Actor({ item, styles }) {
  const iconName = CATEGORY_ICON[item.category] || 'bell';
  if (!item.actor_avatar) {
    return (
      <View style={styles.icon}>
        <AppIcon name={iconName} size={iconName === 'steal' ? STEAL_ICON_SIZE : 22} faded={item.read} />
      </View>
    );
  }
  return (
    <View style={styles.actor}>
      <PortraitBorder borderKey={item.actor_rank_key || 'wood'} size={40}>
        <CharacterBust
          equipped={item.actor_avatar}
          size={40}
          bg={item.actor_clan_color?.fill}
        />
      </PortraitBorder>
      <View style={[styles.actorBadge, iconName === 'steal' && styles.stealActorBadge]}>
        <AppIcon name={iconName} size={iconName === 'steal' ? 19 : 14} />
      </View>
    </View>
  );
}

export default function NotificationsScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  // Shares the 'notifications' key with Home's bell, so opening the inbox from
  // a Home that already knows the unread count renders the list immediately.
  const { data, loading, setData } = useQuery('notifications', api.notifications, {
    fallback: { unread: 0, items: [] },
  });
  const items = data?.items || [];

  const handlePaserAction = async (linkId, action) => {
    try {
      await api.respondToPaser(linkId, action);
      // Refresh notifications after action
      setData((prev) => ({
        ...prev,
        items: (prev?.items || []).filter((n) => n.id !== linkId),
      }));
    } catch (error) {
      console.error('Failed to respond to paser request:', error);
    }
  };

  // Marking read is a side effect of arriving, not of loading — it has to wait
  // until a response actually says something is unread.
  useEffect(() => {
    if (!data?.unread) return;
    api.markNotificationsRead().catch(() => {});
    ExpoNotifications.setBadgeCountAsync?.(0)?.catch(() => {});
    // Reflect it locally so the rows lose their unread tint and Home's badge
    // is already clear when you go back, without another round trip.
    setData((prev) => ({
      ...prev,
      unread: 0,
      items: (prev?.items || []).map((n) => ({ ...n, read: true })),
    }));
  }, [data?.unread, setData]);

  if (loading) {
    return (
      <Screen>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} width="100%" height={64} style={{ borderRadius: radius.card, marginTop: space.md }} />
        ))}
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen center>
        <EmptyState
          art={require('../../assets/art/empty-notifications.png')}
          title="Nothing yet"
          body="Attacks, captures, reminders and updates appear here."
        />
      </Screen>
    );
  }

  return (
    <Screen gutter={false}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={[type.title, { color: colors.text }]}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xxl, paddingTop: space.md }}
        renderItem={({ item, index }) => {
          const capture = item.category === 'stolen';
          const isPaserRequest = item.category === 'pasers' && item.data?.action === 'request';
          const isPaserAccepted = item.category === 'pasers' && item.data?.action === 'accepted';
          // Every row is tappable to the place its event lives — the same
          // routing a tapped push uses (src/notifications/route.js) — so the
          // inbox and the lock screen agree on where a capture, a kudos or a
          // club request opens.
          const [route, params] = targetForNotification({
            ...item.data,
            category: item.category,
          });
          const open = () => navigation.navigate(route, params);
          return (
            <Animated.View
              entering={
                reduce || !shouldStagger(index)
                  ? undefined
                  : FadeInDown.delay(staggerDelay(index)).duration(260)
              }
            >
              <PressableScale
                onPress={open}
                accessibilityRole="button"
                accessibilityLabel={
                  capture
                    ? `${item.title}. ${item.body}. View affected land.`
                    : `${item.title}. ${item.body}.`
                }
                style={[
                  styles.row,
                  !item.read && styles.unread,
                  capture && styles.captureRow,
                ]}
              >
                <Actor item={item} styles={styles} />
                <View style={styles.content}>
                  <Text style={[type.bodyBold, capture && styles.captureTitle]}>{item.title}</Text>
                  <Text style={[type.bodySm, { color: colors.textMuted, marginTop: 2 }]}>{item.body}</Text>
                  <View style={styles.metaRow}>
                    <Text style={[type.caption, { flex: 1 }]}>{timeAgo(item.created_at)}</Text>
                    {capture ? <Text style={styles.viewLand}>VIEW LAND →</Text> : null}
                  </View>
                </View>
                {isPaserRequest && (
                  <View style={styles.actionButtons}>
                    <PressableScale
                      style={[styles.actionButton, styles.acceptButton]}
                      onPress={() => handlePaserAction(item.id, 'accept')}
                      accessibilityRole="button"
                      accessibilityLabel="Accept paser request"
                    >
                      <Check size={16} color="#FFFFFF" strokeWidth={2.5} />
                    </PressableScale>
                    <PressableScale
                      style={[styles.actionButton, styles.declineButton]}
                      onPress={() => handlePaserAction(item.id, 'decline')}
                      accessibilityRole="button"
                      accessibilityLabel="Decline paser request"
                    >
                      <X size={16} color="#FFFFFF" strokeWidth={2.5} />
                    </PressableScale>
                  </View>
                )}
                {isPaserAccepted && (
                  <View style={styles.actionBadge}>
                    <Text style={[type.captionMedium, { color: '#FFFFFF' }]}>Accepted</Text>
                  </View>
                )}
              </PressableScale>
            </Animated.View>
          );
        }}
      />
    </Screen>
  );
}

const makeStyles = (colors, scheme) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: space.gutter,
      paddingBottom: space.md,
    },
    // A stroke, not a drop: this is a stacked list, and forty rows each
    // casting a hard offset block would print every row on top of the one
    // above it — the same call `LeaderboardView` rows make.
    row: {
      flexDirection: 'row',
      gap: space.md,
      backgroundColor: colors.card,
      borderRadius: radius.card,
      padding: space.lg,
      marginBottom: space.sm,
      borderWidth: NB.strokeThin,
      borderColor: nbInk(scheme, colors.card),
    },
    content: { flex: 1 },
    unread: { backgroundColor: colors.cardAlt },
    captureRow: {
      borderLeftWidth: 4,
      borderLeftColor: brand.pink,
      backgroundColor: colors.cardAlt,
    },
    captureTitle: { color: brand.pink },
    metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: space.sm },
    viewLand: { fontSize: 11, fontFamily: fonts.bold, color: brand.pink, letterSpacing: 0.5 },
    actionButtons: {
      flexDirection: 'row',
      gap: space.sm,
      alignItems: 'center',
    },
    actionButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    acceptButton: {
      backgroundColor: brand.teal,
    },
    declineButton: {
      backgroundColor: '#ef4444',
    },
    actionBadge: {
      paddingHorizontal: space.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: brand.teal,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The portrait needs room for the badge hanging off its corner, so it is
    // sized past the frame rather than clipped to it.
    actor: { width: 40, height: 40 },
    actorBadge: {
      position: 'absolute',
      right: -5,
      bottom: -3,
      width: 21,
      height: 21,
      borderRadius: 11,
      backgroundColor: colors.bg,
      borderWidth: 1.5,
      borderColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stealActorBadge: { width: 25, height: 25, borderRadius: 13, right: -7, bottom: -5 },
    icon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
