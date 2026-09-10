// Route-level art groups for iOS image-cache warming. Keep large families
// separate: decoding the complete cosmetics catalogue at launch would trade a
// brief visual pop for excessive startup time and memory use.

import { InteractionManager } from 'react-native';
import { ICONS } from '../components/AppIcon';
import { preloadImages } from '../utils/imagePreload';
import { art } from './onboardingArt';
import { RANK_ART_SOURCES } from './rankArt';
import { SEASON_CATEGORY_ART, SEASON_SCOPE_ART } from './seasonArt';

const present = (sources) => sources.flat(Infinity).filter(Boolean);
const artKeys = (...keys) => keys.map((key) => art(key));

const TAB_ICONS = ['tab-home', 'tab-map', 'tab-record', 'tab-club', 'tab-you']
  .map((key) => ICONS[key]);

// The only art the FIRST frame can possibly show: the loading mascot, the tab
// bar, and the signed-out hero. This is the set launch is allowed to wait on —
// the wider startup family below warms behind the app once it is on screen.
export const CRITICAL_IMAGE_ASSETS = present([
  ...TAB_ICONS,
  require('../../assets/art/loading.png'),
  require('../../assets/art/auth-hero.png'),
]);

export const STARTUP_IMAGE_ASSETS = present([
  ...TAB_ICONS,
  ICONS.bell,
  ICONS.energy,
  require('../../assets/art/loading.png'),
  require('../../assets/art/auth-hero.png'),
  require('../../assets/art/season-banner.png'),
  require('../../assets/art/card-clubs.png'),
  require('../../assets/art/card-solo.png'),
  require('../../assets/art/club-crew.png'),
  artKeys('headerClub', 'profileBanner', 'profileBannerDark'),
]);

const SCREEN_IMAGE_ASSETS = {
  SharedIcons: present(Object.values(ICONS)),
  Home: present([
    ...TAB_ICONS,
    ICONS.bell,
    ICONS.energy,
    require('../../assets/art/season-banner.png'),
    require('../../assets/art/card-clubs.png'),
    require('../../assets/art/card-solo.png'),
    require('../../assets/art/empty-runs.png'),
    // The painted street the whole tab stands on. It covers the window edge to
    // edge, so a cold decode is Home appearing as a flat cream rectangle and
    // then growing a sky — exactly the pop this warming exists to remove.
    artKeys('homeStreet', 'railPass', 'railShop'),
  ]),
  Club: present([
    require('../../assets/art/club-crew.png'),
    require('../../assets/art/empty-club.png'),
    artKeys('headerClub'),
  ]),
  Map: present([
    ICONS.layers,
    ICONS.locate,
    ICONS['map-pin'],
    ICONS.route,
  ]),
  You: present([
    artKeys('profileBanner', 'profileBannerDark', 'proCrew'),
    ICONS.customize,
    ICONS.invite,
  ]),
  Season: present([
    Object.values(SEASON_SCOPE_ART).map((entry) => entry.source),
    Object.values(SEASON_CATEGORY_ART).map((entry) => entry.source),
  ]),
  Progression: present([
    artKeys(
      // The plaza the whole page stands on — first in the group because it is
      // the biggest decode here and the only one whose pop is a full screen
      // rather than a 76pt tile.
      'passBackdrop',
      // The page header's cut-out — the same scroll the Home rail's pass tile
      // wears, which is why it is usually warm before this list runs. The
      // purple crew banner it replaced is no longer drawn anywhere.
      'railPass',
      'stampClaimed',
      'diamondLocked',
      'diamondReached',
      'diamondCurrent',
      'diamondPro',
      'chipLocked',
      'chipLockedPro',
      'chipClaimed',
      'crestPro'
    ),
  ]),
  Shop: present([
    // The two painted plates the whole tab opens on. They are the heaviest
    // thing on the screen and they cover it edge to edge, so a cold decode is
    // the shop appearing as a flat blue rectangle and then snapping into a
    // stall — exactly the pop this warming exists to remove.
    artKeys('pitStopBackdrop', 'pitStopCounter'),
    // Standing in the scene: two shelf props and the reward box on the
    // counter. Small, but they land in the middle of the illustration.
    ICONS.timer,
    ICONS.trophy,
    ICONS.lootbox,
    ICONS.coin,
    ICONS['coin-pouch'],
    ICONS['coin-sack'],
    ICONS['coin-chest'],
    ICONS['coin-vault'],
    // The per-rarity crates used to be warmed here for the reward reveal a
    // purchase opens. That reveal draws the animated gift box now, so warming
    // them was four decodes for art nothing renders.
    ICONS.sparkles,
  ]),
  Record: present([
    ICONS.locate,
    ICONS.pause,
    ICONS.play,
    ICONS.route,
    ICONS.timer,
  ]),
  AvatarStudio: present([
    artKeys('profileBanner', 'stage'),
    ICONS.randomize,
  ]),
  // Pasers draws one cut-out on a flat `panel` header. The full-bleed
  // headerPasers square it used to show is no longer rendered, so warming it
  // would be a decode for nothing.
  Pasers: present([artKeys('panelPasers')]),
  // Rivals is a painted park now, and its header is transparent chrome over
  // it rather than a panel with a cut-out — so what has to be warm on arrival
  // is the park itself. It is the page's ground: decoding it after the cards
  // have drawn is the whole screen changing colour under the reader.
  Rivals: present([artKeys('rivalsPark')]),
  // The plaza is warmed with the Crossroads header because the two arrive
  // together in practice: the reveal that opens the plaza is also what puts a
  // badge on the rail, and a backdrop that decodes while it is fading in is
  // exactly the pop this warming exists to remove.
  Crossroads: present([artKeys('panelCrossroads', 'paserbyPlaza', 'pitStopCloudBand')]),
  // Ten full-bleed illustrations, one per rung, all of them on screen inside
  // one flick of the ladder. This is the heaviest group in the app and it is
  // warmed as a group on purpose: decoding them as they scroll into view is a
  // column of tier-coloured rectangles filling in one after another, which is
  // the exact pop the warming exists to remove.
  RankLadder: present([RANK_ART_SOURCES]),
  Notifications: present([
    require('../../assets/art/empty-notifications.png'),
  ]),
  Leaderboard: present([
    require('../../assets/art/empty-leaderboard.png'),
  ]),
  Onboarding: present([
    artKeys(
      'claim',
      'clans',
      'safety',
      'energy',
      'pasers',
      'rewards',
      'leaderboard',
      'cutName',
      'cutBirthday',
      'cutReady',
      'stage',
      'proHero'
    ),
  ]),
};

export function assetsForScreens(names) {
  const list = Array.isArray(names) ? names : [names];
  return present(list.map((name) => SCREEN_IMAGE_ASSETS[name] || []));
}

export function preloadCriticalImages() {
  return preloadImages(CRITICAL_IMAGE_ASSETS);
}

export function preloadStartupImages() {
  return preloadImages(STARTUP_IMAGE_ASSETS);
}

export function preloadScreenImages(names) {
  return preloadImages(assetsForScreens(names));
}

export function preloadScreenImagesAfterInteractions(names) {
  const queue = Array.isArray(names) ? names : [names];
  let cancelled = false;
  const task = InteractionManager.runAfterInteractions(async () => {
    // Keep each screen's images parallel, but move screen groups through the
    // decoder one at a time so background warming cannot create its own frame
    // hitch on older iPhones.
    for (const name of queue) {
      if (cancelled) return;
      await preloadScreenImages(name);
    }
  });

  return () => {
    cancelled = true;
    task.cancel?.();
  };
}
