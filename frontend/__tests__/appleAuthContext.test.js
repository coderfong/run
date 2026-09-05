import React from 'react';
import renderer, { act } from 'react-test-renderer';

const mockOauthLogin = jest.fn();
const mockSetAuthToken = jest.fn();
const mockSecureGet = jest.fn();
const mockSecureSet = jest.fn();

jest.mock('../src/api/client', () => ({
  api: {
    oauthLogin: (...args) => mockOauthLogin(...args),
  },
  setAuthToken: (...args) => mockSetAuthToken(...args),
}));

jest.mock('../src/api/cache', () => ({
  clearCache: jest.fn(),
  setCacheOwner: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: (...args) => mockSecureGet(...args),
  setItemAsync: (...args) => mockSecureSet(...args),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

import { AuthProvider, useAuth } from '../src/auth/AuthContext';

let auth;
function Probe() {
  auth = useAuth();
  return null;
}

describe('Apple identity handoff through AuthContext', () => {
  beforeEach(() => {
    auth = null;
    jest.clearAllMocks();
    mockSecureGet.mockResolvedValue(null);
    mockSecureSet.mockResolvedValue(undefined);
    mockOauthLogin.mockResolvedValue({
      access_token: 'paser-token',
      user: { id: 'user-1', username: 'ada' },
      created: true,
    });
  });

  test('keeps Apple profile data local and exposes it only during onboarding', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      );
    });

    await act(async () => {
      await auth.signInWithProvider('apple', 'apple-id-token', {
        name: 'Ada Lovelace',
        authorization_code: 'apple-code',
        onboardingIdentity: {
          provider: 'apple',
          firstName: 'Ada',
          lastName: 'Lovelace',
        },
      });
    });

    expect(mockOauthLogin).toHaveBeenCalledWith('apple', 'apple-id-token', {
      name: 'Ada Lovelace',
      authorization_code: 'apple-code',
    });
    expect(auth.needsOnboarding).toBe(true);
    expect(auth.onboardingIdentity).toEqual({
      provider: 'apple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    act(() => auth.completeOnboarding());
    expect(auth.needsOnboarding).toBe(false);
    expect(auth.onboardingIdentity).toBe(null);

    act(() => tree.unmount());
  });
});
