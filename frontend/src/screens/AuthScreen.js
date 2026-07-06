import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { colors, radius, space, type } from '../theme';
import { Screen, Button } from '../components/ui';
import LoopMark from '../components/LoopMark';

// Mirror the backend rules exactly (auth.py) so users never hit a server
// error for a format problem.
const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

function usernameError(raw) {
  const u = raw.trim().toLowerCase();
  if (!u) return 'Enter a username.';
  if (u.length < 3) return 'At least 3 characters.';
  if (u.length > 32) return 'At most 32 characters.';
  if (!USERNAME_RE.test(u)) return 'Only a–z, 0–9 and underscore.';
  return null;
}

function passwordError(pw, isSignup) {
  if (!pw) return 'Enter a password.';
  if (pw.length < 8) return 'At least 8 characters.';
  if (pw.length > 128) return 'At most 128 characters.';
  if (isSignup && (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)))
    return 'Needs at least one letter and one digit.';
  return null;
}

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [apiError, setApiError] = useState(null);

  const isSignup = mode === 'signup';
  const uErr = touched ? usernameError(username) : null;
  const pErr = touched ? passwordError(password, isSignup) : null;

  const onSubmit = async () => {
    setTouched(true);
    setApiError(null);
    if (usernameError(username) || passwordError(password, isSignup)) return;
    const u = username.trim().toLowerCase();
    setBusy(true);
    try {
      if (isSignup) await signUp(u, password);
      else await signIn(u, password);
    } catch (e) {
      setApiError(e.message || `Could not ${isSignup ? 'create the account' : 'sign in'}. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(isSignup ? 'signin' : 'signup');
    setTouched(false);
    setApiError(null);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll contentStyle={{ paddingTop: space.huge }}>
        <View style={styles.brand}>
          <LoopMark size={30} />
          <Text style={type.heading}>Territory Run</Text>
        </View>

        <Text style={[type.display, { marginBottom: space.sm }]}>
          {isSignup ? 'Create your account' : 'Welcome back'}
        </Text>
        <Text style={[type.body, { color: colors.textMuted, marginBottom: space.xl }]}>
          {isSignup
            ? 'Pick a username — your runs will claim land under it.'
            : 'Sign in to keep growing your territory.'}
        </Text>

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={[styles.input, uErr && styles.inputError]}
          placeholder="runner_42"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={(v) => { setUsername(v); setApiError(null); }}
          maxLength={32}
          accessibilityLabel="Username"
        />
        {uErr ? <Text style={styles.fieldError}>{uErr}</Text> : null}
        {isSignup && !uErr ? <Text style={styles.fieldHint}>3–32 characters: a–z, 0–9, underscore.</Text> : null}

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={[styles.input, pErr && styles.inputError]}
          placeholder={isSignup ? 'At least 8 characters, letter + digit' : 'Your password'}
          placeholderTextColor={colors.textDim}
          secureTextEntry
          autoCapitalize="none"
          value={password}
          onChangeText={(v) => { setPassword(v); setApiError(null); }}
          maxLength={128}
          accessibilityLabel="Password"
        />
        {pErr ? <Text style={styles.fieldError}>{pErr}</Text> : null}

        {apiError ? (
          <View style={styles.apiErrorBox}>
            <Text style={styles.apiErrorText}>{apiError}</Text>
          </View>
        ) : null}

        <Button
          title={isSignup ? 'Create account' : 'Sign in'}
          onPress={onSubmit}
          loading={busy}
          style={{ marginTop: space.xl }}
        />

        <TouchableOpacity style={styles.switch} onPress={switchMode} accessibilityRole="button">
          <Text style={[type.body, { color: colors.textMuted }]}>
            {isSignup ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </Text>
        </TouchableOpacity>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: space.xl },
  label: { ...type.labelSm, marginBottom: 6, marginTop: space.md },
  input: {
    ...type.body,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 14,
  },
  inputError: { borderColor: colors.danger },
  fieldError: { ...type.caption, color: colors.danger, marginTop: 6 },
  fieldHint: { ...type.caption, color: colors.textDim, marginTop: 6 },
  apiErrorBox: { backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: space.md, marginTop: space.lg },
  apiErrorText: { ...type.bodySm, color: colors.danger },
  switch: { marginTop: space.lg, alignItems: 'center' },
});
