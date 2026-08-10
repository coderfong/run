// You — profile + your stats. Header, stat wall, recent runs, and settings.
// Trophy shelf (PRs + badges) and tap-through run detail arrive in Phase 6.

import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';

import { Award, ChevronRight, Flame, Medal, Trophy } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';
import { Image } from '../ui/image';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../auth/AuthContext';
import { useClan } from '../state/clan';
import { useAvatar } from '../state/avatar';
import { useSettings, TRAIL_GLOW_COLORS } from '../state/settings';
import { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import SceneBackdrop, { useSceneBackdrop } from '../components/SceneBackdrop';
import StreakCalendar from '../components/StreakCalendar';
import PrivacySettings from '../components/PrivacySettings';
import RecoveryEmail from '../components/RecoveryEmail';
import RivalCard from '../components/RivalCard';
import { Bar, PressableScale, Reveal, haptic } from '../ui/motion';
import { getHealthEnabled, setHealthEnabled, requestHealthPermission } from '../health';
import { brand, radius, space, toon, withAlpha, useTheme, useThemedType, useThemedStyles } from '../theme';
import { levelBandColor } from '../config/progression';
import { COPY as PASERBY_COPY } from '../config/paserby';
import { Screen, Card, Row, Button, StatValue, SectionHeader, Skeleton, OutlinedText } from '../components/ui';
import ThemeToggle from '../components/ThemeToggle';
import EnergyMeter from '../components/EnergyMeter';
import BuyEnergySheet from '../components/BuyEnergySheet';
import BuyPassSheet from '../components/BuyPassSheet';
import { art } from '../config/onboardingArt';
import GameAnimation from '../components/GameAnimation';
import { toast } from '../ui/toast';
import { itemPreviewSources } from '../config/cosmetics';
import { preloadImages } from '../utils/imagePreload';
import { preloadScreenImagesAfterInteractions } from '../config/screenAssets';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';

// Trophy shelf — derived from live stats; earned trophies glow in the accent.
const TROPHIES = [
  { key: 'first_claim', label: 'First claim', icon: Flame, earned: (s) => (s.territory_count || 0) >= 1 },
  { key: 'big_claim', label: '0.5 km² claim', icon: Trophy, earned: (s) => (s.biggest_claim_m2 || 0) >= 500000 },
  { key: 'ten_zones', label: '10 zones', icon: Medal, earned: (s) => (s.territory_count || 0) >= 10 },
  { key: 'streak7', label: 'Week streak', icon: Award, earned: (s) => (s.current_streak_days || 0) >= 7 },
];

const NOTIF_ROWS = [
  ['stolen', 'Land under attack'],
  ['captured', 'Land you capture'],
  ['clan_goal', 'Club weekly goal'],
  ['kudos', 'Kudos received'],
  ['pasers', 'Paser requests'],
  ['paserby', 'Crossed paths & high fives'],
  ['season', 'Season & promotion'],
  ['recap', 'Weekly recap'],
];

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
// Hosted on the repurposed bido-frontend site (Next.js /privacy route).
// www resolves cleanly over HTTPS (the apex has a cert quirk).
const PRIVACY_POLICY_URL = 'https://www.bido.live/privacy';

// The PRO gold, shared with the first-run step's wordmark and the pass's own
// gold track, so the three places it is sold read as one thing.
const GOLD = '#F5C451';

const km = (m) => (m / 1000).toFixed(1);
const km2 = (m2) => (m2 / 1e6).toFixed(2);
// The same formatter as a worklet, for the one tile that counts up: the
// count-up formats each frame on the UI thread and can't call back into JS.
const km2Worklet = (m2) => {
  'worklet';
  return (m2 / 1e6).toFixed(2);
};

function StatTile({ label, value, unit, accent, countTo, format }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Card style={styles.tile} padded>
      <StatValue
        size="md"
        label={label}
        value={value}
        unit={unit}
        color={accent}
        countTo={countTo}
        format={format}
      />
    </Card>
  );
}

