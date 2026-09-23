import React, { useState } from 'react';
import { Linking, StyleSheet, Switch, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Lock } from 'lucide-react-native';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useAccent } from '../hooks/useAccent';
import { useQuery } from '../hooks/useQuery';
import HealthSyncSettings from '../components/HealthSyncSettings';
import PrivacySettings from '../components/PrivacySettings';
import RecoveryEmail from '../components/RecoveryEmail';
import ThemeToggle from '../components/ThemeToggle';
import DevCrossroadsSeed from '../components/DevCrossroadsSeed';
import { COPY as PASERBY_COPY } from '../config/paserby';
import { TRAIL_GLOW_COLORS, useSettings } from '../state/settings';
import { haptic, PressableScale } from '../ui/motion';
import { toast } from '../ui/toast';
import {
  AccordionSection,
  BackButton,
  Button,
  Card,
  Input,
  Screen,
  SectionHeader,
} from '../components/ui';
import { nbField, space, useTheme, useThemedStyles, useThemedType } from '../theme';
import { useProEntitlement } from '../pro/ProProvider';
import { useTutorial } from '../tutorial';

const NOTIF_KEYS = [
  'stolen', 'defended', 'captured', 'clan_goal', 'kudos',
  'pasers', 'paserby', 'season', 'recap', 'reminder',
];

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
const PRIVACY_POLICY_URL = 'https://www.gameablestudios.com/privacy';
const SUPPORT_URL = 'https://www.gameablestudios.com/support';
const GOLD = '#F5C451';

