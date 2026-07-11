# PASER — App Store submission pack

Everything you paste into App Store Connect + the steps to submit. App name is
**PASER**; bundle id `com.pacerrun.app`.

---

## 1. Create the app record (unblocks TestFlight + submission)

1. Go to <https://appstoreconnect.apple.com> → **Apps → +** → **New App**.
2. Platform **iOS**, Name **PASER**, Primary language **English (U.S.)**,
   Bundle ID **com.pacerrun.app**, SKU **paser-ios** (any unique string).
3. Once created, open the app → the number in the URL / **App Information → Apple ID**
   is your **`ascAppId`** (a ~10-digit number). Put it in `frontend/eas.json`
   (see step 4) so `eas submit` works.

## 2. Listing copy (paste these in)

**Name:** `PASER`

**Subtitle** (≤30): `Run. Claim. Conquer.`

**Promotional text** (≤170):
> Turn every run into territory. Claim the map with your distance, defend it with
> your club, and race to hold the most land this season.

**Description:**
```
PASER turns running into a game of real-world territory.

Every run you finish becomes a claim zone as big as the distance you covered —
place it anywhere along your route and take that ground for yourself and your club.
Run faster to claim stronger land. Run the same streets again to reinforce it.

• CLAIM THE MAP — your distance converts into a circle of territory you drop on your route.
• RUN CLUBS — join or create a club, defend land together, and climb the season standings.
• STRENGTH & STEALS — faster runs make stronger claims; out-run a rival to take their turf.
• BUILD YOUR RUNNER — a customisable character with hair, outfits, faces and colours.
• STAY MOTIVATED — streak calendar, XP and levels, personal records, and a live activity feed.
• SOCIAL — comment on runs, chat with your club, and give kudos.

PASER records your route only during an active run. Lace up, head out, and start
taking ground.
```

**Keywords** (≤100 chars, comma-separated, no spaces):
```
run,running,run tracker,gps,fitness,territory,map,club,run club,game,streak,cardio,jog,workout
```

**Support URL:** `https://coderfong.github.io/run/privacy.html` (or a real support page)
**Marketing URL:** *(optional)*
**Privacy Policy URL:** `https://coderfong.github.io/run/privacy.html`

**Category:** Primary **Health & Fitness**, Secondary **Games**.

## 3. App Privacy (the data questionnaire)

Declare **Data linked to you**:
- **Location — Precise Location** → App Functionality (route recording). *Yes, used for app functionality; not for tracking.*
- **Health & Fitness** (distance/steps) → App Functionality.
- **User Content** (comments, chat) → App Functionality.
- **Identifiers / User ID** (username, push token) → App Functionality.
Answer **No** to "used for tracking" and **No** to third-party advertising.

## 4. `eas.json` submit config

`frontend/eas.json` now has a `submit.production` block with placeholders —
replace them and you can submit non-interactively:
- `ascAppId`: the Apple ID number from step 1.
- `appleId`: your Apple Developer account email.
- `appleTeamId`: from <https://developer.apple.com/account> → Membership.

(Or skip editing and run the interactive command in step 5, which fills these in.)

## 5. Submit the build to TestFlight, then the App Store

The background-tracking build is already built on EAS. From `frontend/`:

```
# interactive — signs in and auto-detects the app; easiest first time
npx eas-cli submit --platform ios --latest
```

Then in App Store Connect: **TestFlight** tab → the build appears after ~5–15 min
of processing → test it. When happy, **Distribution → + Version → 2.0.0**, attach
the build, fill the listing above, and **Submit for Review**.

## 6. Review notes (paste into "App Review Information → Notes")

```
PASER is a fitness game: real running distance is converted into map territory.

DEMO ACCOUNT (required — the app needs login):
  username: <create a test account and put it here>
  password: <...>

BACKGROUND LOCATION: PASER requests "Always" location solely to keep recording a
run's route when the screen is off DURING an active, user-started run. Tracking
starts only when the user taps Start on the Record screen and stops when they
finish/pause. The standard blue background-location indicator is shown while
recording. Location is never collected outside an active run.

HOW TO TEST: sign in with the demo account, open the Record tab, tap Start, and
move (or use a simulated route). Distance accrues; tap the hold-to-finish control
to end and place the claim circle on the map.
```

> ⚠️ Fill in a real demo username/password before submitting — reviewers reject
> login-gated apps without working credentials.

## 7. "What's New" (version 2.0.0)

```
Welcome to PASER. Run to claim real-world territory, defend it with your run club,
and climb the season standings.
```
