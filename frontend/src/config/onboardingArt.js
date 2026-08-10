// Onboarding / tutorial art manifest.
//
// EVERY key here is OPTIONAL. `art(key)` returns null when a file has not been
// generated yet and the screens fall back to a code-drawn panel, so the flow
// ships before the art does (Metro resolves `require` at build time, which is
// why missing files must stay commented out rather than being referenced).
//
// To wire a new asset: drop the PNG in `frontend/assets/art/onboarding/` with
// the exact filename below and uncomment its line. Specs + generation prompts:
// docs/ONBOARDING_ASSETS.md.

const ART = {
  // --- story panels (used by the tutorial coach marks) --------------------
  // The four shipped panels are SQUARE (1254²) — their cards pass aspect 1.
  // New panels are 4:3. `welcome` has no art on purpose: that card shows the
  // runner the player just built.
  claim: require('../../assets/art/claim-explainer.png'),
  clans: require('../../assets/art/onboarding-clans.png'),
  safety: require('../../assets/art/onboarding-safety.png'),
  energy: require('../../assets/art/onboarding/energy.png'),
  pasers: require('../../assets/art/onboarding/pasers.png'),
  rewards: require('../../assets/art/onboarding/rewards.png'),
  leaderboard: require('../../assets/art/onboarding/leaderboard.png'),

  // --- step characters ----------------------------------------------------
  // The originals are square scenes with the ground BAKED IN, which is why the
  // steps used to box them in a coloured squircle. `scripts/cut-header-art.py`
  // keys that ground out and trims to the ink, so the characters can stand
  // straight on the night stage at whatever size the step wants. The originals
  // stay wired as the script's inputs; nothing renders them.
  cutName: require('../../assets/art/onboarding/cut/name.png'),
  cutBirthday: require('../../assets/art/onboarding/cut/birthday.png'),
  cutReady: require('../../assets/art/onboarding/cut/ready.png'),
  thumbName: require('../../assets/art/onboarding/thumb-name.png'),
  thumbBirthday: require('../../assets/art/onboarding/thumb-birthday.png'),
  thumbReady: require('../../assets/art/onboarding/thumb-ready.png'),

  // --- backdrops ----------------------------------------------------------
  stage: require('../../assets/art/onboarding/stage.png'),
  // PASER PRO — the crew, in two shapes cut from one square master by
  // `scripts/install-pro-art.py`: 4:3 for the first-run panel, 16:9 with the
  // crew hard right for the card on You (the left of that one is empty stage
  // on purpose, because the card draws its copy there). Regenerate both from
  // the master rather than editing either by hand.
  proHero: require('../../assets/art/onboarding/pro-hero.png'),
  proBanner: require('../../assets/art/ui/pro-banner.png'),
  // The plaza where the running paths meet — the stage the CROSSED PATHS beat
  // plays on (components/paserby/PlazaScene.js). Painted with a flat sky and
  // six ground circles the encountered runners stand on, so the scene supplies
  // its own marks and the reveal only has to place characters. Its sky is
  // deliberately EMPTY: the clouds are a tiling strip the scene drifts, and the
  // butterflies are drawn in code, so both can move.
  paserbyPlaza: require('../../assets/art/paserby/plaza.png'),

  // --- app screens (Home strip, page headers, profile banner) -------------
  getStartedLeft: require('../../assets/art/ui/getstarted-left.png'),
  getStartedRight: require('../../assets/art/ui/getstarted-right.png'),
  // Page-header cut-outs for Pasers and Rivals — a mid-run high five and two
  // runners staking rival flags, drawn on the right of a flat `panel` header in
  // Home's hero-card format. The originals (headerPasers/headerRivals below)
  // are SQUARE scenes with the background BAKED IN, which is why they could
  // only ever be shown full-bleed behind a scrim; `scripts/cut-header-art.py`
  // keys that ground out and trims to the ink.
  panelPasers: require('../../assets/art/panel/pasers.png'),
  panelRivals: require('../../assets/art/panel/rivals.png'),
  // PASERBY — two runners passing each other, cut off the flat yellow ground
  // the master is painted on. The Crossroads header wears that same yellow
  // (#FDC302, 11.4:1 against the panel's ink copy), which is also what hides
  // the one landlocked scrap of ground the connectivity key cannot reach.
  panelCrossroads: require('../../assets/art/panel/crossroads.png'),
  headerPasers: require('../../assets/art/ui/header-pasers.png'),
  headerRivals: require('../../assets/art/ui/header-rivals.png'),
  headerCrossroads: require('../../assets/art/ui/header-crossroads.png'),
  headerClub: require('../../assets/art/ui/header-club.png'),
  headerLeaderboard: require('../../assets/art/ui/header-leaderboard.png'),
  profileBanner: require('../../assets/art/ui/profile-banner.png'),
  profileBannerDark: require('../../assets/art/ui/profile-banner-dark.png'),
  burstRays: require('../../assets/art/ui/burst-rays.png'),
  badge1st: require('../../assets/art/ui/badge-1st.png'),
  badge2nd: require('../../assets/art/ui/badge-2nd.png'),
  badge3rd: require('../../assets/art/ui/badge-3rd.png'),

  // --- Home side rail tiles (components/SideRail.js) ----------------------
  // The rail is pass · shop · rivals. `railRivals` has no art yet, so that
  // tile falls back to its sticker icon; boxes and season art are kept wired
  // but unused since their tiles came off the rail.
  railPass: require('../../assets/art/ui/rail-pass.png'),
  railBoxes: require('../../assets/art/ui/rail-boxes.png'),
  railShop: require('../../assets/art/ui/rail-shop.png'),
  railSeason: require('../../assets/art/ui/rail-season.png'),

  // --- pass screen chrome (screens/ProgressionScreen.js) ------------------
  passBanner: require('../../assets/art/ui/pass-banner.png'),
  stampClaimed: require('../../assets/art/ui/stamp-claimed.png'),
  paperGrain: require('../../assets/art/ui/paper-grain.png'),
  diamondLocked: require('../../assets/art/pass/diamond-locked.png'),
  diamondReached: require('../../assets/art/pass/diamond-reached.png'),
  diamondCurrent: require('../../assets/art/pass/diamond-current.png'),
  diamondPro: require('../../assets/art/pass/diamond-pro.png'),
  btnClaim: require('../../assets/art/pass/btn-claim.png'),
  btnClaimPressed: require('../../assets/art/pass/btn-claim-pressed.png'),
  btnPro: require('../../assets/art/pass/btn-pro.png'),
  chipLocked: require('../../assets/art/pass/chip-locked.png'),
  chipLockedPro: require('../../assets/art/pass/chip-locked-pro.png'),
  chipClaimed: require('../../assets/art/pass/chip-claimed.png'),
  // Installed but NOT currently rendered: these four are 9-slice frames, and
  // RN's Image can't 9-slice cross-platform (capInsets is iOS-only). Stretched
  // into a ~140x116 tile they distort badly enough to overlap neighbouring
  // rows, so ProgressionScreen draws its frames in code instead. Kept here so
  // the art isn't lost if we add a 9-slice component later.
  tileFree: require('../../assets/art/pass/tile-free.png'),
  tilePro: require('../../assets/art/pass/tile-pro.png'),
  crestPro: require('../../assets/art/pass/crest-pro.png'),
  laneFree: require('../../assets/art/pass/lane-free.png'),
  lanePro: require('../../assets/art/pass/lane-pro.png'),

  // --- Pit Stop shop scene (components/shop/PitStopScene.js) --------------
  // OPTIONAL. The station draws itself as vector art (PitStopArt.js), so the
  // shop is complete without any of these. They exist for the day someone
  // wants a painted backdrop instead: drop the file in, uncomment the line,
  // and the scene prefers it — the layer frames in config/pitStop.js keep
  // owning position, so no animation code changes. Spec: docs/SHOP_ASSETS.md.
  // pitStopBg: require('../../assets/art/shop/pitstop-bg.png'),
  // pitStopTent: require('../../assets/art/shop/pitstop-tent.png'),
  // pitStopBackWall: require('../../assets/art/shop/pitstop-back-wall.png'),
  // pitStopCounterBase: require('../../assets/art/shop/pitstop-counter-base.png'),
  // pitStopCounterForeground: require('../../assets/art/shop/pitstop-counter-foreground.png'),
  //
  // Not a backdrop override: a seamlessly tiling strip of cloud, scrolled by
  // the scene at three speeds for parallax. Generated from the supplied clip
  // by scripts/convert-scene-animations.py, which crops it to its alpha
  // bounding box — the strip is positioned by its CLOUDS, and empty sky baked
  // into the frame would push them out of the sliver the canopy leaves.
  pitStopCloudBand: require('../../assets/art/shop/pitstop-cloud-band.png'),
};

// Background colour baked into each story panel — the card fills its letterbox
// with this so `contain` art reads as edge-to-edge. Keep in sync with the art.
export const ART_BG = {
  welcome: '#2B1636',
  // Not a story panel: the ground `panel/crossroads.png` was painted on,
  // sampled from the master. The Crossroads header and its explainer both wear
  // it, which is also what hides the one landlocked scrap of background the
  // cut-out's connectivity key cannot reach.
  panelCrossroads: '#FDC302',
  claim: '#F4EEE1',
  clans: '#261742',
  safety: '#0B322B',
  energy: '#2B1636',
  pasers: '#13294B',
  rewards: '#3A1D0B',
  leaderboard: '#0B322A',
};

export function art(key) {
  return ART[key] || null;
}

export function hasArt(key) {
  return !!ART[key];
}

export default ART;
