# PASER App Store submission pack (2.1.0)

Audited 2026-08-12 against the current iOS build configuration and Apple's
current submission rules. Bundle id: `com.pacerrun.app`.
**Updated 2026-08-20: `IAP_ENABLED` is now true — this version SELLS the PASER
PRO subscription and the energy/coin consumables. The purchase-related sections
below were rewritten to match; do not reuse any older copy that says the app
has no in-app purchases.**

## Submission status

The source now passes Expo's store-readiness checks and produces an iOS bundle,
but **do not submit an old EAS build**. Complete every unchecked gate in
"Before submission" below — including the two new in-app-purchase gates — then
create and test a fresh production build, and submit its nine IAP products in
the same submission.

## App Store Connect metadata

- Name: `PASER`
- Subtitle: `Run. Claim. Conquer.`
- Primary category: Health & Fitness
- Secondary category: Games
- Bundle ID: `com.pacerrun.app`
- Version: `2.1.0`
- Privacy Policy URL: `https://www.gameablestudios.com/privacy`
- Support URL: `https://www.gameablestudios.com/support`
- Terms of Use (EULA): Apple's standard EULA,
  `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`, linked as
  plain text inside the Description (there is no separate URL field for it).
  A custom EULA would instead go in App Information -> License Agreement
- Regulated medical device declaration: **No**
- Copyright: use the legal owner and current year

Promotional text:

> Turn every run into territory. Claim the map with your distance, defend it
> with your club, and race to hold the most land this season.

Description:

```text
PASER turns running into a game of real-world territory.

Every run you finish becomes a claim zone based on the distance you covered.
Place it along your route, take ground for yourself and your club, and return
to defend it.

- CLAIM THE MAP - turn real runs into territory.
- RUN CLUBS - join or create a club and climb the season standings together.
- STRENGTH & STEALS - faster runs make stronger claims; challenge rival turf.
- BUILD YOUR RUNNER - customize your character with outfits and accessories.
- STAY MOTIVATED - follow streaks, XP, levels, records, and your activity feed.
- APPLE HEALTH - optionally save every finished run as a running workout.
- BE SOCIAL - comment on runs, chat with your club, and react to achievements.

PASER records your route only during an active, user-started run.

PASER PRO is an optional auto renewable subscription. SGD 4.98 per month or
SGD 39.98 per year. Payment is charged to your Apple Account at confirmation of
purchase. It renews automatically unless auto renew is turned off at least 24
hours before the end of the current period. Manage or cancel your subscription
in your Apple Account settings.

Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Privacy Policy: https://www.gameablestudios.com/privacy
```

**The prices are SGD on purpose.** PASER is sold in Singapore only, so S$4.98
and S$39.98 are the only prices any buyer can be charged, confirmed in App Store
Connect on 2026-08-25. Never restore the US $4.99 / $39.99 tiers the products
were planned at: nobody in the app's only market can be charged them, which
makes them the same 3.1.2 problem as quoting no price at all.

The last two lines are not optional. App Review rejected this submission on
2026-08-24 because the product page carried no functional Terms of Use link,
which every app that sells an auto-renewable subscription must show. The app
uses Apple's standard EULA, so the link above is the one to paste; only replace
it if a custom EULA is uploaded in App Store Connect instead (App Store Connect
-> App Information -> License Agreement). Paste the URLs as plain text, because
the Description field does not render links, and re-check them in the preview
after saving.

Keywords (100-character field; verify in App Store Connect after pasting):

```text
run,running,gps,fitness,territory,map,club,game,streak,cardio,jog,workout,route
```

What's New:

```text
Run to claim territory, build your runner, team up with a club, and share your
achievements with PASERs. This update also improves privacy and community safety.
```

## In-app purchases (this version sells all of these)

`IAP_ENABLED` is true in this build, so the store is live. Every product below
must be created and **submitted for review with the app** (a first app version
that contains IAP is reviewed together with its products; leaving any of them in
"Missing Metadata" blocks the whole submission). Prices are the tiers the client
assumes until the storefront answers with real localized prices.

