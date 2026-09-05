const cleanNamePart = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').slice(0, 24);
};

// Apple supplies these values inside the native authorization credential,
// outside the identity token. Keep them with the just-created session long
// enough for onboarding to save the local profile.
export function appleIdentityFromCredential(fullName) {
  return {
    provider: 'apple',
    firstName: cleanNamePart(fullName?.givenName),
    lastName: cleanNamePart(fullName?.familyName),
  };
}

// Sign in with Apple has already asked the person for their name. Even when
// Apple returns it only on the first authorization, asking for it again here
// would turn a fast Apple sign-in into a second required identity form.
export function shouldCollectName(mode, identity) {
  return mode === 'full' && identity?.provider !== 'apple';
}
