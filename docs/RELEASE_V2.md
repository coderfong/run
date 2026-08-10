# PASER v2.0.0 — release checklist

Audited 2026-07-30. Everything below was verified against the code, not
assumed. Items marked **YOU** need something only you can do (secrets, store
config, devices).

## Blocking — do these before submitting

### 1. Turn on IAP receipt verification — **YOU**
This is the one that costs money if missed. Until `iap_verify_receipts` is
true, `POST /me/pass/purchase` grants the entire PASER PRO track (all 17
exclusives) to any authenticated caller with no receipt at all. Same for
energy packs.

The verification itself is now implemented (`backend/app/iap.py`, Apple +
Google, fails closed, sandbox-receipt fallback for App Review's testers) and
transactions are deduped (`iap_transactions`, migration 0017). It just needs
its secrets set on Render:

```
IAP_VERIFY_RECEIPTS=true
APPLE_SHARED_SECRET=<App Store Connect → your app → App-Specific Shared Secret>
```

Android additionally needs `GOOGLE_PLAY_ACCESS_TOKEN` and `ANDROID_PACKAGE`.
Leave those blank if you're shipping iOS only — the Google path is never
reached.

> Verify after deploy: a purchase with a junk receipt must return 402, and the
> same valid receipt twice must not grant twice.

### 1b. Create the coin-pack products — **YOU**
The cosmetics shop needs four more **Consumable** products in App Store
Connect, IDs exactly as below (they must match `COIN_PRODUCTS` in
`backend/app/coins.py`):

| Product ID | Reference Name | Coins | Suggested price |
|---|---|---|---|
| `coins_pouch` | Coin Pouch | 500 | $0.99 |
| `coins_sack` | Coin Sack | 1200 | $1.99 |
| `coins_chest` | Coin Chest | 3000 | $4.99 |
| `coins_vault` | Coin Vault | 6500 | $9.99 |

Prices are displayed from `PACK_PRICE` in `src/screens/ShopScreen.js` — keep
the tiers in sync or the app will show a price Apple doesn't charge.

### 2. Run migrations 0017 and 0018 on production
Pushing master auto-migrates (Dockerfile boot CMD), so this happens on deploy.
Confirm `iap_transactions` exists afterwards — without it every verified
purchase 500s on the dedupe insert.

### 3. Clean the seeded test data — **YOU**
`jonfong78` on the production DB carries 12 fabricated runs (10 km each,
`duration_s = 4242`) and 10 fake territories along East Coast Park, added for
asset testing. They're real rows in the live database and will appear on
leaderboards. Delete before review:

```sql
DELETE FROM runs WHERE user_id = '32a78fc4-0b3e-49bd-aeac-8e0732c48282' AND duration_s = 4242;
DELETE FROM territories WHERE user_id = '32a78fc4-0b3e-49bd-aeac-8e0732c48282' AND area_m2 = 900;
```

XP was also set to 250000 (level 50); reset it if you want a realistic account.

### 4. Rotate the database password — **YOU**
The Render Postgres password was shared in chat during this work. Rotate it in
the Render dashboard ("New default credential").

### 5. Configure the mailer, or account recovery stays off — **YOU**
Password reset (added 2026-08-09, see `docs/ACCOUNT_RECOVERY.md`) is fully
implemented but inert until a mail transport is set on Render. With
`MAIL_BACKEND` unset or left at `log`, `POST /auth/forgot` returns 501 and the
app tells runners that reset is not available — which is honest, but it means
every password account is still one forgotten password away from being lost.

```
MAIL_BACKEND=resend
MAIL_FROM=PASER <recovery@yourdomain>       # an address you actually read
RESEND_API_KEY=<resend.com → API keys, after verifying the sender domain>
```

SMTP works too (`MAIL_SMTP_HOST` and friends) if you would rather not add a
provider. Migration `0028` ships with it and is additive.

> Verify after deploy: `POST /auth/forgot` for an account with a confirmed
> address must answer `{"sent": true}` and the mail must arrive. Existing
> accounts have no address until their owners add one from the profile.

## Verified — no action needed

| Area | State |
|---|---|
| Version | `2.0.0`, EAS `autoIncrement` handles build numbers (last review build was 7 → next is 8) |
| EAS project | Real projectId, not a placeholder |
| Production API base | `eas.json` production profile sets `EXPO_PUBLIC_API_BASE` to Render; the stale Cloudflare tunnel in `app.json` `extra` was replaced so it can't be picked up by a stray build |
| Guideline 5.1.1(iv) | `LocationPermissionScreen` complies: neutral "Continue", no escape before the OS prompt; the "Explore" escape exists only in the already-denied state. Reasons documented in the file header |
| Account deletion | Implemented client (`ProfileScreen` → type-to-confirm) and server (`DELETE /me`) — Apple requires this |
| Privacy policy | Live at `https://www.bido.live/privacy` (the old `territoryrun.app` placeholder is gone) |
| Sign in with Apple | Enabled, required because Google sign-in is offered |
| Permission strings | All five `NS*UsageDescription` keys present and specific |
| `__DEV__` unlock-all | In `cosmetics.js` `isUnlocked` — `__DEV__` is false in release builds, so store users still earn unlocks |
| Reward ladder | Every level 1–50 grants something; 35 free + 17 premium keys all resolve to real catalogue art; no placeholder tiles |
| Assets | 916 asset requires resolve, 0 missing, 44/44 art manifest keys live |
| Claim FX | System removed — no Lottie references anywhere |

## Worth doing, not blocking

- **Sentry source maps are disabled** (`SENTRY_DISABLE_AUTO_UPLOAD=true` on the
  production profile), so v2 crash reports arrive unsymbolicated. Drop that env
  var and set a Sentry auth token to get readable stack traces.
- **Android `versionCode` is 1** while the app is at 2.0.0. Fine for a first
  Play submission; bump if v1 ever shipped there.
- **Screenshots** still need capturing on a real device — no simulator on this
  machine.
- Load-test the Render instance if you expect launch traffic; it's on the
  256 MB Basic plan.

## Build & submit

```bash
cd frontend
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

`submit.production` already has `ascAppId 6788529145`, the Apple ID and team id.

> A JS-only change still needs a **new binary** for review — an OTA
> `eas update` cannot fix a build that was never released.