Auto-renewable subscription — one subscription group ("PASER PRO"):

| Product ID | Reference name | Duration | Price tier |
| --- | --- | --- | --- |
| Product ID | Reference name | Duration | Singapore price |
| --- | --- | --- | --- |
| `paser_pro_monthly` | PASER PRO Monthly | 1 month | S$4.98 |
| `paser_pro_annual` | PASER PRO Yearly | 1 year | S$39.98 |

**PASER SELLS IN SINGAPORE ONLY, SO THE PRICE IS SGD.** Availability is one
region by design (`1 of 175 countries or regions selected`), and the only row of
Apple's worldwide price table that anybody can be charged from is
`Singapore (SGD) $4.98`, proceeds `$4.29`, confirmed 2026-08-25. Every other row
of that table describes a storefront PASER is not sold in. S$4.98 is Apple's
nearest SGD price point to the $4.99 the product was planned at, which is why
the two do not match to the cent.

This trips up device testing, and did on 2026-08-25: a phone signed into a **US**
Apple Account opened the paywall and showed `$2.99` / `$29.99`. StoreKit answers
in the storefront the ACCOUNT is signed into, not the region the app is sold in,
so those were the US rows of the same table. That is correct behaviour, not a
pricing bug, and it is why the US column is worth nothing here. **Test the
paywall on an Apple Account whose storefront is Singapore**, or the number on
screen is answering a question nobody asked. The paywall now labels that answer
with its currency (`$2.99 USD`), so a US test account can no longer be mistaken
for a Singapore price.

Two things follow for the metadata. The Description must quote the **SGD**
price, because that is the only price any buyer of this app can see. And the
hardcoded fallbacks must be the SGD prices, not the US tiers the products were
planned at: shown to a Singapore buyer whose store lookup fails, beside a `$`
that reads as SGD, a US tier advertises a price Apple does not charge. PRO's
two are SGD as of 2026-08-25.

The seven consumables in `BuyEnergySheet.js` are still US tiers and have never
been checked against the live store at all.

Both plans MUST be in the SAME subscription group, or a runner switching plans
is billed for both. Each needs a localized display name, description, and a
review screenshot of the paywall. The app's own paywall (`BuyProSheet`) already
carries the 3.1.2 disclosures: price per period, auto-renew and cancellation
terms, and links to the Apple standard EULA and the privacy policy. That is why
the 2026-08-24 rejection cited only the product page and not the app itself.

One loose end that iOS review will not catch: `BuyProSheet` links Apple's EULA
only on iOS, and everywhere else it links `https://www.gameablestudios.com/terms`,
which returns **404** (checked 2026-08-24). Publish that page before any Android
or Play release, or point the non-iOS branch at a terms page that exists.

Consumables (no subscription group, `restore` not required):

| Product ID | Reference name | Price |
| --- | --- | --- |
| `energy_refill_small` | 50 energy | $0.99 |
| `energy_pack_large` | 150 energy | $1.99 |
| `energy_refill_full` | Full energy refill | $2.99 |
| `coins_pouch` | 500 coins | $0.99 |
| `coins_sack` | 1200 coins | $1.99 |
| `coins_chest` | 3000 coins | $4.99 |
| `coins_vault` | 6500 coins | $9.99 |

### When the paywall price disagrees with App Store Connect

Both sheets ask the store for the real, storefront-localized price when they
open and fall back to a hardcoded string when that answer is empty
(`fallbackPrice` in `config/pro.js`, `price` in `BuyEnergySheet.js`). PRO's two
fallbacks are the SGD prices App Store Connect charges; **the seven consumables
are still US tiers** while the app sells only in Singapore, so a lookup that
fails there advertises a price Apple does not charge. Whatever they are set to,
they only agree with the store by maintenance: change a price in App Store
Connect and the fallback is a lie until it is changed here too, and in the
Description.

