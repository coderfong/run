// The recovery email — the account's way back in if the password is forgotten.
//
// This is the only place an existing account can gain one, so the state where
// there is none is treated as a problem to solve rather than a setting that
// happens to be empty: it leads with what would be lost, and the form is
// already open.
//
// Three states, one card:
//   none      — nothing to recover with. The loud one.
//   pending   — an address is set but not confirmed yet, so it does NOT work.
//               A code is waiting in that inbox.
//   verified  — quiet. The address, and the way to change or remove it.
//
// A social account (Google or Apple) recovers through the provider and never
// sees this card at all.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MailCheck, ShieldAlert } from 'lucide-react-native';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useQuery } from '../hooks/useQuery';
import { nbField, radius, space, useTheme, useThemedType } from '../theme';
import { Card, Row, Button, Input, SectionHeader, Skeleton } from './ui';
import { toast } from '../ui/toast';
import { Arrival, useArrival } from '../ui/motion';

function looksLikeEmail(raw) {
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test((raw || '').trim());
}

export default function RecoveryEmail() {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const { refreshUser } = useAuth();
  const { data, setData, refresh } = useQuery('me:recovery', api.recovery);
  const s = styles(colors, scheme, type);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const arriving = useArrival(!data);

  if (!data) {
    return (
      <>
        <SectionHeader title="Account recovery" style={{ marginTop: space.xl, marginBottom: space.md }} />
        <Skeleton width="100%" height={120} style={{ borderRadius: radius.card }} />
      </>
    );
  }

  // Google and Apple accounts have no PASER password to lose.
  if (data.provider && !data.email) return null;

  const verified = !!data.verified;
  const pending = !!data.email && !verified;

  const save = async () => {
    const email = draft.trim().toLowerCase();
    if (!looksLikeEmail(email)) return toast.error('That email does not look right.');
    setBusy(true);
    try {
      await api.setRecoveryEmail(email, password || null);
      setData({ ...data, email, verified: false, can_recover: false });
      setEditing(false);
      setPassword('');
      setCode('');
      toast.success('Code sent. Check your inbox.');
    } catch (e) {
      toast.error(e.message || 'Could not save that address');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await api.verifyRecoveryEmail(code.trim());
      setCode('');
      await refresh();
      // The cached identity drives the nudge elsewhere in the app, so it has
      // to hear about this too.
      refreshUser().catch(() => {});
      toast.success('Email confirmed');
    } catch (e) {
      toast.error(e.message || 'That code is not valid');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    try {
      await api.resendRecoveryCode();
      toast.success('Sent again');
    } catch (e) {
      toast.error(e.message || 'Could not send it');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Outside the fade on purpose: the header is drawn over the placeholder
          too, and ramping up a title that never left reads as a blink. Only
          the card underneath it arrives. */}
      <SectionHeader title="Account recovery" style={{ marginTop: space.xl, marginBottom: space.md }} />
      <Arrival active={arriving}>
      <Card>
        {!data.mail_available ? (
          <Text style={type.caption}>
            Password reset is not switched on for this build yet.
          </Text>
        ) : null}

        {/* --- nothing set: the case worth being loud about ----------------- */}
        {!data.email && !editing ? (
          <>
            <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
              <ShieldAlert size={20} color={colors.danger} />
              <View style={{ flex: 1 }}>
                <Text style={type.bodyMedium}>No way back into this account</Text>
                <Text style={[type.caption, { marginTop: 2 }]}>
                  Your runs, your land and your level all sit behind one password. Add an email and
                  we can send you a code if you ever forget it. Nobody else on PASER can see it.
                </Text>
              </View>
            </Row>
            <Button
              title="Add an email"
              variant="gradient"
              size="sm"
              full={false}
              onPress={() => { setEditing(true); setDraft(''); }}
              style={{ marginTop: space.md, alignSelf: 'flex-start' }}
            />
          </>
        ) : null}

        {/* --- set, waiting on the code ------------------------------------- */}
        {pending && !editing ? (
          <>
            <Text style={type.labelSm}>Waiting for confirmation</Text>
            <Text style={[type.body, { marginTop: 2 }]}>{data.email}</Text>
            <Text style={[type.caption, { marginTop: space.xs }]}>
              We sent a 6 digit code there. Until you type it in, this address cannot reset your
              password.
            </Text>
            <Input
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={colors.textDim}
              keyboardType="number-pad"
              style={[s.input, s.codeInput]}
              accessibilityLabel="The code from your email"
            />
            <Row gap={space.sm} style={{ marginTop: space.md }}>
              <Button
                title="Confirm"
                size="sm"
                full={false}
                variant="gradient"
                loading={busy}
                disabled={code.length < 6}
                onPress={confirm}
              />
              <Button title="Send again" size="sm" full={false} variant="secondary" onPress={resend} />
              <Button
                title="Change"
                size="sm"
                full={false}
                variant="secondary"
                onPress={() => { setEditing(true); setDraft(data.email || ''); }}
              />
            </Row>
          </>
        ) : null}

        {/* --- confirmed ---------------------------------------------------- */}
        {verified && !editing ? (
          <>
            <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
              <MailCheck size={20} color={colors.text} />
              <View style={{ flex: 1 }}>
                <Text style={type.bodyMedium}>{data.email}</Text>
                <Text style={[type.caption, { marginTop: 2 }]}>
                  Confirmed. If you forget your password, we send a code here.
                </Text>
              </View>
            </Row>
            <Button
              title="Change email"
              size="sm"
              full={false}
              variant="secondary"
              onPress={() => { setEditing(true); setDraft(data.email || ''); }}
              style={{ marginTop: space.md, alignSelf: 'flex-start' }}
            />
          </>
        ) : null}

        {/* --- the form ----------------------------------------------------- */}
        {editing ? (
          <>
            <Text style={type.labelSm}>Email</Text>
            <Input
              value={draft}
              onChangeText={setDraft}
              placeholder="you@example.com"
              placeholderTextColor={colors.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={s.input}
              accessibilityLabel="Recovery email"
            />
            {/* Only a confirmed address is worth protecting with the password,
                and asking for it before there is one would shut out the person
                who is signed in but has already forgotten it. */}
            {verified ? (
              <>
                <Text style={[type.labelSm, { marginTop: space.md }]}>Current password</Text>
                <Input
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  placeholder="Your password"
                  placeholderTextColor={colors.textDim}
                  style={s.input}
                  accessibilityLabel="Current password"
                />
              </>
            ) : null}
            <Text style={[type.caption, { marginTop: space.sm }]}>
              We will send a 6 digit code to confirm the address.
            </Text>
            <Row gap={space.sm} style={{ marginTop: space.md }}>
              <Button title="Save" size="sm" full={false} variant="gradient" loading={busy} onPress={save} />
              <Button
                title="Cancel"
                size="sm"
                full={false}
                variant="secondary"
                onPress={() => { setEditing(false); setPassword(''); }}
              />
            </Row>
          </>
        ) : null}
      </Card>
      </Arrival>
    </>
  );
}

const styles = (colors, scheme, type) =>
  StyleSheet.create({
    input: {
      ...type.body,
      color: colors.text,
      backgroundColor: colors.cardAlt,
      paddingHorizontal: space.md,
      paddingVertical: 12,
      marginTop: 6,
      // `cardAlt`, and this field sits inside a Card — so the ink is judged
      // against the field's own fill rather than the card's, which is the same
      // one-surface-step problem the EnergyMeter track had.
      ...nbField(scheme, { on: colors.cardAlt }),
    },
    codeInput: { textAlign: 'center', fontSize: 24, letterSpacing: 8 },
  });
