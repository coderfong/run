# Territory Run — Design Brief

A complete brief to hand to Claude Design (or any designer). Paste sections in chunks if the whole thing is too long for one prompt.

---

## 1. Product in one sentence

Territory Run is a mobile GPS running game where Singapore is divided into 4 regional teams (North, East, South, West), and runners claim physical land by running closed loops. The closed-loop polygon is the captured area; an open path converts to a thin strip instead. Teams compete for total km² held across the city.

At launch — before any runs have happened — each of the 4 regions starts as fully owned by its native team, giving an even 25% / 25% / 25% / 25% distribution on the map and leaderboard. The game state diverges from there as runners capture and trade land.

Think Strava meets paper.io meets a hometown rivalry.

---

## 2. Aesthetic direction

**Bold and playful, not techy or sporty.** The opposite of a clinical fitness tracker.

- High contrast, vivid team colors painted directly onto the map
- Generous corner radii (12-16px on cards, fully rounded pills)
- Big, confident typography for stats and team identity
- Subtle game-y touches: badges, celebrations, claim animations
- Avoid: dark neon/cyberpunk, military/tactical, sterile medical-app vibes
- Reference vibe: Pokémon GO's confidence + Citymapper's clarity + a touch of Duolingo's playfulness

**Both light and dark mode required.** Dark is the default for the active run screen (battery, outdoor visibility); light is the default everywhere else.

---

## 3. Brand and team colors

### Team palette (4 regions)
These are visible on every map. The hues are spaced ~90° apart on the color wheel so zones stay readable when they touch.

| Team  | Fill        | Stroke / dark text     | Dark-mode fill |
|-------|-------------|------------------------|----------------|
| North | `#e9d5ff`   | `#9333ea` / `#581c87`  | `#f3e8ff`      |
| East  | `#bbf7d0`   | `#16a34a` / `#14532d`  | `#dcfce7`      |
| South | `#bfdbfe`   | `#2563eb` / `#1e3a8a`  | `#dbeafe`      |
| West  | `#fecaca`   | `#dc2626` / `#7f1d1d`  | `#fee2e2`      |

### Brand neutrals
- Brand dark: `#0d1117` (run screen background, primary text in dark mode)
- Surface light: `#fafaf7` (page background, soft off-white)
- Surface dark: `#161b22`
- Border: `#e5e1d8` light / `rgba(255,255,255,0.08)` dark

### Don't pick an additional accent color
The user's team color *is* the accent color for that user. Their CTAs, "you" indicators, and progress bars all use their own team color. This makes the app feel personal and avoids the 4-teams-plus-1-brand-color clutter problem.

---

## 4. Typography

Pick two characterful fonts. Avoid Inter, Roboto, system defaults.

- **Display** (numbers, headings, team names, in-run timer): something chunky and confident with strong personality. Suggestions: Archivo Black, Boldonse, Druk Wide, or a heavy weight of Sharp Grotesk.
- **Body** (UI, descriptions, labels): a clean modern grotesk. Suggestions: Geist, Manrope, DM Sans, Public Sans.

Numerical weight: use only 400 (body) and 500 or 700 (display headings). Skip 600.

Sentence case everywhere. No ALL CAPS except small uppercase eyebrows (team region labels above big numbers).

---

## 5. Component tokens

- Card radius: `12px` (regular), `16px` (hero cards)
- Pill radius: fully rounded
- Border: `0.5px` for refined feel
- Spacing scale: 4, 8, 12, 16, 24, 32, 48 px
- Touch targets: 44px minimum
- Map zone strokes: `1.5px` regular, `2.5px` for the user's own zones (a subtle bump that reads as "yours")

---

## 6. The core mechanic to visualize

This is the one thing that must be unmissable in the UI. The whole game lives or dies on whether players understand it.

> A **closed loop** = you claim the polygon inside (area depends on the shape you ran).
> An **open path** = your distance converts directly to area at a fixed rate.

**The math**
- Closed loop area = the geometric area enclosed by the polygon (varies by shape — a circular 5km loop maxes out around 2 km², an irregular city 5km loop is typically 0.5–1.0 km²)
- Open path area (km²) = **distance (km) × 0.05**
  - 1 km open → 0.05 km²
  - 5 km open → 0.25 km²
  - 10 km open → 0.50 km²

This 0.05 constant is mentally equivalent to painting a 50m-wide strip along your route (close to one HDB block wide), which is a useful spatial intuition even though the game can render the open-path area however looks best — strip along the path, expanding circle from the endpoint, or a flat number ticking up.

