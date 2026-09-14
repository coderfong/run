// PASER welcome + auth.
//
// Step 1 (Welcome): moimoi-style landing — the big PASER wordmark up top, the
// mascot hero filling the screen, the image DISSOLVING into solid black at the
// bottom (not hard-cropped) where two stacked pill buttons sit. Step 2 (Form):
// the username/password form with inline validation (rules mirror the backend).
//
// The two steps CROSSFADE (both absolutely filled, fade in/out) instead of the
// old hard swap. Honors Reduce Motion.

import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from '../ui/image';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { warmUp } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import ForgotPassword from '../auth/ForgotPassword';
import { brand, nbField, radius, space, type, useTheme } from '../theme';
import { Screen, Button, Card, Input } from '../components/ui';
import { framePose, frameVariant } from '../ui/frameRegistry';
import { Reveal, useReduceMotion } from '../ui/motion';
import SocialAuthButtons from '../components/SocialAuthButtons';
import { preloadScreenImagesAfterInteractions } from '../config/screenAssets';

const AUTH_HERO = require('../../assets/art/auth-hero.png');
const PRIVACY_URL = 'https://www.gameablestudios.com/privacy';
const SUPPORT_URL = 'https://www.gameablestudios.com/support';

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

function usernameError(raw) {
  const u = raw.trim().toLowerCase();
  if (!u) return 'Enter a username.';
  if (u.length < 3) return 'At least 3 characters.';
  if (u.length > 32) return 'At most 32 characters.';
  if (!USERNAME_RE.test(u)) return 'Letters, numbers and underscore only.';
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

// Optional, so blank is valid. Anything typed has to look like an address:
// this is the only chance to catch a typo before the day it is needed.
function emailError(raw) {
  const e = (raw || '').trim();
  if (!e) return null;
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return 'That email does not look right.';
  return null;
}

// --- step 1: the hero landing ------------------------------------------------

function Welcome({ onSignIn, onCreate }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.hero}>
      {/* the bottom fades to solid black — a clean stage for the buttons */}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.4)', '#000000', '#000000']}
        locations={[0.55, 0.72, 0.9, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[
          styles.heroInner,
          { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl },
        ]}
      >
        <View style={styles.wordmarkWrap}>
          <Reveal>
            <Text style={styles.wordmark}>{brand.name}</Text>
          </Reveal>
          <Reveal delay={120} style={{ alignItems: 'center' }}>
            <Text style={styles.tagline}>{brand.tagline}</Text>
          </Reveal>
          {/* the full crew — aspect ratio lives on the wrapper View (reliable),
              the image just fills it and is contained, so all runners show */}
          <Reveal delay={240} style={{ width: '100%' }}>
            <View style={styles.crewWrap}>
              <Image source={AUTH_HERO} style={styles.crew} resizeMode="contain" />
            </View>
          </Reveal>
        </View>

        <View style={{ gap: space.md, marginBottom: space.xxl }}>
          <Reveal from="up" delay={300}>
            <Button title="Sign in" variant="primary" onPress={onSignIn} />
          </Reveal>
          <Reveal from="up" delay={380}>
            <Button title="Create account" variant="gradient" onPress={onCreate} />
          </Reveal>

          {/* social sign-in */}
          <Reveal from="up" delay={440}>
            <SocialAuthButtons />
          </Reveal>

          <Reveal from="none" delay={560}>
            <View style={styles.legalRow}>
              <Text style={styles.legal}>By continuing, you acknowledge our </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}
                accessibilityRole="link"
                accessibilityLabel="Privacy Policy"
              >
                <Text style={[styles.legal, styles.legalLink]}>Privacy Policy</Text>
              </TouchableOpacity>
              <Text style={styles.legal}> | </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL(SUPPORT_URL).catch(() => {})}
                accessibilityRole="link"
                accessibilityLabel="Support"
              >
                <Text style={[styles.legal, styles.legalLink]}>Support</Text>
              </TouchableOpacity>
            </View>
          </Reveal>
        </View>
      </View>
    </View>
  );
}

// --- step 2: the form ---------------------------------------------------------

