import React, { useEffect } from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
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

import HomeScreen from './src/screens/HomeScreen';
import RunningScreen from './src/screens/RunningScreen';
import ResultScreen from './src/screens/ResultScreen';
import GlobalMapScreen from './src/screens/GlobalMapScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import AuthScreen from './src/screens/AuthScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import ProfileScreen from './src/screens/ProfileScreen';

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { MotionProvider } from './src/ui/motion';
import { OfflineBanner } from './src/ui/offline';
import { ToastHost } from './src/ui/toast';
import { colors, darkColors, fonts } from './src/theme';

// Hold the splash until fonts are ready — avoids a flash of fallback type.
SplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator();

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

const screenOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerTitleStyle: { color: colors.text, fontFamily: fonts.display },
  headerTintColor: colors.text,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

// The active run is the one dark screen — give it a matching dark header.
const runScreenOptions = {
  headerStyle: { backgroundColor: darkColors.bg },
  headerTitleStyle: { color: darkColors.text, fontFamily: fonts.display },
  headerTintColor: darkColors.text,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: darkColors.bg },
};

function FullScreenSpinner() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

function RootNavigator() {
  const { signedIn, loading, needsOnboarding, completeOnboarding } = useAuth();

  if (loading) return <FullScreenSpinner />;

  if (!signedIn) {
    return (
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator screenOptions={{ ...screenOptions, headerShown: false }}>
          <Stack.Screen name="Auth" component={AuthScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    );
  }

  // New accounts get the intro once, right after signing up.
  if (needsOnboarding) {
    return <OnboardingScreen onDone={completeOnboarding} />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator initialRouteName="Home" screenOptions={screenOptions}>
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Running"
          component={RunningScreen}
          options={{ title: 'Run', ...runScreenOptions }}
        />
        <Stack.Screen
          name="Result"
          component={ResultScreen}
          options={{ title: 'Result', ...runScreenOptions }}
        />
        <Stack.Screen
          name="GlobalMap"
          component={GlobalMapScreen}
          options={{ title: 'World Map' }}
        />
        <Stack.Screen
          name="Leaderboard"
          component={LeaderboardScreen}
          options={{ title: 'Leaderboard' }}
        />
        <Stack.Screen
          name="Profile"
          component={ProfileScreen}
          options={{ title: 'Profile' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  // Keep the native splash up until type is ready (or failed — then we
  // proceed with system fallbacks rather than blocking the app forever).
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <MotionProvider>
        <AuthProvider>
          <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
          <RootNavigator />
          <OfflineBanner />
          <ToastHost />
        </AuthProvider>
      </MotionProvider>
    </SafeAreaProvider>
  );
}
