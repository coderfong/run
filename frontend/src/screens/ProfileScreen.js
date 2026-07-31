// You — profile + your stats. Header, stat wall, recent runs, and settings.
// Trophy shelf (PRs + badges) and tap-through run detail arrive in Phase 6.

import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';

import { Award, Flame, Medal, Trophy } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useClan } from '../state/clan';
import { useAvatar } from '../state/avatar';
import { useSettings, TRAIL_GLOW_COLORS } from '../state/settings';
import { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import StreakCalendar from '../components/StreakCalendar';
import RivalCard from '../components/RivalCard';
import { PressableScale, Reveal, haptic } from '../ui/motion';
import { getHealthEnabled, setHealthEnabled, requestHealthPermission } from '../health';
import { brand, radius, space, withAlpha, useTheme, useThemedType, useThemedStyles } from '../theme';
import { art } from '../config/onboardingArt';
import { Screen, Card, Row, Button, StatValue, SectionHeader, Pill, Skeleton } from '../components/ui';
import ThemeToggle from '../components/ThemeToggle';
import EnergyMeter from '../components/EnergyMeter';
import BuyEnergySheet from '../components/BuyEnergySheet';
import { toast } from '../ui/toast';

// Trophy shelf — derived from live stats; earned trophies glow in the accent.
const TROPHIES = [
  { key: 'first_claim', label: 'First claim', icon: Flame, earned: (s) => (s.territory_count || 0) >= 1 },
  { key: 'big_claim', label: '0.5 km² claim', icon: Trophy, earned: (s) => (s.biggest_claim_m2 || 0) >= 500000 },
  { key: 'ten_zones', label: '10 zones', icon: Medal, earned: (s) => (s.territory_count || 0) >= 10 },
  { key: 'streak7', label: '7-day streak', icon: Award, earned: (s) => (s.current_streak_days || 0) >= 7 },
];

const NOTIF_ROWS = [
  ['stolen', 'Land under attack'],
  ['captured', 'Land you capture'],
  ['clan_goal', 'Club weekly goal'],
  ['kudos', 'Kudos received'],
  ['pasers', 'Paser requests'],
  ['season', 'Season & promotion'],
  ['recap', 'Weekly recap'],
];

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
// Hosted on the repurposed bido-frontend site (Next.js /privacy route).
// www resolves cleanly over HTTPS (the apex has a cert quirk).
const PRIVACY_POLICY_URL = 'https://www.bido.live/privacy';

const km = (m) => (m / 1000).toFixed(1);
const km2 = (m2) => (m2 / 1e6).toFixed(2);

function StatTile({ label, value, unit, accent }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Card style={styles.tile} padded>
      <StatValue size="md" label={label} value={value} unit={unit} color={accent} />
    </Card>
  );
}