The result: a typical 5km closed loop captures ~3× more area than a 5km open path. Closing always wins, but open paths still earn you something, so a partial run is never wasted. Tune the 0.05 constant up or down to shift game balance: lower = "closing matters even more", higher = "open running is more competitive".

**Design treatments needed**
- On the active run screen: live preview of the polygon if you closed your loop right now (dashed line back to start, semi-transparent fill in your team color)
- Two stat readouts side by side: "0.42 km² if closed · 0.12 km² as open path"
- A "Close the loop!" prompt that appears when the runner is within X meters of start
- Result screen variants: "Loop captured" (celebration, big polygon) vs "Distance converted" (shows the open-path area as the result)
- On the World Map: a live "team share" bar showing the current 4-way split, starting at 25/25/25/25 and shifting over time. This bar is the at-a-glance scoreboard for the whole game.

---

## 7. Existing screens to redesign

All 8 already exist with working logic. They need a unified visual treatment.

1. **Onboarding** — 4 swipeable slides with custom illustrations: orbiting runner closing a loop, team-colored land flooding the map, stealing overlap from a rival, location-permission radar.
2. **Auth** — Sign in / sign up toggle. Username + password.
3. **Home (hub)** — Greeting, your team badge, a static map of Singapore's 4 regions with yours highlighted, 3 stat tiles, Start Run CTA, secondary buttons to World Map and Leaderboard. At launch the 4 regions display as fully colored in their team hue (the 25% baseline).
4. **Running** — Active GPS tracking. Live polyline, distance/pace/time, loop-closure preview, "close the loop" hint.
5. **Result** — Post-run summary. Captured polygon variant and no-loop variant.
6. **GlobalMap** — Interactive pan/zoom map of all territories painted in team colors. Yours subtly emphasized.
7. **Leaderboard** — Top runners by total area held. Team dot, username, area. Your row pinned visible.
8. **Profile** — Avatar, username (inline-edit), team pill, sign out, delete account.

---

## 8. New screens and states to design (priority order)

These are missing from the current build. Listed by impact.

**P0 — Must add**
1. **Team reveal** — appears once, between signup completion and first Home view. Animated zoom into the user's assigned region on a map of Singapore, team color floods in, "Welcome, runner of the [region]." Bold display type. Single CTA: "Claim my first zone."
2. **Empty Home** — what a new user with zero territories sees. The 3 stat tiles read 0. Replace the map with an instruction state: "Run your first loop to claim land." Big primary CTA.
3. **Location permission denied** — both Home and Running need this. Soft empty state with a re-prompt CTA and a "Open settings" link.

**P1 — Should add**
4. **First capture celebration** — overlay on the Result screen the first time a user captures any land. Confetti or a team-colored burst, "Your first zone!" badge, share prompt.
5. **Mid-run states** — pause/resume, GPS-lost banner with last-known position, low-battery warning, run-too-short discard.
6. **Result variants** — beyond captured/none: loop-too-small, loop-overlaps-existing-territory, loop-stole-from-rival (own celebration moment).
7. **Real-time conflict alert** — push notification + a "Your zone in [region] was contested" banner that deep-links to Home with a Defend CTA.

**P2 — Polish**
8. **Loading and skeleton states** for Auth → Home, Home → World Map, Profile fetching.
9. **Sign-out and delete-account** confirmation flows.
10. **Onboarding skip-resume** — if a user skips and comes back, where do they land?

---

## 9. What to deliver

For each screen and state above, produce:

- One high-fidelity mobile mockup (390×844 iPhone frame is fine), light mode
- The dark-mode variant where it matters (Running for sure; Home and Result optionally)
- Specs for any new components (claim-celebration burst, GPS-lost banner, team reveal animation key frames)
- A compact component sheet at the end: buttons, pills, stat tiles, map zone styles, the team-color application rules

Export as a Figma file or a single multi-page artifact, whichever Claude Design produces best.

---

## 10. Don'ts

- No purple gradients on white. No glowy neon. No noise textures.
- Don't introduce a 6th color for "brand" — the team palette is the brand.
- Don't put icons inside the team region zones on the map. Color and label only.
- No tiny text — 11px floor.
- Don't redesign the existing IA (info architecture). The 8 screens and the navigation between them are settled; this brief is about visual cohesion and missing states.
- Don't mock up real-time multiplayer chat or social features — out of scope for this pass.

---

## 11. One thing to nail

If only one screen comes out perfect, make it the **Running** screen. The loop-vs-strip preview, the live polygon fill in team color, the "close the loop" prompt — this is the screen that turns "I went for a run" into "I'm playing Territory Run."
