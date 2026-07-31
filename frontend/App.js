import React, { useEffect, useState } from 'react';
import { Alert, StatusBar, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import {
  createNavigationContainerRef,
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
import TabBar from './src/navigation/TabBar';
import ErrorBoundary from './src/components/ErrorBoundary';
import { usePushRegistration } from './src/hooks/usePush';
import { colors, darkColors, fonts, ThemeProvider, useTheme } from './src/theme';

// Crash telemetry — a strict no-op unless a DSN is provided via env/extra.
const SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN || Constants?.expoConfig?.extra?.sentryDsn || '';
if (SENTRY_DSN) Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.1 });

SplashScreen.preventAutoHideAsync().catch(() => {});

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    border: colors.border,
    primary: colors.primary,
  },
};

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
    },
  },
};

// --- per-tab stacks --------------------------------------------------------

const HomeStackNav = createNativeStackNavigator();
function HomeStack() {
  return (
    <HomeStackNav.Navigator screenOptions={{ headerShown: false }}>
      <HomeStackNav.Screen name="HomeMain" component={HomeScreen} />
      <HomeStackNav.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{ headerShown: true, title: 'Leaderboard', ...headerLight }}
      />
      <HomeStackNav.Screen
        name="RunDetail"
        component={RunDetailScreen}
        options={{ headerShown: true, title: 'Run', ...headerLight }}
      />
      <HomeStackNav.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ headerShown: true, title: 'Notifications', ...headerLight }}
      />
      <HomeStackNav.Screen
        name="Season"
        component={SeasonScreen}
        options={{ headerShown: true, title: 'Season', ...headerLight }}
      />
      <HomeStackNav.Screen
        name="ClubDetail"
        component={ClubDetailScreen}
        options={{ headerShown: true, title: 'Club', ...headerLight }}
      />
    </HomeStackNav.Navigator>
  );
}

const MapStackNav = createNativeStackNavigator();
function MapStack() {
  return (
    <MapStackNav.Navigator screenOptions={{ headerShown: false }}>
      <MapStackNav.Screen name="MapMain" component={GlobalMapScreen} />
    </MapStackNav.Navigator>
  );
}

const ClubStackNav = createNativeStackNavigator();
function ClubStack() {
  return (
    <ClubStackNav.Navigator screenOptions={{ headerShown: false }}>
      <ClubStackNav.Screen name="ClubMain" component={ClubScreen} />
      <ClubStackNav.Screen
        name="ClubCreate"
        component={ClubCreateScreen}
        options={{ headerShown: true, title: 'Create club', ...headerLight }}
      />
      <ClubStackNav.Screen
        name="ClubJoin"
        component={ClubJoinScreen}
        options={{ headerShown: true, title: 'Join club', ...headerLight }}
      />
      <ClubStackNav.Screen
        name="ClubDetail"
        component={ClubDetailScreen}
        options={{ headerShown: true, title: 'Club', ...headerLight }}
      />
      <ClubStackNav.Screen
        name="ClubChat"
        component={ClubChatScreen}
        options={{ headerShown: true, title: 'Club chat', ...headerLight }}
      />
    </ClubStackNav.Navigator>
  );
}

const YouStackNav = createNativeStackNavigator();
function YouStack() {
  return (
    <YouStackNav.Navigator screenOptions={{ headerShown: false }}>
      <YouStackNav.Screen name="YouMain" component={ProfileScreen} />
      <YouStackNav.Screen
        name="Progression"
        component={ProgressionScreen}
        options={{ headerShown: true, title: 'Levels & rewards', ...headerLight }}
      />
      <YouStackNav.Screen
        name="AvatarStudio"
        component={AvatarStudioScreen}
        options={{ headerShown: true, title: 'Your runner', ...headerLight }}
      />
      <YouStackNav.Screen
        name="RunDetail"
        component={RunDetailScreen}
        options={{ headerShown: true, title: 'Run', ...headerLight }}
      />
      {/* Pasers and Rivals draw their own gradient headers (with a back
          button), so the native one is off. */}
      <YouStackNav.Screen name="Pasers" component={PasersScreen} />
      <YouStackNav.Screen name="Rivals" component={RivalsScreen} />
      <YouStackNav.Screen
        name="RunnerProfile"
        component={RunnerProfileScreen}
        // title is set by the screen once the runner's name loads
        options={{ headerShown: true, title: 'Runner', ...headerLight }}
      />
    </YouStackNav.Navigator>
  );
}

const headerLight = {
  headerStyle: { backgroundColor: colors.bg },
  headerTitleStyle: { color: colors.text, fontFamily: fonts.display },
  headerTintColor: colors.text,
  headerShadowVisible: false,
};

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
  const { width } = useWindowDimensions();
  return (
    <Tab.Navigator
      tabBarPosition="bottom"
      tabBar={(props) => <TabBar {...props} />}
      initialLayout={{ width }}
      screenOptions={{ swipeEnabled: true, lazy: true }}
    >
      <Tab.Screen name="Home" component={HomeTab} />
      <Tab.Screen name="Map" component={MapTab} options={{ swipeEnabled: false }} />
      <Tab.Screen name="Club" component={ClubTab} />
      {/* Home deep-links into You › Pasers / Rivals, which leaves the You
          stack sitting on that inner screen. Tapping the You tab then
          re-showed Pasers instead of the profile, because navigate('You')
          restores the stack's existing state. Reset to the profile on every
          tab press — the standard "tap the tab, go to its root" behaviour. */}
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
      <RecordStackNav.Screen name="Result" component={ResultScreen} options={{ headerShown: false }} />
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
  return (
    <RootStackNav.Navigator screenOptions={{ headerShown: false }}>
      <RootStackNav.Screen name="Tabs" component={MainTabs} />
      {/* Shop lives at the ROOT, not inside the You stack. The Home side rail
          opens it, and when it sat under You that deep-link left the You tab
          resting on the shop — tapping You then reopened the shop instead of
          the profile. */}
      <RootStackNav.Screen
        name="Shop"
        component={ShopScreen}
        options={{ headerShown: true, title: 'Shop', ...headerLight }}
      />
      <RootStackNav.Screen
        name="Record"
        component={RecordModal}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
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
        {/* first-run coach marks, dimming the real home screen behind them */}
        {profile.tutorialPending ? (
          <TutorialOverlay
            name={displayName}
            onDone={completeTutorial}
            onAddPaser={() => {
              if (!navigationRef.isReady()) return;
              navigationRef.navigate('Tabs', {
                screen: 'You',
                params: { screen: 'Pasers' },
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
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

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
