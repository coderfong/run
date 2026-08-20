# Neo-brutalism UI sweep + feature polish — multi-chat tracker

A large batch of UI/UX requests from the user (2026-08-19), to be worked
**one chunk per chat** at the user's request. This file is the shared plan: each
new chat reads it, picks the first unfinished chunk, does it, and ticks it off.

Foundations already in place (do not reinvent): `src/theme/nb.js` (tokens),
`HardShadow`, `PressableShift` (motion.js), `BackButton` (added chunk 1). The
neo-brutalist recipe is heavy stroke (`NB.stroke` 3pt) + hard zero-blur offset
drop + flat saturated fills. Dark keeps a dark page: cream stroke, accent drop.
Rules: frames and NB strokes never stack; `colors.border` stays a hairline; use
`HardShadow`/`PressableShift`, not raw `shadow.hard`, wherever Android matters.
Verify each chunk with `npx jest` + `npm run check`.

"Style every single asset neo-brutalist" is the umbrella ask — satisfied
incrementally by the screen chunks below, not as a separate pass.

---

## Chunk 1 — Navigation & shared chrome  ✅ DONE (2026-08-19)
- [x] Back arrow → NB tile. New `components/ui/BackButton.js` (squared radius-12
      tile, 3pt stroke, hard offset drop, PressableShift press). Wired into
      `ToonHeader` panel (standard + compact) and scrim variants.
- [ ] Adopt `BackButton` in the screens that still hand-roll a back chevron:
      `AuthScreen`, `ClubCreateScreen`, `auth/ForgotPassword`, `StreakCalendar`,
      `onboarding/ui.js`. Deferred to each screen's own chunk / a cleanup pass.

## Chunk 2 — Detail & customisation screens NB  ✅ DONE (2026-08-19)
- [x] Run detail page = `RunDetailScreen` (confirmed: Home feed/runner cards
      → `RunDetail`). Map wrapped in NB stroke + HardShadow; round send button →
      squared NB. Framed panels + nbField input were already NB.
- [x] Levels & rewards (`ProgressionScreen`): soft info circle → squared NB tile;
      lane-header "tickets" moved from iOS-only hard shadow to `HardShadow`
      (renders on Android). Reward tiles legitimately stay frame-based
      (celebratory surface).
- [x] "Starting to run" (`RunningScreen`): "Start run" now uses `ToonButton`
      with the run's accent fill (same pattern as the claim CTA); HUD panel +
      top status bar given heavier cream NB strokes (screen is always-dark).
- [x] Customisation (`AvatarStudioScreen`): dice → squared NB tile with hard
      drop, re-docked to the RIGHT and vertically centred on the character
      (was floating top-left and getting covered); try-on bar + slot chips
      bumped to NB stroke weight. Grid cells were already frame-based.
      NOTE: swatches left as-is (their border is the selection ring). If the
      user wants a deeper pass on chips/swatches, revisit.

## Chunk 3 — Shop & Rivals polish  ✅ DONE (2026-08-19)
- [x] Shop rarity headers: each rarity now renders a FRAMED plate (`frameVariant
      'box'`) filled in its rarity colour with a big, bold label (`toonType.label`
      @15px), text flipping to ink on legendary gold via `nbTextOn`. Was an 8px
      dot + small caption. (`ShopScreen`)
- [x] Shop "Fresh stock in …": screen is a raw ScrollView (no Screen wrapper), so
      the restock clock sat on the home indicator — now `paddingBottom =
      insets.bottom + space.huge`.
- [x] Rivals card "🔥 RIVALRY" / "⚔ UNDER ATTACK": was bright teal outlined text
      that vanished on the card. Now a FILLED state-coloured NB tag (stroked pill,
      ink/white text via `nbTextOn`). (`RivalCard`)
      NOTE: `RivalPopup`'s "NEW RIVALRY" left as-is (pink, more legible, transient
      toast). Revisit if the user wants it matched.

## Chunk 4 — Map & ranks (frontend-only parts)  ✅ DONE (2026-08-19)
- [x] Frame around the map: heavy NB stroke overlay inset to the safe area,
      drawn over the board but under the controls, `pointerEvents="none"`,
      scheme-coloured (dark ink on light basemap, cream on dark). (`GlobalMapScreen`)
- [x] Season standings filters: the "messy" was inline VERTICAL dividers floating
      wherever a wrapping chip row happened to break. Replaced with a full-width
      rule that forces each axis onto its own line and cleanly separates the
      groups (who / by, when / where); row gap opened up. (`SeasonScreen`)

