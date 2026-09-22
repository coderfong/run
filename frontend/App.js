import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  InteractionManager,
  StatusBar,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { Easing, FadeIn } from 'react-native-reanimated';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import {
  createNavigationContainerRef,
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { enableFreeze } from 'react-native-screens';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { X } from 'lucide-react-native';

import HomeScreen from './src/screens/HomeScreen';
import RunningScreen from './src/screens/RunningScreen';
import ResultScreen from './src/screens/ResultScreen';
import GlobalMapScreen from './src/screens/GlobalMapScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import AuthScreen from './src/screens/AuthScreen';
import OnboardingFlow from './src/onboarding/OnboardingFlow';
import ProfileScreen from './src/screens/ProfileScreen';
import LocationPermissionScreen from './src/screens/LocationPermissionScreen';
import RunDetailScreen from './src/screens/RunDetailScreen';
import RunShareScreen from './src/screens/RunShareScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ClubScreen from './src/screens/ClubScreen';
import ClubJoinScreen from './src/screens/ClubJoinScreen';
import ClubCreateScreen from './src/screens/ClubCreateScreen';
import ClubDetailScreen from './src/screens/ClubDetailScreen';
import ClubChatScreen from './src/screens/ClubChatScreen';
import SeasonScreen from './src/screens/SeasonScreen';
import AvatarStudioScreen from './src/screens/AvatarStudioScreen';
import ShopScreen from './src/screens/ShopScreen';
import RankDropWatcher from './src/components/rank/RankDropWatcher';
import ProgressionScreen from './src/screens/ProgressionScreen';
import RankProgressionScreen from './src/screens/RankProgressionScreen';
import MissionsScreen from './src/screens/MissionsScreen';
import RankLadderScreen from './src/screens/RankLadderScreen';
import PasersScreen from './src/screens/PasersScreen';
import RivalsScreen from './src/screens/RivalsScreen';
import RivalDetailScreen from './src/screens/RivalDetailScreen';
import CrossroadsScreen from './src/screens/CrossroadsScreen';
import TerritoryScreen from './src/screens/TerritoryScreen';
import RunnerProfileScreen from './src/screens/RunnerProfileScreen';
import PlanAttackScreen from './src/screens/PlanAttackScreen';
import RunShareCard from './src/components/share/RunShareCard';

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { ClanProvider } from './src/state/clan';
import { AvatarProvider, useAvatar } from './src/state/avatar';
import { ProfileProvider, useProfile } from './src/state/profile';
import { MotionProvider, useReduceMotion, MascotLoader } from './src/ui/motion';
import { RecordingProvider, useRecording } from './src/state/recording';
import { SettingsProvider } from './src/state/settings';
import { OfflineBanner } from './src/ui/offline';
import { ToastHost } from './src/ui/toast';
import { RivalPopupHost } from './src/components/RivalPopup';
import { LandCaptureAlertHost } from './src/components/LandCaptureAlert';
import { CrossroadsAlertHost } from './src/components/CrossroadsAlert';
import { DefenseHeldBanner } from './src/components/DefenseHeldBanner';
import { useNotificationTaps } from './src/notifications/setup';
import TabBar from './src/navigation/TabBar';
import ErrorBoundary from './src/components/ErrorBoundary';
import { usePushRegistration } from './src/hooks/usePush';
import { useProSync } from './src/hooks/usePro';
import ProProvider from './src/pro/ProProvider';
// The first-run tutorial: coach marks over the real app, following the real
// run and claim flow rather than replacing it. See src/tutorial/index.js.
import { TutorialProvider, TutorialOverlay } from './src/tutorial';
import { hydrateProExposure } from './src/pro/exposure';
import { hydrateCache } from './src/api/cache';
import { warmUp } from './src/api/client';
import { preloadCriticalImages, preloadHomeFeedRunners, preloadStartupImages } from './src/config/screenAssets';
import { addWatchCommandListener, publishToWatch } from './src/watch/watchLink';
import WatchAvatarSync from './src/watch/watchAvatar';
import { commandAllowed, PHASE as WATCH_PHASE } from './src/watch/watchState';
// No static `colors` here on purpose — App used to build the nav theme and the
// header chrome from it, which pinned both to the dark palette. Everything
// theme-dependent now reads useTheme(); `darkColors` stays only for the record
// modal, which is deliberately dark in either theme.
import { darkColors, fonts, hydrateThemePreference, ThemeProvider, useTheme } from './src/theme';
import { FONT_FILES } from './src/theme/fontFiles';

// A production navigator has neither the screen nor its deep-link mapping.
// Keeping the require behind the same compile-time flag also lets Metro drop
// the gallery/lab module from release bundles.
const AnimationGalleryScreen = __DEV__
  ? require('./src/screens/AnimationGalleryScreen').default
  : null;

// Crash telemetry — a strict no-op unless a DSN is provided via env/extra.
const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN || Constants?.expoConfig?.extra?.sentryDsn || '';
if (SENTRY_DSN) Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1 });

SplashScreen.preventAutoHideAsync().catch(() => {});