function AuthForm({ onBack, onForgot, initialMode = 'signin' }) {
  const { signIn, signUp } = useAuth();
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = formStyles(colors, scheme);

  // Which side of the form you land on is decided by the button you pressed on
  // the way in. It used to always be 'signin', so Create account walked you to
  // a screen headed "Welcome back" asking for a password you had never set.
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [apiError, setApiError] = useState(null);

  const isSignup = mode === 'signup';
  const uErr = touched ? usernameError(username) : null;
  const pErr = touched ? passwordError(password, isSignup) : null;
  const eErr = touched ? emailError(email) : null;

  const onSubmit = async () => {
    setTouched(true);
    setApiError(null);
    if (usernameError(username) || passwordError(password, isSignup)) return;
    if (isSignup && emailError(email)) return;
    const u = username.trim().toLowerCase();
    setBusy(true);
    try {
      if (isSignup) await signUp(u, password, email.trim().toLowerCase() || null);
      else await signIn(u, password);
    } catch (e) {
      setApiError(e.message || `Could not ${isSignup ? 'create the account' : 'sign in'}. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll contentStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: space.huge }}>
        <Reveal>
          <Text style={[type.display, { marginBottom: space.sm, textAlign: 'center', color: colors.text }]}>
            {isSignup ? 'Create account' : 'Welcome back'}
          </Text>
          <Text style={[type.body, { color: colors.textMuted, marginBottom: space.xl, textAlign: 'center' }]}>
            {isSignup
              ? 'Pick a username. Your runs will claim land under it.'
              : 'Sign in to keep claiming.'}
          </Text>
        </Reveal>

        <Card
          frame={frameVariant('box', `auth:${mode}`)}
          frameTint={brand.pink}
          framePose={framePose(`auth:${mode}`)}
        >
        <Reveal delay={90}>
          <Text style={s.label}>Username</Text>
          <Input
            style={[s.input, uErr && s.inputError]}
            placeholder="runner_42"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={(v) => { setUsername(v); setApiError(null); }}
            maxLength={32}
            accessibilityLabel="Username"
          />
          {uErr ? <Text style={s.fieldError}>{uErr}</Text> : null}
          {isSignup && !uErr ? <Text style={s.fieldHint}>3 to 32 characters: letters, numbers, underscore.</Text> : null}
        </Reveal>

        <Reveal delay={170}>
          <Text style={s.label}>Password</Text>
          <Input
            style={[s.input, pErr && s.inputError]}
            placeholder={isSignup ? 'At least 8 characters, letter + digit' : 'Your password'}
            placeholderTextColor={colors.textDim}
            secureTextEntry
            autoCapitalize="none"
            value={password}
            onChangeText={(v) => { setPassword(v); setApiError(null); }}
            maxLength={128}
            accessibilityLabel="Password"
          />
          {pErr ? <Text style={s.fieldError}>{pErr}</Text> : null}
          {/* The one thing standing between a forgotten password and a lost
              account. Offered on sign in only, because on the signup form the
              field below is the version that helps. */}
          {!isSignup ? (
            <TouchableOpacity
              onPress={onForgot}
              style={{ marginTop: space.md, alignSelf: 'flex-start' }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={[type.bodySm, { color: colors.textMuted, textDecorationLine: 'underline' }]}>
                Forgot your password?
              </Text>
            </TouchableOpacity>
          ) : null}
        </Reveal>

        {/* Optional at signup and skippable, but it is the whole of account
            recovery: an account with no confirmed address cannot be got back
            if the password goes. Said plainly rather than buried in a hint. */}
        {isSignup ? (
          <Reveal delay={210}>
            <Text style={s.label}>Email</Text>
            <Input
              style={[s.input, eErr && s.inputError]}
              placeholder="you@example.com"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={(v) => { setEmail(v); setApiError(null); }}
              maxLength={254}
              accessibilityLabel="Email, optional, used to reset your password"
            />
            {eErr ? (
              <Text style={s.fieldError}>{eErr}</Text>
            ) : (
              <Text style={s.fieldHint}>
                Optional. It is the only way to reset your password later, and nobody else on PASER
                can see it.
              </Text>
            )}
          </Reveal>
        ) : null}

        {apiError ? (
          <Reveal from="none">
            <View style={s.apiErrorBox}>
              <Text style={s.apiErrorText}>{apiError}</Text>
            </View>
          </Reveal>
        ) : null}

        <Reveal from="up" delay={250}>
          <Button
            title={isSignup ? 'Create account' : 'Sign in'}
            variant="gradient"
            onPress={onSubmit}
            loading={busy}
            style={{ marginTop: space.xl }}
          />

          <TouchableOpacity
            style={s.switch}
            onPress={() => { setMode(isSignup ? 'signin' : 'signup'); setTouched(false); setApiError(null); }}
            accessibilityRole="button"
          >
            <Text style={[type.body, { color: colors.textMuted }]}>
              {isSignup ? 'Already have an account? Sign in' : 'New here? Create an account'}
            </Text>
          </TouchableOpacity>
        </Reveal>
        </Card>
      </Screen>

      <TouchableOpacity
        onPress={onBack}
        style={[s.back, { top: insets.top + space.md }]}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <ChevronLeft size={22} color={colors.textMuted} />
        <Text style={[type.bodyMedium, { color: colors.textMuted }]}>Back</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

// --- root: crossfades welcome <-> form ---------------------------------------

export default function AuthScreen() {
  const [step, setStep] = useState('welcome'); // 'welcome' | 'form' | 'forgot'
  const [intent, setIntent] = useState('signin'); // which button opened the form
  const reduced = useReduceMotion();

  useEffect(() => preloadScreenImagesAfterInteractions('Onboarding'), []);

  // Wake the API while the welcome screen is being read.
  //
  // This is the FIRST screen of a fresh install, and the host spins the
  // instance down when it is left alone, so the sign-in that follows is the
  // call most likely in the whole app to land on a cold server. Starting the
  // boot here spends it on the seconds someone takes to choose a button and
  // type a username, instead of on a spinner after they press Sign in.
  // Unawaited and silent, exactly as on the run screen. See warmUp.
  useEffect(() => warmUp(), []);

  const enter = reduced ? undefined : FadeIn.duration(320);
  const exit = reduced ? undefined : FadeOut.duration(200);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {step === 'welcome' ? (
        <Animated.View key="welcome" style={StyleSheet.absoluteFill} entering={enter} exiting={exit}>
          <Welcome
            onSignIn={() => { setIntent('signin'); setStep('form'); }}
            onCreate={() => { setIntent('signup'); setStep('form'); }}
          />
        </Animated.View>
      ) : step === 'forgot' ? (
        <Animated.View key="forgot" style={StyleSheet.absoluteFill} entering={enter} exiting={exit}>
          <ForgotPassword onBack={() => setStep('form')} />
        </Animated.View>
      ) : (
        <Animated.View key="form" style={StyleSheet.absoluteFill} entering={enter} exiting={exit}>
          {/* Keyed on the intent so switching sides remounts with the right
              mode rather than leaving a stale `useState` initial value. */}
          <AuthForm
            key={intent}
            initialMode={intent}
            onBack={() => setStep('welcome')}
            onForgot={() => setStep('forgot')}
          />
        </Animated.View>
      )}
    </View>
  );
}

// --- styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  hero: { flex: 1, backgroundColor: '#fdcf15' },
  heroInner: { flex: 1, justifyContent: 'space-between', paddingHorizontal: space.gutter },
  wordmarkWrap: { alignItems: 'center', marginTop: space.lg },
  crewWrap: { width: '100%', aspectRatio: 1.555, marginTop: space.xl },
  crew: { width: '100%', height: '100%' },
  wordmark: {
    fontFamily: type.hero.fontFamily,
    fontSize: 68,
    lineHeight: 74,
    letterSpacing: -1,
    textTransform: 'uppercase',
    color: '#141414',
  },
  tagline: {
    ...type.labelSm,
    color: '#141414',
    opacity: 0.7,
    letterSpacing: 3,
    marginTop: space.sm,
  },
  legalRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center',
    marginTop: space.xs,
  },
  legal: { ...type.caption, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },
  legalLink: { color: '#fff', textDecorationLine: 'underline' },
});

// Form chrome is themed (light/dark ready) — built from the active palette.
const formStyles = (colors, scheme) =>
  StyleSheet.create({
    back: {
      position: 'absolute',
      left: space.gutter,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    label: { ...type.labelSm, color: colors.textMuted, marginBottom: 6, marginTop: space.md },
    input: {
      ...type.body,
      color: colors.text,
      backgroundColor: colors.card,
      paddingHorizontal: space.md,
      paddingVertical: 14,
      ...nbField(scheme, { on: colors.card }),
    },
    // Spread AFTER `input` at every call site, so this replaces the ink rather
    // than sitting beside it. Same width, so nothing shifts when a field goes
    // invalid — only the colour of the edge changes.
    inputError: nbField(scheme, { on: colors.card, error: colors.danger }),
    fieldError: { ...type.caption, color: colors.danger, marginTop: 6 },
    fieldHint: { ...type.caption, color: colors.textDim, marginTop: 6 },
    apiErrorBox: { backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: space.md, marginTop: space.lg },
    apiErrorText: { ...type.bodySm, color: colors.danger },
    switch: { marginTop: space.lg, alignItems: 'center' },
  });
