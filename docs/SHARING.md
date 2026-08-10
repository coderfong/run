# Sharing a run — Instagram Stories and the system sheet

Added 2026-08-05. What the Share button on the post-run screen does now, and
the two things only you can finish.

## What ships

`ResultScreen`'s Share button no longer screenshots the on-screen recap card.
It opens **`RunShareSheet`** (`frontend/src/components/share/`), which is the
Strava-shaped flow:

1. **Pick a format** — Story (9:16, exported 1080×1920) or Post (1:1, exported
   1080×1080).
2. **Pick a background** — three ways:
   * **No background** — the card exports as a TRANSPARENT PNG and goes to
     Instagram as a *sticker*, so the runner's own selfie or photo (whatever
     they put on the story) is the background and the stats sit over it. This
     is the one to reach for; the others are for when there is no photo worth
     posting.
   * **Colour** — the clan-coloured wash.
   * **Photo** — one of the runner's own pictures (`expo-image-picker`)
     full-bleed inside the card itself.
3. **Customise it** — under the preview:
   * **Accent** — the clan colour first, then eight swatches (including ink,
     for a bright photo). Drives the territory number, the route's end dot and
     the colour background.
   * **Text** — Light or Dark. Dark flips the whole card to ink type with a
     white halo, which is the only thing that reads on a snowy or sunlit shot.
   * **Align** — Left / Centre / Right, applied to the headline, the stat grid
     and the signature together.
   * **Runner** — the PASER mark wearing the player's head, feet on the end dot
     of their own route (the one point on the card that means something),
     clamped so a run that finished high or low doesn't put it through the
     headline or the numbers. On/Off and Flip. See "The runner on the route".
   * **Stats** — chips for every metric the run actually has (Distance, Pace,
     Time, Elev gain, Best km, Avg speed, Territory), plus a Route toggle.
     Bounded at one minimum and six maximum: zero leaves a hole the runner
     cannot see, and seven is three rows of numbers with nowhere left to draw
     the route.
4. **See the real card** — the preview *is* the component that gets captured
   (`RunShareCard`), so there is no gap between preview and post.
5. **Send it** —
   * **Share to Instagram Stories** — a direct handoff. Instagram opens with
     the card already set as the story background; the runner adds stickers and
     posts. Only offered when Instagram is actually there.
   * **More options** — the system share sheet (Instagram feed, WhatsApp,
     Messages, Save Image). Always available, and every Instagram failure falls
     back to it rather than dead-ending.

### The card

Layout, top to bottom: the territory headline (the number that makes PASER not
Strava), the route drawn big across the card, a two-up grid of Distance / Elev
gain / Pace / Time, then the brand mark. Everything is sized off
`u = width / 360`, so one component serves the small preview and the 1080-wide
export.

No handle, no clan, no date, no "took N km² from X". On somebody's own story the
handle is already at the top of the screen, the date is today, and the steal
line was a sentence of app copy in the middle of a picture.

Rules it has to keep:

* **Capture-safe.** No map view, no animation — a GL surface or a
  still-decoding image is what turns `captureRef` output into a black
  rectangle. The route is an SVG polyline, the claimed ground an SVG polygon,
  both projected through one shared bounding box so they stay registered, and
  the mark is a plain RN `Image`. A chosen photo reports `onPhotoReady` and the
  sheet waits for it before capturing.

  The one exception is the head on the route runner, which comes from
  `CharacterRig` and so draws through `expo-image` (every other screen needs
  that cache). It is safe here for a reason rather than by construction: the rig
  is mounted in the preview the whole time the runner is choosing controls, so
  its layers are long decoded by the time anyone taps Share. The capture also
  waits 400 ms instead of 60 ms when the runner is on. If a card ever exports
  with a headless logo, that is the thing to suspect, and the fix is a
  `plainImages` prop on the rig rather than a longer sleep.

### The runner on the route

`components/character/LogoRunner.js` — the PASER mark running, wearing the
player's own head.

The mark already IS the running pose the brand owns: side-on, front knee up,
trailing leg extended. Nothing cut out of the front-facing paper doll gets near
it, and the attempts are worth recording so nobody repeats them:

* **Tilting the standing figure** reads as falling over, not running.
* **Cutting the doll into limbs and rotating them** (a jointed rig off the
  joints measured in the ink layer) does produce a real stride, and it even
  carries clothes if the layers are flattened before cutting. But the arms have
  nowhere to go on a front-facing body — swung in they hide behind the torso,
  swung out past ~28° they rise into the shoulder-cap piece that hides the arm
  cuts — and every cut edge lacks an outline, so knees and elbows show seams.
  That component was built, evaluated and removed.