// Screens that go off-screen (a backgrounded stack screen, an unfocused tab's
// nested stack) stop rendering/updating instead of quietly running on. Without
// this a blurred screen's timers and effects (e.g. GlobalMapScreen's heat-pulse
// interval) kept ticking and competing with the transition animation for JS
// thread time — part of why navigating between screens felt laggy.
enableFreeze(true);

// React Navigation paints the surface UNDER every screen — including the strip
// behind the floating tab pill, which our TabBar leaves transparent on purpose.
// This used to be a module-level const built from the static `colors` (the dark
// palette, see theme/index.js), so light mode kept a black band along the
// bottom of every tabbed screen. Both hooks below read the ACTIVE palette
// instead; they run inside the tree, under ThemeProvider.
function useNavTheme() {
  const { colors, scheme } = useTheme();
  return useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.bg,
        card: colors.bg,
        text: colors.text,
        border: colors.border,
        primary: colors.primary,
      },
    };
  }, [colors, scheme]);
}

// Chrome for the native stack headers, on the active palette. Applied through
// each navigator's `screenOptions` so it themes every pushed screen at once —
// it was previously spread into the options of each screen one at a time.
function useHeaderChrome() {
  const { colors } = useTheme();
  const reduced = useReduceMotion();
  return useMemo(
    () => ({
      headerStyle: { backgroundColor: colors.bg },
      headerTitleStyle: { color: colors.text, fontFamily: fonts.display },
      headerTintColor: colors.text,
      headerShadowVisible: false,
      // Without this iOS labels the back button with the PREVIOUS ROUTE'S
      // NAME — Season showed a chevron reading "HomeMain". Route names are
      // internal identifiers, not copy; show the chevron alone.
      headerBackButtonDisplayMode: 'minimal',
      // State the transition instead of inheriting a platform-dependent
      // default. Forward navigation pushes the next page in; back follows the
      // same gesture in reverse. Accessibility Reduce Motion turns it into a
      // clean cut without making every other runner's navigation feel static.
      animation: reduced ? 'none' : 'default',
      gestureEnabled: true,
      fullScreenGestureEnabled: !reduced,
    }),
    [colors, reduced]
  );
}

// pacer:// deep links (territoryrun:// kept as a legacy prefix for older
// invite links and installed builds).
const linking = {
  prefixes: ['pacer://', 'territoryrun://'],
  config: {
    screens: {
      Tabs: {
        screens: {
          Home: { screens: { HomeMain: 'home', Leaderboard: 'leaderboard' } },
          Map: 'map',
          Club: { screens: { ClubMain: 'club', ClubJoin: 'clan/join/:code' } },
          You: 'you',
        },
      },
      Record: 'record',
      ...(__DEV__ ? { AnimationGallery: 'dev/animations' } : {}),
    },
  },
};

// --- per-tab stacks --------------------------------------------------------

const HomeStackNav = createNativeStackNavigator();
function HomeStack() {
  const header = useHeaderChrome();
  return (
    <HomeStackNav.Navigator screenOptions={{ headerShown: false, ...header }}>
      <HomeStackNav.Screen name="HomeMain" component={HomeScreen} />
      {/* Draws its own art panel header (with a back button), like Season,
          Rivals and Missions — the native one would stack a second bar above
          it. */}
      <HomeStackNav.Screen name="Leaderboard" component={LeaderboardScreen} />
      <HomeStackNav.Screen
        name="RunDetail"
        component={RunDetailScreen}
        options={{ headerShown: false }}
      />
      {/* Draws its own header (with a back button), like Leaderboard and
          Season — the native one would stack a second bar above it. */}
      <HomeStackNav.Screen name="Notifications" component={NotificationsScreen} />
      {/* Season draws its own art header (with a back button), like Pasers
          and Rivals — the native one would stack a second bar above it. */}
      <HomeStackNav.Screen name="Season" component={SeasonScreen} />
      <HomeStackNav.Screen
        name="ClubDetail"
        component={ClubDetailScreen}
        options={{ headerShown: false }}
      />
      {/* The side rail's destinations, registered HERE as well as under You.
          They used to be opened with navigate('You', { screen: … }), which
          crossed into the other tab: back from the shop rail landed on the
          profile, and you could not get to Home without a second tap. A screen
          opened from Home is pushed onto Home's own stack, so back is Home.
          The You tab keeps its own copies for the routes reached from the
          profile, and each instance carries its own navigation state. */}
      {/* Levels & rewards, missions and the rank ladder all draw their own
          panel headers (with a back button), like Season and Rivals — the
          native one would stack a second bar above them. */}
      <HomeStackNav.Screen name="Progression" component={ProgressionScreen} />
      <HomeStackNav.Screen name="RankProgression" component={RankProgressionScreen} />
      <HomeStackNav.Screen name="Missions" component={MissionsScreen} />
      <HomeStackNav.Screen name="RankLadder" component={RankLadderScreen} />
      <HomeStackNav.Screen name="Rivals" component={RivalsScreen} />
      <HomeStackNav.Screen
        name="RivalDetail"
        component={RivalDetailScreen}
        // title is set by the screen once the rival's name loads
        options={{ headerShown: true, title: 'Rivalry' }}
      />
      <HomeStackNav.Screen name="Crossroads" component={CrossroadsScreen} />
      {/* Reachable from Crossroads, so it has to exist on this stack too. */}
      <HomeStackNav.Screen
        name="RunnerProfile"
        component={RunnerProfileScreen}
        options={{ headerShown: true, title: 'Runner' }}
      />
    </HomeStackNav.Navigator>
  );
}

