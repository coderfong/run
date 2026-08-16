// Getting back into an account when the password is gone.
//
// Three steps, and each one only asks for the thing it can act on: the
// username, then the code that was mailed, then the new password. The mailed
// code is traded for a short lived ticket at step two, so it is never held
// in this component's state while somebody types a password.
//
// The dead ends matter as much as the happy path. An account with no recovery
// email, or one that signs in through Google or Apple, cannot be reset here,
// and both are answered on the first step with what to do instead rather than
// with a spinner and silence.

import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronLeft, MailCheck } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { useAuth } from './AuthContext';
import { nbField, radius, space, type, useTheme } from '../theme';
import { Screen, Button, Input } from '../components/ui';
import { Reveal } from '../ui/motion';

const CODE_LENGTH = 6;

function passwordError(pw) {
  if (!pw) return 'Enter a password.';
  if (pw.length < 8) return 'At least 8 characters.';
  if (pw.length > 128) return 'At most 128 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Needs at least one letter and one digit.';
  return null;
}

// What the first step says when there is nothing to send. Both cases are real
// answers about the account, so both get a real explanation.
const DEAD_END = {
  no_email: {
    title: 'No recovery email',
    body:
      'This account has no confirmed email, so there is nowhere to send a code. If you are still signed in on another device, open your profile and add one there. Otherwise write to us and we will help.',
  },
  google: {
    title: 'This account uses Google',
    body: 'There is no PASER password to reset. Go back and tap Continue with Google.',
  },
  apple: {
    title: 'This account uses Apple',
    body: 'There is no PASER password to reset. Go back and tap Continue with Apple.',
  },
};

