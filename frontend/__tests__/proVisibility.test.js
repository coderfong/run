// "I don't see PASER PRO anywhere."
//
// Every marketing surface used to gate on `storeAvailable()`, which is false
// until a sandbox purchase has been taken end to end. That made the whole
// subscription invisible rather than merely unbuyable.
import { IAP_ENABLED, PRO_SURFACES_ENABLED } from '../src/config/releaseFeatures';
import { proVisible, storeAvailable } from '../src/pro/storeAvailable';

describe('showing PRO and selling PRO are separate questions', () => {
  it('shows PRO in this build', () => {
    expect(proVisible()).toBe(true);
  });

  it('does not claim a purchase could complete just because PRO is shown', () => {
    expect(storeAvailable()).toBe(IAP_ENABLED);
  });

  // The invariant that keeps the two switches from contradicting each other:
  // a build that can take money must show what it is selling.
  it('always shows PRO when it can be sold', () => {
    if (storeAvailable()) expect(proVisible()).toBe(true);
  });

  it('is the surfaces switch that decides visibility', () => {
    expect(proVisible()).toBe(PRO_SURFACES_ENABLED || IAP_ENABLED);
  });
});
