# PACER — App Store listing pack

Copy/paste into App Store Connect. Placeholders in _italics_ are yours to set.

## Basics
- **Name:** PACER
- **Subtitle (30 chars max):** Run. Claim. Conquer.
- **Category:** Primary — Health & Fitness. Secondary — Games (optional).
- **Bundle ID:** com.pacerrun.app
- **Privacy Policy URL:** https://coderfong.github.io/run/  _(live once you enable GitHub Pages — see below)_
- **Support URL:** _a page or email you control, e.g. a simple GitHub page or mailto_

## Promotional text (170 chars, editable any time)
Turn your city into a game board. Run a loop, claim the land inside it, and defend your turf against rival clans. Every run is territory.

## Description
PACER turns running into a territory game. Every run you finish as a closed
loop claims the ground inside it — the streets you circle become yours on a
live city map.

RUN
- Track any run with a live map, distance, pace, and calories.
- Close a loop and the area inside is captured as your territory.
- Pause and lock the screen mid-run; see rival land as you pass through it.

CLAIM
- Your loops become polygons on a shared city map, colored by clan.
- Steal territory by running loops over land someone else holds.
- Climb solo and clan leaderboards ranked by total land held.

CONQUER
- Join or found a clan, chase the weekly clan goal, and rise through the leagues.
- Earn XP and levels, unlock trophies, and track your season standing.

Your route is tracked only during an active run — never in the background
otherwise. Claiming land is public; your raw GPS trace is not.

## Keywords (100 chars, comma-separated, no spaces after commas)
run,running,territory,map,gps,fitness,clan,leaderboard,cardio,game,conquer,route,jog,tracker

## App Privacy questionnaire (Apple's "App Privacy" section)
Answer "Yes, we collect data." Data types and settings:

| Data type | Collected | Linked to identity | Used for tracking | Purpose |
|-----------|-----------|--------------------|--------------------|---------|
| Precise Location | Yes | Yes | No | App Functionality (recording runs / claiming land) |
| Coarse Location | No | — | — | — |
| User ID (username) | Yes | Yes | No | App Functionality |
| Fitness (steps/motion) | Yes | Yes | No | App Functionality (anti-cheat: on-foot verification) |
| Health (workouts) | Yes (write-only, optional) | Yes | No | App Functionality (optional Health sync) |
| Crash Data / Diagnostics | Yes (if enabled) | No | No | App Functionality |

- **Tracking:** No. PACER does not track users across apps/sites; no ads, no data sale.
- **Account deletion:** Supported in-app (You → Settings → Delete account) — Apple requires this and you have it.

## Background location note (for App Review)
The app declares the `location` background mode so an in-progress run keeps
recording if the screen locks. It is used ONLY during an active, user-started
run — not for continuous background tracking. State this in the review notes to
avoid a rejection.

## Age rating
Likely 4+ (no objectionable content). Answer the rating questionnaire honestly;
there is user-generated content only in the form of usernames/clan names, so you
may need to note "infrequent/mild" for user-generated content and confirm you
can moderate (block/report) if Apple asks.

## Screenshots (required: 6.7" and 6.1" iPhone)
Capture on device: (1) a run in progress with the live loop, (2) the city map
with claimed territories, (3) the season standings, (4) a clan page, (5) the
You tab with XP + trophies. Portrait, no status-bar clutter.

## Hosting the privacy policy (GitHub Pages)
1. GitHub → your repo → Settings → Pages.
2. Source: "Deploy from a branch" → Branch: `master` → Folder: `/docs` → Save.
3. Wait ~1 min; the URL is https://coderfong.github.io/run/ — put that in the
   Privacy Policy URL field above and in-app You → Settings.