export default function ProfileScreen({ navigation }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { user, signOut, updateUsername, deleteAccount } = useAuth();
  const { color } = useClan();
  const { equipped } = useAvatar();
  const { trailGlow, setTrailGlow } = useSettings();
  const accent = color.stroke;

  // The scene behind the runner — daytime kerb in light mode, lamp-lit night
  // street in dark. SceneBackdrop sizes itself to whichever art is showing and
  // to the window rather than to this header, so the whole scene is visible in
  // both themes; the header only needs the height to reserve room for it.
  const { height: sceneH } = useSceneBackdrop({ variant: 'profile' });

  // The name and its level badge sit at the very bottom of the header, and the
  // portrait frame above them is taller than the art's own shape — so the badge
  // hung off the bottom edge of the scene. Measuring the name row and growing
  // the scene to clear it keeps the whole header ON the scene at any window
  // width, portrait tier or text size; `bleed` adds the height as more road
  // rather than cropping into the trees.
  const [nameBottom, setNameBottom] = useState(0);
  const headerH = Math.max(sceneH, nameBottom ? nameBottom + space.sm : 0);

  // Everything the page shows is served from the cache on the first render and
  // corrected behind it, so returning to You never rebuilds itself from six
  // grey tiles. `loading` stays true only until the very first successful
  // fetch on a fresh install.
  const { data: stats } = useQuery('me:stats', api.meStats, { fallback: {} });
  const { data: runs } = useQuery('me:runs', api.meRuns, { fallback: [] });
  const { data: runDays } = useQuery('me:run-days', api.runDays, {
    fallback: { days: [] },
    select: (d) => d.days || [],
  });
  const { data: prefs, setData: setPrefs } = useQuery('me:notif-prefs', api.getNotifPrefs);
  const { data: energy, refresh: reloadEnergy } = useQuery('me:energy', api.energyStatus);
  const { data: paserInfo } = useQuery('pasers', api.pasers);
  // Shares the 'me:paserby' key with Home's Crossroads badge, so the switch is
  // drawn from cache on the first render and both stay in step.
  const { data: paserby, setData: setPaserby } = useQuery('me:paserby', api.paserby, {
    fallback: { enabled: true, unseen: 0, total: 0 },
  });
  // Shares the pass screen's cache key: the PRO card is decided on the first
  // render rather than popping in, and it goes away on both pages the moment
  // the pass is bought on either of them.
  const { data: progression, refresh: reloadProgression } = useQuery('me:progression', api.progression);
  const { data: rivals } = useQuery('me:rivals:3', () => api.rivals(3), {
    fallback: { rivals: [] },
    select: (d) => d.rivals || [],
  });

  const [healthOn, setHealthOn] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user?.username || '');
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteDraft, setDeleteDraft] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [passOpen, setPassOpen] = useState(false);

  useEffect(() => {
    // You is pre-mounted behind Home, making this idle time ideal for the
    // first customisation category and the screens linked from this profile.
    preloadImages(itemPreviewSources('hair', {
      hairColor: scheme === 'dark' ? 4 : 0,
    }));
    return preloadScreenImagesAfterInteractions([
      'AvatarStudio',
      'Progression',
      'Pasers',
      'Rivals',
      'Crossroads',
    ]);
  }, [scheme]);

  // The paser badge and the rivals row refresh on focus (useQuery does that for
  // every query on this page): the badge has to settle after you answer a
  // request over on the Pasers screen and come back, and rivalries move while
  // you're away — someone can take your land at any time.
  //
  // Warming the rivals' avatar layers happens once their cards are already on
  // screen, never in front of them.
  useEffect(() => {
    if (rivals?.length) preloadRunnerAssets(rivals);
  }, [rivals]);

  useEffect(() => {
    getHealthEnabled().then(setHealthOn);
  }, []);

  const togglePref = async (key) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try { await api.setNotifPrefs(next); } catch { setPrefs(prefs); }
  };

  const togglePaserby = async () => {
    const next = !(paserby?.enabled !== false);
    setPaserby({ ...(paserby || {}), enabled: next });
    try {
      const out = await api.setPaserby(next);
      setPaserby(out);
    } catch {
      setPaserby({ ...(paserby || {}), enabled: !next });
      toast.error('Could not change that setting');
    }
  };

  const toggleHealth = async () => {
    const next = !healthOn;
    setHealthOn(next);
    await setHealthEnabled(next);
    if (next) requestHealthPermission();
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

  // Drives the medal beside the Trophies heading — it replays when the count
  // moves, so earning one is the thing that makes it spin.
  const earnedTrophies = stats ? TROPHIES.filter(({ earned }) => earned(stats)).length : 0;

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
      {/* header — profile picture is a head-and-shoulders bust, sitting on the
          roadside scene (the art leaves its centre clear for it). The header
          reserves the scene's full height so the stat wall below starts clear
          of it instead of floating over the road. */}
      <Reveal style={[styles.header, { minHeight: headerH }]}>
        <SceneBackdrop variant="profile" minHeight={headerH} bleed />
        <PressableScale
          onPress={() => navigation.navigate('AvatarStudio')}
          accessibilityRole="button"
          accessibilityLabel="Your runner, tap to customize"
        >
          {/* Bust must FILL the border's hole (both 104) and sit on an opaque
              disc — at 96 with a translucent backdrop, the banner behind it
              showed through the 8px gap. Same pairing as ProgressionScreen. */}
          {/* Border comes from RANK (territorial standing), not level. */}
          <PortraitBorder borderKey={stats?.rank_key || 'wood'} size={104}>
            <CharacterBust equipped={equipped} size={104} bg={colors.cardAlt} />
          </PortraitBorder>
        </PressableScale>
        {/* The name sits ON the scene, not on the page background, so it takes
            the game treatment — white with an ink outline — instead of the
            palette's body colour. Themed text went dark-on-cream in light mode
            and got lost in the hedge the moment it wrapped past the art. */}
        {/* Name and level on one line — the level in the clan accent so it
            reads as the headline stat rather than a second row of chrome. */}
        <Row
          gap={space.sm}
          style={styles.nameRow}
          onLayout={(e) => {
            const { y, height } = e.nativeEvent.layout;
            setNameBottom(y + height);
          }}
        >
          <OutlinedText style={[type.title, { color: '#fff' }]} outline={toon.ink} width={2.5}>
            {user?.username}
          </OutlinedText>
          {stats && (
            <View style={[styles.levelBadge, { backgroundColor: levelBandColor(stats.level ?? 0) }]}>
              <OutlinedText style={[type.statSm, { color: '#fff' }]} outline={toon.ink} width={1.5}>
                {String(stats.level ?? 0)}
              </OutlinedText>
            </View>
          )}
        </Row>
        {/* level + XP bar — taps through to the reward ladder. Sits directly
            under the name so progress reads before the actions. */}
        {stats && (
          <PressableScale
            style={styles.xpWrap}
            onPress={() => navigation.navigate('Progression')}
            accessibilityRole="button"
            accessibilityLabel="View levels and rewards"
          >
            <View style={{ flex: 1 }}>
              <Bar
                pct={(stats.xp || 0) / Math.max(1, stats.next_level_xp || 100)}
                trackStyle={styles.xpTrack}
                fillStyle={[styles.xpFill, { backgroundColor: accent }]}
              />
              <Text style={[type.caption, { marginTop: 4 }]}>
                {(stats.xp || 0).toLocaleString()} / {(stats.next_level_xp || 100).toLocaleString()} XP · Levels & rewards →
              </Text>
            </View>
          </PressableScale>
        )}

        {/* the two runner actions sit as a pair; the badge on Add pasers is
            requests waiting on you */}
        <Row gap={space.sm} style={styles.actions}>
          <Button
            title="Customize runner"
            variant="secondary"
            size="sm"
            full={false}
            icon={<AppIcon name="customize" size={ACTION_ICON} />}
            onPress={() => navigation.navigate('AvatarStudio')}
          />
          <View>
            <Button
              title="Add pasers"
              variant="secondary"
              size="sm"
              full={false}
              icon={<AppIcon name="invite" size={ACTION_ICON} />}
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
            style={{ alignSelf: 'stretch', marginTop: space.lg }}
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
            {/* One counting number per screen (see theme/motion). Area held is
                the headline — it is the thing the whole game is about — so it
                counts and the other five arrive settled. */}
            <StatTile
              label="Area held"
              value={km2(stats.total_area_m2 || 0)}
              countTo={stats.total_area_m2 || 0}
              format={km2Worklet}
              unit="km²"
              accent={accent}
            />
            <StatTile label="Distance" value={km(stats.career_distance_m || 0)} unit="km" />
            <StatTile label="Runs" value={String(stats.runs_count || 0)} />
            <StatTile label="Biggest claim" value={km2(stats.biggest_claim_m2 || 0)} unit="km²" accent={accent} />
            <StatTile label="Streak" value={String(stats.current_streak_weeks || 0)} unit="wk" />
            <StatTile label="Zones" value={String(stats.territory_count || 0)} />
          </>
        )}
      </Reveal>

      {/* PASER PRO — shown only to non holders, and it is a POSTER: the crew,
          the wordmark, one line. The banner art is painted with its right half
          full of runners and its left half empty stage, so the copy sits in
          the dark on the left with nothing behind it. Everything about what
          PRO actually gives you is a tap away on the pass; a card on You that
          listed it was three paragraphs nobody read. */}
      {progression && !progression.premium_active ? (
        <Reveal delay={110}>
          <PressableScale
            style={styles.proCard}
            onPress={() => { haptic.light(); setPassOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel="Paser Pro. Twice the rewards, one payment. Tap to unlock"
          >
            {/* Explicit 100%/100% rather than absoluteFill: that registered
                style carries no width or height, and an Image handed one has
                been seen falling back to its intrinsic size (see the same
                note in onboarding/ui.js). */}
            <Image
              source={art('proBanner')}
              style={styles.proArt}
              resizeMode="cover"
              accessible={false}
            />
            <View style={styles.proCopy}>
              <OutlinedText
                style={[type.title, { color: GOLD }]}
                outline={toon.ink}
                width={2}
                align="left"
                containerStyle={{ alignSelf: 'flex-start' }}
              >
                PASER PRO
              </OutlinedText>
              <Text style={[type.bodySm, { color: 'rgba(255,255,255,0.78)', marginTop: 2 }]}>
                Twice the rewards.
              </Text>
              <Row gap={2} style={styles.proCta}>
                <Text style={[type.captionMedium, { color: GOLD }]}>Unlock</Text>
                <ChevronRight size={14} color={GOLD} strokeWidth={3} />
              </Row>
            </View>
          </PressableScale>
        </Reveal>
      ) : null}

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
            accessibilityLabel="Rivals, none yet"
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
        action={(stats?.current_streak_days || 0) >= 2 ? `${stats.current_streak_days} day streak 🔥` : undefined}
        style={{ marginTop: space.xl, marginBottom: space.md }}
      />
      <Card>
        <StreakCalendar runDays={runDays || []} accent={accent} />
      </Card>
      </Reveal>

      {/* trophies. The medal rides BESIDE the heading — as its own centred
          block it was 88pt of mostly-empty air between the title and the
          shelf, which read as a gap in the page rather than as a flourish.
          It replays whenever the count of earned trophies changes. */}
      <Reveal delay={180}>
      <SectionHeader
        title="Trophies"
        accessory={
          earnedTrophies ? (
            <GameAnimation name="medal" size={TROPHY_MEDAL} trigger={earnedTrophies} />
          ) : null
        }
        style={{ marginTop: space.xl, marginBottom: space.md }}
      />
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

      {/* crossed paths — the PASERBY switch. It lives in Settings as well as
          on the Crossroads screen itself: somebody looking for the way out
          looks here first. Turning it off stops new encounters being made AND
          deletes the trace samples the matcher would have used. */}
      <SectionHeader title="Crossed paths" style={{ marginTop: space.xl, marginBottom: space.md }} />
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
            title={`Crossroads · ${paserby.total}`}
            variant="secondary"
            size="sm"
            full={false}
            onPress={() => navigation.navigate('Crossroads')}
            style={{ marginTop: space.md, alignSelf: 'flex-start' }}
          />
        ) : null}
      </Card>

      {/* the way back in if the password goes. Sits above privacy rather than
          down by Sign out because an account with no recovery email is a
          problem to fix, not a preference to browse. */}
      <RecoveryEmail />

      {/* route privacy — what other people see of your runs */}
      <PrivacySettings />

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
      <BuyEnergySheet visible={shopOpen} onClose={() => setShopOpen(false)} onPurchased={reloadEnergy} />
      <BuyPassSheet visible={passOpen} onClose={() => setPassOpen(false)} onPurchased={reloadProgression} />
    </Screen>
  );
}

