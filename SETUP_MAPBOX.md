# Mapbox + EAS dev build — the manual steps only you can do

Territory Run v2 renders its game board with **`@rnmapbox/maps`**, which uses a
native SDK. That means **it does not run in Expo Go** — you need an **EAS
development build** installed on your phone. Do this once; after that you run
`npx expo start --dev-client` and iterate normally.

Everything below is a human step (accounts, secrets, a cloud build). The app
code, config wiring, and fallbacks are already in place.

---

## 1. Mapbox account + two tokens

1. Create a free account at https://account.mapbox.com/.
2. **Public token** (`pk.…`) — used at runtime to load tiles. Copy the
   "Default public token" from https://account.mapbox.com/access-tokens/.
3. **Download token** (`sk.…`, secret) — used at *build time* to download the
   iOS/Android SDK. Create a new token with the **`Downloads:Read`** secret
   scope. Copy it now; Mapbox only shows it once.

> Two different tokens. The `pk.` one is public and goes in the app's runtime
> env; the `sk.` one is a build secret and must never be committed.

---

## 2. Put the tokens in your environment

For **local dev** (Metro reads `EXPO_PUBLIC_*` at bundle time), create
`frontend/.env` (git-ignored) or export in your shell before `expo start`:

```
EXPO_PUBLIC_MAPBOX_TOKEN=pk.your_public_token
# Optional until you design the custom styles (step 4):
EXPO_PUBLIC_MAP_STYLE_LIGHT=
EXPO_PUBLIC_MAP_STYLE_DARK=
```

The **download token** is only needed at build time. For EAS builds, store it
as a secret so it's injected into the native build:

```powershell
cd frontend
eas secret:create --scope project --name MAPBOX_DOWNLOAD_TOKEN --value sk.your_download_token
```

`app.config.js` reads `MAPBOX_DOWNLOAD_TOKEN` and feeds it to the
`@rnmapbox/maps` config plugin. Until it's set, the plugin uses an empty token
and the native build will fail to fetch the SDK — so set it before building.

---

## 3. Build and install the dev client

```powershell
cd frontend
npm install -g eas-cli
eas login
eas init            # writes projectId into app.json (first time only)

# Android dev build (APK you can sideload):
eas build --profile development --platform android

# iOS dev build (needs an Apple Developer account for a device build):
eas build --profile development --platform ios
```

When the cloud build finishes, EAS prints a QR/URL:
- **Android:** open the link on your phone, download the APK, install it
  (allow "install from unknown sources").
- **iOS:** install via the EAS link (the device must be registered in your
  Apple Developer account; `eas device:create` walks you through it).

Then run the dev server and open the installed dev client (NOT Expo Go):

```powershell
cd frontend
npx expo start --dev-client
```

Set `EXPO_PUBLIC_MAPBOX_TOKEN` in the dev `env` of `eas.json` (or your shell)
so the installed build has the public token. Reloading JS is instant after
that; you only rebuild when native deps change.

---

## 4. The two custom Studio styles (design these by hand)

Until these exist, the app falls back to `mapbox://styles/mapbox/light-v11`
and `.../dark-v11` so it's usable. When you're ready, create two styles in
**Mapbox Studio** (https://studio.mapbox.com/) to this brief, then paste their
`mapbox://styles/you/…` URLs into `EXPO_PUBLIC_MAP_STYLE_LIGHT` / `_DARK`.

**Style brief — "Territory Run game board":**

> Near-monochrome, low contrast, so clan-colored territory is the only
> saturated thing on screen.
> - **Water** is the key landmark: coastline, canals, reservoirs — muted but
>   clearly readable.
> - Faint green-space tint (park connectors matter to runners).
> - Thin, quiet major roads; minor roads appear only at high zoom.
> - **Remove entirely:** POIs, business labels, building footprints, transit
>   lines, road shields.
> - **Labels:** neighbourhood names only (small, quiet, mid-zoom and up);
>   street names only at max zoom; tiny MRT station dots as orientation
>   anchors.
> - Two variants: **light** and **dark "night run"** (the dark one is the
>   backdrop for the glowing trail — keep it truly dark, low chroma).

Both styles should look coherent when clan-colored polygons at ~35% opacity
are drawn on top with a 2px saturated stroke.

---

## 5. Verify

- Map tab and the Record screen show the styled board (not a blank grid).
- Camera cannot pan/zoom outside Singapore (bounds are locked in
  `src/config/cities.js`).
- Your trail on the Record screen glows in your accent color on the dark style.

If the map is blank: the public token isn't reaching the build. Confirm
`EXPO_PUBLIC_MAPBOX_TOKEN` is set for the profile/shell you launched from — the
app shows a "Map needs a Mapbox token" placeholder when it's missing.