const MapStackNav = createNativeStackNavigator();
function MapStack() {
  const header = useHeaderChrome();
  return (
    <MapStackNav.Navigator screenOptions={{ headerShown: false, ...header }}>
      <MapStackNav.Screen name="MapMain" component={GlobalMapScreen} />
      {/* Reachable from the "Full profile" link on a tapped territory/avatar's
          quick-look popup, so it has to exist on this stack too. */}
      <MapStackNav.Screen
        name="RunnerProfile"
        component={RunnerProfileScreen}
        options={{ headerShown: true, title: 'Runner' }}
      />
    </MapStackNav.Navigator>
  );
}

const ClubStackNav = createNativeStackNavigator();
function ClubStack() {
  const header = useHeaderChrome();
  return (
    <ClubStackNav.Navigator screenOptions={{ headerShown: false, ...header }}>
      <ClubStackNav.Screen name="ClubMain" component={ClubScreen} />
      {/* A create form is a detour, not a destination, so it comes up as a
          sheet you dismiss rather than a page you navigate back out of. */}
      <ClubStackNav.Screen
        name="ClubCreate"
        component={ClubCreateScreen}
        options={{ headerShown: false, presentation: 'modal' }}
      />
      <ClubStackNav.Screen
        name="ClubJoin"
        component={ClubJoinScreen}
        options={{ headerShown: true, title: 'Join club' }}
      />
      <ClubStackNav.Screen
        name="ClubDetail"
        component={ClubDetailScreen}
        options={{ headerShown: false }}
      />
      <ClubStackNav.Screen
        name="ClubChat"
        component={ClubChatScreen}
        options={{ headerShown: true, title: 'Club chat' }}
      />
    </ClubStackNav.Navigator>
  );
}

const YouStackNav = createNativeStackNavigator();
function YouStack() {
  const header = useHeaderChrome();
  return (
    <YouStackNav.Navigator screenOptions={{ headerShown: false, ...header }}>
      <YouStackNav.Screen name="YouMain" component={ProfileScreen} />
      {/* Draws its own panel header (with a back button) — see HomeStack. */}
      <YouStackNav.Screen name="Progression" component={ProgressionScreen} />
      {/* Draws its own header: the scene runs up under the status bar with
          the NB back tile on its sky, like the You page it is opened from. */}
      <YouStackNav.Screen
        name="AvatarStudio"
        component={AvatarStudioScreen}
        options={{ title: 'Your runner' }}
      />
      <YouStackNav.Screen
        name="RunDetail"
        component={RunDetailScreen}
        options={{ headerShown: false }}
      />
      {/* Pasers, Rivals and Crossroads draw their own gradient headers (with a
          back button), so the native one is off. */}
      <YouStackNav.Screen name="Missions" component={MissionsScreen} />
      <YouStackNav.Screen name="RankLadder" component={RankLadderScreen} />
      <YouStackNav.Screen name="Pasers" component={PasersScreen} />
      <YouStackNav.Screen name="Rivals" component={RivalsScreen} />
      <YouStackNav.Screen
        name="RivalDetail"
        component={RivalDetailScreen}
        // title is set by the screen once the rival's name loads
        options={{ headerShown: true, title: 'Rivalry' }}
      />
      <YouStackNav.Screen name="Crossroads" component={CrossroadsScreen} />
      {/* Your land: the full list behind the "Your land" card on the profile.
          Draws its own panel header, like Rivals. */}
      <YouStackNav.Screen name="Territory" component={TerritoryScreen} />
      <YouStackNav.Screen
        name="RunnerProfile"
        component={RunnerProfileScreen}
        // title is set by the screen once the runner's name loads
        options={{ headerShown: true, title: 'Runner' }}
      />
    </YouStackNav.Navigator>
  );
}

// --- tabs ------------------------------------------------------------------

// Each tab stack gets its own error boundary so one tab crashing shows a
// retry state rather than taking down the whole app.
const withBoundary = (Stack) => function BoundedTab() {
  return (
    <ErrorBoundary>
      <Stack />
    </ErrorBoundary>
  );
};
const HomeTab = withBoundary(HomeStack);
const MapTab = withBoundary(MapStack);
const ClubTab = withBoundary(ClubStack);
const YouTab = withBoundary(YouStack);

