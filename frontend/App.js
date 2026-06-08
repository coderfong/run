import React from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/screens/HomeScreen';
import RunningScreen from './src/screens/RunningScreen';
import ResultScreen from './src/screens/ResultScreen';
import GlobalMapScreen from './src/screens/GlobalMapScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import AuthScreen from './src/screens/AuthScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import ProfileScreen from './src/screens/ProfileScreen';

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { ToastHost } from './src/ui/toast';
import { colors, darkColors } from './src/theme';

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
  headerTitleStyle: { color: colors.text, fontWeight: '800' },
  headerTintColor: colors.text,
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

// The active run is the one dark screen — give it a matching dark header.
const runScreenOptions = {
  headerStyle: { backgroundColor: darkColors.bg },
  headerTitleStyle: { color: darkColors.text, fontWeight: '800' },
  headerTintColor: '#ffffff',
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
          options={{ title: 'Result' }}
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
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />
        <RootNavigator />
        <ToastHost />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