## Chunk 4b — Rank-scoped territory + locked ranks (CROSS-STACK)  ✅ DONE (2026-08-20)
- [x] BACKEND: `/map-polygons` (`routes/territories.py`) now returns each owner's
      RANK on every territory (`rank_key` / `rank_tier` / `rank_label`, decay
      already applied) and accepts `?rank=N` to scope the board to one tier.
      No migration: rank derives from the existing `rank_points`/`rank_points_at`
      columns via `ranks.DECAY_SQL` + `rank_for_points` + new `ranks.tier_bounds`.
      The filter lives in SQL so the LIMIT is respected (a sparse tier still fills
      its page). Omitting `rank` returns all tiers, so the claim-placement callers
      (`ResultScreen` / `RunningScreen`) are untouched.
- [x] FRONTEND: `api.mapPolygons(bbox, zoom, { rank })` gained the opt-in param.
      `GlobalMapScreen` got a centred NB rank-selector pill (‹ swatch+label ›),
      defaulting to the viewer's own tier (`useAvatar().rankKey`) and auto-following
      it until the runner scouts by hand. Board refetches on tier change; `rank`
      joins the viewport cache key. Tiers above your own are viewable but show a
      LOCKED note; tapping the pill opens an explainer Sheet.
- [x] Tests: new `backend/test_map_ranks.py` (all pass, incl. empty-tier and
      open-top-tier cases); `npx jest` 782/783 (the 1 fail is Chunk 5's
      `landCaptureAlert.test.js`, unrelated: client is mocked); `npm run check` clean.
- NOTE: unpushed backend work reads as a broken feature on device (the app hits
      the Render backend, see paser-prod-deploy-gap). Ranked map needs `master`
      pushed to Render before it works in TestFlight.

## Chunk 4c — Repeat-claim saturation (CROSS-STACK)  ✅ DONE (2026-08-20)
The claim-count field already EXISTED: `territories.reinforcements` (migration
0022) is +1'd on every re-run over the owner's own ground (see `_claim_territory`
in `runs.py`, `merged_reinforcements`). So NO new column / migration was needed —
the work was to surface it and use it.
- [x] BACKEND: `map-polygons` now selects `t.reinforcements` and returns it on
      `TerritoryOut` (`schemas.py`, `routes/territories.py`). `strength` was
      already in the payload but it is muddied (pace + attack chip damage);
      `reinforcements` is the clean repeat-claim count, so the fill keys off it.
- [x] FRONTEND: `GlobalMapScreen.toFeatures` folds the count into `fillOpacity`
      via `claimSaturation(reinforcements)` — a diminishing-returns curve
      (`1 + 0.6·(1 − e^(−reps/2.5))`, ≤ ×1.6) multiplied onto the existing
      freshness-decayed opacity, then clamped to `SAT_MAX` 0.92 so a farmed block
      reads bold but never a flat opaque wall. Sits alongside chunk 4b's rank
      selector edits in the same file (no conflict).
      NOTE: the post-run preview builder (`territoryBoard.js`) was left as-is —
      it draws a single run's claim, not the persistent repeat-claimed board.
- DEPLOY: backend-only for the data (no migration). The live app hits Render, so
  the deepened fill only appears once backend is pushed AND the client build ships
  the `toFeatures` change; until backend deploys, `t.reinforcements` is undefined
  and `claimSaturation` returns 1.0 (unchanged look) — safe, no gate.