// Material top-tabs (native pager under the hood) give horizontal swipe between
// tabs while keeping our custom bottom bar via tabBarPosition="bottom". Swipe is
// disabled on Map so Mapbox panning isn't hijacked (Map sits mid-order, so it
// bookends the swipe: Home↔Map and Club↔You swipe; leave Map by tapping).
//
// NOT BOTTOM TABS, AND NOT FROZEN. Build 68 swapped this for native bottom tabs
// with `freezeOnBlur` and `detachInactiveScreens`, on the theory that the
// preloaded tabs were the lag. It made every tab switch dearer instead. A
// frozen tab is suspended by react-freeze, React hides suspended content with
// `display: none`, and Fabric does not mount a `display: none` subtree, so
// leaving a tab tore down its whole native view tree and coming back built it
// again, on every switch. `lazy` put Map's Mapbox context back inside the first
// tap, the swipe between tabs went, and GlobalMapScreen's bottom inset (see its
// note on SafeAreaInsetsContext) is measured for THIS navigator. Hidden tabs are
// kept cheap the targeted way: loops park on `useOnScreen`, first fetches wait
// for focus (useQuery), and a refresh that changes nothing re-renders nothing
// (api/cache.js).
const Tab = createMaterialTopTabNavigator();

// How long after launch the other three tabs start being built. Long enough
// that Home has drawn and its first requests are away; short enough that
// nobody has finished reading the screen and reached for a tab.
const TAB_PRELOAD_DELAY_MS = 1500;
// The breather between building one of them and building the next.
const TAB_PRELOAD_STEP_MS = 160;

function MainTabs() {
  const { colors } = useTheme();
  const reduced = useReduceMotion();
  const { width } = useWindowDimensions();

  // PRELOAD THE OTHER TABS — BUT NOT DURING LAUNCH, AND NOT DURING THE SWIPE.
  //
  // `lazyPreloadDistance: 3` is what stops a tab tap from being a mount, and
  // it is worth keeping. As a FIXED option, though, it is a mount cost paid
  // at the worst possible moment either way: set to 0, the first swipe to
  // each tab pays for that tab's mount — Mapbox's GL context included — right
  // in the middle of the pager's swipe animation, which is the stutter this
  // was rewritten to fix and instead reintroduced. Set to 3 from launch,
  // opening the app builds all four tabs at once, racing the screen the
  // runner is actually looking at.
  //
  // So it starts at zero and climbs to three once the app is idle. Home mounts
  // alone, draws, and settles; the other three are built behind it a beat
  // later — off the interaction path, not inside a gesture — and are ready
  // by the time anybody swipes or taps a tab. Changing a screen option
  // remounts nothing — the tabs that already exist stay exactly as they are.
  //
  // ONE TAB PER STEP. It used to jump from zero straight to three, which built
  // Map (its GL context and all), Club and You in a SINGLE commit: the longest
  // freeze in the app, a second and a half after launch, which is exactly when
  // a runner first reaches for the screen. The distance now climbs one at a
  // time and hands the thread back in between, so the same work is three
  // shorter tasks with frames and touches between them instead of one long
  // one. It counts out from the tab in front, so from Home that is Map, then
  // Club, then You, the last a few hundred milliseconds after the first.
  const [preloadDistance, setPreloadDistance] = useState(0);
  useEffect(() => {
    let alive = true;
    let task = null;
    let timer = null;
    const step = (distance) => {
      task = InteractionManager.runAfterInteractions(() => {
        if (!alive) return;
        setPreloadDistance(distance);
        if (distance < 3) timer = setTimeout(() => step(distance + 1), TAB_PRELOAD_STEP_MS);
      });
    };
    timer = setTimeout(() => step(1), TAB_PRELOAD_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
      task?.cancel?.();
    };
  }, []);

  const screenOptions = useMemo(
    () => ({
      swipeEnabled: true,
      animationEnabled: !reduced,
      lazy: true,
      lazyPreloadDistance: preloadDistance,
    }),
    [preloadDistance, reduced]
  );

  return (
    <Tab.Navigator
      tabBarPosition="bottom"
      tabBar={(props) => <TabBar {...props} />}
      initialLayout={{ width }}
      // Our TabBar is a floating pill on a transparent dock, so the pager's own
      // surface is what shows around and under it — state it explicitly rather
      // than relying on the navigator's default.
      style={{ backgroundColor: colors.bg }}
      sceneContainerStyle={{ backgroundColor: colors.bg }}
      // Lazy mounting's low initial cost, and every tab prepared before it is
      // asked for — see `preloadDistance` above for why the second half of
      // that is deferred rather than set at launch. Separately, useQuery
      // (hooks/useQuery.js) gates each screen's FIRST fetch on that screen
      // being focused, so a preloaded tab is built without also firing its
      // network requests.
      screenOptions={screenOptions}
    >
      <Tab.Screen name="Home" component={HomeTab} />
      <Tab.Screen name="Map" component={MapTab} options={{ swipeEnabled: false }} />
      <Tab.Screen name="Club" component={ClubTab} />
      {/* The steal popup and the tutorial still deep-link into You › Rivals /
          Pasers, which leaves the You stack sitting on that inner screen.
          Tapping the You tab then re-showed it instead of the profile, because
          navigate('You') restores the stack's existing state. Reset to the
          profile on every tab press — the standard "tap the tab, go to its
          root" behaviour. (Home's side rail no longer comes through here; it
          pushes onto Home's own stack.) */}
      <Tab.Screen
        name="You"
        component={YouTab}
        listeners={({ navigation }) => ({
          tabPress: () => navigation.navigate('You', { screen: 'YouMain' }),
        })}
      />
    </Tab.Navigator>
  );
}