Whatever the store does answer is now shown with its currency named.
`withCurrency` in `iap.js` appends the ISO code to any price the storefront
formatted with a bare symbol, so the US answer reads `$2.99 USD` and the
Singapore one reads `$4.98 SGD` instead of both reading as plain `$`. It never
changes the number, and a string the store already made explicit (`S$4.98`) is
left alone. This is what stops the paragraph above this one from being a thing
you have to remember while looking at a paywall.

An empty answer looks exactly like a working one on screen, so diagnose it
rather than guessing:

- **On a dev client on a real device**, signed into a Sandbox Apple Account,
  open the paywall and read the console. `fetchProductPrices` logs every id the
  store returned with its price and currency, and warns with the likely causes
  for any it did not. The simulator has no store and always falls back.
- **On TestFlight**, where there is no console, tap the plan and read Apple's
  own purchase sheet. That sheet is the truth: if its price differs from the
  card above it, the card was showing the fallback.
- **Ordered causes of an empty answer**: the Paid Apps agreement is not active
  in Agreements, Tax, and Banking (this alone returns nothing, however correct
  everything else is); the product is still in Missing Metadata; the id differs
  from the one in the source (case sensitive); or a subscription is being asked
  for as an in-app product.
- **A price in the right shape but the wrong currency is not a bug.** The store
  answers in the storefront the Apple Account is signed into, not the region of
  the price you typed in App Store Connect. Check Settings -> Media & Purchases
  before treating it as one.

Energy is a claim-pacing consumable; coins buy cosmetics only. Neither is a
randomized draw, so the loot-box answer stays No. The description need not list
these products, but Review Notes below must describe them accurately — do not
tell Apple the app has no purchases.

Apple Health sync **is** in this version and may be described, but describe it
exactly: an optional switch that saves finished runs to Apple Health as running
workouts. PASER writes only. It never reads Health data.

## App Privacy answers

Answer **Yes, data is collected**. Declare these as linked to the user, used
for App Functionality, and **not used for tracking**:

| Apple data type | What PASER uses it for |
| --- | --- |
| Contact Info - Email Address | Optional account recovery and social-provider sign-in |
| Location - Precise Location | Active-run recording, route display, and territory claims |
| Health & Fitness - Fitness | Run distance, duration, pace, and on-foot verification. Workouts written to Apple Health are not collected by PASER; they stay on the device |
| User Content - Other User Content | Usernames, club names/descriptions, comments, chat, reactions, and reports |
| Identifiers - User ID | Account, social graph, runs, and moderation |
| Identifiers - Device ID | Push-notification token, if Apple classifies the token this way |
| Other Data - Other Data Types | Date of birth used for the 13+ gate and stronger route-privacy defaults for minors |
| Purchases - Purchase History | PASER PRO subscription and consumable (energy/coin) transactions, to grant and restore entitlements |

Declare Diagnostics only if `EXPO_PUBLIC_SENTRY_DSN` is enabled in the submitted
mobile build. The current production profile does not set it. Answer **No** for
tracking, advertising, and data-broker use.

The public privacy policy must match these answers, and it must cover Apple
Health, which HealthKit apps are required to have (Guideline 5.1.3). Publish
the Apple Health section of `PRIVACY.md` at the live privacy URL before
submission: write-only, opt-in, never read, never sent to PASER's servers,
never used for advertising or shared with third parties.

## Age rating questionnaire

- User-generated content: Yes
- Messaging and chat: Yes
- Social media: Yes
- Health or wellness topics: Yes
- Loot boxes: No (coins and energy are sold in fixed quantities, not randomized draws)
- In-app purchases: Yes (one auto-renewable subscription plus energy/coin consumables)
- Gambling, contests, advertising, web access: No
- Set the app's minimum age to 13; onboarding already enforces 13+

With Apple's current definitions, the social feed/chat makes **13+** the
appropriate rating. Re-answer the questionnaire if the feature set changes.

