/**
 * PASER PRO's client side, and the three ways it can quietly go wrong.
 *
 *   1. The product ids drift from the backend's. Nothing fails loudly: the
 *      store sheet opens, the purchase succeeds, and `/me/pro/subscribe`
 *      answers 400 "unknown product" AFTER the runner has been charged. So
 *      this asserts the ids in config/pro.js against the real Python.
 *
 *   2. `activeSubscriptions` reports something that isn't live, or drops
 *      something that is. Sync feeds entitlement, so both directions matter:
 *      the first extends PRO that was never paid for, the second lets a paid
 *      subscription lapse on the server while the store thinks it is fine.
 *
 *   3. Android buys without an offer token. Play rejects the purchase at the
 *      sheet, which reads to the runner as "PASER is broken", and there is no
 *      iOS symptom at all so it survives every simulator test.
 *
 * The paywall's own copy is not tested here — it is checked by review against
 * guideline 3.1.2, which is a reading task, not an assertion.
 */

const fs = require('fs');
const path = require('path');

jest.mock('expo-iap', () => ({
  ErrorCode: { UserCancelled: 'E_USER_CANCELLED' },
  finishTransaction: jest.fn().mockResolvedValue(undefined),
  fetchProducts: jest.fn().mockResolvedValue([]),
  getActiveSubscriptions: jest.fn().mockResolvedValue([]),
  getAvailablePurchases: jest.fn().mockResolvedValue([]),
  initConnection: jest.fn().mockResolvedValue(true),
  purchaseErrorListener: jest.fn(() => ({ remove: jest.fn() })),
  purchaseUpdatedListener: jest.fn(() => ({ remove: jest.fn() })),
  requestPurchase: jest.fn().mockResolvedValue(undefined),
  restorePurchases: jest.fn().mockResolvedValue(undefined),
}));

function load(platform = 'ios') {
  jest.resetModules();
  // Platform.OS is a plain property on some React Native versions and a
  // getter on others; defineProperty is the one form that works either way.
  Object.defineProperty(require('react-native').Platform, 'OS', {
    value: platform,
    configurable: true,
  });
  return { iap: require('../src/iap'), store: require('expo-iap') };
}