// --- record modal (Record → Result owns the screen) ------------------------

function CloseRecordButton({ navigation }) {
  const { isRecording } = useRecording();
  const dismiss = () => navigation.getParent()?.goBack();
  const onPress = () => {
    if (isRecording) {
      Alert.alert('Discard run?', "Your route won't be saved.", [
        { text: 'Keep running', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: dismiss },
      ]);
    } else {
      dismiss();
    }
  };
  return (
    <TouchableOpacity onPress={onPress} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close run">
      <X size={24} color={darkColors.text} />
    </TouchableOpacity>
  );
}

const RecordStackNav = createNativeStackNavigator();
// Boundaried like the tabs are, and for a reason paid for in full: the record
// modal sits at the ROOT, outside every tab's boundary, so a render throw in
// the run or its result had nothing above it to catch it — and an uncaught
// throw in a release build is not a retry state, it is the app closing. That
// is exactly how one `undefined` icon on the share sheet read as "PASER
// crashes when I finish a run". The run flow is the worst possible place to
// leave unguarded: it is the end of an effort the runner cannot repeat.
function RecordModal({ route }) {
  return (
    <ErrorBoundary>
      {/* The tutorial's second host. `fullScreenModal` presents a real view
          controller above the React root, so the overlay beside the navigator
          cannot reach this screen — the run and claim coach marks are drawn
          from in here instead. It renders nothing unless the tutorial is on a
          step that belongs to it. */}
      <View style={{ flex: 1 }}>
        <RecordStack watchStartAt={route?.params?.watchStartAt} />
        <TutorialOverlay host="record" />
      </View>
    </ErrorBoundary>
  );
}

// Same deal for the share screen reached from a feed card: it is at the root,
// outside every tab's boundary, and it mounts the one card that has taken the
// app down before.
function RunShareModal(props) {
  return (
    <ErrorBoundary>
      <RunShareScreen {...props} />
    </ErrorBoundary>
  );
}

// Placing a run's land later, from Home or the run's own page. At the root and
// boundaried like Record: it IS the claim screen, the heaviest thing in the app.
function PlanAttackModal(props) {
  return (
    <ErrorBoundary>
      {/* Same claim screen, same modal presentation, so the same second host —
          a runner whose first claim is placed later still gets taught it. */}
      <View style={{ flex: 1 }}>
        <PlanAttackScreen {...props} />
        <TutorialOverlay host="record" />
      </View>
    </ErrorBoundary>
  );
}

function RecordStack({ watchStartAt }) {
  return (
    <RecordStackNav.Navigator
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: darkColors.bg } }}
    >
      <RecordStackNav.Screen
        name="Record"
        component={RunningScreen}
        initialParams={{ watchStartAt }}
        options={({ navigation }) => ({
          headerShown: true,
          headerTransparent: false,
          headerTitle: '',
          headerStyle: { backgroundColor: darkColors.bg },
          headerShadowVisible: false,
          headerTintColor: darkColors.text,
          headerLeft: () => <CloseRecordButton navigation={navigation} />,
        })}
      />
      {/* Fades rather than pushing. A horizontal push says "you moved forward
          and can come back"; finishing a run is neither — the run ends and its
          payoff resolves in place. */}
      <RecordStackNav.Screen
        name="Result"
        component={ResultScreen}
        options={{ headerShown: false, animation: 'fade' }}
      />
    </RecordStackNav.Navigator>
  );
}

// --- root ------------------------------------------------------------------

const AuthStackNav = createNativeStackNavigator();
function AuthNavigator() {
  return (
    <AuthStackNav.Navigator screenOptions={{ headerShown: false }}>
      <AuthStackNav.Screen name="Auth" component={AuthScreen} />
    </AuthStackNav.Navigator>
  );
}

const RootStackNav = createNativeStackNavigator();
function RootStack() {
  const header = useHeaderChrome();
  return (
    <RootStackNav.Navigator screenOptions={{ headerShown: false, ...header }}>
      <RootStackNav.Screen name="Tabs" component={MainTabs} />
      {/* Shop lives at the ROOT, not inside the You stack. The Home side rail
          opens it, and when it sat under You that deep-link left the You tab
          resting on the shop — tapping You then reopened the shop instead of
          the profile. */}
      {/* Draws its own header row (back, title and coin purse on one line),
          so the native bar stays off. */}
      <RootStackNav.Screen
        name="Shop"
        component={ShopScreen}
        options={{ title: 'Water point' }}
      />
      <RootStackNav.Screen
        name="Record"
        component={RecordModal}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
      {/* Sharing an OLD run, from its card in the feed. At the root and full
          screen for the same reason Record is: the sheet is a whole screen and
          must not be posted from under the tab bar. Boundaried too — the share
          card is the one surface in this app with a crash history. */}
      <RootStackNav.Screen
        name="RunShare"
        component={RunShareModal}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
      {/* A run's land, placed later (PlanAttackScreen). Full screen because it
          is the claim map, and it fades the way the claim does after a run
          rather than sliding up like a new task. */}
      <RootStackNav.Screen
        name="PlanAttack"
        component={PlanAttackModal}
        options={{ presentation: 'fullScreenModal', animation: 'fade' }}
      />
      {__DEV__ && (
        <RootStackNav.Screen
          name="AnimationGallery"
          component={AnimationGalleryScreen}
          options={{ headerShown: true, title: 'Animation Gallery' }}
        />
      )}
    </RootStackNav.Navigator>
  );
}

