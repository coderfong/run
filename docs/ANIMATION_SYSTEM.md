# PASER FX system

## Shipped library

`C:\Users\user\Desktop\animations` remains the source library. The curated selection contains 45 assets, and the release gate imports the 44 assets whose packages have explicit compatible terms. Their authored 1× sheets total 1,114,854 bytes (about 1.06 MiB). The importer also produces nearest-neighbour 2× and 3× Metro variants, bringing the complete density set to 4,464,371 bytes (about 4.26 MiB). Metro selects the matching texture for the device instead of stretching a 1× frame across Retina pixels. The generated registry uses literal `require()` calls, so Metro never receives the rest of the 297.8 MB collection or the one blocked candidate.

Two existing PASER Lotties are registered alongside the approved sprites. `EffectPlayer` therefore exposes 46 release-approved effects through one API:

```jsx
<EffectPlayer
  effect="electric_impact_01"
  size={260}
  loop={false}
  onComplete={onDone}
/>
```

The caller does not need to know whether an entry is a sprite, Lottie, animated image, or static image. Missing sources, unsupported types, corrupt metadata, renderer exceptions, and missing callbacks all terminate the visual slot safely; none can alter territory ownership.

## Architecture and ownership

- `frontend/src/effects/generatedEffectRegistry.js` is generated and must not be edited by hand.
- `animations:import` writes each sprite as a 1× source plus `@2x` and `@3x` nearest-neighbour siblings. Metro treats these as one logical asset with three density scales; frame metadata remains in logical pixels.
- `effectRegistry.js` performs id, category, tag, and random queries over release-approved entries only.
- `SpriteAnimation.js` advances frames with Reanimated's UI-thread frame callback. It does not set React state per frame and clamps the frame index to `frameCount - 1`, including partially filled grids.
- `EffectPlayer.js` validates metadata, contains renderer exceptions, guarantees at-most-once completion, and has a bounded completion fallback.
- `CaptureStylePlayer.js` owns visual cue scheduling, caps concurrent effects at three, cancels timers/shake on unmount or replay, and clears completed textures.
- `anchors.js` creates one memoized projected-polygon model per playback. `territoryVisualCenter` searches for a visible interior point with the best edge clearance, then fits the rendered extent inside safe screen insets.
- `useClaimSequence.js` is the sole owner of territory/reveal/payoff state.
- `Pet.js` and `ReactionEffect.js` remain semantic presentation systems, not game-state dependencies.

The production handoff is:

```text
useClaimSequence (state owner)
  -> CaptureStylePlayer (presentation plan)
  -> authored FX and haptic cues
  -> territoryReveal callback
  -> useClaimSequence starts TerritoryRevealCanvas
  -> permanent territory, victory, payoff, leaderboard
```

The sequence controller supplies a tracked fallback if the authored reveal callback never arrives. Skip, replay, reset, unmount, and completion cancel and resolve pending waits so old async runs cannot retain closures or update a later screen.

## Layer model

The shared values in `frontend/src/effects/layers.js` define the ordering:

| Layer | z-index | Owner |
| --- | ---: | --- |
| Map and territory base | native/base | Result map |
| Territory reveal | 20 | `TerritoryRevealCanvas` |
| Character / encounter | 30 | `CaptureEncounter` |
| Foreground and impact FX | 40 | `CaptureStylePlayer` |
| Victory beat | 50 | `TerritoryVictoryBeat` |
| Result UI | 100 | payoff/header controls |

Screen shake is applied only to the FX stage, never to the Result UI.

## Capture styles

| Style | Duration | Choreography | Release |
| --- | ---: | --- | --- |
| Thunderstrike | 1400 ms | electric charge -> electric impact/reveal -> solar aftershock | approved |
| Arcane Portal | 1800 ms | red vortex -> spectral bloom/reveal -> void fold | approved |
| Warm Detonation | 1300 ms | fuse burst -> warm impact/reveal -> ember trail | approved |
| Frostbite | 2200 ms | frost nova/reveal -> crystalline bloom -> bubbles | approved |
| Inferno | 1700 ms | rotating fire -> rising column -> hot impact/reveal | approved |
| Void Collapse | 1900 ms | vortex -> infinity compression -> implosion/reveal | approved |
| Radiant Claim | 1400 ms | radiant pillar -> solar ring/reveal -> spectral finish | approved |
| Earthshaker | 1400 ms | rupture -> shock impact/reveal -> warm seal | approved |
| Spellbound | 1900 ms | spell charge -> parry -> projectile/reveal | approved |
| Cosmic Bloom | 2100 ms | nebula -> spectral core/reveal -> infinity afterimage | approved |
| Blue Nova | 1600 ms | blue-fire coil -> frost core -> electric reveal | approved |
| Solar Shatter | 1500 ms | tightening ring -> spatial shrapnel/reveal -> radiant seal | approved |
| Acid Rain | 1800 ms | falling projectile -> acid splash/reveal -> bubbles | approved |
| Glitch Takeover | 2000 ms | optional blocked portal -> infinity glyph -> electric reveal | blocked style; production falls back to Thunderstrike |
| Flower Power | 1800 ms | radiant seed -> spectral bloom -> nebula/reveal | approved |
| Lucky Duck | 1800 ms | optional blocked duck -> happy reaction -> radiant reveal | blocked style; production falls back to Thunderstrike |

Each full-motion style has exactly one reveal cue and one primary haptic. Reduced motion is a separate 220 ms information-preserving plan: immediate reveal, one light haptic, no sprites, no screen shake, and no decorative loop.

## Development gallery

In a development build, either open **FX gallery** from the post-run sequence panel or use `paser://dev/animations` while signed in. Search, filters, playback controls, backgrounds, scenarios, reduced-motion preview, and replay are available there.

The screen import, deep-link mapping, buttons, and capture lab are all guarded by `__DEV__`. A production web export contains neither the `dev/animations` route nor the `FX gallery` label.

## Adding assets

From `C:\Users\user\Desktop\run\frontend`:

```powershell
npm run animations:scan
npm run animations:import
npm run animations:validate
npm run check
npm test -- --runInBand --watch=false
```

Review `docs/ANIMATION_LIBRARY.md`, `docs/animation-library-inventory.json`, and `frontend/scripts/animations/animation-selection.json`. Put exceptional sprite-layout or visual-origin corrections in `animation-overrides.json` or selection metadata instead of adding per-screen hacks.

The importer is deterministic for unchanged input, prunes stale generated files only inside `frontend/assets/effects`, rejects unapproved packages, validates dimensions/alpha/frame data/texture limits, verifies every density image is an exact nearest-neighbour copy, and regenerates the registry, manifest, and import report.

## Known exclusions

- One curated file remains blocked for missing license evidence; see `ANIMATION_ASSET_LICENSES.md`.
- The Cartoon FX Unity/Windows demo is compiled content, not a source sprite library.
- No downloaded JSON passed Lottie's structure check. PASER's two existing Lotties remain supported.
- Broken AppleDouble payloads, unsupported RAR previews, oversized textures, authoring formats, binaries, audio, and ambiguous smoke sheets remain inventoried but unregistered.
- The required Lottie web peer and RNMapbox web peer are installed; production iOS, Android, and web exports pass. Native-device thermal/memory soak remains a release-device QA task.