## Review notes

```text
PASER is a 13+ fitness game. A user-started outdoor run is converted into map
territory after the user finishes the run.

DEMO ACCOUNT
Username: <working review username>
Password: <working review password>

BACKGROUND LOCATION
PASER requests background location only so an active run can continue when the
screen locks. Collection begins after the runner taps Start and ends when the
runner finishes the run. PASER does not collect background location outside an
active run.

HOW TO TEST
Sign in with the demo account, open Record, start a run, and move using a device
or simulated location. Finish the run, choose a claim position, and submit it.
The demo account should already contain realistic runs so Map, Feed, Clubs,
comments, chat, report/block, and account deletion can be reviewed indoors.

COMMUNITY SAFETY
Use the three-dot button on another runner's profile, run, comment, or club-chat
message to report or block them. Blocking hides both users from one another's
social content. Account deletion is in You > Settings > Delete account.

APPLE HEALTH
Health sync is optional and off by default. Turn it on in You > Settings >
Apple Health and allow it on the permission sheet. PASER then writes each
finished run to Apple Health as a running workout with its time and distance.
PASER requests write access only and never reads health data.

PURCHASES
This version offers in-app purchases. PASER PRO is an auto-renewable
subscription (monthly or yearly) that unlocks depth features only: route
planning, territory and rival analytics, run history, and leaderboard filters.
PRO never sells competitive advantage - it cannot grant more or stronger
territory, slower decay, cheaper energy, or a leaderboard position.

To reach the subscription, open the You tab and tap the PASER PRO card, or tap
any padlocked PRO feature. The paywall shows both plans, the price per period,
the auto-renewal and cancellation terms, and links to the Terms of Use and
Privacy Policy.

The app also sells consumables: energy refills (a claim-pacing resource) and
coin packs (spent only on cosmetic outfits). Open the shop from the coin/energy
balance on the Home or You screen. Consumables are not randomized.

All purchases can be exercised in the sandbox with the demo account.
```

## Screenshots

Provide 1-10 portrait screenshots without alpha. Use a current 6.9-inch iPhone
set (for example 1320x2868, 1290x2796, or 1260x2736). Suggested sequence:

1. Home with a realistic recent run and streak.
2. Record screen with an active route.
3. Claim placement and captured territory.
4. Global map with several territories.
5. Club and season standings.
6. Social feed with reactions/comments.
7. Runner customization or rewards.

Use only data and artwork you are licensed to display. Avoid mock Apple UI and
make sure every screenshot reflects the submitted binary.

## Before submission

- [ ] **Terms of Use link in the App Description (owner-only, App Store Connect;
      this is what the 2026-08-24 rejection asked for).** The submission was
      returned without a full review: an app that sells an auto-renewable
      subscription must carry a functional Terms of Use (EULA) link in the
      metadata on its product page, and the Description had none. Paste the
      Description exactly as written above, including the subscription
      disclosure and the two URL lines, save, and reply to App Review saying
      the link is now in the Description. Nothing in the binary changes, so no
      new build is needed for this: the same build can be resubmitted once the
      metadata is saved. The paywall itself was already compliant, which is why
      only the product page was cited.
- [x] Subscription availability is deliberately **Singapore only** (`1 of 175
      countries or regions selected`, both products). Nothing to change; it is
      recorded because it decides which price is the real one everywhere else
      in this file.
- [x] Both subscription prices read off App Store Connect in **SGD**, the only
      currency this app sells in: S$4.98 monthly, S$39.98 yearly (2026-08-25).
      The Description above and `config/pro.js` both carry those figures. The US
      $4.99 / $39.99 the products were planned at appear nowhere any more.
- [ ] **The seven consumables' fallback prices are still US tiers**
      (`price` in `BuyEnergySheet.js`). Read their Singapore rows in App Store
      Connect and correct them, the way the subscription just was. A Singapore
      buyer whose store lookup fails is shown a US price under a `$` that reads
      as SGD. Ships with the next build, so it does not block the metadata
      resubmission.
