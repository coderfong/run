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
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Send } from 'lucide-react-native';

import { api } from '../api/client';
import { useClan } from '../state/clan';
import { colors, radius, space, type, withAlpha } from '../theme';
import { Screen, Skeleton, EmptyState } from '../components/ui';
import { PressableScale, haptic } from '../ui/motion';
import { toast } from '../ui/toast';

function timeStr(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ClubChatScreen({ route }) {
  const clanId = route.params?.clanId;
  const { color } = useClan();
  const accent = color.stroke;

  const [messages, setMessages] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const items = await api.clanMessages(clanId);
      setMessages(items);
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
        {!messages ? (
          <View style={{ padding: space.gutter }}>
            <Skeleton width="60%" height={36} style={{ borderRadius: 16, marginBottom: space.sm }} />
            <Skeleton width="70%" height={36} style={{ borderRadius: 16, alignSelf: 'flex-end' }} />
          </View>
        ) : messages.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState title="Say hi" body="Kick off the club chat — plan the next run together." />
          </View>
        ) : (
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
                </View>
              );
            }}
          />
        )}

        {/* composer */}
        <View style={styles.composer}>
          <TextInput
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

const styles = StyleSheet.create({
  bubbleRow: { marginBottom: space.sm, alignItems: 'flex-start' },
  sender: { ...type.caption, color: colors.textMuted, marginBottom: 2, marginLeft: 4 },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  time: { ...type.caption, fontSize: 10, marginTop: 2, alignSelf: 'flex-end' },

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
  input: {
    ...type.bodySm,
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    maxHeight: 100,
    color: colors.text,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