describe('PRO product ids match the backend', () => {
  const config = fs.readFileSync(
    path.join(__dirname, '..', '..', 'backend', 'app', 'config.py'),
    'utf8',
  );

  it('lists exactly the ids the server will accept', () => {
    const declared = config.match(/pro_products:\s*tuple\[str, \.\.\.\]\s*=\s*\(([^)]*)\)/);
    expect(declared).toBeTruthy();
    const serverIds = [...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const { PRO_PRODUCTS } = require('../src/config/pro');
    expect([...PRO_PRODUCTS].sort()).toEqual([...serverIds].sort());
  });

  it('offers a plan for every id it declares', () => {
    const { PLANS, PRO_PRODUCTS } = require('../src/config/pro');
    expect(PLANS.map((p) => p.id).sort()).toEqual([...PRO_PRODUCTS].sort());
    // A plan with no price and no period cannot carry the required
    // disclosure, which is a rejection rather than a cosmetic gap.
    for (const plan of PLANS) {
      expect(plan.fallbackPrice).toMatch(/\d/);
      expect(plan.period).toBeTruthy();
      expect(plan.label).toBeTruthy();
    }
  });

  it('names only icons that exist', () => {
    const { PRO_PERKS } = require('../src/config/pro');
    const { hasIcon } = require('../src/components/AppIcon');
    for (const [icon, label] of PRO_PERKS) {
      expect([icon, hasIcon(icon)]).toEqual([icon, true]);
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('promises nothing that would be power', () => {
    // The whole monetisation rests on PRO selling depth, never advantage. A
    // perk line that starts promising more land or cheaper energy is the
    // point where that breaks, and it breaks in copy before it breaks in code.
    const { PRO_PERKS } = require('../src/config/pro');
    const banned = /\b(more energy|extra energy|cheaper|stronger|faster decay|slower decay|more land|more territory|bonus land|advantage|boost)\b/i;
    for (const [, label] of PRO_PERKS) {
      expect([label, banned.test(label)]).toEqual([label, false]);
    }
  });
});

describe('activeSubscriptions', () => {
  it('maps a live subscription into what /me/pro/sync takes', async () => {
    const { iap, store } = load('ios');
    store.getActiveSubscriptions.mockResolvedValue([
      { productId: 'paser_pro_monthly', purchaseToken: 'jws-token', isActive: true },
    ]);
    await expect(iap.activeSubscriptions(['paser_pro_monthly'])).resolves.toEqual([
      { product_id: 'paser_pro_monthly', receipt: 'jws-token', platform: 'ios' },
    ]);
  });

  it('drops a subscription the store says is not active', async () => {
    const { iap, store } = load('ios');
    store.getActiveSubscriptions.mockResolvedValue([
      { productId: 'paser_pro_monthly', purchaseToken: 'jws-token', isActive: false },
    ]);
    await expect(iap.activeSubscriptions()).resolves.toEqual([]);
  });

  it('drops one with no token, which cannot be verified anyway', async () => {
    const { iap, store } = load('ios');
    store.getActiveSubscriptions.mockResolvedValue([
      { productId: 'paser_pro_annual', purchaseToken: null, isActive: true },
    ]);
    await expect(iap.activeSubscriptions()).resolves.toEqual([]);
  });

  it('reports nothing rather than throwing when the store is empty', async () => {
    const { iap, store } = load('android');
    store.getActiveSubscriptions.mockResolvedValue(null);
    await expect(iap.activeSubscriptions()).resolves.toEqual([]);
  });
});

describe('storeSubscribe', () => {
  // requestPurchase resolves before the outcome arrives; the real result comes
  // through purchaseUpdatedListener. This drives that listener so the promise
  // storeSubscribe returns actually settles.
  function deliverPurchase(store, purchase) {
    store.purchaseUpdatedListener.mockImplementation((cb) => {
      setTimeout(() => cb(purchase), 0);
      return { remove: jest.fn() };
    });
  }

  it('asks for a subscription, not an in-app product', async () => {
    const { iap, store } = load('ios');
    deliverPurchase(store, { productId: 'paser_pro_monthly', purchaseToken: 'tok' });
    const out = await iap.storeSubscribe('paser_pro_monthly');
    expect(out).toEqual({
      receipt: 'tok',
      platform: 'ios',
      purchase: { productId: 'paser_pro_monthly', purchaseToken: 'tok' },
    });
    expect(store.requestPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'subs' }),
    );
  });

  it('carries the Play offer token on Android', async () => {
    const { iap, store } = load('android');
    store.fetchProducts.mockResolvedValue([
      {
        id: 'paser_pro_annual',
        subscriptionOffers: [
          { offerToken: 'intro-offer' },
          { offerToken: 'base-plan' },
        ],
      },
    ]);
    deliverPurchase(store, { productId: 'paser_pro_annual', purchaseToken: 'tok' });
    await iap.storeSubscribe('paser_pro_annual');
    expect(store.fetchProducts).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'subs' }),
    );
    const args = store.requestPurchase.mock.calls.at(-1)[0];
    expect(args.request.google.subscriptionOffers).toEqual([
      { sku: 'paser_pro_annual', offerToken: 'base-plan' },
    ]);
  });

  it('still buys when Play returns no offers, rather than blocking the sheet', async () => {
    const { iap, store } = load('android');
    store.fetchProducts.mockResolvedValue([{ id: 'paser_pro_monthly', subscriptionOffers: [] }]);
    deliverPurchase(store, { productId: 'paser_pro_monthly', purchaseToken: 'tok' });
    await expect(iap.storeSubscribe('paser_pro_monthly')).resolves.toMatchObject({ receipt: 'tok' });
    const args = store.requestPurchase.mock.calls.at(-1)[0];
    expect(args.request.google.subscriptionOffers).toBeUndefined();
  });

  it('refuses a purchase the store gave no token for', async () => {
    const { iap, store } = load('ios');
    deliverPurchase(store, { productId: 'paser_pro_monthly', purchaseToken: null });
    await expect(iap.storeSubscribe('paser_pro_monthly')).rejects.toThrow(/purchase token/i);
  });
});