- [x] Backend deployed. Commit `b5170cf` pushed 2026-08-12 and live on Render:
      `GET /version` reports `2.1.0` / commit `b5170cf`, `GET /health` reports
      `{"ok": true, "db": true}`, and `/me/reports`, `/me/blocks` and
      `/auth/apple` are in the served OpenAPI. The service boots by running
      Alembic, so revisions `0030`–`0032` ran with it.
- [x] Render environment set 2026-08-12. `/version` reports `production`,
      `/health` is green, so the service booted through both production guards.
- [x] **Session tokens were forgeable and are not any more.** Until 2026-08-12
      the live API validated sessions with `dev-only-change-me-in-prod`, the
      committed dev default: a token signed with it and sent to `/me` returned
      `user not found`, which is only reachable after the signature verifies.
      That is also why `ENV` had been left at `development` — the boot guard in
      `app/main.py` exists to reject exactly this, so turning it on would have
      failed. `JWT_SECRET` is now a real random value (old secret → `invalid
      token`, new secret → `user not found`) and `CORS_ORIGINS` is
      `https://www.bido.live`, so a foreign `Origin` gets no
      `Access-Control-Allow-Origin` at all. Rotate `JWT_SECRET` once more after
      launch: the value was pasted into a chat transcript.
      **[2026-08-14: `CORS_ORIGINS` on Render still points at the retired
      `bido.live` domain and has not been migrated — update it to the
      gameablestudios.com origin if anything server-side needs to call the
      API from that domain.]**
- [x] `APPLE_KEY_ID` (`78L7WYZJ67`) and `APPLE_PRIVATE_KEY` set. The key was
      confirmed to be a Sign in with Apple key, not one of the other Apple key
      types, by signing a client secret and having Apple's token endpoint reply
      `invalid_grant` rather than `invalid_client`. Nothing reachable from
      outside exercises `_apple_client_secret()` without deleting an account,
      so the paste itself is proven only by the deletion test below.
- [x] Google and Apple sign-in are configured server-side: both endpoints
      return `401` on a bad token rather than the `501` they return when their
      client-id lists are empty. Whether Render's `GOOGLE_CLIENT_IDS` contains
      the same id the app sends is only provable at a real sign-in, because the
      audience check runs after Google validates the token.
- [ ] Account recovery is honestly unavailable: `/auth/forgot` now returns 501
      and the app handles that code with a real message. It was returning a
      hollow 200 before, mailing reset codes into the server log. Set
      `RESEND_API_KEY` and `MAIL_FROM` to actually deliver them.
- [ ] Remove seeded/fabricated production runs and rotate any credential that
      has previously been shared outside the secrets manager.
- [x] Live privacy page covers Apple Health correctly. Checked 2026-08-12: it
      already states that PASER writes finished runs to Apple Health and reads
      nothing, which is exactly what the binary now does.
- [ ] Create a real, stable reviewer account and paste it into Review Notes.
- [ ] **In-app purchase store setup (owner-only, App Store Connect).** This is
      the first version with IAP, so the products are reviewed with the app.
      Create the two subscriptions in ONE group and all seven consumables (ids
      and prices in "In-app purchases" above), give each localized metadata and
      the subscription group a review screenshot of the paywall, and make sure
      the Paid Apps agreement is active and banking/tax are complete or every
      product stays "Missing Metadata" and blocks submission. Add all nine to
      the version's In-App Purchases section so they submit together.
- [ ] **Backend IAP verification is ON (owner-only, Render env).** Set
      `iap_verify_receipts=true`, `apple_app_apple_id` (App Store Connect ->
      App Information -> Apple ID, needed for production verification), and
      `apple_bundle_id=com.pacerrun.app`. Left false, every subscribe/consume
      call grants for free; set true without the identifiers, it fails closed
      and real purchases cannot complete. Verify a sandbox purchase completes
      end to end before submitting - the release rule is that no build may ship
      a buy button that cannot complete a real transaction.
