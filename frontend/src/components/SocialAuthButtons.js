// Google + Apple sign-in buttons.
//
// The OAuth SDKs are loaded LAZILY (dynamic require inside the press handler),
// so the app bundles and runs even before you install them. Until the packages
// + client IDs are configured, a tap shows a friendly "set up" toast instead of
// crashing.
//
// SETUP (do all of these to make it live):
//   1. npx expo install expo-apple-authentication expo-auth-session expo-web-browser expo-crypto
//   2. Google Cloud console → OAuth client IDs (iOS, Android, Web). Put them in
//      app.config.js `extra`: googleIosClientId / googleAndroidClientId / googleWebClientId.
//   3. Apple Developer → enable "Sign in with Apple" capability; set
//      `ios.usesAppleSignIn: true` in app config. Backend needs your bundle id
//      as APPLE_CLIENT_IDS (see backend/app/config.py).
//   4. Rebuild the dev client (these are native modules — not in Expo Go).

import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAuth } from '../auth/AuthContext';
import { radius, space, useTheme, useThemedType } from '../theme';
import { toast } from '../ui/toast';
import Constants from 'expo-constants';

const extra = Constants?.expoConfig?.extra || {};

function tryRequire(name) {
  try { return require(name); } catch { return null; }
}

// A random URL-safe nonce for the Google implicit id_token flow.
function nonce(len = 24) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

export default function SocialAuthButtons() {
  const { signInWithProvider } = useAuth();
  const { colors } = useTheme();
  const type = useThemedType();
  const [busy, setBusy] = useState(null);

  const appleAvailable = Platform.OS === 'ios';

  const signInApple = async () => {
    if (busy) return;
    setBusy('apple');
    try {
      const AA = tryRequire('expo-apple-authentication');
      if (!AA?.signInAsync) {
        toast.error('Apple sign-in isn’t set up yet.');
        return;
      }
      const cred = await AA.signInAsync({
        requestedScopes: [AA.AppleAuthenticationScope.FULL_NAME, AA.AppleAuthenticationScope.EMAIL],
      });
      if (!cred?.identityToken) throw new Error('No identity token from Apple');
      const name = cred.fullName
        ? [cred.fullName.givenName, cred.fullName.familyName].filter(Boolean).join(' ')
        : undefined;
      await signInWithProvider('apple', cred.identityToken, { name });
    } catch (e) {
      if (e?.code === 'ERR_REQUEST_CANCELED') return; // user backed out
      toast.error(e.message || 'Apple sign-in failed');
    } finally {
      setBusy(null);
    }
  };

  const signInGoogle = async () => {
    if (busy) return;
    setBusy('google');
    try {
      const AuthSession = tryRequire('expo-auth-session');
      const WebBrowser = tryRequire('expo-web-browser');
      if (!AuthSession?.AuthRequest || !WebBrowser) {
        toast.error('Google sign-in isn’t set up yet.');
        return;
      }
      const clientId =
        Platform.select({ ios: extra.googleIosClientId, android: extra.googleAndroidClientId }) ||
        extra.googleWebClientId;
      if (!clientId) {
        toast.error('Add your Google client IDs to app config.');
        return;
      }
      WebBrowser.maybeCompleteAuthSession();
      const redirectUri = AuthSession.makeRedirectUri();
      const n = nonce();
      const req = new AuthSession.AuthRequest({
        clientId,
        redirectUri,
        scopes: ['openid', 'profile', 'email'],
        responseType: 'id_token',
        extraParams: { nonce: n },
      });
      const discovery = {
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      };
      const result = await req.promptAsync(discovery);
      if (result.type !== 'success') return; // cancelled/dismissed
      const idToken = result.params?.id_token;
      if (!idToken) throw new Error('No id_token from Google');
      await signInWithProvider('google', idToken, { nonce: n });
    } catch (e) {
      toast.error(e.message || 'Google sign-in failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      {/* divider */}
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={[type.caption, { color: 'rgba(255,255,255,0.6)', marginHorizontal: space.md }]}>or</Text>
        <View style={styles.line} />
      </View>

      <View style={{ gap: space.sm }}>
        {appleAvailable && (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#000' }]}
            onPress={signInApple}
            disabled={!!busy}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Continue with Apple"
          >
            <Text style={[styles.glyph, { color: '#fff' }]}></Text>
            <Text style={[styles.btnText, { color: '#fff' }]}>
              {busy === 'apple' ? 'Signing in…' : 'Continue with Apple'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.btn, { backgroundColor: '#fff' }]}
          onPress={signInGoogle}
          disabled={!!busy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
        >
          <Text style={[styles.glyph, styles.gGlyph]}>G</Text>
          <Text style={[styles.btnText, { color: '#1f1f1f' }]}>
            {busy === 'google' ? 'Signing in…' : 'Continue with Google'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: space.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.25)' },
  btn: {
    height: 52,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  btnText: { fontSize: 16, fontWeight: '600' },
  glyph: { fontSize: 18, fontWeight: '700', width: 18, textAlign: 'center' },
  gGlyph: { color: '#4285F4' },
});
