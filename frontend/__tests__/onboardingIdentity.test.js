import {
  appleIdentityFromCredential,
  shouldCollectName,
} from '../src/auth/onboardingIdentity';

describe('Sign in with Apple onboarding identity', () => {
  test('normalizes the name supplied by the Apple credential', () => {
    expect(appleIdentityFromCredential({
      givenName: '  Ada   Marie  ',
      familyName: '  Lovelace ',
    })).toEqual({
      provider: 'apple',
      firstName: 'Ada Marie',
      lastName: 'Lovelace',
    });
  });

  test('accepts a later Apple authorization with no repeated name data', () => {
    expect(appleIdentityFromCredential(null)).toEqual({
      provider: 'apple',
      firstName: '',
      lastName: '',
    });
  });

  test('never presents the required name step after Apple sign-in', () => {
    expect(shouldCollectName('full', { provider: 'apple' })).toBe(false);
    expect(shouldCollectName('full', { provider: 'google' })).toBe(true);
    expect(shouldCollectName('full', null)).toBe(true);
    expect(shouldCollectName('character', null)).toBe(false);
  });
});
