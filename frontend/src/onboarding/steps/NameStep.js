// "Howdy! What's your name?" — the first step after sign-up. First name is
// required (it greets the runner everywhere); last name is optional.

import React, { useRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Hand } from 'lucide-react-native';

import { fonts, space } from '../../theme';
import { ToonButton } from '../../components/ui';
import { art } from '../../config/onboardingArt';
import { StepHeadline, StepThumb } from '../ui';
import { toon, toonRadius } from '../toon';

export default function NameStep({ value, onChange, onContinue, bottomInset = 0 }) {
  const lastRef = useRef(null);
  const ready = value.firstName.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={12}
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <StepThumb
          source={art('thumbName')}
          fallback={<Hand size={54} color="#fff" strokeWidth={2.5} />}
        />
        <StepHeadline title="Howdy! What's your name?" style={{ marginTop: space.lg }} />

        <View style={styles.fields}>
          <TextInput
            style={styles.input}
            value={value.firstName}
            onChangeText={(firstName) => onChange({ firstName })}
            placeholder="First name"
            placeholderTextColor="rgba(255,255,255,0.42)"
            autoCapitalize="words"
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="next"
            maxLength={24}
            onSubmitEditing={() => lastRef.current?.focus()}
            accessibilityLabel="First name"
          />
          <TextInput
            ref={lastRef}
            style={styles.input}
            value={value.lastName}
            onChangeText={(lastName) => onChange({ lastName })}
            placeholder="Last name"
            placeholderTextColor="rgba(255,255,255,0.42)"
            autoCapitalize="words"
            autoComplete="family-name"
            textContentType="familyName"
            returnKeyType="done"
            maxLength={24}
            onSubmitEditing={() => ready && onContinue()}
            accessibilityLabel="Last name (optional)"
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomInset + space.lg }]}>
        <ToonButton title="Continue" onPress={onContinue} disabled={!ready} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingTop: space.xl, paddingHorizontal: space.gutter, paddingBottom: space.xl },
  fields: { gap: space.md, marginTop: space.xl },
  input: {
    height: 58,
    borderRadius: toonRadius.cell,
    backgroundColor: toon.sheet,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: space.lg,
    color: '#fff',
    fontFamily: fonts.bodyMedium,
    fontSize: 16,
  },
  footer: { paddingHorizontal: space.gutter, paddingTop: space.sm },
});
