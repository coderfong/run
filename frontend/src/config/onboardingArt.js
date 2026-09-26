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
  // PASER PRO — the crew, in three shapes cut from one square master by
  // `scripts/install-pro-art.py`: 4:3 for the first-run panel, 16:9 with the
  // crew hard right, and the transparent CUT-OUT. Regenerate them from the
  // master rather than editing any of them by hand.
  //
  // The cut-out is the one the app reaches for now. Both painted plates carry
  // their own dark background, which means dropping either into the paper page
  // prints a rectangle of somebody else's stage inside a hand-drawn box; the
  // cut-out sits on whatever fill the card already has. `proBanner` is kept
  // because it is a real, regenerable shape of the same art, but nothing
  // renders it — the poster on You is a framed gold card now (ProfileScreen)
  // and the slide on Home was always the cut-out.
  proHero: require('../../assets/art/onboarding/pro-hero.png'),
  proBanner: require('../../assets/art/ui/pro-banner.png'),
  proCrew: require('../../assets/art/card-pro.png'),
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
  // UNWIRED, same rule as `passBanner` below: Rivals is a painted park now and
  // its header is transparent chrome standing in the treeline, so nothing
  // draws the flag-planting cut-out any more, and a `require` nothing draws is
  // a slot off the OTA asset budget. The cut-out and its square original are
  // both still in assets/art — uncomment to bring it back.
  // panelRivals: require('../../assets/art/panel/rivals.png'),
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
  // Same scene, animated: a Seedance-generated seamless ~5s loop (clouds,
  // water shimmer, flag flutter, a touch of leaf/grass sway) — podium and
  // skyline held rigid, no camera motion. `headerLeaderboard` above stays
  // wired as the Reduce Motion fallback and the frame this one loops from.
  headerLeaderboardAnimated: require('../../assets/animations/seedance-leaderboard-podium.webp'),
  profileBanner: require('../../assets/art/ui/profile-banner.png'),
  profileBannerDark: require('../../assets/art/ui/profile-banner-dark.png'),
  burstRays: require('../../assets/art/ui/burst-rays.png'),
  badge1st: require('../../assets/art/ui/badge-1st.png'),
  badge2nd: require('../../assets/art/ui/badge-2nd.png'),
  badge3rd: require('../../assets/art/ui/badge-3rd.png'),

  // --- Home side rail tiles (components/SideRail.js) ----------------------
  // The rail is missions · pass · shop · rivals · crossroads, and all five now
  // have art. Boxes and season are kept wired but unused since their tiles
  // came off the rail.
  //
  // These are CUT-OUTS, made by `scripts/cut-rail-art.py` from the finished
  // tiles in assets/art/rail/. The masters are drawn as whole tiles — black
  // frame, flat colour panel, sticker on top — and the rail draws the frame
  // and the panel itself, so only the sticker is wired here. Regenerate them
  // from the masters rather than editing any of them by hand; the script also
  // prints each master's ground colour, which is the tile `tint` the sticker
  // was drawn to sit on.
  railMissions: require('../../assets/art/ui/rail-missions.png'),
  railPass: require('../../assets/art/ui/rail-pass.png'),
  railBoxes: require('../../assets/art/ui/rail-boxes.png'),
  railShop: require('../../assets/art/ui/rail-shop.png'),
  railRivals: require('../../assets/art/ui/rail-rivals.png'),
  railCrossroads: require('../../assets/art/ui/rail-crossroads.png'),
  railSeason: require('../../assets/art/ui/rail-season.png'),

  // --- pass screen chrome (screens/ProgressionScreen.js) ------------------
  // The purple crew banner. UNWIRED: the pass page opens on a flat `panel`
  // header now (the same format Missions and Rivals wear), so nothing renders
  // it, and a `require` that nothing draws is a slot off the OTA asset budget.
  // The file is still in assets/art/ui — uncomment to bring it back.
  // passBanner: require('../../assets/art/ui/pass-banner.png'),
  //
  // The ground the ladder climbs: a painted race plaza — sky, skyline and
  // start-line hoardings up top, then flat paving all the way down. Drawn
  // behind the WHOLE page (components/pass/PassBackdrop.js), pinned by its
  // horizon rather than covered to the window, so the flags land in the same
  // place on every phone. Its bottom edge is exported below as
  // PASS_BACKDROP_GROUND — a 50-level ladder is far taller than any one
  // painting, so the paving has to keep going in a flat colour under it.
  passBackdrop: require('../../assets/art/pass/backdrop.png'),
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
  // NOT optional, unlike most of this file. The station used to draw its own
  // environment as vector art and these were an empty seam for painted layers
  // to land in; the painting landed, and the vector environment is retired, so
  // the shop scene has no backdrop without them.
  //
  // TWO PLATES AND THE CREW BETWEEN THEM: `backdrop` is everything behind the
  // volunteers, `counter` is the counter that cuts them off at the hip. Both
  // are cut from ONE master (art/src/pitstop-water-point.png) by
  // scripts/install-pit-stop-art.py, which is also what sizes them — do not
  // add them to scripts/downscale-art.py. Spec: docs/SHOP_ASSETS.md.
  pitStopBackdrop: require('../../assets/art/shop/pitstop-backdrop.png'),
  pitStopCounter: require('../../assets/art/shop/pitstop-counter.png'),
  //
  // A seamlessly tiling strip of cloud, generated from a supplied clip by
  // scripts/convert-scene-animations.py. THE SHOP NO LONGER READS IT — it
  // drifted three copies across its sky at three speeds, and that sky is
  // painted now — but the name has outlived the screen: PlazaScene drifts the
  // same band across the Crossroads plaza, and screenAssets preloads it for
  // that tab. It stays wired for the plaza, not for the shop.
  pitStopCloudBand: require('../../assets/art/shop/pitstop-cloud-band.png'),

  // --- Rivals park (components/rivals/RivalsBackdrop.js) ------------------
  // The dog park the rivalry cards sit in: a canopy of trees across the top
  // and the skyline, hedges, grass and two dogs pulling on the same bone
  // across the bottom. ONE FILE, TWO BANDS, STACKED — the flat cream field
  // that separates them in the master is not in the asset at all, because the
  // page paints it (RIVALS_PARK.ground) and stretches it to whatever height
  // the window has left. Cut and measured by
  // scripts/install-rivals-backdrop.py, which also sizes it — leave it out of
  // scripts/downscale-art.py, the same one-owner rule as the pit stop plates.
  rivalsPark: require('../../assets/art/rivals/park.png'),

  // --- Home street (components/home/HomeBackdrop.js) ----------------------
  // The outdoors the feed happens in: open sky across the top, then the city
  // behind a hedgerow across the bottom. Built and drawn exactly like the
  // rivals park above — two bands stacked in one file, the flat cream field
  // between them left out and painted by the page (HOME_STREET.ground) — but
  // it earns that construction more than any other backdrop, because Home is
  // the one page that SCROLLS: the sky stays behind the header and the hedge
  // stays above the tab bar while the feed runs through the field between.
  // Cut and measured by scripts/install-home-backdrop.py, which also sizes
  // it — leave it out of scripts/downscale-art.py.
  homeStreet: require('../../assets/art/home/backdrop.png'),
};