So: the body is the logo and only the head is swapped, which is where face,
hair and headwear live anyway. `assets/brand/paser-mark-body.png` is the mark
with its own head removed — a separate connected shape in the art, so the cut is
exact — and `scripts/make-brand-mark.py` prints the head-slot fractions that
`LogoRunner` must stay in step with. Re-run it if the icon ever changes.

The head is a clipped window onto a full `CharacterRig`, cut at the CHIN so the
head plate's own outline forms the bottom edge; any lower and the rig's
shoulders come through as a cream band across the logo's chest.

**The trade:** the player's cosmetics below the neck no longer show on the card.
Their face, hair and headwear do.
* **Full-bleed, or none at all.** With a background, it reaches every edge and
  `CARD_INK` is handed to Instagram as the story canvas colour, so letterboxing
  does not show a card floating on black. With `background="none"` the card
  paints nothing, the PNG keeps its alpha, and `socialShare` passes it as
  `stickerImage` rather than `backgroundImage` — a sticker with an opaque
  background is just a background the runner has to drag around.
* **Type carries its own legibility.** As a sticker there is no scrim to hide
  behind: the labels go fully opaque and the shadow tightens to read as an
  outline (`toneFor`), because a translucent label vanishes on a pale sky or a
  white t-shirt.
* **Measured, not hand-tuned.** The route band takes the height the headline,
  stats, brag line and signature do not — that is what stops a long route being
  drawn straight through the numbers. The stat grid is two-up because a single
  row of four collided the moment a pace and a duration sat side by side.
* Story content stays inside Instagram's chrome (top 11%, bottom 15%).

## 1. A new native build is required — **YOU**

Instagram Stories sharing uses **`react-native-share`**, and photo backgrounds
use **`expo-image-picker`** — both native modules (plus `expo-build-properties`
for the react-native-share config plugin). The photo picker arrived AFTER the
2.1.0 build, so a binary built before it shows "Photo backgrounds need a newer
build of PASER" and the colour background still works.

* `expo.version` was bumped **2.0.0 → 2.1.0** for this, and the
  `runtimeVersion` policy is `appVersion` — so 2.1.0 updates can only land on a
  2.1.0 binary. **Do not `eas update` this onto 2.0.0**: those binaries have no
  `RNShare` native module.
* The native build has NOT been run yet. Pick a profile from `eas.json`:

  ```bash
  cd frontend && npx eas-cli build --platform ios --profile development
  ```

  (`preview` for an internal build against Render, `production` for the store.)
  Heads-up: the `development` profile's `EXPO_PUBLIC_API_BASE` is a cloudflared
  tunnel URL that goes stale between sessions — point it at your current tunnel
  or at Render before building.
* Rebuild the local dev client too, or the Instagram button simply never
  appears on device.

The JS is written so an old binary degrades instead of crashing:
`react-native-share` resolves its native module with `getEnforcing` (which
throws at *import* time), so `src/utils/socialShare.js` requires it lazily and
treats the throw as "no Instagram destination" — the sheet then shows a plain
Share button wired to the system sheet.

The config plugin entry in `app.json` adds what the platforms need:

```json
["react-native-share", {
  "ios": ["instagram", "instagram-stories"],
  "android": ["com.instagram.android"]
}]
```

iOS gets `instagram` / `instagram-stories` in `LSApplicationQueriesSchemes`
(without them `Linking.canOpenURL` always says no, so the button would stay
hidden); Android gets the package into `<queries>` for the installed check.

## 2. Set a Meta app id — **YOU**

Instagram's story API wants the sharing app identified via `source_application`.
The documented value is a **Facebook (Meta) app id**:

1. <https://developers.facebook.com/apps> → create an app (type: Consumer).
2. Copy the App ID.
3. Put it in `app.json` → `expo.extra.facebookAppId`.

Until that is set, `socialShare.js` sends the bundle id (`com.pacerrun.app`),
which Instagram currently accepts for the background-image flow — but a real
app id is the supported path and the thing to fix if stories start bouncing.
No Meta SDK, no login, nothing else to configure.

## Where to look when it misbehaves

| Symptom | Cause |
| --- | --- |
| No Instagram button at all | Instagram not installed, or a binary built before `react-native-share` |
| "Opening the share sheet instead…" | Instagram refused the story — usually the app id, or an Android intent knocked back |
| Blank/black exported image | Something non-static got into `RunShareCard` (map, `expo-image`, animation) |
| Card content clipped | A text block grew past its estimate in `RunShareCard` (`headH` / `statsH` / `signatureH`) |
| A metric has no chip | `availableStats` dropped it — the run has no honest number for it (elevation needs altitude, which only runs recorded after 2026-08-06 carry) |
| Sticker text invisible | Bright background with Light text; switch Text to Dark |
