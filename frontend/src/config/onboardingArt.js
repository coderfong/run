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

  // --- step thumbnails (1:1 squircle, ~520²) ------------------------------
  thumbName: require('../../assets/art/onboarding/thumb-name.png'),
  thumbBirthday: require('../../assets/art/onboarding/thumb-birthday.png'),
  thumbReady: require('../../assets/art/onboarding/thumb-ready.png'),

  // --- backdrops ----------------------------------------------------------
  stage: require('../../assets/art/onboarding/stage.png'),
  proHero: require('../../assets/art/onboarding/pro-hero.png'),

  // --- app screens (Home strip, page headers, profile banner) -------------
  getStartedLeft: require('../../assets/art/ui/getstarted-left.png'),
  getStartedRight: require('../../assets/art/ui/getstarted-right.png'),
  headerPasers: require('../../assets/art/ui/header-pasers.png'),
  headerClub: require('../../assets/art/ui/header-club.png'),
  headerLeaderboard: require('../../assets/art/ui/header-leaderboard.png'),
  profileBanner: require('../../assets/art/ui/profile-banner.png'),
  burstRays: require('../../assets/art/ui/burst-rays.png'),
  badge1st: require('../../assets/art/ui/badge-1st.png'),
  badge2nd: require('../../assets/art/ui/badge-2nd.png'),
  badge3rd: require('../../assets/art/ui/badge-3rd.png'),

  // --- Home side rail tiles (components/SideRail.js) ----------------------
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
};

// Background colour baked into each story panel — the card fills its letterbox
// with this so `contain` art reads as edge-to-edge. Keep in sync with the art.
export const ART_BG = {
  welcome: '#2B1636',
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