- [x] Build 25 (2.1.0) built and uploaded to App Store Connect on 2026-08-12.
      EAS build id `c57ede84-3644-4f75-98c1-f37bd0b86aa1`. This is the first
      build with the HealthKit module actually linked, and the first since
      App Store Connect rejected build 24 for error 90683. Do not submit build
      23 or 24.
- [x] **Build 27 (2.1.0) uploaded to App Store Connect 2026-08-13.** Submission
      `34c2eeb5-687d-440f-9bbf-1d4e22912d4a`, API key `Y76YNKLKFB` from the EAS
      servers, so no Apple password was handled. Apple processes it in about
      ten minutes and then it appears in TestFlight:
      `https://appstoreconnect.apple.com/apps/6788529145/testflight/ios`.
      **This is an upload, not a submission for review.** Everything unchecked
      below still has to happen in the App Store Connect web UI or on a
      physical device before the Submit for Review button is worth pressing.
- [ ] **Build 27 supersedes build 25 and is the one to test.** EAS's remote
      build counter was already at 26, so this build took 27 — do not read the
      gap as a missing build. Build 25 predates
      the 2026-08-13 UI pass: the hand-drawn frames were drawn at each
      drawing's own size (so a full-width hero wore a 17pt line and a 52pt
      button wore the banner's clipped corner as a rule struck through its
      label), framed controls painted their own rounded-rectangle backgrounds
      underneath the wobbly outline, Create account opened the sign-in form,
      and Done on the share card opened the crossed-paths modal on top of the
      share modal — the app's only opaque full-screen Modal, which is a native
      present-on-a-presenting-controller. Do not submit build 25.
      Cut from commit `45e3e78`, on branch `ui/frames-and-claim-pass`. EAS
      build id `8ae97286-fd8e-489c-adf2-d0ebacf662f9`. The CraftPix credit line
      in Profile landed in `ed5c2dc`, after the archive, so it is in the NEXT
      build rather than this one.

      Housekeeping while you are here: the uploaded archive is **378 MB**,
      which is most of a minute of upload on every build. `.easignore` is
      worth writing — `frontend/.history`, `frontend/dist`, and the three
      `.expo-export-check*` directories are all in the tarball and none of
      them is needed to build.
- [ ] Test the fresh build on a physical iPhone through TestFlight: password,
      Apple, and Google sign-in; permissions; foreground/background run; claim;
      map; notifications; share/save; report; block; and account deletion.
- [ ] Test Apple Health on that build: You > Settings > Apple Health, allow on
      the permission sheet, finish a run, and confirm the workout and its
      distance appear in the Health app. Confirm the sheet only ever offers
      write access. Health sync cannot be verified anywhere but a real device,
      and it is the one feature in this release with no earlier build behind
      it. If it does not work, pull the Apple Health bullet from the
      description before submitting rather than shipping a claim that fails.
- [ ] Capture final 6.9-inch screenshots from that exact build.
- [ ] Complete App Privacy, age rating, content-rights, export-compliance, and
      regulated-medical-device questions in App Store Connect.
- [x] Support and privacy URLs load without authentication. Migrated off the
      old `bido.live` domain (checked live there 2026-08-13) to
      `https://www.gameablestudios.com/privacy` and
      `https://www.gameablestudios.com/support`, contact address now
      `jonathan@gameablestudios.com`. Re-verified live 2026-08-14 after the
      Vercel custom-domain move — both pages load with the correct content
      and contact address. **Update the App Store Connect Privacy Policy URL
      / Support URL fields to the gameablestudios.com URLs before
      submitting** — those are set manually in ASC and don't follow this
      repo. The App Store Connect account in `eas.json` remains
      `constanceow@gmail.com`; that is fine, but the support address is what
      reviewers and users will write to.

Build and submit only after those gates are complete:

```bash
cd frontend
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production --latest
```
