// Club chat — a simple polling message room for club members. Own messages
// sit right in the club colour; others sit left with the sender's name.
// Polls every 4s while the screen is focused (no sockets — keeps the
// backend boring and works everywhere).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MoreHorizontal, Send } from 'lucide-react-native';

import { api } from '../api/client';
import { getCached, setCached } from '../api/cache';
import { useClan } from '../state/clan';
import { NB, nbField, radius, space, withAlpha, useTheme, useThemedStyles, useThemedType } from '../theme';
import { Screen, Skeleton, EmptyState, Input } from '../components/ui';
import { Arrival, PressableScale, haptic, useArrival } from '../ui/motion';
import { toast } from '../ui/toast';
import { openSafetyActions } from '../utils/safety';

function timeStr(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ClubChatScreen({ route }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const clanId = route.params?.clanId;
  const { color } = useClan();
  const accent = color.stroke;

  // Seeded from cache so reopening the room shows the conversation you were
  // just reading; the 4s poll below replaces it with the live thread.
  const [messages, setMessages] = useState(() => getCached(`clan:${clanId}:messages`));
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const pollRef = useRef(null);
  // undefined is "the first fetch is still out" — the cache seeds an array.
  const arriving = useArrival(messages === undefined);

  const load = useCallback(async () => {
    try {
      const items = await api.clanMessages(clanId);
      setMessages(items);
      setCached(`clan:${clanId}:messages`, items);
    } catch {
      setMessages((prev) => prev || []);
    }
  }, [clanId]);

  // Poll while focused.
  useFocusEffect(
    useCallback(() => {
      load();
      pollRef.current = setInterval(load, 4000);
      return () => clearInterval(pollRef.current);
    }, [load])
  );

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    haptic.light();
    try {
      const m = await api.sendClanMessage(clanId, body);
      setMessages((prev) => [...(prev || []), m]);
      setDraft('');
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      toast.error(e.message || 'Could not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Screen gutter={false} edges={[]} style={{ flex: 1 }}>
        {messages === undefined ? (
          <View style={{ padding: space.gutter }}>
            <Skeleton width="60%" height={36} style={{ borderRadius: 16, marginBottom: space.sm }} />
            <Skeleton width="70%" height={36} style={{ borderRadius: 16, alignSelf: 'flex-end' }} />
          </View>
        ) : messages.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState title="Say hi" body="Kick off the club chat. Plan the next run together." />
          </View>
        ) : (
          <Arrival active={arriving} style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={{ padding: space.gutter, paddingBottom: space.md }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item, index }) => {
              const prev = messages[index - 1];
              const showName = !item.is_you && (!prev || prev.user_id !== item.user_id);
              return (
                <View style={[styles.bubbleRow, item.is_you && { alignItems: 'flex-end' }]}>
                  {showName ? <Text style={styles.sender}>{item.username}</Text> : null}
                  <View style={styles.messageRow}>
                    <View
                      style={[
                        styles.bubble,
                        item.is_you
                          ? { backgroundColor: withAlpha(accent, 0.9), borderBottomRightRadius: 4 }
                          : { backgroundColor: colors.card, borderBottomLeftRadius: 4 },
                      ]}
                    >
                      <Text style={[type.bodySm, { color: item.is_you ? '#fff' : colors.text }]}>{item.body}</Text>
                      <Text style={[styles.time, { color: item.is_you ? 'rgba(255,255,255,0.7)' : colors.textDim }]}>
                        {timeStr(item.created_at)}
                      </Text>
                    </View>
                    {!item.is_you && item.user_id ? (
                      <PressableScale
                        onPress={() => openSafetyActions({
                          userId: item.user_id,
                          username: item.username,
                          context: `club message ${item.id}`,
                          onBlocked: (blockedId) => setMessages((prev) =>
                            (prev || []).filter((message) => message.user_id !== blockedId)
                          ),
                        })}
                        hitSlop={10}
                        style={styles.safetyButton}
                        accessibilityRole="button"
                        accessibilityLabel={`Safety options for ${item.username}`}
                      >
                        <MoreHorizontal size={20} color={colors.textMuted} />
                      </PressableScale>
                    ) : null}
                  </View>
                </View>
              );
            }}
          />
          </Arrival>
        )}

        {/* composer */}
        <View style={styles.composer}>
          <Input
            style={styles.input}
            placeholder="Message your club…"
            placeholderTextColor={colors.textDim}
            value={draft}
            onChangeText={setDraft}
            maxLength={500}
            multiline
            accessibilityLabel="Message"
          />
          <PressableScale
            onPress={send}
            disabled={!draft.trim() || sending}
            style={[styles.sendBtn, { backgroundColor: accent, opacity: draft.trim() && !sending ? 1 : 0.4 }]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Send size={18} color="#fff" />
          </PressableScale>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  bubbleRow: { marginBottom: space.sm, alignItems: 'flex-start' },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  sender: { ...type.caption, color: colors.textMuted, marginBottom: 2, marginLeft: 4 },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  time: { ...type.caption, fontSize: 10, marginTop: 2, alignSelf: 'flex-end' },
  safetyButton: { padding: 6 },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.gutter,
    paddingVertical: space.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    paddingBottom: space.lg,
  },
  // Thin, unlike the full-width fields on the forms. A composer is not the
  // whole control — it is one half of a docked row with a send button beside
  // it — and 3pt of ink around a field this short reads as a box drawn around
  // the message rather than as the field's own edge.
  input: {
    ...type.bodySm,
    flex: 1,
    backgroundColor: colors.card,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    maxHeight: 100,
    color: colors.text,
    ...nbField(scheme, { on: colors.card, stroke: NB.strokeThin }),
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
