import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { colors, font, radius, space } from '../theme';
import { toast } from '../ui/toast';

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const isSignup = mode === 'signup';

  const validate = () => {
    const u = username.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) {
      toast.error('Username: 3-32 chars (a-z, 0-9, _).');
      return null;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return null;
    }
    if (isSignup && (!/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      toast.error('Password needs a letter and a digit.');
      return null;
    }
    return u;
  };

  const onSubmit = async () => {
    const u = validate();
    if (!u) return;
    setBusy(true);
    try {
      if (isSignup) await signUp(u, password);
      else await signIn(u, password);
    } catch (e) {
      toast.error(e.message || 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.logoDot} />
          <Text style={styles.brandText}>Territory Run</Text>
        </View>

        <Text style={styles.headline}>
          {isSignup ? 'Create your account' : 'Welcome back'}
        </Text>
        <Text style={styles.subtle}>
          {isSignup
            ? 'Pick a username — your runs will claim land under it.'
            : 'Sign in to keep growing your territory.'}
        </Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          placeholder="runner_42"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
          maxLength={32}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="At least 8 characters"
          placeholderTextColor={colors.textDim}
          secureTextEntry
          autoCapitalize="none"
          value={password}
          onChangeText={setPassword}
          maxLength={128}
        />

        <TouchableOpacity
          style={[styles.primaryBtn, busy && styles.btnDisabled]}
          activeOpacity={0.85}
          onPress={onSubmit}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryInk} />
          ) : (
            <Text style={styles.primaryBtnText}>
              {isSignup ? 'Create account' : 'Sign in'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switch}
          onPress={() => setMode(isSignup ? 'signin' : 'signup')}
        >
          <Text style={styles.switchText}>
            {isSignup
              ? 'Already have an account? Sign in'
              : "New here? Create an account"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space.xl, paddingTop: space.xxl + 24 },

  brand: { flexDirection: 'row', alignItems: 'center', marginBottom: space.xl },
  logoDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    marginRight: 10,
  },
  brandText: { ...font.section, fontSize: 18 },

  headline: { ...font.hero, marginBottom: space.sm },
  subtle: { ...font.muted, marginBottom: space.xl },

  label: {
    ...font.muted,
    marginBottom: 6,
    marginTop: space.md,
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
  },

  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: space.xl,
  },
  primaryBtnText: { color: colors.primaryInk, fontWeight: '800', fontSize: 16 },
  btnDisabled: { opacity: 0.6 },

  switch: { marginTop: space.lg, alignItems: 'center' },
  switchText: { color: colors.textMuted, fontSize: 14 },
});