// How far the unread-requests badge hangs off the top of its button.
const BADGE_OVERHANG = 7;
// Sized to the heading it sits next to, not to the section — a medal taller
// than "Trophies" is the block this used to be, just moved sideways.
const TROPHY_MEDAL = 32;
// Up from 18: at that size the glyph inside a 44pt button read as a bullet
// point beside the label rather than as an icon.
const ACTION_ICON = 22;

const makeStyles = (colors, _scheme, type) => StyleSheet.create({
  nameRow: { alignItems: 'center', justifyContent: 'center', marginTop: space.md },
  // The header now ends at the scene's bottom edge rather than at the name, so
  // its old `xl` bottom margin read as a hole between the art and the runner
  // actions — `md` closes it up without letting the buttons touch the road.
  header: { alignItems: 'center', marginTop: space.md, marginBottom: space.md, paddingTop: space.lg },

  wall: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: { width: '31.5%', marginBottom: space.md },

  xpWrap: { flexDirection: 'row', alignItems: 'center', gap: space.md, alignSelf: 'stretch', marginTop: space.lg },
  // Customize runner / Add pasers sit close under the XP bar: they are what you
  // do with the runner above them, so the pair reads as part of that block
  // rather than as its own section. `sm` is measured from the BADGE, which
  // hangs BADGE_OVERHANG above the button it rides on — the gap you see is the
  // one below the overhang, not below the layout box.
  actions: { marginTop: space.sm + BADGE_OVERHANG },
  // sits over the top-right corner of the Add pasers button
  badge: {
    position: 'absolute',
    top: -BADGE_OVERHANG,
    right: -BADGE_OVERHANG,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Solid, and the fill steps every five levels (config/progression.js). It
  // used to be a card-coloured disc ringed in the CLAN accent, which told you
  // which club the runner was in — something the tag already says — and left
  // two players forty levels apart wearing the same chip.
  levelBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 3,
    borderColor: toon.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  xpTrack: { height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: 'hidden' },
  xpFill: { height: '100%', borderRadius: 4 },

  // The PRO poster. Its aspect is the BANNER'S OWN (16:9) so the art fills it
  // exactly at every width and `cover` never has anything to crop; the dark
  // background is the art's edge value, for the frame before it decodes. The
  // copy is pinned to the left 44%, which is the empty half of the picture.
  proCard: {
    marginTop: space.xl,
    aspectRatio: 16 / 9,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: GOLD,
    backgroundColor: '#181316',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  proArt: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  proCopy: { width: '44%', paddingLeft: space.lg },
  proCta: { marginTop: space.sm, alignSelf: 'flex-start' },

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