export default function SettingsScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const accent = useAccent();
  const { user, signOut, updateUsername, deleteAccount } = useAuth();
  const { trailGlow, setTrailGlow } = useSettings();
  const { isPro, canShowPro, openPaywall } = useProEntitlement();
  const { replay } = useTutorial();
  const { data: prefs, setData: setPrefs } = useQuery('me:notif-prefs', api.getNotifPrefs);
  const { data: paserby, setData: setPaserby } = useQuery('me:paserby', api.paserby, {
    fallback: { enabled: true, unseen: 0, total: 0 },
  });

  const [section, setSection] = useState('customisation');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user?.username || '');
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteDraft, setDeleteDraft] = useState('');
  const [deleting, setDeleting] = useState(false);

  const toggleSection = (key) => setSection((open) => (open === key ? null : key));
  const notificationsOn = prefs ? NOTIF_KEYS.every((key) => prefs[key] !== false) : true;
  const deleteMatches = deleteDraft.trim().toLowerCase() === user?.username;

  const toggleNotifications = async () => {
    const enabled = !notificationsOn;
    const next = { ...prefs };
    NOTIF_KEYS.forEach((key) => { next[key] = enabled; });
    setPrefs(next);
    try { await api.setNotifPrefs(next); } catch { setPrefs(prefs); }
  };

  const togglePaserby = async () => {
    const next = !(paserby?.enabled !== false);
    setPaserby({ ...(paserby || {}), enabled: next });
    try {
      setPaserby(await api.setPaserby(next));
    } catch {
      setPaserby({ ...(paserby || {}), enabled: !next });
      toast.error('Could not change that setting');
    }
  };

  // Re-arms the new core tutorial and takes the runner to Home, where it
  // starts. Touches nothing but the tutorial's own record: runs, land, rank,
  // coins and missions are exactly as they were.
  const replayTutorial = () => {
    if (!replay()) toast.show('Finish your run first, then replay the tutorial.');
  };

  const saveUsername = async () => {
    const u = draft.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) return toast.error('Usernames are 3 to 32 characters: letters, numbers, underscore.');
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

  const doDelete = async () => {
    if (!deleteMatches) return;
    setDeleting(true);
    try {
      await deleteAccount();
      toast.success('Account deleted');
    } catch (e) {
      toast.error(e.message || 'Could not delete account');
      setDeleting(false);
    }
  };

  return (
    <Screen scroll contentStyle={{ paddingBottom: space.xxl }}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={type.title}>Settings</Text>
      </View>

      <View style={styles.list}>
        <AccordionSection
          title="App customisation"
          subtitle="Theme, runner colour, tutorial"
          framed={false}
          open={section === 'customisation'}
          onToggle={() => toggleSection('customisation')}
        >
          <SectionHeader title="Help" framed={false} style={styles.innerHeading} />
          <Card>
            <Text style={type.labelSm}>Tutorial</Text>
            <Text style={[type.caption, styles.settingCopy]}>
              Play the first run walkthrough again. Nothing you have earned is affected.
            </Text>
            <Button
              title="Replay tutorial"
              variant="secondary"
              size="sm"
              full={false}
              onPress={replayTutorial}
            />
          </Card>

          <SectionHeader title="Appearance" framed={false} style={styles.groupHeading} />
          <Card>
            <Text style={type.labelSm}>Theme</Text>
            <Text style={[type.caption, styles.settingCopy]}>
              Follow your device, or force light or dark.
            </Text>
            <ThemeToggle />
          </Card>

          <Card style={{ marginTop: space.md }}>
            <Text style={type.labelSm}>Runner colour</Text>
            <Text style={[type.caption, { marginTop: 2 }]}>
              Colours your trail, map outline and profile frames. Club follows your club colour.
            </Text>
            <View style={styles.swatchRow}>
              {TRAIL_GLOW_COLORS.map(({ key, label, value, pro }) => {
                const swatch = value || accent;
                const selected = trailGlow === key;
                const locked = pro && canShowPro && !isPro;
                return (
                  <PressableScale
                    key={key}
                    onPress={() => {
                      haptic.light();
                      if (locked) { openPaywall('cosmetics'); return; }
                      setTrailGlow(key);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={locked ? `Trail glow ${label}, PASER PRO, tap to unlock` : `Trail glow ${label}`}
                    accessibilityState={{ selected }}
                    style={styles.swatchItem}
                  >
                    <View style={[styles.swatch, { backgroundColor: swatch, shadowColor: swatch }, selected && styles.swatchSelected]}>
                      {locked ? (
                        <View style={styles.swatchLock}>
                          <Lock size={13} color={GOLD} strokeWidth={2.5} />
                        </View>
                      ) : null}
                    </View>
                    <Text style={[type.caption, { color: locked ? GOLD : selected ? colors.text : colors.textDim }]}>
                      {label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </Card>
        </AccordionSection>

        <AccordionSection
          title="Notifications"
          subtitle="PASER alerts and preferences"
          framed={false}
          open={section === 'notifications'}
          onToggle={() => toggleSection('notifications')}
        >
          <Card>
            <View style={styles.toggleRowInner}>
              <View style={{ flex: 1, paddingRight: space.md }}>
                <Text style={type.body}>Notifications</Text>
                <Text style={type.caption}>Allow PASER alerts outside the app.</Text>
              </View>
              <Switch
                value={notificationsOn}
                onValueChange={toggleNotifications}
                trackColor={{ true: accent }}
                disabled={!prefs}
                accessibilityLabel="Notifications toggle"
              />
            </View>
          </Card>
        </AccordionSection>

        <AccordionSection
          title="Privacy"
          subtitle="Routes, crossed paths, Apple Health"
          framed={false}
          open={section === 'privacy'}
          onToggle={() => toggleSection('privacy')}
        >
          <PrivacySettings nested />

          <SectionHeader framed={false} title="Crossed paths" style={styles.innerHeading} />
          <Card>
            <View style={styles.toggleRowInner}>
              <View style={{ flex: 1, paddingRight: space.md }}>
                <Text style={type.body}>{PASERBY_COPY.setting}</Text>
                <Text style={type.caption}>{PASERBY_COPY.settingHint}</Text>
              </View>
              <Switch
                value={paserby ? paserby.enabled !== false : true}
                onValueChange={togglePaserby}
                trackColor={{ true: accent }}
                disabled={!paserby}
              />
            </View>
            {paserby?.total ? (
              <Button
                title={`Crossroads (${paserby.total})`}
                variant="secondary"
                size="sm"
                full={false}
                onPress={() => navigation.navigate('Crossroads')}
                style={{ marginTop: space.md, alignSelf: 'flex-start' }}
              />
            ) : null}
            <DevCrossroadsSeed onOpen={() => navigation.navigate('Crossroads')} />
          </Card>

          <HealthSyncSettings nested />
        </AccordionSection>

        <AccordionSection
          title="Account"
          subtitle="Username, recovery, sign out"
          framed={false}
          open={section === 'account'}
          onToggle={() => toggleSection('account')}
          last
        >
          <Card>
            <Text style={type.labelSm}>Username</Text>
            {editing ? (
              <>
                <Input
                  value={draft}
                  onChangeText={setDraft}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={32}
                  style={styles.input}
                  placeholderTextColor={colors.textDim}
                />
                <View style={styles.btnRow}>
                  <Button title="Cancel" variant="secondary" size="sm" full={false} onPress={() => { setEditing(false); setDraft(user?.username || ''); }} />
                  <Button title="Save" size="sm" full={false} loading={busy} onPress={saveUsername} accent={accent} />
                </View>
              </>
            ) : (
              <View style={styles.settingRow}>
                <Text style={type.bodyBold}>{user?.username}</Text>
                <Button title="Change" variant="secondary" size="sm" full={false} onPress={() => setEditing(true)} />
              </View>
            )}
          </Card>

          <RecoveryEmail nested />

          <Button title="Sign out" variant="secondary" onPress={signOut} style={{ marginTop: space.xl }} />

          {!confirmingDelete ? (
            <Button
              title="Delete account"
              variant="destructive"
              onPress={() => { setConfirmingDelete(true); setDeleteDraft(''); }}
              style={{ marginTop: space.md }}
            />
          ) : (
            <Card style={{ marginTop: space.md }} accent={colors.danger}>
              <Text style={[type.heading, { color: colors.danger, marginBottom: space.sm }]}>Delete this account?</Text>
              <Text style={[type.bodySm, { color: colors.textMuted, lineHeight: 19 }]}>
                This permanently removes your runs and territories. It cannot be undone. Type{' '}
                <Text style={type.bodySmBold}>{user?.username}</Text> to confirm.
              </Text>
              <Input
                value={deleteDraft}
                onChangeText={setDeleteDraft}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={user?.username}
                placeholderTextColor={colors.textDim}
                style={styles.input}
                accessibilityLabel="Type your username to confirm deletion"
              />
              <View style={styles.btnRow}>
                <Button title="Cancel" variant="secondary" size="sm" full={false} onPress={() => setConfirmingDelete(false)} />
                <Button title="Delete forever" variant="destructive" size="sm" full={false} disabled={!deleteMatches} loading={deleting} onPress={doDelete} />
              </View>
            </Card>
          )}

          <Text
            style={[type.bodyMedium, styles.link]}
            onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})}
            accessibilityRole="link"
          >
            Privacy Policy
          </Text>
          <Text
            style={[type.bodyMedium, styles.link]}
            onPress={() => Linking.openURL(SUPPORT_URL).catch(() => {})}
            accessibilityRole="link"
          >
            Support
          </Text>
          <Text style={styles.legal}>Pixel effects by Will Tice</Text>
          <Text style={[styles.legal, { marginTop: space.xs }]}>Additional VFX by Pixel VFX Studio, RiaKare and Luis Zuno</Text>
          <Text style={[styles.legal, { marginTop: space.xs }]}>Pixel landscapes by CraftPix.net</Text>
        </AccordionSection>
      </View>

      <Text style={[styles.legal, { marginTop: space.xl }]}>PASER v{Constants.expoConfig?.version || '2.0.0'}</Text>
    </Screen>
  );
}

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.xl,
  },
  list: { gap: space.md },
  innerHeading: { marginTop: space.md, marginBottom: space.md },
  groupHeading: { marginTop: space.xl, marginBottom: space.md },
  settingCopy: { marginTop: 2, marginBottom: space.md },
  toggleRowInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: {
    ...type.body,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    marginVertical: space.sm,
    ...nbField(scheme, { on: colors.bgElevated }),
  },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
  swatchItem: { alignItems: 'center', gap: 6, width: 56 },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  swatchSelected: { borderWidth: 3, borderColor: colors.text, transform: [{ scale: 1.12 }] },
  swatchLock: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.sm },
  link: {
    color: colors.textMuted,
    textDecorationLine: 'underline',
    textAlign: 'center',
    marginTop: space.xl,
  },
  legal: { ...type.caption, color: colors.textDim, marginTop: space.md, textAlign: 'center' },
});