export default function ForgotPassword({ onBack, initialUsername = '' }) {
  const { colors, scheme } = useTheme();
  const { adoptSession } = useAuth();
  const insets = useSafeAreaInsets();
  const s = styles(colors, scheme);

  const [step, setStep] = useState('ask'); // ask | code | password | blocked
  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [resent, setResent] = useState(false);

  const cleanName = username.trim().toLowerCase();

  const requestCode = async ({ resend } = {}) => {
    if (!cleanName) return setError('Enter your username.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.forgotPassword(cleanName);
      if (res?.sent) {
        setStep('code');
        if (resend) {
          setResent(true);
          setCode('');
        }
        return;
      }
      const key = res?.reason === 'oauth' ? res?.provider : 'no_email';
      setBlocked(DEAD_END[key] || DEAD_END.no_email);
      setStep('blocked');
    } catch (e) {
      setError(
        e?.status === 501
          ? 'Password reset is not switched on yet. Write to us and we will get you back in.'
          : e?.message || 'Could not send the code. Try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.verifyResetCode(cleanName, code.trim());
      setTicket(res.ticket);
      setCode('');
      setStep('password');
    } catch (e) {
      setError(e?.message || 'That code is not valid.');
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async () => {
    const pErr = passwordError(password);
    if (pErr) return setError(pErr);
    setBusy(true);
    setError(null);
    try {
      // Comes back as a full session, so this signs them in on the spot. Any
      // other device that was signed in is signed out by the same call.
      await adoptSession(await api.resetPassword(ticket, password));
    } catch (e) {
      setBusy(false);
      if (e?.status === 400) {
        // The ticket expired or was already spent. Sending them back to the
        // top is the only move that can succeed.
        setStep('ask');
        setTicket(null);
        setPassword('');
        setError('That reset expired. Ask for a new code.');
        return;
      }
      setError(e?.message || 'Could not set the password.');
    }
  };

  const body = {
    ask: (
      <>
        <Text style={s.title}>Forgot your password</Text>
        <Text style={s.lede}>
          Tell us your username. If your account has a confirmed email, we will send a code to it.
        </Text>
        <Text style={s.label}>Username</Text>
        <Input
          style={s.input}
          placeholder="runner_42"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          value={username}
          onChangeText={(v) => { setUsername(v); setError(null); }}
          maxLength={32}
          accessibilityLabel="Username"
        />
        <Button
          title="Send the code"
          variant="gradient"
          onPress={requestCode}
          loading={busy}
          style={{ marginTop: space.xl }}
        />
      </>
    ),

    code: (
      <>
        <View style={s.mailIcon}>
          <MailCheck size={30} color={colors.text} />
        </View>
        <Text style={s.title}>Check your email</Text>
        <Text style={s.lede}>
          We sent a {CODE_LENGTH} digit code to the email on your account. It works once and
          expires in 15 minutes.
        </Text>
        <Input
          style={[s.input, s.codeInput]}
          placeholder="000000"
          placeholderTextColor={colors.textDim}
          keyboardType="number-pad"
          autoFocus
          value={code}
          onChangeText={(v) => { setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH)); setError(null); }}
          maxLength={CODE_LENGTH}
          accessibilityLabel="The code from your email"
        />
        <Button
          title="Continue"
          variant="gradient"
          onPress={submitCode}
          loading={busy}
          disabled={code.length < CODE_LENGTH}
          style={{ marginTop: space.xl }}
        />
        <TouchableOpacity
          style={s.subtle}
          disabled={busy}
          onPress={() => requestCode({ resend: true })}
          accessibilityRole="button"
        >
          <Text style={[type.body, { color: colors.textMuted }]}>
            {resent ? 'Sent again. Check your inbox and spam.' : 'Nothing arrived? Send it again'}
          </Text>
        </TouchableOpacity>
      </>
    ),

    password: (
      <>
        <Text style={s.title}>Choose a new password</Text>
        <Text style={s.lede}>
          Signing in on your other devices will need this new password.
        </Text>
        <Text style={s.label}>New password</Text>
        <Input
          style={s.input}
          placeholder="At least 8 characters, letter and digit"
          placeholderTextColor={colors.textDim}
          secureTextEntry
          autoCapitalize="none"
          autoFocus
          value={password}
          onChangeText={(v) => { setPassword(v); setError(null); }}
          maxLength={128}
          accessibilityLabel="New password"
        />
        <Button
          title="Set password and sign in"
          variant="gradient"
          onPress={submitPassword}
          loading={busy}
          style={{ marginTop: space.xl }}
        />
      </>
    ),

    blocked: (
      <>
        <Text style={s.title}>{blocked?.title}</Text>
        <Text style={s.lede}>{blocked?.body}</Text>
        <Button
          title="Back to sign in"
          variant="gradient"
          onPress={onBack}
          style={{ marginTop: space.xl }}
        />
        <TouchableOpacity
          style={s.subtle}
          onPress={() => { setStep('ask'); setBlocked(null); }}
          accessibilityRole="button"
        >
          <Text style={[type.body, { color: colors.textMuted }]}>Try a different username</Text>
        </TouchableOpacity>
      </>
    ),
  }[step];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen scroll contentStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: space.huge }}>
        <Reveal>{body}</Reveal>
        {error ? (
          <Reveal from="none">
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          </Reveal>
        ) : null}
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

const styles = (colors, scheme) =>
  StyleSheet.create({
    back: {
      position: 'absolute',
      left: space.gutter,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    title: { ...type.display, color: colors.text, textAlign: 'center', marginBottom: space.sm },
    lede: {
      ...type.body,
      color: colors.textMuted,
      textAlign: 'center',
      marginBottom: space.lg,
      lineHeight: 21,
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
    // The code is the whole screen at that step, so it is set large and spaced
    // rather than sitting in a field that looks like every other field.
    codeInput: {
      textAlign: 'center',
      fontSize: 30,
      letterSpacing: 10,
      paddingVertical: space.md,
    },
    mailIcon: { alignSelf: 'center', marginBottom: space.md },
    subtle: { marginTop: space.lg, alignItems: 'center' },
    errorBox: {
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.sm,
      padding: space.md,
      marginTop: space.lg,
    },
    errorText: { ...type.bodySm, color: colors.danger },
  });
