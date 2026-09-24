// Cosmetics hidden from the app's UI, set from the Fit Studio ("Hide from
// app"). Hiding is not deleting: the item stays in the catalogue, every id
// keeps resolving (getItem, rewards already paid out, saved loadouts) and
// anyone wearing it still renders. It is only left out of what the app
// OFFERS: the Avatar Studio grid (unless it is the piece being worn), the
// first-run rack, the coin shop, loot boxes and the random-outfit dice.
//
// The list between the markers is rewritten by
// scripts/fit-studio/hide-item.mjs, and read by scripts/gen-shop-catalog.py
// and scripts/check-catalog.js, so keep it one quoted id per line.

// BEGIN HIDDEN
export const HIDDEN_IDS = [
  'cur_auroraracers',
  'cur_balletflats',
  'cur_blackknitrunners',
  'cur_carbongoldracers',
  'cur_championtrackspikes',
  'cur_chelseaboots',
  'cur_classichightops',
  'cur_cleanwhitesneakers',
  'cur_cloudfoamrunners',
  'cur_courtsneakers',
  'cur_dressshoes',
  'cur_everydaycushionedroadshoes',
  'cur_frosttrailshoes',
  'cur_highstackracedayshoes',
  'cur_hikingsandals',
  'cur_lavatrailshoes',
  'cur_lightweightspeedtrainers',
  'cur_maryjanes',
  'cur_maxcushionlongrunshoes',
  'cur_neonpulserunners',
  'cur_recoverysandals',
  'cur_reflectivenightrunners',
  'cur_regionaleventrunners',
  'cur_slides',
  'cur_stealthnightshoes',
  'cur_trailboots',
  'cur_trailrunningshoes',
  'cur_wetweatherroadshoes',
  'cur_wingedspeedshoes',
];
// END HIDDEN

const HIDDEN = new Set(HIDDEN_IDS);

export const isHiddenId = (id) => HIDDEN.has(id);
export const isHiddenItem = (item) => !!item && HIDDEN.has(item.id);

// A slot's items as the UI offers them: hidden ones dropped, except `keepId`
// (the piece being worn), so a runner never loses sight of what they have on.
export function listedItems(items, keepId) {
  return (items || []).filter((item) => !HIDDEN.has(item.id) || item.id === keepId);
}
