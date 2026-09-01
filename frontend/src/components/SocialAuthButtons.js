// Google + Apple sign-in buttons.
//
// Backend half is live: POST /auth/google and /auth/apple verify the provider's
// id_token (audience + signature) and return our own session — see
// backend/app/routes/auth.py. AuthContext.signInWithProvider() consumes it.
//
// SETUP STATE
//   ✔ packages installed (expo-apple-authentication, expo-auth-session, expo-web-browser)
//   ✔ config plugins + ios.usesAppleSignIn in app.json
//   ⋯ Google client ids: set EXPO_PUBLIC_GOOGLE_{IOS,ANDROID,WEB}_CLIENT_ID in .env
//     (surfaced via app.config.js `extra`). Until set, the Google button explains
//     it isn't configured rather than crashing.
//   ⋯ backend: GOOGLE_CLIENT_IDS / APPLE_CLIENT_IDS env must list the same ids
//     (APPLE_CLIENT_IDS = com.pacerrun.app). Otherwise those endpoints 501.
//   ⋯ these are NATIVE modules — needs a dev-client / EAS rebuild, not Expo Go.

import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Constants from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';

import { useAuth } from '../auth/AuthContext';
import { space } from '../theme';
import { framePose, frameVariant } from '../ui/frameRegistry';
import { toast } from '../ui/toast';
import Framed from './ui/Framed';

// Lets the auth popup hand control back to the app.
WebBrowser.maybeCompleteAuthSession();

const extra = Constants?.expoConfig?.extra || {};
const GOOGLE_IDS = {
  iosClientId: extra.googleIosClientId || undefined,
  androidClientId: extra.googleAndroidClientId || undefined,
  clientId: extra.googleWebClientId || undefined,
};
// Only mount the Google hook when there's an id for it to use — the provider
// throws at render if the current platform has no client id.
const HAS_GOOGLE = !!(
  Platform.select({ ios: GOOGLE_IDS.iosClientId, android: GOOGLE_IDS.androidClientId }) ||
  GOOGLE_IDS.clientId
);

function Row({ bg, glyph, glyphStyle, label, fg, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={styles.btn}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Framed
        frame={frameVariant('action', label)}
        tint={fg}
        fill={bg}
        pose={framePose(label)}
        inset={false}
        style={styles.btnFrame}
        contentStyle={styles.btnContent}
      >
        <Text style={[styles.glyph, glyphStyle, { color: fg }]}>{glyph}</Text>
        <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
      </Framed>
    </TouchableOpacity>
  );
}

// Isolated so the auth-request hook only ever runs when configured.
function GoogleButton() {
  const { signInWithProvider } = useAuth();
  const [busy, setBusy] = useState(false);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest(GOOGLE_IDS);

  useEffect(() => {
    if (!response) return;
    if (response.type !== 'success') {
      setBusy(false);
      return;
    }
    const idToken = response.params?.id_token || response.authentication?.idToken;
    if (!idToken) {
      setBusy(false);
      toast.error('Google didn’t return an identity token.');
      return;
    }
    signInWithProvider('google', idToken)
      .catch((e) => toast.error(e.message || 'Could not sign in with Google'))
      .finally(() => setBusy(false));
  }, [response, signInWithProvider]);

  return (
    <Row
      bg="#fff"
      glyph="G"
      glyphStyle={styles.gGlyph}
      fg="#1f1f1f"
      label={busy ? 'Signing in…' : 'Continue with Google'}
      disabled={!request || busy}
      onPress={() => {
        setBusy(true);
        promptAsync().catch((e) => {
          setBusy(false);
          toast.error(e.message || 'Could not sign in with Google');
        });
      }}
    />
  );
}

export default function SocialAuthButtons() {
  const { signInWithProvider } = useAuth();
  const [busy, setBusy] = useState(false);
  const [appleOk, setAppleOk] = useState(false);

  // Apple only exists on iOS, and only on devices that support it.
  useEffect(() => {
    let alive = true;
    if (Platform.OS !== 'ios') return undefined;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => alive && setAppleOk(!!ok))
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const signInApple = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!cred?.identityToken) throw new Error('No identity token from Apple');
      // Apple only sends the name on the FIRST authorization — pass it through
      // so the backend can seed a username from it.
      const name = cred.fullName
        ? [cred.fullName.givenName, cred.fullName.familyName].filter(Boolean).join(' ')
        : undefined;
      // The authorization code is only needed so the server can hold a
      // revocable session for account deletion. It is NOT what signs you in,
      // so a missing one is passed along as absent rather than thrown: the
      // identity token is the credential, and the server retries the exchange
      // on the next sign-in.
      await signInWithProvider('apple', cred.identityToken, {
        name,
        authorization_code: cred.authorizationCode || undefined,
      });
    } catch (e) {
      // Both spellings: the constant was renamed across expo-apple-authentication
      // versions and a cancel must never surface as a failure.
      if (e?.code === 'ERR_REQUEST_CANCELED' || e?.code === 'ERR_CANCELED') return;
      toast.error(e.message || 'Could not sign in with Apple');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.orText}>or</Text>
        <View style={styles.line} />
      </View>

      <View style={{ gap: space.sm }}>
        {appleOk && (
          <Row
            bg="#000"
            glyph=""
            fg="#fff"
            label={busy ? 'Signing in…' : 'Continue with Apple'}
            disabled={busy}
            onPress={signInApple}
          />
        )}

        {HAS_GOOGLE ? (
          <GoogleButton />
        ) : (
          <Row
            bg="#fff"
            glyph="G"
            glyphStyle={styles.gGlyph}
            fg="#1f1f1f"
            label="Continue with Google"
            onPress={() => toast.error('Signing in with Google is not set up yet.')}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: space.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.25)' },
  orText: { color: 'rgba(255,255,255,0.6)', marginHorizontal: space.md, fontSize: 12 },
  btn: {
    height: 52,
  },
  btnFrame: { flex: 1 },
  btnContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  btnText: { fontSize: 16, fontWeight: '600' },
  glyph: { fontSize: 18, fontWeight: '700', width: 18, textAlign: 'center' },
  gGlyph: { color: '#4285F4' },
});
