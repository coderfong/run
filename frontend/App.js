import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StatusBar, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
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

import HomeScreen from './src/screens/HomeScreen';
import RunningScreen from './src/screens/RunningScreen';
import ResultScreen from './src/screens/ResultScreen';
import GlobalMapScreen from './src/screens/GlobalMapScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import AuthScreen from './src/screens/AuthScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import LocationPermissionScreen from './src/screens/LocationPermissionScreen';
import RunDetailScreen from './src/screens/RunDetailScreen';
import ClubScreen from './src/screens/ClubScreen';
import ClubJoinScreen from './src/screens/ClubJoinScreen';
import ClubCreateScreen from './src/screens/ClubCreateScreen';

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { ClanProvider } from './src/state/clan';
import { MotionProvider } from './src/ui/motion';
import { RecordingProvider, useRecording } from './src/state/recording';
import { OfflineBanner } from './src/ui/offline';
import { ToastHost } from './src/ui/toast';
import TabBar from './src/navigation/TabBar';
import ErrorBoundary from './src/components/ErrorBoundary';
import { usePushRegistration } from './src/hooks/usePush';
import { colors, darkColors, fonts } from './src/theme';

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

// territoryrun:// deep links. Run-result links land in Phase 6 once a
// standalone run-detail route exists.
const linking = {
  prefixes: ['territoryrun://'],
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
        options={{ headerShown: true, title: 'Create clan', ...headerLight }}
      />
      <ClubStackNav.Screen
        name="ClubJoin"
        component={ClubJoinScreen}
        options={{ headerShown: true, title: 'Join clan', ...headerLight }}
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
        name="RunDetail"
        component={RunDetailScreen}
        options={{ headerShown: true, title: 'Run', ...headerLight }}
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

const Tab = createBottomTabNavigator();
function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tab.Screen name="Home" component={HomeTab} />
      <Tab.Screen name="Map" component={MapTab} />
      <Tab.Screen name="Club" component={ClubTab} />
      <Tab.Screen name="You" component={YouTab} />
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
      <RootStackNav.Screen
        name="Record"
        component={RecordModal}
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
      />
    </RootStackNav.Navigator>
  );
}

function FullScreenSpinner() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

function RootNavigator() {
  const { signedIn, loading, needsOnboarding, completeOnboarding } = useAuth();
  const [locStatus, setLocStatus] = useState(null);
  const [locHandled, setLocHandled] = useState(false);
  usePushRegistration(signedIn);

  useEffect(() => {
    if (!signedIn) return;
    Location.getForegroundPermissionsAsync()
      .then((r) => setLocStatus(r.status))
      .catch(() => setLocStatus('granted'));
  }, [signedIn]);

  if (loading) return <FullScreenSpinner />;

  if (!signedIn) {
    return (
      <NavigationContainer theme={navTheme}>
        <AuthNavigator />
      </NavigationContainer>
    );
  }

  if (needsOnboarding) return <OnboardingScreen onDone={completeOnboarding} />;

  if (locStatus === 'undetermined' && !locHandled) {
    return (
      <LocationPermissionScreen
        onDone={(granted) => {
          setLocHandled(true);
          setLocStatus(granted ? 'granted' : 'denied');
        }}
      />
    );
  }

  return (
    <NavigationContainer theme={navTheme} linking={linking}>
      <RootStack />
    </NavigationContainer>
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
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <MotionProvider>
        <AuthProvider>
          <ClanProvider>
            <RecordingProvider>
              <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
              <RootNavigator />
              <OfflineBanner />
              <ToastHost />
            </RecordingProvider>
          </ClanProvider>
        </AuthProvider>
      </MotionProvider>
    </SafeAreaProvider>
  );
}

export default SENTRY_DSN ? Sentry.wrap(App) : App;
