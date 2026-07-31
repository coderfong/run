// AppIcon — renders a generated PASER sticker icon (full-colour PNG, bold
// outline). These are NOT tintable line icons, so active/inactive state is
// shown with opacity + a slight scale, never a colour swap.
//
// Registry keys match the files in assets/icons/. Add a file there + a line
// here and it's usable app-wide via <AppIcon name="..." />.

import React from 'react';
import { Image } from 'react-native';

export const ICONS = {
  // tab bar
  'tab-home': require('../../assets/icons/tab-home.png'),
  'tab-map': require('../../assets/icons/tab-map.png'),
  'tab-record': require('../../assets/icons/tab-record.png'),
  'tab-club': require('../../assets/icons/tab-club.png'),
  'tab-you': require('../../assets/icons/tab-you.png'),
  // actions / status
  like: require('../../assets/icons/like.png'),
  comment: require('../../assets/icons/comment.png'),
  share: require('../../assets/icons/share.png'),
  bell: require('../../assets/icons/bell.png'),
  energy: require('../../assets/icons/energy.png'),
  streak: require('../../assets/icons/streak.png'),
  trophy: require('../../assets/icons/trophy.png'),
  'clan-shield': require('../../assets/icons/clan-shield.png'),
  steal: require('../../assets/icons/steal.png'),
  claim: require('../../assets/icons/claim.png'),
  locate: require('../../assets/icons/locate.png'),
  lootbox: require('../../assets/icons/lootbox.png'),
  // Per-rarity crates — same silhouette family, escalating material. Used by
  // RewardArt for lootbox tiers; falls back to `lootbox` if a key is missing.
  'lootbox-common': require('../../assets/icons/lootbox-common.png'),
  'lootbox-rare': require('../../assets/icons/lootbox-rare.png'),
  'lootbox-epic': require('../../assets/icons/lootbox-epic.png'),
  'lootbox-legendary': require('../../assets/icons/lootbox-legendary.png'),
  // Coin currency: the single coin sits beside every price (down to 12px), the
  // rest are the IAP pack tiles keyed to COIN_PRODUCTS in backend/app/coins.py.
  coin: require('../../assets/icons/coin.png'),
  'coin-pouch': require('../../assets/icons/coin-pouch.png'),
  'coin-sack': require('../../assets/icons/coin-sack.png'),
  'coin-chest': require('../../assets/icons/coin-chest.png'),
  'coin-vault': require('../../assets/icons/coin-vault.png'),
  // batch 2
  add: require('../../assets/icons/add.png'),
  award: require('../../assets/icons/award.png'),
  crown: require('../../assets/icons/crown.png'),
  customize: require('../../assets/icons/customize.png'),
  invite: require('../../assets/icons/invite.png'),
  layers: require('../../assets/icons/layers.png'),
  'map-pin': require('../../assets/icons/map-pin.png'),
  pause: require('../../assets/icons/pause.png'),
  play: require('../../assets/icons/play.png'),
  randomize: require('../../assets/icons/randomize.png'),
  route: require('../../assets/icons/route.png'),
  sparkles: require('../../assets/icons/sparkles.png'),
  timer: require('../../assets/icons/timer.png'),
  verified: require('../../assets/icons/verified.png'),
};

export function hasIcon(name) {
  return !!ICONS[name];
}

export default function AppIcon({ name, size = 24, style, faded = false }) {
  const src = ICONS[name];
  if (!src) return null;
  return (
    <Image
      source={src}
      style={[{ width: size, height: size, opacity: faded ? 0.45 : 1 }, style]}
      resizeMode="contain"
      accessible={false}
    />
  );
}