// Status bar icons follow the active theme (dark icons on light, and vice versa).
function ThemedStatusBar() {
  const { scheme, colors } = useTheme();
  return <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={colors.bg} />;
}

function FullScreenSpinner() {
  // Light stage so the black-outlined runner reads without any backdrop/border.
  return (
    <View style={{ flex: 1, backgroundColor: '#fbf7ee', justifyContent: 'center', alignItems: 'center' }}>
      <StatusBar barStyle="dark-content" backgroundColor="#fbf7ee" />
      <MascotLoader source={require('./assets/art/loading.png')} />
    </View>
  );
}

// Lets the tutorial overlay (which lives OUTSIDE the navigator) hand off to a
// screen inside it.
const navigationRef = createNavigationContainerRef();

// Offers Start on the watch throughout the signed-in app. A wrist press opens
// Record with a short-lived token; RunningScreen owns the countdown, API call,
// permissions and GPS exactly as it does for the phone's Start button.
function WatchRunLauncher({ enabled }) {
  const { isRecording } = useRecording();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [routeName, setRouteName] = useState(null);
  const canStart = enabled && appActive && !isRecording && routeName !== 'Record';

  useEffect(() => {
    const appSub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    const syncRoute = () => setRouteName(navigationRef.getCurrentRoute()?.name || null);
    syncRoute();
    const navSub = navigationRef.addListener('state', syncRoute);
    return () => {
      appSub?.remove?.();
      navSub?.();
      publishToWatch({ phase: WATCH_PHASE.IDLE });
    };
  }, []);

  useEffect(() => {
    if (routeName === 'Record' || isRecording) return;
    publishToWatch({ phase: canStart ? WATCH_PHASE.READY : WATCH_PHASE.IDLE });
  }, [canStart, enabled, isRecording, routeName]);

  useEffect(() => {
    if (!enabled) return undefined;
    const sub = addWatchCommandListener((command) => {
      if (!canStart || !commandAllowed(command, WATCH_PHASE.READY)) return;
      if (!navigationRef.isReady()) return;
      navigationRef.navigate('Record', { watchStartAt: command.at });
    });
    return () => sub.remove();
  }, [canStart, enabled]);

  return null;
}

