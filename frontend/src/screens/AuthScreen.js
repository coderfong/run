// PACER welcome + auth. Step 1: full-bleed hero (art/hero-welcome.png),
// PACER wordmark, gradient Sign in + outline Create account. Step 2: the
// dark form with inline validation (rules mirror the backend exactly).

import React, { useState } from 'react';
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { brand, colors, radius, space, type } from '../theme';
import { Screen, Button } from '../components/ui';
import LoopMark from '../components/LoopMark';

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

// --- step 1: the hero landing ------------------------------------------------

function Welcome({ onSignIn, onCreate }) {
  const insets = useSafeAreaInsets();
  return (
    <ImageBackground
      source={require('../../assets/art/hero-welcome.png')}
      style={styles.hero}
      resizeMode="cover"
    >
      {/* scrim so type + CTAs always read */}
      <LinearGradient
        colors={['rgba(11,13,16,0.55)', 'rgba(11,13,16,0.15)', 'rgba(11,13,16,0.92)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.heroInner, { paddingTop: insets.top + space.huge, paddingBottom: insets.bottom + space.xl }]}>
        <View style={styles.wordmarkWrap}>
          <Text style={styles.wordmark}>{brand.name}</Text>
          <Text style={styles.tagline}>{brand.tagline}</Text>
          <View style={{ marginTop: space.md }}>
            <LoopMark size={26} />
          </View>
        </View>

        <View style={{ gap: space.md }}>
          <Button title="Sign in" variant="gradient" onPress={onSignIn} />
          <Button title="Create account" variant="outline" onPress={onCreate} />
          <Text style={styles.legal}>
            By continuing, you agree to our Terms of Service and Privacy Policy
          </Text>
        </View>
      </View>
    </ImageBackground>
  );
}

// --- step 2: the form ---------------------------------------------------------

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [step, setStep] = useState('welcome'); // 'welcome' | 'form'
  const [mode, setMode] = useState('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [apiError, setApiError] = useState(null);

  const isSignup = mode === 'signup';
  const uErr = touched ? usernameError(username) : null;
  const pErr = touched ? passwordError(password, isSignup) : null;

  const open = (m) => {
    setMode(m);
    setTouched(false);
    setApiError(null);
    setStep('form');
  };

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

  if (step === 'welcome') {
    return <Welcome onSignIn={() => open('signin')} onCreate={() => open('signup')} />;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll contentStyle={{ paddingTop: space.huge }}>
        <TouchableOpacity
          onPress={() => setStep('welcome')}
          style={styles.back}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={colors.textMuted} />
          <Text style={[type.bodyMedium, { color: colors.textMuted }]}>Back</Text>
        </TouchableOpacity>

        <Text style={[type.display, { marginBottom: space.sm }]}>
          {isSignup ? 'Create account' : 'Welcome back'}
        </Text>
        <Text style={[type.body, { color: colors.textMuted, marginBottom: space.xl }]}>
          {isSignup
            ? 'Pick a username — your runs will claim land under it.'
            : 'Sign in to keep conquering.'}
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
          variant="gradient"
          onPress={onSubmit}
          loading={busy}
          style={{ marginTop: space.xl }}
        />

        <TouchableOpacity
          style={styles.switch}
          onPress={() => { setMode(isSignup ? 'signin' : 'signup'); setTouched(false); setApiError(null); }}
          accessibilityRole="button"
        >
          <Text style={[type.body, { color: colors.textMuted }]}>
            {isSignup ? 'Already have an account? Sign in' : 'New here? Create an account'}
          </Text>
        </TouchableOpacity>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, backgroundColor: colors.bg },
  heroInner: { flex: 1, justifyContent: 'space-between', paddingHorizontal: space.gutter },
  wordmarkWrap: { alignItems: 'center', marginTop: space.huge },
  wordmark: {
    ...type.hero,
    fontSize: 56,
    color: '#ffffff',
    transform: [{ skewX: '-6deg' }],
  },
  tagline: {
    ...type.labelSm,
    color: brand.pink,
    letterSpacing: 3,
    marginTop: space.sm,
  },
  legal: { ...type.caption, color: colors.textMuted, textAlign: 'center', marginTop: space.xs },

  back: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: space.lg },
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