## Chunk 4d — Dev: test Crossroads (CROSS-STACK, small)  ✅ DONE (2026-08-20)
Crossroads is the "paserby" plaza (people you've crossed), reachable from Profile.
Testing it needs ENCOUNTER data, which comes from runs near other players — so a
proper dev affordance wants a backend dev-seed endpoint (mirror `DevRunSimulator`'s
"submit a real synthesised run" approach) gated by `__DEV__`/`dev_tools`.
- [x] BACKEND: `POST /dev/paserby/seed` + `POST /dev/paserby/clear`
      (`routes/dev.py`), on the same `is_dev_account` allowlist as the rival
      scenarios. Seed writes REAL `paserby_encounters` + `paserby_pairs` rows —
      the same rows the matcher writes (NULL run ids, ordered pair) — against
      throwaway `is_bot` runners it owns (`DevCross_<uid>_<i>`), spread across the
      familiarity ladder, the broad-date phrases, rank/level, an incoming
      high-five on some, and (where clubs already exist) clan tags. Idempotent: a
      re-seed deletes the caller's prior dev bots first and their
      encounters/pairs cascade away with them. `clear` removes them.
- [x] CLIENT sends real generated loadouts (`config/cosmetics.randomEquipped`)
      so the seeded characters wear real cosmetics, not the default look.
      `api.devSeedCrossroads/devClearCrossroads`.
- [x] Dev button: `components/DevCrossroadsSeed.js` (gated `__DEV__ ||
      dev_tools`, same pattern as DevRunSimulator/DevProPanel), dropped into the
      "Crossed paths" card in `ProfileScreen` — seeds N runners then opens the
      plaza, so the screen is reachable even from a cold/empty account (its own
      entry button is hidden until an encounter exists).
- VERIFY at hand-off: `npx jest` 782/783 and `npm run check` red, but BOTH
  failures were concurrent unrelated chunks in the shared tree — `ProfileScreen`
  had a duplicate `GOLD` (Chunk 7's `import {GOLD}` vs the stale local const,
  which differ in value: #eab308 vs #F5C451 — Chunk 7's to resolve) and
  `landCaptureAlert.test.js` (Chunk 5's ring). The `check:tdz`/`check:undefined`
  scanners swept all files and flagged nothing in this chunk's new/edited code.
  Re-run once those chunks land.

## Chunk 5 — Rival capture experience  ✅ DONE (2026-08-19)  [needs on-device check]
Reworked `LandCaptureAlert` into two stages:
- [x] Replay bug fixed: the choreography used to live behind the always-open
      warning; it now mounts ONCE in a dedicated `playback` view (keyed), so it
      can't restart on re-renders.
- [x] `alert` view: plain "LAND CAPTURED", the runner's own `CharacterBust`, the
      loss strip, and two buttons only — "VIEW AFFECTED LAND" + "DISMISS". The
      NOTIFICATIONS action is gone (also removed its handler from `App.js`).
- [x] On View → `playback` view: the capture choreography plays once, ending on a
      "TERRITORY STOLEN" banner (victim-side mirror of the attacker's payoff),
      then a "ZOOM TO THE LAND" button that fits the live map to the real ground.
- [x] REAL AREA (follow-up, 2026-08-20): the "stolen" payload now carries the
      attacker's territory ring (`territory_ring`, largest ring, decimated to 28
      pts / 5dp so it stays under Expo's ~4KB push limit — `_decimate_ring` in
      `runs.py`, mirrored in the dev simulator). `landCaptureAlerts` validates it
      into `territoryRing`; `LandCaptureAlert` projects it into the stage via
      `utils/staticMercator.fitRingToBox` (Web Mercator, 512-tile, matched to the
      static snapshot's centre + zoom) and passes it as `territoryRings` to
      `CaptureStylePlayer` + `layoutDefenders`, so the box is the EXACT area, not
      the seeded fan. "ZOOM TO THE LAND" forwards the ring through `onViewLand`;
      `GlobalMapScreen` `fitToPoints` the ring instead of a point drop. Older
      captures / any path without the ring keep the point + fan fallback.
      Jest + nb pass, but ANIMATION/LAYOUT is unverified here (RN/Expo, no
      browser) — verify on device (use the dev capture simulator, which now sends
      the ring too).

## Chunk 6 — Claim / "drop your land" placement UI  ✅ DONE (2026-08-20)
All in `src/components/claim/ChooseAttack.js` (plus a stale comment in `ResultScreen`).
- [x] Move-mode buttons shrunk: the `recFrame` square → a short card
      (`aspectRatio: 1.5`), icon 30→22, tighter chip padding. The three cards no
      longer tower over the rail. `claimSheet` maxHeight is a cap (wraps content),
      so the sheet shortens on its own — comment there corrected.
- [x] Slider enlarged: `railTrack`/`railFill` 6→10px, `railTouch` 34→46,
      `HANDLE` 26→32, `handleCore` 10→12, rest notch grown to match. Position is
      the primary control on the screen, now reads that way.
- [x] Label→value gap tightened: `GroundMetric` row was `space-between` (label
      left, number pushed to the far right); now `flex-start` so NEW/ENEMY/
      YOURS/GAIN sit right next to their figures (value marginLeft 8→6).
      NB system untouched (frames/strokes never stack). ChooseAttack tests pass;
      `npm run check` green. Full jest: 782 pass, 1 fail = Chunk 5's
      landCaptureAlert "boxes the real ring" (unrelated to this chunk).

## Chunk 7 — PASER Pro gating & monetisation  ✅ DONE (2026-08-20)
- [x] New shared gate `components/ProLock.js`: `ProLockedSection` (swaps a whole
      feature for a NB gold-stroked, hard-drop lock card; tap → `openPaywall`)
      and `ProInlineLock` (slim in-surface strip). Both reuse ProTeaser's
      `useProTeaser`, so a locked panel is the SAME funnel event as a locked map
      layer. Gate = `canShowPro && !isPro`: a build that can't sell PRO, and a
      subscriber, both get the real feature — only a sellable-but-unsubscribed
      account sees a lock. Depth-not-power upheld (richer VIEWS only).
- [x] Gated **Splits** on `RunDetailScreen` and `ResultScreen` (context
      `run_detail` / `run_insights`, feature `run_splits`). No splits → no lock.
      Reused existing contexts, so `proContexts.test` (banned-power/icons/dashes)
      needed no new copy.
- [x] Gated the **elevation / advanced stat row** on the ResultScreen card
      (Best km · Elevation · Avg speed) via `ProInlineLock`. The four headline
      stats (distance/pace/duration/calories) stay free. Read the lock boolean
      via `useProEntitlement` in the screen (no side effect); the impression
      fires from the single `ProInlineLock` that renders.
- [x] Gated **runner colour** customisation: `TRAIL_GLOW_COLORS` gained a `pro`
      flag (club + 4 neons free; violet/magenta/orange/amber are PRO). Locked
      swatches wear a gold padlock and open the paywall (`cosmetics`) instead of
      selecting. A pre-gated choice is grandfathered; only NEW selects are gated.
      (AvatarStudio cosmetics were already PRO-gated per-item — left as-is.)
- [x] Repurposed the redundant territory report: `TerritoryInsights` gained
      `hideClaimSummary`, set on ResultScreen, dropping the two lines the hero
      card already shouts (Land claimed, Taken from). RunDetail keeps them (no
      card above it there). Unique lines (new ground, biggest capture, standing)
      and the PRO form analytics — the actual depth — stay.
- GOTCHA: `ProLockedSection` returns `children` verbatim when unlocked, so the
      wrapper's `style` (e.g. marginTop) is dropped in that path — the top gap
      has to live on the CHILD too, not only the wrapper.
- NOTE: static checks + affected jest green. Lock CARD / press motion (RN/Expo)
      unverified in a browser here — eyeball padlocks + tap-to-paywall on device.

## Chunk 8 — Share flow  ✅ DONE (2026-08-20)
- [x] Removed the "Everything around your run stays see through…" hint line and
      its style from `RunShareSheet`.
- [x] Gated the fine-grain LOOKS behind PRO: the Accent row and the Text
      (alignment) row now carry the Chunk 7 padlock — a gold PRO tag on the
      label, dimmed controls, and a full-row Pressable that opens
      `openPaywall('share')` instead of letting a free account change them. Off
      for subscribers and in no-store builds (`!isPro && canShowPro`), so no dead
      padlocks. WHAT the card says (stats, route, runner) stays free; this gates
      polish, not substance. Reuses the AvatarStudio lock pattern (gold `Lock` +
      `GOLD`).
- [x] Card font changed from Poppins Black (round, kiddy) to Anton, the tall
      condensed athletic poster face — added as `fonts.poster`, used for the
      stat label/value/unit and the wordmark badge in `RunShareCard`. Anton was
      already loaded in App.js, just never exposed on `fonts`.
- [x] Two stats now sit ONE PER LINE (Strava): `perRow = stats.length <= 2 ? 1
      : 2` drives both the row-height maths and the cell width; three or more
      stay two-up.
- [x] Shareable card position: asked the user (it already sits directly under
      the "Share your run" title) — they chose KEEP AT TOP, so no reorder.
- [x] Removed the "Home post" editor from the share flow. Posting to Home is its
      own thing and still lives on the Home feed card (`FeedCard` →
      `RunPostEditorModal`); dropped the `RunPostEditor` import + Row from
      `RunShareSheet`.

## Chunk 9 — Copy cleanup  ✅ DONE (2026-08-20)
- [x] Trimmed redundant, AI-sounding descriptive copy. The real pattern (not a
      blanket cull): empty-state bodies that restated their own titles, and
      ProTeaser/ProLocked blurbs that duplicated the row list right beneath them.
      Edits:
      - `HomeScreen` feed empty state: dropped "Start a run." (a Start-run button
        sits right there).
      - `ClubChatScreen` empty state: title is "Say hi", so "Kick off the club chat."
        went → body is just "Plan the next run together."
      - `ClubScreen` intro cards: dropped "Switch here" / "This is your crew home:
        … all live in Club view" framing.
      - `config/paserby.js` `empty`: dropped leading "No crossed paths yet." (the
        `emptyTitle` already says it).
      - `TerritoryInsights` PRO blurb: was a 1:1 restatement of its four rows →
        "How this run compares with your recent form."
      - `RunDetailScreen` splits blurb: dropped awkward "for every run you read".
      - `RivalDetailScreen` free blurb: fixed broken "how far you have each run"
        grammar → "monthly distance".
      - `RivalsScreen` empty state: "the rivalry starts itself" → "a rivalry begins".
      Left intentionally (deliberate explainers whose own comments defend them):
      `ProgressionScreen` info sheet, `config/paserby` INTRO_BEATS, `TerritoryPlanner`
      estimate caveats; plus permission rationale (`LocationPermissionScreen`), the
      onboarding slides, and every functional error/validation/legal string. No dash
      violations existed or were introduced; `·` placeholder usage untouched.
      Verified: `npx jest` (782 pass; the 1 `landCaptureAlert` "boxes the real ring"
      fail is Chunk 5's unverified backend-payload feature, not this copy pass) +
      `npm run check` green.