export default function ProfileScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { user, signOut, updateUsername, deleteAccount } = useAuth();
  const { color, clan } = useClan();
  const { equipped } = useAvatar();
  const { trailGlow, setTrailGlow } = useSettings();
  const accent = color.stroke;

  const [stats, setStats] = useState(null);
  const [runs, setRuns] = useState(null);
  const [runDays, setRunDays] = useState([]);
  const [prefs, setPrefs] = useState(null);
  const [healthOn, setHealthOn] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user?.username || '');
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteDraft, setDeleteDraft] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [energy, setEnergy] = useState(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [paserInfo, setPaserInfo] = useState(null);

  const loadEnergy = () => { api.energyStatus().then(setEnergy).catch(() => {}); };

  const [rivals, setRivals] = useState(null);

  // On focus, not mount: the badge has to settle after you answer a request
  // over on the Pasers screen and come back. Rivalries move while you're
  // away too — someone can take your land at any time.
  useFocusEffect(
    useCallback(() => {
      api.pasers().then(setPaserInfo).catch(() => {});
      api.rivals(3).then((d) => setRivals(d.rivals || [])).catch(() => setRivals([]));
    }, [])
  );

  useEffect(() => {
    api.meStats().then(setStats).catch(() => setStats({}));
    api.meRuns().then(setRuns).catch(() => setRuns([]));
    api.runDays().then((d) => setRunDays(d.days || [])).catch(() => setRunDays([]));
    api.getNotifPrefs().then(setPrefs).catch(() => setPrefs(null));
    api.energyStatus().then(setEnergy).catch(() => {});
    getHealthEnabled().then(setHealthOn);
  }, []);

  const togglePref = async (key) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try { await api.setNotifPrefs(next); } catch { setPrefs(prefs); }
  };

  const toggleHealth = async () => {
    const next = !healthOn;
    setHealthOn(next);
    await setHealthEnabled(next);
    if (next) requestHealthPermission();
  };

  const saveUsername = async () => {
    const u = draft.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) return toast.error('Username: 3-32 chars (a-z, 0-9, _).');
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

  const deleteMatches = deleteDraft.trim().toLowerCase() === user?.username;
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
      {/* header — profile picture is a head-and-shoulders bust, sitting on a
          roadside scene band (the banner art leaves its centre clear for it) */}
      <Reveal style={styles.header}>
        {art('profileBanner') && (
          <Image
            source={art('profileBanner')}
            style={styles.banner}
            resizeMode="cover"
            fadeDuration={0}
            pointerEvents="none"
          />
        )}
        <PressableScale
          onPress={() => navigation.navigate('AvatarStudio')}
          accessibilityRole="button"
          accessibilityLabel="Your runner — tap to customize"
        >
          {/* Bust must FILL the border's hole (both 104) and sit on an opaque
              disc — at 96 with a translucent backdrop, the banner behind it
              showed through the 8px gap. Same pairing as ProgressionScreen. */}
          {/* Border comes from RANK (territorial standing), not level. */}
          <PortraitBorder borderKey={stats?.rank_key || 'wood'} size={104}>
            <CharacterBust equipped={equipped} size={104} bg={colors.cardAlt} />
          </PortraitBorder>
        </PressableScale>
        <Text style={[type.title, { marginTop: space.md }]}>{user?.username}</Text>
        <Pill label={clan?.tag ? `[${clan.tag}]` : 'Solo'} color={accent} dot style={{ marginTop: space.sm }} />
        {/* level + XP bar — taps through to the reward ladder. Sits directly
            under the name so progress reads before the actions. */}
        {stats && (
          <PressableScale
            style={styles.xpWrap}
            onPress={() => navigation.navigate('Progression')}
            accessibilityRole="button"
            accessibilityLabel="View levels and rewards"
          >
            <View style={[styles.levelBadge, { borderColor: accent }]}>
              <Text style={[type.statSm, { color: accent }]}>{stats.level ?? 0}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.xpTrack}>
                <View
                  style={[
                    styles.xpFill,
                    {
                      backgroundColor: accent,
                      width: `${Math.min(100, ((stats.xp || 0) / Math.max(1, stats.next_level_xp || 100)) * 100)}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[type.caption, { marginTop: 4 }]}>
                {(stats.xp || 0).toLocaleString()} / {(stats.next_level_xp || 100).toLocaleString()} XP · Levels & rewards →
              </Text>
            </View>
          </PressableScale>
        )}

        {/* the two runner actions sit as a pair; the badge on Add pasers is
            requests waiting on you */}
        <Row gap={8} style={{ marginTop: space.md }}>
          <Button
            title="Customize runner"
            variant="secondary"
            size="sm"
            full={false}
            icon={<AppIcon name="customize" size={18} />}
            onPress={() => navigation.navigate('AvatarStudio')}
          />
          <View>
            <Button
              title="Add pasers"
              variant="secondary"
              size="sm"
              full={false}
              icon={<AppIcon name="invite" size={18} />}
              onPress={() => navigation.navigate('Pasers')}
            />
            {paserInfo?.incoming?.length ? (
              <View style={[styles.badge, { backgroundColor: brand.pink, borderColor: colors.bg }]} pointerEvents="none">
                <Text style={[type.captionMedium, { color: '#fff' }]}>{paserInfo.incoming.length}</Text>
              </View>
            ) : null}
          </View>
        </Row>

        {/* claim energy — tap to refill */}
        {energy && (
          <EnergyMeter
            status={energy}
            onPress={() => setShopOpen(true)}
            style={{ alignSelf: 'stretch', marginTop: space.md }}
          />
        )}

      </Reveal>

      {/* stat wall */}
      <Reveal delay={90} style={styles.wall}>
        {!stats ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width="31%" height={80} style={{ borderRadius: 16, marginBottom: space.md }} />
          ))
        ) : (
          <>
            <StatTile label="Area held" value={km2(stats.total_area_m2 || 0)} unit="km²" accent={accent} />
            <StatTile label="Distance" value={km(stats.career_distance_m || 0)} unit="km" />
            <StatTile label="Runs" value={String(stats.runs_count || 0)} />
            <StatTile label="Biggest claim" value={km2(stats.biggest_claim_m2 || 0)} unit="km²" accent={accent} />
            <StatTile label="Streak" value={String(stats.current_streak_weeks || 0)} unit="wk" />
            <StatTile label="Zones" value={String(stats.territory_count || 0)} />
          </>
        )}
      </Reveal>

      {/* Rivals — the newest beat, with every rivalry a tap away. The header
          shows even at zero: rivalries only start accruing once someone takes
          your land, and hiding the row entirely meant a new player had no way
          to reach the Rivals page at all. */}
      {rivals && !rivals.length ? (
        <Reveal delay={120}>
          <SectionHeader
            title="Rivals"
            action="See all"
            onAction={() => navigation.navigate('Rivals')}
            style={{ marginTop: space.xl, marginBottom: space.md }}
          />
          <TouchableOpacity
            onPress={() => navigation.navigate('Rivals')}
            accessibilityRole="button"
            accessibilityLabel="Rivals — none yet"
          >
            <Card padded>
              <Text style={[type.bodySm, { color: colors.textMuted, textAlign: 'center' }]}>
                No rivals yet. Claim ground someone else wants and you’ll get one.
              </Text>
            </Card>
          </TouchableOpacity>
        </Reveal>
      ) : null}
      {rivals?.length ? (
        <Reveal delay={120}>
          <SectionHeader
            title="Rivals"
            action={rivals.length > 1 ? `See all ${rivals.length}` : 'See all'}
            onAction={() => navigation.navigate('Rivals')}
            style={{ marginTop: space.xl, marginBottom: space.md }}
          />
          <RivalCard
            rival={rivals[0]}
            myAvatar={equipped}
            compact
            onPress={() => navigation.navigate('Rivals')}
            onTakeBack={() => navigation.navigate('Record')}
            onViewLand={
              rivals[0].last_event?.lat != null
                ? () =>
                    navigation.navigate('Map', {
                      screen: 'MapMain',
                      params: {
                        focus: { lat: rivals[0].last_event.lat, lon: rivals[0].last_event.lon },
                      },
                    })
                : undefined
            }
          />
        </Reveal>
      ) : null}

      {/* running streak calendar */}
      <Reveal delay={150}>
      <SectionHeader
        title="Running streak"
        action={(stats?.current_streak_days || 0) >= 2 ? `${stats.current_streak_days}-day streak 🔥` : undefined}
        style={{ marginTop: space.xl, marginBottom: space.md }}
      />
      <Card>
        <StreakCalendar runDays={runDays} accent={accent} />
      </Card>
      </Reveal>

      {/* trophies */}
      <Reveal delay={180}>
      <SectionHeader title="Trophies" style={{ marginTop: space.xl, marginBottom: space.md }} />
      <View style={styles.trophyRow}>
        {TROPHIES.map(({ key, label, icon: Icon, earned }) => {
          const got = stats ? earned(stats) : false;
          return (
            <View key={key} style={[styles.trophy, got && { backgroundColor: withAlpha(accent, 0.12) }]}>
              <Icon size={24} color={got ? accent : colors.textDim} strokeWidth={2} />
              <Text style={[type.caption, { marginTop: 6, textAlign: 'center', color: got ? colors.text : colors.textDim }]}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>
      </Reveal>

      {/* recent runs */}
      <SectionHeader title="Recent runs" style={{ marginTop: space.xl, marginBottom: space.md }} />
      <Card padded={false}>
        {!runs ? (
          <View style={{ padding: space.lg }}>
            <Skeleton width="100%" height={16} />
          </View>
        ) : runs.length === 0 ? (
          <Text style={[type.caption, { padding: space.lg }]}>No runs yet.</Text>
        ) : (
          runs.slice(0, 8).map((r, i) => (
            <TouchableOpacity
              key={r.run_id}
              style={[styles.runRow, i > 0 && styles.runDivider]}
              onPress={() => navigation.navigate('RunDetail', { runId: r.run_id })}
              accessibilityRole="button"
              accessibilityLabel="Open run detail"
            >
              <View style={{ flex: 1 }}>
                <Text style={type.bodyBold}>{new Date(r.created_at).toLocaleDateString()}</Text>
                <Text style={type.caption}>
                  {km(r.distance_m)} km · {r.closed_loop ? `${km2(r.area_m2)} km² claimed` : 'not claimed'}
                </Text>
              </View>
              {r.closed_loop && <View style={[styles.claimDot, { backgroundColor: accent }]} />}
            </TouchableOpacity>
          ))
        )}
      </Card>

      {/* settings */}
      <SectionHeader title="Settings" style={{ marginTop: space.xl, marginBottom: space.md }} />
      <Card>
        <Text style={type.labelSm}>Username</Text>
        {editing ? (
          <>
            <TextInput
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

      {/* trail glow colour — how your live route lights up on the run map */}
      <Card style={{ marginTop: space.md }}>
        <Text style={type.labelSm}>Trail glow</Text>
        <Text style={[type.caption, { marginTop: 2 }]}>
          The colour your route glows while you run. Club follows your club colour.
        </Text>
        <View style={styles.swatchRow}>
          {TRAIL_GLOW_COLORS.map(({ key, label, value }) => {
            const swatch = value || accent;
            const selected = trailGlow === key;
            return (
              <PressableScale
                key={key}
                onPress={() => { haptic.light(); setTrailGlow(key); }}
                accessibilityRole="button"
                accessibilityLabel={`Trail glow ${label}`}
                accessibilityState={{ selected }}
                style={styles.swatchItem}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: swatch, shadowColor: swatch },
                    selected && styles.swatchSelected,
                  ]}
                />
                <Text style={[type.caption, { color: selected ? colors.text : colors.textDim }]}>{label}</Text>
              </PressableScale>
            );
          })}
        </View>
      </Card>

      {/* appearance */}
      <SectionHeader title="Appearance" style={{ marginTop: space.xl, marginBottom: space.md }} />
      <Card>
        <Text style={type.labelSm}>Theme</Text>
        <Text style={[type.caption, { marginTop: 2, marginBottom: space.md }]}>
          Follow your device, or force light or dark.
        </Text>
        <ThemeToggle />
      </Card>

      {/* notifications */}
      <SectionHeader title="Notifications" style={{ marginTop: space.xl, marginBottom: space.md }} />
      <Card padded={false}>
        {NOTIF_ROWS.map(([key, label], i) => (
          <View key={key} style={[styles.toggleRow, i > 0 && styles.runDivider]}>
            <Text style={type.body}>{label}</Text>
            <Switch
              value={prefs ? !!prefs[key] : true}
              onValueChange={() => prefs && togglePref(key)}
              trackColor={{ true: accent }}
              disabled={!prefs}
            />
          </View>
        ))}
      </Card>

      {/* health sync */}
      <SectionHeader title="Health" style={{ marginTop: space.xl, marginBottom: space.md }} />
      <Card>
        <View style={styles.toggleRowInner}>
          <View style={{ flex: 1, paddingRight: space.md }}>
            <Text style={type.body}>Sync runs to Health</Text>
            <Text style={type.caption}>Write each finished run to Apple Health / Health Connect. We never read your health data.</Text>
          </View>
          <Switch value={healthOn} onValueChange={toggleHealth} trackColor={{ true: accent }} />
        </View>
      </Card>

      <Button title="Sign out" variant="secondary" onPress={signOut} style={{ marginTop: space.xl }} />

      {!confirmingDelete ? (
        <Button
          title="Delete account"
          variant="destructive"
          onPress={() => { setConfirmingDelete(true); setDeleteDraft(''); }}
          style={{ marginTop: space.md, backgroundColor: colors.dangerSoft }}
        />
      ) : (
        <Card style={{ marginTop: space.md, borderWidth: 1, borderColor: '#f5c2c2' }}>
          <Text style={[type.heading, { color: colors.danger, marginBottom: space.sm }]}>Delete this account?</Text>
          <Text style={[type.bodySm, { color: colors.textMuted, lineHeight: 19 }]}>
            This permanently removes your runs and territories. It cannot be undone. Type{' '}
            <Text style={[type.bodySmBold]}>{user?.username}</Text> to confirm.
          </Text>
          <TextInput
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

      <TouchableOpacity style={styles.link} onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})} accessibilityRole="link" accessibilityLabel="Privacy policy">
        <Text style={[type.bodyMedium, { color: colors.textMuted, textDecorationLine: 'underline' }]}>Privacy Policy</Text>
      </TouchableOpacity>
      <Text style={styles.legal}>PASER v{Constants.expoConfig?.version || '2.0.0'}</Text>
      <BuyEnergySheet visible={shopOpen} onClose={() => setShopOpen(false)} onPurchased={loadEnergy} />
    </Screen>
  );
}

const makeStyles = (colors, _scheme, type) => StyleSheet.create({
  header: { alignItems: 'center', marginTop: space.md, marginBottom: space.xl, paddingTop: space.lg },
  // Scene band behind the bust: wider than the content box so it bleeds to the
  // screen edges, and anchored to the top so the runner stands on the path.
  // Tall enough that the bust + its border ring sit INSIDE the scene rather
  // than hanging off the bottom edge of it.
  // aspectRatio (not a fixed height) so the band matches the art's own 1400x600
  // and `cover` has nothing left to crop — the full scene shows.
  banner: {
    position: 'absolute', top: 0, left: -space.gutter, right: -space.gutter,
    aspectRatio: 1400 / 600, borderRadius: radius.card,
  },

  wall: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: { width: '31.5%', marginBottom: space.md },

  xpWrap: { flexDirection: 'row', alignItems: 'center', gap: space.md, alignSelf: 'stretch', marginTop: space.lg },
  // sits over the top-right corner of the Add pasers button
  badge: {
    position: 'absolute',
    top: -7,
    right: -7,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  xpTrack: { height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: 'hidden' },
  xpFill: { height: '100%', borderRadius: 4 },

  trophyRow: { flexDirection: 'row', gap: space.sm },
  trophy: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    paddingVertical: space.md,
    alignItems: 'center',
  },

  runRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  runDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  claimDot: { width: 8, height: 8, borderRadius: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  toggleRowInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  input: {
    ...type.body,
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    marginVertical: space.sm,
  },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm },
  swatchRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.md },
  swatchItem: { alignItems: 'center', gap: 6 },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  swatchSelected: { borderWidth: 3, borderColor: colors.text, transform: [{ scale: 1.12 }] },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.sm },

  link: { marginTop: space.xl, alignItems: 'center' },
  legal: { ...type.caption, color: colors.textDim, marginTop: space.md, textAlign: 'center' },
});