function RootNavigator() {
  const { colors } = useTheme();
  const navTheme = useNavTheme();
  const {
    signedIn,
    loading,
    needsOnboarding,
    onboardingIdentity,
    completeOnboarding,
  } = useAuth();
  const { needsSetup: avatarNeedsSetup, loading: avatarLoading } = useAvatar();
  const { loading: profileLoading } = useProfile();
  const reduced = useReduceMotion();
  const [locStatus, setLocStatus] = useState(null);
  const [locHandled, setLocHandled] = useState(false);
  const [navReady, setNavReady] = useState(false);
  usePushRegistration(signedIn);
  // Foreground handler, Android channels, and tap routing for every category
  // — cold start included. The per-event hosts below own their in-app banners;
  // this owns "where does a tapped notification open".
  useNotificationTaps(navigationRef, navReady && signedIn);

  useEffect(() => {
    if (!signedIn) setNavReady(false);
  }, [signedIn]);
  // A subscription renews with the app closed, so the expiry the backend
  // holds goes stale on its own. This re-posts whatever the store says is
  // live; it can only ever extend PRO, never take it away.
  useProSync(signedIn);

  useEffect(() => {
    if (!signedIn) return;
    Location.getForegroundPermissionsAsync()
      .then((r) => setLocStatus(r.status))
      .catch(() => setLocStatus('granted'));
  }, [signedIn]);

  // Pick the current phase + its screen. Each phase CROSSFADES in (keyed
  // Animated.View) instead of hard-swapping. Only one NavigationContainer is
  // ever mounted at a time (no `exiting`), so phases never overlap in the tree.
  let phase = 'app';
  let content;
  if (loading) {
    phase = 'loading';
    content = <FullScreenSpinner />;
  } else if (!signedIn) {
    phase = 'auth';
    content = (
      <NavigationContainer theme={navTheme}>
        <AuthNavigator />
      </NavigationContainer>
    );
  } else if (avatarLoading || profileLoading) {
    // The intro builds the avatar, so wait for the saved loadout + profile
    // before deciding whether it needs to run at all.
    phase = 'loading';
    content = <FullScreenSpinner />;
  } else if (needsOnboarding || avatarNeedsSetup) {
    // New account → the full intro (name · birthday · character · PRO).
    // Existing account with no avatar (predates the avatar system) → just the
    // character steps, exactly once.
    phase = 'onboarding';
    content = (
      <OnboardingFlow
        mode={needsOnboarding ? 'full' : 'character'}
        onboardingIdentity={needsOnboarding ? onboardingIdentity : null}
        onDone={completeOnboarding}
      />
    );
  } else if (locStatus === 'undetermined' && !locHandled) {
    phase = 'location';
    content = (
      <LocationPermissionScreen
        onDone={(granted) => {
          setLocHandled(true);
          setLocStatus(granted ? 'granted' : 'denied');
        }}
      />
    );
  } else {
    phase = 'app';
    content = (
      <>
        <NavigationContainer
          ref={navigationRef}
          theme={navTheme}
          linking={linking}
          onReady={() => setNavReady(true)}
        >
          <RootStack />
        </NavigationContainer>
        <WatchRunLauncher enabled={navReady && locStatus === 'granted'} />
        {/* A tier lost while the app was closed, told once on the way back
            in. Outside the navigator like the alert hosts below. */}
        <RankDropWatcher navigationRef={navigationRef} ready={navReady} />
        {/* Steal alerts drop in over whatever screen is up, so the host lives
            outside the navigator — same as the tutorial overlay. */}
        <RivalPopupHost
          onOpen={() => {
            if (!navigationRef.isReady()) return;
            // initial:false keeps YouMain underneath, so Rivals' back button
            // works and the You tab isn't left stranded on a detail screen.
            navigationRef.navigate('Tabs', {
              screen: 'You',
              params: { screen: 'Rivals', initial: false },
            });
          }}
        />
        <LandCaptureAlertHost
          onViewLand={(capture) => {
            if (!navigationRef.isReady()) return;
            // A real ring lets the map FIT the exact ground taken; a bare point
            // is the fallback (older captures / any path without the ring).
            const ring = Array.isArray(capture?.territoryRing) && capture.territoryRing.length >= 3
              ? capture.territoryRing
              : null;
            const focus =
              Number.isFinite(capture?.lat) && Number.isFinite(capture?.lon)
                ? { focus: { lat: capture.lat, lon: capture.lon, ring } }
                : ring
                  ? { focus: { ring } }
                  : undefined;
            navigationRef.navigate('Tabs', {
              screen: 'Map',
              params: { screen: 'MapMain', params: focus },
            });
          }}
        />
        {/* Somebody new turning up at the plaza, while the app is open. The
            banner sits over whatever screen is up and blocks nothing. */}
        <CrossroadsAlertHost
          onOpen={() => {
            if (!navigationRef.isReady()) return;
            // The Home stack's copy, with HomeMain left underneath — the You
            // stack registers Crossroads too, but sending somebody there from a
            // banner would strand the You tab on an inner screen.
            navigationRef.navigate('Tabs', {
              screen: 'Home',
              params: { screen: 'Crossroads', initial: false },
            });
          }}
        />
        {/* Somebody ran your border and your territory held. Not a full-screen
            cutscene — losing land earns that, a defense that held earns a line
            you can tap through to the map or let pass. */}
        <DefenseHeldBanner
          onOpen={(focus) => {
            if (!navigationRef.isReady()) return;
            navigationRef.navigate('Tabs', {
              screen: 'Map',
              params: { screen: 'MapMain', params: focus },
            });
          }}
        />
        {/* First-run coach marks over the tabs: the world, the loop, and the
            record button. The run and claim halves of the same tutorial are
            drawn by a SECOND host inside the record modal — a fullScreenModal
            is presented above the React root, so nothing mounted out here can
            draw on it. See src/tutorial/TutorialOverlay.js. */}
        <TutorialOverlay host="root" />
      </>
    );
  }

  return (
    <Animated.View
      key={phase}
      style={{ flex: 1, backgroundColor: colors.bg }}
      // Slower than it was, and eased out rather than linear: the app should
      // read as arriving, and a 300ms linear ramp is quick enough that the
      // first half is spent at an opacity nobody can see, so it lands as a
      // slightly soft cut. The long tail is the part that reads as a fade.
      entering={reduced ? undefined : FadeIn.duration(440).easing(Easing.out(Easing.quad))}
    >
      {content}
    </Animated.View>
  );
}

// Start the API container booting the moment PASER is on screen.
//
// The live backend spins down when nothing has called it, and the request that
// wakes it waits for the whole boot — measured at 43 SECONDS. Until now the
// only warm-up pings were on the sign-in screen and the run screen, so the
// case that hurts most was the one nobody covered: a signed-in runner opening
// the app, or coming back to it after lunch. Their first request IS the wake-up
// call, and every screen sits on cached content behind it.
//
// This does not make the boot faster — nothing in the app can, and the real
// fix is the instance type (see backend/render.yaml, which asks for `starter`
// and is not what is running). What it does is stop the wait being serial: the
// container starts while fonts load, art decodes and the cached UI paints, so
// by the time anybody taps something the server has had a head start on it.
//
// Cheap enough to fire on every foreground: one unauthenticated GET that is
// abandoned on a timeout and whose result is thrown away.
function useBackendWarmUp() {
  useEffect(() => {
    warmUp();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') warmUp();
    });
    return () => sub.remove();
  }, []);
}

