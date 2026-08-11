# PASER App Store submission pack (2.1.0)

Audited 2026-08-12 against the current iOS build configuration and Apple's
current submission rules. Bundle id: `com.pacerrun.app`.

## Submission status

The source now passes Expo's store-readiness checks and produces an iOS bundle,
but **do not submit the existing EAS build**. Build 23 predates the changes in
this working tree. Complete every unchecked gate in "Before submission" below,
then create and test a fresh production build.

## App Store Connect metadata

- Name: `PASER`
- Subtitle: `Run. Claim. Conquer.`
- Primary category: Health & Fitness
- Secondary category: Games
- Bundle ID: `com.pacerrun.app`
- Version: `2.1.0`
- Privacy Policy URL: `https://www.bido.live/privacy`
- Support URL: `https://www.bido.live/support`
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
```

Keywords (100-character field; verify in App Store Connect after pasting):

```text
run,running,gps,fitness,territory,map,club,game,streak,cardio,jog,workout,route
```

What's New:

```text
Run to claim territory, build your runner, team up with a club, and share your
achievements with PASERs. This update also improves privacy and community safety.
```

Do not advertise PASER PRO, Energy purchases, or coin packs in this version:
those purchase surfaces are deliberately disabled until a real StoreKit flow
is complete.

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
- Loot boxes: No for this build (nothing can be purchased; paid surfaces are off)
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
This version does not offer in-app purchases.
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

- [x] Backend deployed. Commit `b5170cf` pushed 2026-08-12 and live on Render:
      `GET /version` reports `2.1.0` / commit `b5170cf`, `GET /health` reports
      `{"ok": true, "db": true}`, and `/me/reports`, `/me/blocks` and
      `/auth/apple` are in the served OpenAPI. The service boots by running
      Alembic, so revisions `0030`–`0032` ran with it.
- [ ] Set Render `ENV=production`. Still `development` as of the deploy above,
      and it is the last thing `/version` gets wrong. `APP_VERSION` now tracks
      the code and already reads `2.1.0`.
- [ ] Configure `APPLE_CLIENT_IDS`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`,
      `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`; test Apple sign-in and deletion.
      This is also the real proof that `0032` landed: token revocation reads
      the column it added.
- [ ] Configure and test Google sign-in with the same client id used by the app.
- [ ] Remove seeded/fabricated production runs and rotate any credential that
      has previously been shared outside the secrets manager.
- [x] Live privacy page covers Apple Health correctly. Checked 2026-08-12: it
      already states that PASER writes finished runs to Apple Health and reads
      nothing, which is exactly what the binary now does.
- [ ] Create a real, stable reviewer account and paste it into Review Notes.
- [ ] Create a fresh EAS production build; the latest existing build (23) does
      not contain this audit's fixes.
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
- [ ] Confirm the support and privacy URLs work without authentication.

Build and submit only after those gates are complete:

```bash
cd frontend
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production --latest
```
