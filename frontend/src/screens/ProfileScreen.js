// You — who your runner is and how your PASER game is going.
//
// TWO HALVES, and the split is the whole layout. The top is the runner: the
// scene, the portrait, the name, the rank rail, the two things you do with a
// runner, and the six numbers that say how the game is going. All of it open,
// all of it the reason anybody taps You.
//
// Settings live on their own screen behind the top-right gear. The profile
// stops at the identity/progression surfaces: stats, land, streak and trophies.

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronRight, Settings } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';
import { Image } from '../ui/image';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../auth/AuthContext';
import { useAvatar } from '../state/avatar';
import { useAccent } from '../hooks/useAccent';
import { RunnerFigure } from '../components/identity/PlayerIdentity';
import SceneBackdrop, { useSceneBackdrop } from '../components/SceneBackdrop';
import StreakCalendar from '../components/StreakCalendar';
import { Arrival, PressableScale, Reveal, haptic, useArrival } from '../ui/motion';
import { brand, radius, space, toon, useTheme, useThemedType, useThemedStyles } from '../theme';
import { Screen, Card, Row, Button, Framed, SectionHeader, Skeleton, OutlinedText } from '../components/ui';
import RankRail from '../components/rank/RankRail';
import YourLandCard from '../components/territory/YourLandCard';
import { standingFrom } from '../config/rankLadder';
import { useProEntitlement } from '../pro/ProProvider';
import DevProPanel from '../components/DevProPanel';
import DevCelebrationsPanel from '../components/DevCelebrationsPanel';
import SharedStatTile from '../components/StatTile';
import { art } from '../config/onboardingArt';
import GameAnimation from '../components/GameAnimation';
import { itemPreviewSources } from '../config/cosmetics';
import { preloadImages } from '../utils/imagePreload';
import { preloadScreenImagesAfterInteractions } from '../config/screenAssets';
import { TARGET, TIP, TutorialTarget, useTutorialTip } from '../tutorial';

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
  const { user } = useAuth();
  const { equipped } = useAvatar();
  const accent = useAccent();

  // The scene behind the runner — daytime kerb in light mode, lamp-lit night
  // street in dark. SceneBackdrop sizes itself to whichever art is showing and
  // to the window rather than to this header, so the whole scene is visible in
  // both themes; the header only needs the height to reserve room for it.
  const { height: sceneH, standAt } = useSceneBackdrop({ variant: 'profile' });

  // The scene runs all the way up under the status bar. The page opts out of
  // Screen's top inset and the header takes it instead, as sky above the art —
  // the runner stays exactly where it stood on the scene, only the strip of
  // page background that used to sit above the scene is gone.
  const insets = useSafeAreaInsets();
  const skyTop = insets.top + space.md;

  // THE WHOLE RUNNER IS THE HEADER. This used to be a head in a rank ring,
  // which showed rank well and hid most of what a player had put on: the top
  // was a collar, and bottoms, shoes and most accessories were not drawn at
  // all. Now the full outfit stands on the pavement of the scene, and rank is
  // stated beside it by the crest on the rank rail (see
  // components/identity/PlayerIdentity for the rule).
  //
  // Sized off the window so shoes and bottoms are big enough to read without
  // pushing the stat wall off a small phone: 170pt on an SE, ~220 on a 6.1".
  const { height: winH } = useWindowDimensions();
  const runnerH = Math.round(Math.max(170, Math.min(250, winH * 0.26)));
  // The runner's box starts right under the status bar strip and its feet
  // land on the pavement, so the sky above the art is whatever makes the two
  // meet. On a phone where the runner is shorter than the room above the
  // pavement, the runner is pushed down instead.
  const feetOnScene = (standAt ?? 0.85) * sceneH;
  const sky = Math.max(skyTop, skyTop + runnerH - feetOnScene);
  const runnerTop = sky + feetOnScene - runnerH;

  // The name and its level badge sit at the very bottom of the header, and the
  // portrait frame above them is taller than the art's own shape — so the badge
  // hung off the bottom edge of the scene. Measuring the name row and growing
  // the scene to clear it keeps the whole header ON the scene at any window
  // width, portrait tier or text size; `bleed` adds the height as more road
  // rather than cropping into the trees.
  const [nameBottom, setNameBottom] = useState(0);
  const headerH = Math.max(sceneH + sky, nameBottom ? nameBottom + space.sm : 0);

  // Everything the page shows is served from the cache on the first render and
  // corrected behind it, so returning to You never rebuilds itself from six
  // grey tiles. `loading` stays true only until the very first successful
  // fetch on a fresh install.
  const { data: stats } = useQuery('me:stats', api.meStats, { fallback: {} });
  // "Everything you've earned lives here", said once, and not until there is
  // something earned on screen to say it about.
  useTutorialTip(TIP.PROGRESSION, stats != null);
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
  // The stat wall fills in behind cached content.
  const statsArriving = useArrival(!stats);
  const { data: runDays } = useQuery('me:run-days', api.runDays, {
    fallback: { days: [] },
    select: (d) => d.days || [],
  });
  const { data: paserInfo } = useQuery('pasers', api.pasers);
  // The pass query that used to live here is gone. It existed for exactly two
  // things: deciding whether to show the PRO poster, and reloading after a
  // purchase made from it. Both now come from the entitlement itself, which
  // this screen already has, so keeping it would be a request per visit to
  // /me/progression for a number nothing on the page reads.
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
      'Crossroads',
      // The ten tier scenes. Last in the queue because it is the heaviest
      // group in the app, and this is the only page that opens the ladder —
      // the rail below the portrait is the tap that leads there.
      'RankLadder',
    ]);
  }, [scheme]);
  // Drives the medal beside the Trophies heading — it replays when the count
  // moves, so earning one is the thing that makes it spin.
  const earnedTrophies = stats ? TROPHIES.filter(({ earned }) => earned(stats)).length : 0;

  return (
    <Screen scroll edges={[]} contentStyle={{ paddingBottom: space.xxl }}>
      {/* header — profile picture is a head-and-shoulders bust, sitting on the
          roadside scene (the art leaves its centre clear for it). The header
          reserves the scene's full height so the stat wall below starts clear
          of it instead of floating over the road. */}
      {/* What the You tip lights: the runner, their rank and their level, all
          in one box. */}
      <TutorialTarget id={TARGET.YOU_MAIN}>
      <Reveal style={[styles.header, { minHeight: headerH, paddingTop: runnerTop }]}>
        {/* Wind through the scene. A no-op when the leaf art is not in the
            build, so this line is safe whatever the asset selection says. It
            stops itself when You is not the tab in front; this page used to
            read focus to tell it, which re-rendered the whole page on every
            tab switch. */}
        <SceneBackdrop
          variant="profile"
          minHeight={headerH}
          skyAbove={sky}
          bleed
          ambient="leaves"
        />
        <TouchableOpacity
          style={[styles.settingsButton, { top: skyTop + space.sm, backgroundColor: colors.card, borderColor: toon.ink }]}
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={8}
        >
          <Settings size={22} color={toon.ink} strokeWidth={2.75} />
        </TouchableOpacity>
        {/* The full outfit, head to shoes, standing on the pavement. No ring
            round it: rank is the crest on the rail below. Tap to dress. */}
        <PressableScale
          onPress={() => navigation.navigate('AvatarStudio')}
          accessibilityRole="button"
          accessibilityLabel="Your runner, tap to customize"
        >
          <RunnerFigure equipped={equipped} height={runnerH} width={runnerH * 0.7} animate />
        </PressableScale>

        {/* Name, then level, both under the portrait and centred on it. They
            sit ON the scene, not on the page background, so both take the game
            treatment — white with an ink outline — and the level is spelled
            out in the same voice as the name rather than riding a disc.
            The block is measured so the scene grows to keep it on the art. */}
        <View
          style={styles.identity}
          onLayout={(e) => {
            const { y, height } = e.nativeEvent.layout;
            setNameBottom(y + height);
          }}
        >
          <OutlinedText
            style={[type.title, styles.name, { color: '#fff' }]}
            outline={toon.ink}
            width={2.5}
          >
            {user?.username}
          </OutlinedText>

          {/* The level IS the way to levels and rewards, so it stays a tap. */}
          {stats && (
            <PressableScale
              onPress={() => navigation.navigate('Progression')}
              accessibilityRole="button"
              accessibilityLabel={`Level ${stats.level ?? 0}. View levels and rewards`}
            >
              <OutlinedText
                style={[type.title, styles.levelText, { color: '#fff' }]}
                outline={toon.ink}
                width={2}
              >
                {`Level ${stats.level ?? 0}`}
              </OutlinedText>
            </PressableScale>
          )}
        </View>

        {/* RANK, directly under the runner it belongs to and above the
            actions. It is the ladder the game is actually played on.
            Push it sideways to see what is ahead; tap it for the full ladder. */}
        {stats && (
          <RankRail
            standing={standingFrom(stats)}
            floors={rankFloors}
            crest
            onPress={() => navigation.navigate('RankLadder')}
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
      </TutorialTarget>


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
      {/* The profile now stops at profile content: land, consistency and earned
          trophies. Settings live behind the gear, and run history remains on
          the app's history/detail surfaces instead of stretching this page. */}
      <View style={styles.sections}>
        <SectionHeader framed={false} title="Statistics" style={{ marginBottom: space.md }} />

        <YourLandCard navigation={navigation} accent={accent} nested />

        <Reveal delay={150}>
          <SectionHeader
            title="Running streak"
            action={(stats?.current_streak_days || 0) >= 2 ? `${stats.current_streak_days} day streak` : undefined}
            framed={false}
            style={{ marginTop: space.xl, marginBottom: space.md }}
          />
          <Card>
            <StreakCalendar runDays={runDays || []} accent={accent} />
          </Card>
        </Reveal>

        <Reveal delay={180}>
          <SectionHeader
            title="Trophies"
            accessory={
              earnedTrophies ? (
                <GameAnimation name="medal" size={TROPHY_MEDAL} trigger={earnedTrophies} />
              ) : null
            }
            framed={false}
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
                  <View style={styles.trophyContent}>
                    <AppIcon name={icon} size={30} opacity={got ? 1 : 0.6} />
                    <Text style={[type.captionMedium, { marginTop: 6, textAlign: 'center', color: got ? '#292015' : colors.textMuted }]}>
                      {label}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </View>
        </Reveal>
      </View>

      {/* PASER PRO belongs after the profile content, not between the runner and settings. */}
      {canShowPro && !isPro && !proLoading ? (
        <Reveal delay={110}>
          <PressableScale
            onPress={() => { haptic.light(); openPaywall('profile'); }}
            accessibilityRole="button"
            accessibilityLabel="Paser Pro. Planning, stats and styles. Tap to explore"
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
                <Text style={[type.display, styles.proTitle]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
                  GO PRO
                </Text>
                <Text style={[type.bodySm, styles.proSub]}>Planning. Stats. Style.</Text>
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
              <Image source={art('proCrew')} style={styles.proArt} resizeMode="contain" accessible={false} />
            </Framed>
          </PressableScale>
        </Reveal>
      ) : null}

      {/* Every PRO state, previewable from a desk. Invisible to real accounts
          — see the gate in DevProPanel. */}
      <DevProPanel style={{ marginTop: space.lg }} />
      {/* Rank up, rank down, level up and the rest, playable on demand.
          Invisible to real accounts, the same gate as DevProPanel. */}
      <DevCelebrationsPanel style={{ marginTop: space.md }} />

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
  settingsButton: {
    position: 'absolute',
    right: space.gutter,
    zIndex: 3,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

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
  identity: { alignItems: 'center', marginTop: space.sm },
  name: { textAlign: 'center' },
  // Same outlined title voice as the name, one step down so the name leads.
  levelText: { textAlign: 'center', fontSize: 16, lineHeight: 22, marginTop: 2 },

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

  // The folded half of the page. The gap above the first heading is the join
  // between who you are, which is drawn, and what you can change, which is a
  // list — so it takes a section's worth of air rather than a card's.
  sections: { marginTop: space.xl },

  trophyRow: { flexDirection: 'row', gap: space.sm },
  trophy: { flex: 1, paddingVertical: space.md, alignItems: 'center', justifyContent: 'center', minHeight: 80 },
  trophyContent: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  legal: { ...type.caption, color: colors.textDim, marginTop: space.md, textAlign: 'center' },
});
