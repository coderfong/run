// Which item a box actually hands over.
//
// Lifted out of ProgressionScreen when the daily mission bonus became a second
// place boxes are opened. Two copies of a payout rule is how the pass and the
// missions screen start quietly paying different things.
//
// THE SERVER DECIDES THE RARITY, THIS DECIDES THE ITEM. Rarity is the part
// worth protecting — it is what the gamble bids up — and it is settled server
// side at open time (backend/app/lootbox.py). Which of the ~40 items of that
// rarity you get is chosen here, against the client catalogue, because that
// catalogue only exists on the client.
//
// PASS REWARDS ARE NEVER IN THE POOL. A box must not be able to hand over
// something the free or premium track is supposed to be the route to, or the
// ladder stops being a reason to climb.
//
// STILL LOCKED FIRST. Rolling uniformly means a player with most of a rarity
// owned keeps opening boxes into duplicates they cannot see. Preferring items
// they do not have makes a box a collection moving forward, and it falls back
// to the whole pool once a rarity is complete so it can never come up empty.

import { ITEMS } from './cosmetics';

export function rollCosmetic(rarity, isUnlocked) {
  const pool = [];
  for (const slot of Object.keys(ITEMS)) {
    for (const item of ITEMS[slot]) {
      if (
        (item.rarity || 'common') === rarity
        && item.id !== 'none'
        && !item.unlock?.pass
        && !item.unlock?.premium
      ) pool.push({ slot, item });
    }
  }
  if (!pool.length) {
    throw new Error(`No ${rarity} cosmetics are configured for lootboxes`);
  }
  const locked = pool.filter(({ item }) => !isUnlocked(item));
  const src = locked.length ? locked : pool;
  return src[Math.floor(Math.random() * src.length)];
}

export default rollCosmetic;
