// You — profile + your stats. Header, stat wall, recent runs, and settings.
// Trophy shelf (PRs + badges) and tap-through run detail arrive in Phase 6.

import React, { useEffect, useMemo, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronRight, Lock } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';
import { Image } from '../ui/image';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../auth/AuthContext';
import { useAvatar } from '../state/avatar';
import { useAccent } from '../hooks/useAccent';
import { useTabSwipeLock } from '../hooks/useTabSwipeLock';
import { useSettings, TRAIL_GLOW_COLORS } from '../state/settings';
import { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import SceneBackdrop, { useSceneBackdrop } from '../components/SceneBackdrop';
import StreakCalendar from '../components/StreakCalendar';
import PrivacySettings from '../components/PrivacySettings';
import HealthSyncSettings from '../components/HealthSyncSettings';
import RecoveryEmail from '../components/RecoveryEmail';
import RivalCard from '../components/RivalCard';
import { Arrival, PressableScale, Reveal, haptic, useArrival } from '../ui/motion';
import { brand, nbField, radius, space, toon, withAlpha, useTheme, useThemedType, useThemedStyles } from '../theme';
import { levelBandColor } from '../config/progression';
import { COPY as PASERBY_COPY } from '../config/paserby';
import { Screen, Card, Row, Button, Framed, Input, SectionHeader, Skeleton, OutlinedText } from '../components/ui';
import ThemeToggle from '../components/ThemeToggle';
import RankRail from '../components/rank/RankRail';
import { standingFrom } from '../config/rankLadder';
import { useProEntitlement } from '../pro/ProProvider';
import DevProPanel from '../components/DevProPanel';
import DevCelebrationsPanel from '../components/DevCelebrationsPanel';
import DevCrossroadsSeed from '../components/DevCrossroadsSeed';
import SharedStatTile from '../components/StatTile';
import { art } from '../config/onboardingArt';
import GameAnimation from '../components/GameAnimation';
import { toast } from '../ui/toast';
import { itemPreviewSources } from '../config/cosmetics';
import { preloadImages } from '../utils/imagePreload';
import { preloadScreenImagesAfterInteractions } from '../config/screenAssets';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';
import { shortDate } from '../utils/time';

// Trophy shelf — derived from live stats; earned trophies glow in the accent.
// The shelf is PASER's own sticker art, not line icons. It used to be four
// lucide glyphs drawn in the accent, which read as a settings list sitting in
// the middle of a page made of painted characters and painted frames — and a
// trophy shelf is the one place on the profile that should look like a prize.
//
// An unearned trophy is the same sticker at reduced opacity, because these are
// full-colour PNGs and cannot be tinted (see AppIcon's own header). That is
// the right treatment anyway: greying a trophy out says "not yet", where a
// different colour would say "a different kind of trophy".
const TROPHIES = [
  { key: 'first_claim', label: 'First claim', icon: 'claim', earned: (s) => (s.territory_count || 0) >= 1 },
  { key: 'big_claim', label: '0.5 km² claim', icon: 'trophy', earned: (s) => (s.biggest_claim_m2 || 0) >= 500000 },
  { key: 'ten_zones', label: '10 zones', icon: 'award', earned: (s) => (s.territory_count || 0) >= 10 },
  { key: 'streak7', label: 'Week streak', icon: 'streak', earned: (s) => (s.current_streak_days || 0) >= 7 },
];

const NOTIF_ROWS = [
  ['stolen', 'Land under attack'],
  ['defended', 'Attacks your land held off'],
  ['captured', 'Land you capture'],
  ['clan_goal', 'Club weekly goal'],
  ['kudos', 'Kudos received'],
  ['pasers', 'Paser requests'],
  ['paserby', 'Crossed paths & high fives'],
  ['season', 'Season & promotion'],
  ['recap', 'Weekly recap'],
  ['reminder', 'Streak & territory reminders'],
];

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
// Hosted on the bido-frontend site (Next.js /privacy route), now on the
// gameablestudios.com domain.
const PRIVACY_POLICY_URL = 'https://www.gameablestudios.com/privacy';
const SUPPORT_URL = 'https://www.gameablestudios.com/support';

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

// One cell of the wall, at this page's width. The tile itself is shared with
// RunnerProfile — see components/StatTile.js for what it is and why.
function StatTile(props) {
  const styles = useThemedStyles(makeStyles);
  return <SharedStatTile {...props} style={styles.tile} />;
}

export default function ProfileScreen({ navigation }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const { user, signOut, updateUsername, deleteAccount } = useAuth();
  const { equipped } = useAvatar();
  const { trailGlow, setTrailGlow } = useSettings();
  // The drift in the header stops when the tab is not the one you are on.
  // This is a tab screen, so without it the leaves keep crossing for the whole
  // session behind Home, the map and the shop.
  const focused = useIsFocused();
  // The rank rail scrolls sideways inside a tab pager that also swipes
  // sideways; while a finger is on the rail, the You tab stops swiping.
  const lockTabSwipe = useTabSwipeLock(navigation);
  // The runner colour picker below is exactly this: club colour unless a
  // fixed one is chosen. This page's own frames used to hardcode the club
  // colour, which is why only whichever swatch happened to match the club's
  // colour ever looked like it did anything.
  const accent = useAccent();

  // The scene behind the runner — daytime kerb in light mode, lamp-lit night
  // street in dark. SceneBackdrop sizes itself to whichever art is showing and
  // to the window rather than to this header, so the whole scene is visible in
  // both themes; the header only needs the height to reserve room for it.
  const { height: sceneH } = useSceneBackdrop({ variant: 'profile' });

  // The scene runs all the way up under the status bar. The page opts out of
  // Screen's top inset and the header takes it instead, as sky above the art —
  // the runner stays exactly where it stood on the scene, only the strip of
  // page background that used to sit above the scene is gone.
  const insets = useSafeAreaInsets();
  const skyTop = insets.top + space.md;

  // The name and its level badge sit at the very bottom of the header, and the
  // portrait frame above them is taller than the art's own shape — so the badge
  // hung off the bottom edge of the scene. Measuring the name row and growing
  // the scene to clear it keeps the whole header ON the scene at any window
  // width, portrait tier or text size; `bleed` adds the height as more road
  // rather than cropping into the trees.
  const [nameBottom, setNameBottom] = useState(0);
  const headerH = Math.max(sceneH + skyTop, nameBottom ? nameBottom + space.sm : 0);

  // Everything the page shows is served from the cache on the first render and
  // corrected behind it, so returning to You never rebuilds itself from six
  // grey tiles. `loading` stays true only until the very first successful
  // fetch on a fresh install.
  const { data: stats } = useQuery('me:stats', api.meStats, { fallback: {} });
  // The ladder's tier thresholds, for the numbers under the rank rail. Cached
  // hard: it counts every rated player, and a threshold that moved between two
  // openings of this page would read as noise rather than as a ladder. The
  // rail draws without it — the nodes simply carry no number yet.
  const { data: ladder } = useQuery('leaderboard:rank-ladder', api.rankLadder, {
    staleMs: 5 * 60 * 1000,
    fallback: null,
  });
  const rankFloors = useMemo(
    () => (ladder?.tiers || []).map((t) => t.floor),
    [ladder]
  );
  // `select` is a GUARD, not a transform: the list is rendered with
  // `runs.slice`, and a payload that is not a list (an error body, a cache
  // entry written by an older shape) throws mid render. A throw here is not a
  // missing run list — it is the whole You page replaced by the tab's error
  // boundary, which is a page of settings and stats lost to one bad response.
  const { data: runs } = useQuery('me:runs', api.meRuns, {
    fallback: [],
    select: (d) => (Array.isArray(d) ? d : []),
  });
  // The wall and the run list fill in independently of each other, so each
  // keeps its own latch — one of them arriving must not fade the other.
  const statsArriving = useArrival(!stats);
  const runsArriving = useArrival(!runs);
  const { data: runDays } = useQuery('me:run-days', api.runDays, {
    fallback: { days: [] },
    select: (d) => d.days || [],
  });
  const { data: prefs, setData: setPrefs } = useQuery('me:notif-prefs', api.getNotifPrefs);
  const { data: paserInfo } = useQuery('pasers', api.pasers);
  // Shares the 'me:paserby' key with Home's Crossroads badge, so the switch is
  // drawn from cache on the first render and both stay in step.
  const { data: paserby, setData: setPaserby } = useQuery('me:paserby', api.paserby, {
    fallback: { enabled: true, unseen: 0, total: 0 },
  });
  // The pass query that used to live here is gone. It existed for exactly two
  // things: deciding whether to show the PRO poster, and reloading after a
  // purchase made from it. Both now come from the entitlement itself, which
  // this screen already has, so keeping it would be a request per visit to
  // /me/progression for a number nothing on the page reads.
  const { data: rivals } = useQuery('me:rivals:3', () => api.rivals(3), {
    fallback: { rivals: [] },
    select: (d) => d.rivals || [],
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user?.username || '');
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteDraft, setDeleteDraft] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { isPro, canShowPro, isLoading: proLoading, openPaywall } = useProEntitlement();

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
      // The ten tier scenes. Last in the queue because it is the heaviest
      // group in the app, and this is the only page that opens the ladder —
      // the rail below the portrait is the tap that leads there.
      'RankLadder',
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
    <Screen scroll edges={[]} contentStyle={{ paddingBottom: space.xxl }}>
      {/* header — profile picture is a head-and-shoulders bust, sitting on the
          roadside scene (the art leaves its centre clear for it). The header
          reserves the scene's full height so the stat wall below starts clear
          of it instead of floating over the road. */}
      <Reveal style={[styles.header, { minHeight: headerH, paddingTop: skyTop + space.lg }]}>
        {/* Wind through the scene. A no-op when the leaf art is not in the
            build, so this line is safe whatever the asset selection says. */}
        <SceneBackdrop
          variant="profile"
          minHeight={headerH}
          skyAbove={skyTop}
          bleed
          ambient="leaves"
          playing={focused}
        />
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
          {/* The level badge IS the way to levels and rewards now. The XP bar
              that used to carry that tap sat between the name and the rank
              rail, which meant the header stacked two progress tracks on top
              of each other before you reached anything you could do — so the
              header keeps the ladder that is the game (rank) and the level
              keeps its route out, on the badge that states it. */}
          {stats && (
            <PressableScale
              style={[styles.levelBadge, { backgroundColor: levelBandColor(stats.level ?? 0) }]}
              onPress={() => navigation.navigate('Progression')}
              accessibilityRole="button"
              accessibilityLabel={`Level ${stats.level ?? 0}. View levels and rewards`}
            >
              <OutlinedText style={[type.statSm, { color: '#fff' }]} outline={toon.ink} width={1.5}>
                {String(stats.level ?? 0)}
              </OutlinedText>
            </PressableScale>
          )}
        </Row>

        {/* RANK, directly under the runner it belongs to and above the
            actions. It is the ladder the game is actually played on.
            Push it sideways to see what is ahead; tap it for the full ladder. */}
        {stats && (
          <RankRail
            standing={standingFrom(stats)}
            floors={rankFloors}
            onPress={() => navigation.navigate('RankLadder')}
            onGrab={lockTabSwipe}
            style={styles.rankRail}
          />
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

        {/* No energy meter here. Energy is a thing you spend at the moment you
            claim, so it is read where that happens — Home, the result screen
            and the shop all carry the meter and its refill. On You it was one
            more bar in a header that is meant to be who you are, not what you
            have left. */}
      </Reveal>


      {/* stat wall */}
      <Reveal delay={90} style={styles.wall}>
        {!stats ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width="31%" height={80} style={{ borderRadius: 16, marginBottom: space.md }} />
          ))
        ) : (
          <Arrival active={statsArriving} style={styles.wallInner}>
            {/* One counting number per screen (see theme/motion). Area held is
                the headline — it is the thing the whole game is about — so it
                counts and the other five arrive settled. No stickers on any
                tile: the wall is numbers only. */}
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
          </Arrival>
        )}
      </Reveal>

      {/* PASER PRO — shown only to non holders, and it is a POSTER: the crew,
          the wordmark, one line. Everything about what PRO actually gives you
          is a tap away on the paywall; a card on You that listed it was three
          paragraphs nobody read.

          IT IS DRAWN, not printed. This used to be the 16:9 `proBanner` — a
          dark photographic-looking plate with a machine-cut gold hairline
          around it, dropped into the middle of a page made of hand-drawn
          boxes on paper. It read as an ad slot the app had sold to somebody
          else, and it was the only surface on You with neither the ink line
          nor the paper. So it is the same box Home's hero cards are: a heavy
          ink frame, a flat gold fill, and the crew as a CUT-OUT (`proCrew`,
          the transparent master) bleeding off the right edge rather than a
          rectangle of somebody else's background. Same treatment as the PRO
          slide on Home, which is the point — the two are one product.

          THE GATE IS ENTITLEMENT ITSELF, not `progression.premium_active`.
          Those two agree on the server (premium_active IS is_pro — see
          routes/progression.py), but they arrive from different endpoints, so
          reading the pass here meant the poster waited on a request it does
          not otherwise need and ignored the dev entitlement override. Held
          back only while entitlement is still loading, so a subscriber never
          sees their own subscription advertised for a frame. */}
      {canShowPro && !isPro && !proLoading ? (
        <Reveal delay={110}>
          <PressableScale
            onPress={() => { haptic.light(); openPaywall('profile'); }}
            accessibilityRole="button"
            accessibilityLabel="Paser Pro. Strategy, insights and style. Territory planner, territory intelligence, advanced analytics, rival intelligence and exclusive customisation. Tap to explore"
          >
            <Framed
              frame={frameVariant('featured', 'pro:you')}
              tint={toon.ink}
              fill={GOLD}
              weight={INK.bold}
              pose={framePose('pro:you')}
              inset={false}
              style={styles.proCard}
              contentStyle={styles.proCardContent}
            >
              <View style={styles.proCopy}>
                <Text style={[type.labelSm, styles.proEyebrow]}>PASER PRO</Text>
                {/* One line, always. "GO PRO" is comfortable in this column,
                    but the column is a fraction of the screen and the screen
                    can be a small phone at a large text size. */}
                <Text
                  style={[type.display, styles.proTitle]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  GO PRO
                </Text>
                {/* WAS "Twice the rewards." That is a promise about POWER, and
                    PRO does not sell power — see the contract at the top of
                    config/pro.js and entitlements.py. Three words for the three
                    things it does sell; the full list lives on the paywall,
                    which is where somebody who taps this is going anyway. */}
                <Text style={[type.bodySm, styles.proSub]}>
                  Strategy. Insights. Style.
                </Text>
                <Framed
                  frame={frameVariant('chip', 'Explore PRO')}
                  tint={toon.ink}
                  fill="#ffffff"
                  weight={INK.thin}
                  pose={framePose('Explore PRO')}
                  inset={false}
                  style={styles.proBtn}
                  contentStyle={styles.proBtnContent}
                >
                  <Row gap={2}>
                    <Text style={[type.buttonSm, { color: toon.ink }]}>Explore PRO</Text>
                    <ChevronRight size={14} color={toon.ink} strokeWidth={3} />
                  </Row>
                </Framed>
              </View>
              {/* `contain`, and bled into the frame's padding on three sides so
                  the crew stands as tall as the card allows. A cut-out has no
                  edges to crop, so there is nothing for `cover` to do here but
                  cut somebody's head off at a narrow width. */}
              <Image
                source={art('proCrew')}
                style={styles.proArt}
                resizeMode="contain"
                accessible={false}
              />
            </Framed>
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
        {TROPHIES.map(({ key, label, icon, earned }) => {
          const got = stats ? earned(stats) : false;
          return (
            <Card
              key={key}
              padded={false}
              style={styles.trophy}
              fill={got ? '#FFF2C6' : colors.card}
            >
              <AppIcon name={icon} size={30} opacity={got ? 1 : 0.6} />
              <Text style={[type.caption, { marginTop: 6, textAlign: 'center', color: got ? '#292015' : colors.textMuted }]}>
                {label}
              </Text>
            </Card>
          );
        })}
      </View>
      </Reveal>

      {/* recent runs */}
      <SectionHeader framed frameTint={accent} title="Recent runs" style={{ marginTop: space.xl, marginBottom: space.md }} />
      <Card padded={false}>
        {!runs ? (
          <View style={{ padding: space.lg }}>
            <Skeleton width="100%" height={16} />
          </View>
        ) : runs.length === 0 ? (
          <Text style={[type.caption, { padding: space.lg }]}>No runs yet.</Text>
        ) : (
          <Arrival active={runsArriving}>
          {runs.slice(0, 8).map((r, i) => (
            <TouchableOpacity
              key={r.run_id}
              style={[styles.runRow, i > 0 && styles.runDivider]}
              onPress={() => navigation.navigate('RunDetail', { runId: r.run_id })}
              accessibilityRole="button"
              accessibilityLabel="Open run detail"
            >
              <View style={{ flex: 1 }}>
                <Text style={type.bodyBold}>{shortDate(r.created_at)}</Text>
                <Text style={type.caption}>
                  {km(r.distance_m)} km · {r.closed_loop ? `${km2(r.area_m2)} km² claimed` : 'not claimed'}
                </Text>
              </View>
              {r.closed_loop && <View style={[styles.claimDot, { backgroundColor: accent }]} />}
            </TouchableOpacity>
          ))}
          </Arrival>
        )}
      </Card>

      {/* settings */}
      <SectionHeader framed frameTint={accent} title="Settings" style={{ marginTop: space.xl, marginBottom: space.md }} />
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

      {/* Player colour — trail, own-land outline and colourable game chrome. */}
      <Card style={{ marginTop: space.md }}>
        <Text style={type.labelSm}>Runner colour</Text>
        <Text style={[type.caption, { marginTop: 2 }]}>
          Colours your trail, map outline and this page's frames. Club follows your club colour.
        </Text>
        <View style={styles.swatchRow}>
          {TRAIL_GLOW_COLORS.map(({ key, label, value, pro }) => {
            const swatch = value || accent;
            const selected = trailGlow === key;
            // Locked only when PRO is actually sellable and this account is not
            // on it. A build with the store off shows the whole palette; a
            // subscriber wears any of it. A free runner who chose a PRO colour
            // before it was gated keeps it — this only blocks NEW selections.
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
                accessibilityLabel={
                  locked ? `Trail glow ${label}, PASER PRO, tap to unlock` : `Trail glow ${label}`
                }
                accessibilityState={{ selected }}
                style={styles.swatchItem}
              >
                <View
                  style={[
                    styles.swatch,
                    { backgroundColor: swatch, shadowColor: swatch },
                    selected && styles.swatchSelected,
                  ]}
                >
                  {locked ? (
                    <View style={styles.swatchLock}>
                      <Lock size={13} color={GOLD} strokeWidth={2.5} />
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[
                    type.caption,
                    { color: locked ? GOLD : selected ? colors.text : colors.textDim },
                  ]}
                >
                  {label}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </Card>

      {/* crossed paths — the PASERBY switch. It lives in Settings as well as
          on the Crossroads screen itself: somebody looking for the way out
          looks here first. Turning it off stops new encounters being made AND
          deletes the trace samples the matcher would have used. */}
      <SectionHeader framed frameTint={accent} title="Crossed paths" style={{ marginTop: space.xl, marginBottom: space.md }} />
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
        {/* Dev only (see the gate inside): seeds real crossings against
            throwaway bots and opens the plaza, so Crossroads can be looked at
            without crossing anyone's path. Hidden in release for every account
            the server has not named. */}
        <DevCrossroadsSeed onOpen={() => navigation.navigate('Crossroads')} />
      </Card>

      {/* the way back in if the password goes. Sits above privacy rather than
          down by Sign out because an account with no recovery email is a
          problem to fix, not a preference to browse. */}
      <RecoveryEmail />

      {/* route privacy — what other people see of your runs */}
      <PrivacySettings />

      {/* apple health — renders nothing where there is no health store */}
      <HealthSyncSettings />

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
      <SectionHeader title="Push notifications" style={{ marginTop: space.xl, marginBottom: space.sm }} />
      <Text style={[type.caption, { color: colors.textMuted, marginBottom: space.md }]}>
        Every event stays in your in-app inbox. Choose which ones may alert you outside PASER.
      </Text>
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

      <Button title="Sign out" variant="secondary" onPress={signOut} style={{ marginTop: space.xl }} />

      {!confirmingDelete ? (
        <Button
          title="Delete account"
          variant="destructive"
          onPress={() => { setConfirmingDelete(true); setDeleteDraft(''); }}
          // No `backgroundColor` here. The soft red used to be painted on the
          // button's own root as a way of toning the destructive red down, and
          // with a hand-drawn frame on top that rectangle showed all round the
          // wobble — a pale red box with a darker red box inside it, which is
          // what "two shades of red" was. The frame's paper is the fill now,
          // and it is the only one.
          style={{ marginTop: space.md }}
        />
      ) : (
        <Card style={{ marginTop: space.md }} accent={colors.danger}>
          <Text style={[type.heading, { color: colors.danger, marginBottom: space.sm }]}>Delete this account?</Text>
          <Text style={[type.bodySm, { color: colors.textMuted, lineHeight: 19 }]}>
            This permanently removes your runs and territories. It cannot be undone. Type{' '}
            <Text style={[type.bodySmBold]}>{user?.username}</Text> to confirm.
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

      <TouchableOpacity style={styles.link} onPress={() => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {})} accessibilityRole="link" accessibilityLabel="Privacy policy">
        <Text style={[type.bodyMedium, { color: colors.textMuted, textDecorationLine: 'underline' }]}>Privacy Policy</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.link} onPress={() => Linking.openURL(SUPPORT_URL).catch(() => {})} accessibilityRole="link" accessibilityLabel="Support">
        <Text style={[type.bodyMedium, { color: colors.textMuted, textDecorationLine: 'underline' }]}>Support</Text>
      </TouchableOpacity>
      <Text style={styles.legal}>Pixel effects by Will Tice</Text>
      <Text style={[styles.legal, { marginTop: space.xs }]}>Additional VFX by Pixel VFX Studio, RiaKare and Luis Zuno</Text>
      {/* The first run plays against a CraftPix landscape. Their free licence
          allows commercial use and asks for a credit where one is practical;
          this is where every other pack in the app is credited, so it costs a
          line and removes a content rights question at review. */}
      {/* Every PRO state, previewable from a desk. Invisible to real accounts
          — see the gate in DevProPanel. */}
      <DevProPanel style={{ marginTop: space.lg }} />
      {/* Rank up, rank down, level up and the rest, playable on demand.
          Invisible to real accounts, the same gate as DevProPanel. */}
      <DevCelebrationsPanel style={{ marginTop: space.md }} />

      <Text style={[styles.legal, { marginTop: space.xs }]}>Pixel landscapes by CraftPix.net</Text>
      <Text style={[styles.legal, { marginTop: space.xs }]}>PASER v{Constants.expoConfig?.version || '2.0.0'}</Text>
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

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  nameRow: { alignItems: 'center', justifyContent: 'center', marginTop: space.md },
  // The header now ends at the scene's bottom edge rather than at the name, so
  // its old `xl` bottom margin read as a hole between the art and the runner
  // actions — `md` closes it up without letting the buttons touch the road.
  // No top margin or padding here: the header starts at the very top of the
  // screen so its scene can, and the padding that clears the status bar is
  // applied inline where the inset is known.
  header: { alignItems: 'center', marginBottom: space.md },

  wall: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  // The fade wrapper sits BETWEEN the wall and its tiles, so it has to carry
  // the wall's own layout or the six tiles collapse into one column.
  wallInner: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: { width: '31.5%', marginBottom: space.md },

  // Customize runner / Add pasers sit close under the rank rail: they are what
  // you do with the runner above them, so the pair reads as part of that block
  // rather than as its own section. `sm` is measured from the BADGE, which
  // hangs BADGE_OVERHANG above the button it rides on — the gap you see is the
  // one below the overhang, not below the layout box.
  // The rail carries its own bottom gap so the buttons under it are not
  // sitting on the tier labels.
  rankRail: { marginTop: space.lg },
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

  // The PRO poster — Home's hero card geometry, deliberately: a fixed 190pt
  // box with the copy column on the left and the cut-out bleeding off the
  // right. NOT an aspect ratio any more. That was the old banner's own 16:9,
  // which only made sense while the picture WAS the card; a cut-out has no
  // frame of its own, so the card sets the height and the art fills it.
  //
  // No radius, no border, no background here: the frame brings the edge, the
  // paper and the depth (see Card's header). Anything set here would print a
  // machine-cut rectangle behind a hand-drawn one.
  proCard: { marginTop: space.xl, height: 190 },
  proCardContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: space.md,
  },
  proCopy: { flex: 1, justifyContent: 'center', paddingRight: space.sm },
  // Ink on gold, not white on dark — the fill changed, so the whole column
  // has to. The opacity steps are the hero cards' own.
  proEyebrow: { color: toon.ink, opacity: 0.75 },
  proTitle: { color: toon.ink, marginTop: 2 },
  proSub: { color: toon.ink, opacity: 0.72, marginTop: 4 },
  proBtn: { alignSelf: 'flex-start', marginTop: space.md },
  proBtnContent: { paddingHorizontal: space.md, paddingVertical: 8 },
  // Bleeds into the frame's padding so the crew stands the card's full height
  // and runs off its right edge, the way the hero art does.
  proArt: {
    width: '62%',
    height: 190,
    marginVertical: -space.md,
    marginRight: -space.md,
  },

  trophyRow: { flexDirection: 'row', gap: space.sm },
  trophy: { flex: 1, paddingVertical: space.md, alignItems: 'center' },

  runRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
  runDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  claimDot: { width: 8, height: 8, borderRadius: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 56 },
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
  // `space-between` on a single row worked for the original six, but ten
  // swatches (plus a label under each) in that width just overlapped. Wraps
  // instead, spaced evenly regardless of how many colours the list grows to.
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
  // A gold padlock over a PASER PRO colour, on a scrim dark enough to read on
  // any swatch. Rounds to match the 34px circle it sits on.
  swatchLock: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  btnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.sm },

  link: { marginTop: space.xl, alignItems: 'center' },
  legal: { ...type.caption, color: colors.textDim, marginTop: space.md, textAlign: 'center' },
});