// The Rivals park, as the page has to know it. PRINTED BY THE INSTALL SCRIPT —
// paste, don't hand-edit: `ground` is sampled off the master's flat field,
// `sky` off its very top edge, and the two fractions are measured from the
// first and last row that is the field colour all the way across. `top` and
// `bottom` are each band's height as a fraction of the picture's WIDTH, which
// is the only scale the page draws it at, so a band is `width x fraction`
// points tall on any phone.
export const RIVALS_PARK = {
  ground: '#FFFCEF',
  sky: '#76C8FD',
  top: 0.3836,
  bottom: 0.5154,
};

// The Home street, on the same terms as the park above — PRINTED BY
// scripts/install-home-backdrop.py, paste rather than hand-edit. `ground` is
// the flat field the feed scrolls through, `sky` is the colour the top band
// opens on (a window taller than the picture leaves a strip above it, and that
// strip has to be sky, not field), and the two fractions are each band's height
// as a fraction of the picture's WIDTH — the only scale the page draws it at.
export const HOME_STREET = {
  ground: '#FDFAEF',
  sky: '#8BCDFD',
  top: 0.4463,
  bottom: 0.2349,
};

// The paving colour at `passBackdrop`'s bottom edge, sampled off the master.
// The painting is one screen tall and the ladder under it is fifty levels, so
// the page is painted in this and the art simply runs out into it — the seam is
// invisible only while this matches the pixels it continues. Re-sample it if
// the plaza is ever repainted.
export const PASS_BACKDROP_GROUND = '#F3E6CA';

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
  // The final "go run" coach mark. No art yet (falls back to the Flag icon on
  // this fill); `assets/art/onboarding/run.png` would slot straight in.
  run: '#0F3D33',
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
