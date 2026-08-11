import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StatusBar, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
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
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { X } from 'lucide-react-native';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Poppins_700Bold, Poppins_900Black } from '@expo-google-fonts/poppins';

import HomeScreen from './src/screens/HomeScreen';
import RunningScreen from './src/screens/RunningScreen';
import ResultScreen from './src/screens/ResultScreen';
import GlobalMapScreen from './src/screens/GlobalMapScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import AuthScreen from './src/screens/AuthScreen';
import OnboardingFlow from './src/onboarding/OnboardingFlow';
import TutorialOverlay from './src/onboarding/TutorialOverlay';
import ProfileScreen from './src/screens/ProfileScreen';
import LocationPermissionScreen from './src/screens/LocationPermissionScreen';
import RunDetailScreen from './src/screens/RunDetailScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ClubScreen from './src/screens/ClubScreen';
import ClubJoinScreen from './src/screens/ClubJoinScreen';
import ClubCreateScreen from './src/screens/ClubCreateScreen';
import ClubDetailScreen from './src/screens/ClubDetailScreen';
import ClubChatScreen from './src/screens/ClubChatScreen';
import SeasonScreen from './src/screens/SeasonScreen';
import AvatarStudioScreen from './src/screens/AvatarStudioScreen';
import ShopScreen from './src/screens/ShopScreen';
import ProgressionScreen from './src/screens/ProgressionScreen';
import PasersScreen from './src/screens/PasersScreen';
import RivalsScreen from './src/screens/RivalsScreen';
import CrossroadsScreen from './src/screens/CrossroadsScreen';
import RunnerProfileScreen from './src/screens/RunnerProfileScreen';

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
import TabBar from './src/navigation/TabBar';
import ErrorBoundary from './src/components/ErrorBoundary';
import { usePushRegistration } from './src/hooks/usePush';
import { hydrateCache } from './src/api/cache';
import { preloadCriticalImages, preloadStartupImages } from './src/config/screenAssets';
// No static `colors` here on purpose — App used to build the nav theme and the
// header chrome from it, which pinned both to the dark palette. Everything
// theme-dependent now reads useTheme(); `darkColors` stays only for the record
// modal, which is deliberately dark in either theme.
import { darkColors, fonts, ThemeProvider, useTheme } from './src/theme';

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
    }),
    [colors]
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
      <HomeStackNav.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{ headerShown: true, title: 'Leaderboard' }}
      />
      <HomeStackNav.Screen
        name="RunDetail"
        component={RunDetailScreen}
        options={{ headerShown: true, title: 'Run' }}
      />
      <HomeStackNav.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ headerShown: true, title: 'Notifications' }}
      />
      {/* Season draws its own art header (with a back button), like Pasers
          and Rivals — the native one would stack a second bar above it. */}
      <HomeStackNav.Screen name="Season" component={SeasonScreen} />
      <HomeStackNav.Screen
        name="ClubDetail"
        component={ClubDetailScreen}
        options={{ headerShown: true, title: 'Club' }}
      />
      {/* The side rail's destinations, registered HERE as well as under You.
          They used to be opened with navigate('You', { screen: … }), which
          crossed into the other tab: back from the shop rail landed on the
          profile, and you could not get to Home without a second tap. A screen
          opened from Home is pushed onto Home's own stack, so back is Home.
          The You tab keeps its own copies for the routes reached from the
          profile, and each instance carries its own navigation state. */}
      <HomeStackNav.Screen
        name="Progression"
        component={ProgressionScreen}
        options={{ headerShown: true, title: 'Levels & rewards' }}
      />
      <HomeStackNav.Screen name="Rivals" component={RivalsScreen} />
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
        options={{ headerShown: true, title: 'Create club', presentation: 'modal' }}
      />
      <ClubStackNav.Screen
        name="ClubJoin"
        component={ClubJoinScreen}
        options={{ headerShown: true, title: 'Join club' }}
      />
      <ClubStackNav.Screen
        name="ClubDetail"
        component={ClubDetailScreen}
        options={{ headerShown: true, title: 'Club' }}
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
      <YouStackNav.Screen
        name="Progression"
        component={ProgressionScreen}
        options={{ headerShown: true, title: 'Levels & rewards' }}
      />
      <YouStackNav.Screen
        name="AvatarStudio"
        component={AvatarStudioScreen}
        options={{ headerShown: true, title: 'Your runner' }}
      />
      <YouStackNav.Screen
        name="RunDetail"
        component={RunDetailScreen}
        options={{ headerShown: true, title: 'Run' }}
      />
      {/* Pasers, Rivals and Crossroads draw their own gradient headers (with a
          back button), so the native one is off. */}
      <YouStackNav.Screen name="Pasers" component={PasersScreen} />
      <YouStackNav.Screen name="Rivals" component={RivalsScreen} />
      <YouStackNav.Screen name="Crossroads" component={CrossroadsScreen} />
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
const Tab = createMaterialTopTabNavigator();
function MainTabs() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
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
      // Keep lazy mounting's low initial cost, but prepare every one of our
      // four tabs while Home is visible. With the default distance of 0, iOS
      // first mounted and decoded a tab only after the user tapped/swiped it.
      screenOptions={{ swipeEnabled: true, lazy: true, lazyPreloadDistance: 3 }}
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
function RecordModal() {
  return (
    <RecordStackNav.Navigator
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: darkColors.bg } }}
    >
      <RecordStackNav.Screen
        name="Record"
        component={RunningScreen}
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
      <RootStackNav.Screen
        name="Shop"
        component={ShopScreen}
        options={{ headerShown: true, title: 'Water point' }}
      />
      <RootStackNav.Screen
        name="Record"
        component={RecordModal}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
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