// Local-only visual review surface. EXPO_PUBLIC_SHARE_PREVIEW is never set by
// an EAS profile; it lets us show the capture component itself in a browser.
const SHARE_PREVIEW_PATH = Array.from({ length: 48 }, (_, i) => ({
  latitude: 1.29 + Math.sin((i / 48) * Math.PI * 2) * (0.0025 + 0.0007 * Math.sin(i * 1.7)),
  longitude: 103.84 + Math.cos((i / 48) * Math.PI * 2) * (0.0036 + 0.0008 * Math.cos(i * 1.3)),
}));

function SharePreview() {
  const { width, height } = useWindowDimensions();
  const cardWidth = Math.min(380, width * 0.9, height * 0.52);
  return (
    <View style={{ flex: 1, backgroundColor: '#10141A', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ backgroundColor: '#71879A', borderRadius: 24, overflow: 'hidden' }}>
        <RunShareCard
          width={cardWidth}
          team={{ fill: '#FDE7F1', stroke: '#EC4899', glow: '#EC4899' }}
          run={{ distanceM: 18230, durationS: 5401, areaM2: 0 }}
          path={SHARE_PREVIEW_PATH}
          rings={null}
          showCharacter={false}
        />
      </View>
    </View>
  );
}

// Keeps the runner's portrait on the Apple Watch in step with the studio.
// Mounted at the root rather than on the Run screen: the watch app records
// standalone, so the wrist can want the picture on a morning the Run screen is
// never opened. Draws nothing and costs one hash per loadout change on a phone
// with no watch.
function WatchPortrait() {
  const { equipped } = useAvatar();
  return <WatchAvatarSync equipped={equipped} />;
}

function App() {
  useBackendWarmUp();
  const [startupImagesReady, setStartupImagesReady] = useState(false);
  // The response cache is read from disk into memory ONCE, here, so that every
  // screen's first render can seed itself from it synchronously. Doing it later
  // (or per screen) would put an AsyncStorage tick in front of the content and
  // give back the frame of skeleton the cache exists to remove. It is a single
  // small read and it overlaps the font load, so it costs no real time — but it
  // is raced anyway, because nothing on the launch path may block forever.
  const [cacheReady, setCacheReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);

  useEffect(() => {
    let alive = true;
    const done = () => alive && setCacheReady(true);
    const guard = setTimeout(done, 400);
    // The PRO exposure record rides along with the cache read: it is the same
    // kind of thing (a small blob that has to be in memory before the first
    // render can decide what to show) and it must not add a second gate to the
    // launch path. It is deliberately NOT raced against `done` — a slow read
    // costs at most one extra free planner preview, never a delayed launch.
    hydrateProExposure();
    // The saved theme rides the same gate, so the first frame is already in
    // the scheme the runner picked rather than the default, then a swap.
    Promise.all([hydrateCache(), hydrateThemePreference()]).finally(() => {
      clearTimeout(guard);
      done();
    });
    return () => {
      alive = false;
      clearTimeout(guard);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const finish = () => {
      if (active) setStartupImagesReady(true);
    };
    // A corrupt/missing optional PNG must not strand someone on the native
    // splash. Normal bundled assets resolve well before this guard fires.
    const guard = setTimeout(finish, 1500);
    // Hold the splash for the first frame's art only; the rest of the startup
    // family decodes behind the running app. Waiting on the full set put every
    // one of those decodes in front of the user before anything was drawn.
    //
    // The first frame includes the runners on the feed rows Home paints from
    // the cache, so this waits on that read as well — the rows are chosen from
    // what it holds. Both halves decode in parallel and the guard caps the lot.
    Promise.all([
      preloadCriticalImages(),
      hydrateCache().then(preloadHomeFeedRunners),
    ]).finally(() => {
      clearTimeout(guard);
      finish();
      preloadStartupImages().catch(() => {});
    });
    return () => {
      active = false;
      clearTimeout(guard);
    };
  }, []);

  const ready = (fontsLoaded || fontError) && startupImagesReady && cacheReady;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  if (process.env.EXPO_PUBLIC_SHARE_PREVIEW === '1') return <SharePreview />;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <MotionProvider>
          <AuthProvider>
            <ClanProvider>
              <AvatarProvider>
                <ProfileProvider>
                  <RecordingProvider>
                    <SettingsProvider>
                      {/* PASER PRO. Innermost on purpose: it reads auth, the
                          clan accent and the theme, and it hosts the app's ONE
                          paywall sheet above the navigator. Screens never
                          mount a paywall of their own any more — they call
                          openPaywall(context). See src/pro/ProProvider.js. */}
                      <ProProvider>
                        {/* Inside ProProvider because the one thing it needs
                            that nothing else has is the account's finished-run
                            count — the second half of "is this a genuinely new
                            player". Everything below it is passed as children,
                            so a coach mark moving re-renders the overlay and
                            nothing else. */}
                        <TutorialProvider navigationRef={navigationRef}>
                          <ThemedStatusBar />
                          <WatchPortrait />
                          <RootNavigator />
                          <OfflineBanner />
                          <ToastHost />
                        </TutorialProvider>
                      </ProProvider>
                    </SettingsProvider>
                  </RecordingProvider>
                </ProfileProvider>
              </AvatarProvider>
            </ClanProvider>
          </AuthProvider>
        </MotionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

export default SENTRY_DSN ? Sentry.wrap(App) : App;
