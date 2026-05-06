import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { regionForUser } from '../data/regions';
import { colors, font, radius, space } from '../theme';
import { toast } from '../ui/toast';

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

export default function ProfileScreen() {
  const { user, signOut, updateUsername, deleteAccount } = useAuth();
  const team = regionForUser(user?.username || '');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user?.username || '');
  const [busy, setBusy] = useState(false);

  const saveUsername = async () => {
    const u = draft.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) {
      toast.error('Username: 3-32 chars (a-z, 0-9, _).');
      return;
    }
    setBusy(true);
    try {
      await updateUsername(u);
      toast.success('Username updated');
      setEditing(false);
    } catch (e) {
      toast.error(e.message || 'Could not rename');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete account?',
      'This permanently removes your runs and territories. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
              toast.success('Account deleted');
            } catch (e) {
              toast.error(e.message || 'Could not delete account');
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
    >
      <View style={styles.header}>
        <View style={[styles.avatar, { borderColor: team.color }]}>
          <Text style={styles.avatarText}>
            {(user?.username || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.username}>{user?.username}</Text>
        <View style={[styles.teamPill, { borderColor: team.color }]}>
          <View style={[styles.teamDot, { backgroundColor: team.color }]} />
          <Text style={styles.teamText}>Team {team.name}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Username</Text>
        {editing ? (
          <View>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={32}
              style={styles.input}
              placeholderTextColor={colors.textDim}
            />
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.smallBtn, styles.secondary]}
                onPress={() => {
                  setEditing(false);
                  setDraft(user?.username || '');
                }}
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallBtn, styles.primary, busy && { opacity: 0.6 }]}
                onPress={saveUsername}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color={colors.primaryInk} />
                ) : (
                  <Text style={styles.primaryText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.row}>
            <Text style={styles.cardValue}>{user?.username}</Text>
            <TouchableOpacity
              style={[styles.smallBtn, styles.secondary]}
              onPress={() => setEditing(true)}
            >
              <Text style={styles.secondaryText}>Change</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.fullBtn, { backgroundColor: colors.card }]}
        activeOpacity={0.85}
        onPress={signOut}
      >
        <Text style={[styles.fullBtnText, { color: colors.text }]}>
          Sign out
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.fullBtn, { backgroundColor: '#3a1414', marginTop: space.md }]}
        activeOpacity={0.85}
        onPress={confirmDelete}
      >
        <Text style={[styles.fullBtnText, { color: colors.danger }]}>
          Delete account
        </Text>
      </TouchableOpacity>

      <Text style={styles.legal}>
        By using Territory Run you accept our Terms of Service and Privacy
        Policy.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  container: { padding: space.lg, paddingBottom: space.xxl },

  header: { alignItems: 'center', marginBottom: space.xl },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.card,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  avatarText: { color: colors.text, fontSize: 36, fontWeight: '800' },
  username: { ...font.title, marginBottom: space.sm },
  teamPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  teamDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  teamText: { color: colors.text, fontWeight: '700', fontSize: 12 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLabel: { ...font.muted, marginBottom: 6, textTransform: 'uppercase', fontSize: 11 },
  cardValue: { ...font.body, fontSize: 16, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  input: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    marginVertical: space.sm,
  },

  smallBtn: {
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.sm,
    minWidth: 84,
    alignItems: 'center',
  },
  primary: { backgroundColor: colors.primary, marginLeft: space.sm },
  primaryText: { color: colors.primaryInk, fontWeight: '800' },
  secondary: { backgroundColor: colors.cardAlt },
  secondaryText: { color: colors.text, fontWeight: '700' },

  fullBtn: {
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  fullBtnText: { fontSize: 16, fontWeight: '700' },

  legal: {
    color: colors.textDim,
    fontSize: 12,
    marginTop: space.xl,
    textAlign: 'center',
    paddingHorizontal: space.lg,
    lineHeight: 18,
  },
});