function RootNavigator() {
  const { colors } = useTheme();
  const navTheme = useNavTheme();
  const { signedIn, loading, needsOnboarding, completeOnboarding } = useAuth();
  const { needsSetup: avatarNeedsSetup, loading: avatarLoading } = useAvatar();
  const { profile, displayName, loading: profileLoading, completeTutorial } = useProfile();
  const reduced = useReduceMotion();
  const [locStatus, setLocStatus] = useState(null);
  const [locHandled, setLocHandled] = useState(false);
  usePushRegistration(signedIn);

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
        <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
          <RootStack />
        </NavigationContainer>
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
            const focus =
              Number.isFinite(capture?.lat) && Number.isFinite(capture?.lon)
                ? { focus: { lat: capture.lat, lon: capture.lon } }
                : undefined;
            navigationRef.navigate('Tabs', {
              screen: 'Map',
              params: { screen: 'MapMain', params: focus },
            });
          }}
          onOpenNotifications={() => {
            if (!navigationRef.isReady()) return;
            navigationRef.navigate('Tabs', {
              screen: 'Home',
              params: { screen: 'Notifications', initial: false },
            });
          }}
        />
        {/* first-run coach marks, dimming the real home screen behind them */}
        {profile.tutorialPending ? (
          <TutorialOverlay
            name={displayName}
            onDone={completeTutorial}
            onAddPaser={() => {
              if (!navigationRef.isReady()) return;
              navigationRef.navigate('Tabs', {
                screen: 'You',
                // initial:false keeps the profile under Pasers, so its back
                // button returns there instead of dead-ending the tab.
                params: { screen: 'Pasers', initial: false },
              });
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <Animated.View
      key={phase}
      style={{ flex: 1, backgroundColor: colors.bg }}
      entering={reduced ? undefined : FadeIn.duration(300)}
    >
      {content}
    </Animated.View>
  );
}

function App() {
  const [startupImagesReady, setStartupImagesReady] = useState(false);
  // The response cache is read from disk into memory ONCE, here, so that every
  // screen's first render can seed itself from it synchronously. Doing it later
  // (or per screen) would put an AsyncStorage tick in front of the content and
  // give back the frame of skeleton the cache exists to remove. It is a single
  // small read and it overlaps the font load, so it costs no real time — but it
  // is raced anyway, because nothing on the launch path may block forever.
  const [cacheReady, setCacheReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Anton_400Regular,
    Poppins_700Bold,
    Poppins_900Black,
  });

  useEffect(() => {
    let alive = true;
    const done = () => alive && setCacheReady(true);
    const guard = setTimeout(done, 400);
    hydrateCache().finally(() => {
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
    preloadCriticalImages().finally(() => {
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
                      <ThemedStatusBar />
                      <RootNavigator />
                      <OfflineBanner />
                      <ToastHost />
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
