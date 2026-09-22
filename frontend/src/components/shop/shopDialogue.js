// shopDialogue — the Water Point's dialogue engine.
//
// PURE FUNCTIONS, no React. `getProductDialogue` takes what a shopper is
// looking at and returns what the seller says and what the friend says back
// — nothing here touches a timer, a shared value or a ref, so the sequencing
// (useShopDialogue) and the reasoning about WHAT to say can be tested and
// changed independently.
//
// ONE LINE PICKED PER CALL, not a script. A product carries no scripted
// dialogue of its own — the line is derived from what kind of thing it is
// (rarity, slot, ownership, affordability), so a new cosmetic dropped into
// the catalogue speaks correctly on day one with zero lines written for it.
// A future PRODUCT-SPECIFIC line is additive: look one up by `product.item_id`
// first and fall back to the rules below, and nothing else here has to change.

import { SLOTS } from '../../config/cosmetics';

export const SLOT_LABEL = Object.fromEntries(SLOTS.map((s) => [s.key, s.label]));

function pick(list, seed = Math.random()) {
  if (!list || !list.length) return null;
  const i = Math.floor(seed * list.length) % list.length;
  return list[i];
}

// ---------------------------------------------------------------------------
// The seller's line — always states the fact (price, ownership, affordability).
// Never hype; the friend does that.
// ---------------------------------------------------------------------------

const PRICE_LINES = {
  common: (price) => [
    `${price} coins. Nice and easy.`,
    `Just ${price}. Go on.`,
    `${price} coins, if you are in.`,
  ],
  rare: (price) => [
    `Ooh, this one is ${price}.`,
    `${price} coins -- a good one.`,
    `That will be ${price}.`,
  ],
  epic: (price) => [
    `${price} coins. This one is special.`,
    `${price} -- worth it, honestly.`,
  ],
  legendary: (price) => [
    `...${price} coins.`,
    `${price}. You have expensive taste.`,
    `That is the big one -- ${price}.`,
  ],
};

const SLOT_SELLER_LINES = {
  headwear: ['Try it on.', 'Good with the visor off, too.'],
  glasses: ['These might be your thing.', 'Squint-proof, I promise.'],
  footwear: ['Fresh pair?', 'These will carry you.'],
  top: ['That works with your fit.', 'Goes with most of what you have got.'],
  bottom: ['Comfortable for the long ones.'],
  hair: ['A whole new look.'],
  accessory: ['A little extra.', 'The detail that finishes a fit.'],
  face: ['A new face for the road.'],
};

export function sellerPriceLine(rarity, price, seed) {
  const list = (PRICE_LINES[rarity] || PRICE_LINES.common)(price);
  return pick(list, seed);
}

export function sellerSlotLine(slot, seed) {
  return pick(SLOT_SELLER_LINES[slot], seed);
}

// ---------------------------------------------------------------------------
// The friend's line — reacts, never states a fact the seller already gave.
// ---------------------------------------------------------------------------

const HYPE_BY_RARITY = {
  common: ['Not bad. Not bad at all.', 'Solid pick.', 'That will do the job.'],
  rare: ['Okayyy... those actually look good on you.', 'Ooh, nice.', 'I like that one.'],
  epic: ['Now that is a fit.', 'Okay, showing off a little.', 'That is a statement piece.'],
  legendary: ['You are about to look FAST.', 'That is the one. THAT is the one.', 'Wear it. Wear it now.'],
};

const HYPE_BY_SLOT = {
  headwear: ['That hat is doing a lot of work.', 'Very you.'],
  glasses: ['Those actually suit you.', 'Mysterious. I like it.'],
  footwear: ['Those will turn heads at the start line.', 'Fresh kicks.'],
  top: ['That colour works on you.', 'Good fit, honestly.'],
  accessory: ['The little details matter.'],
};

const OWNED_FRIEND_LINES = ['Still looks good though.', 'A classic pick.', 'Cannot go wrong twice.'];
const SHORT_FRIEND_LINES = ['One more run?', 'So close. Get out there.', 'A few more coins and it is yours.'];

export function friendReactionLine({ rarity, slot, seed }) {
  // Slot-flavoured half the time, rarity-flavoured the other half — the
  // variety is what keeps two rare hats from sounding like the same line.
  const bySlot = HYPE_BY_SLOT[slot];
  const useSlot = bySlot && bySlot.length && (seed % 1) < 0.5;
  const list = useSlot ? bySlot : (HYPE_BY_RARITY[rarity] || HYPE_BY_RARITY.common);
  return pick(list, seed);
}

// ---------------------------------------------------------------------------
// getProductDialogue — the one entry point useShopDialogue calls.
// ---------------------------------------------------------------------------

/**
 * `product`  the shelf item ({ item_id, rarity, price, owned, slot, ... })
 * `cat`      the resolved cosmetics-catalogue entry (for a future
 *            product-specific line; unused by the rules below)
 * `affordable` coins >= price
 * `missingCoins` price - coins, only meaningful when !affordable
 * `seed`     0..1, so a caller can vary the pick without this module owning
 *            any randomness of its own (keeps it a pure function)
 */
export function getProductDialogue({ product, affordable, missingCoins, seed = Math.random() }) {
  if (!product) return null;
  const { rarity, price, slot, owned } = product;

  if (owned) {
    return {
      sellerLine: 'You already own this!',
      friendLine: pick(OWNED_FRIEND_LINES, seed),
      reactionType: 'owned',
    };
  }

  if (!affordable) {
    const short = Math.max(0, Math.round(missingCoins ?? 0));
    return {
      sellerLine: short > 0 ? `You are ${short.toLocaleString()} short.` : 'Not quite enough yet.',
      friendLine: pick(SHORT_FRIEND_LINES, seed),
      reactionType: 'short',
    };
  }

  // Half the time the seller states the price, half the time the slot
  // flavour — the price is always available in the placard regardless, so
  // this is about keeping the SPOKEN line from being the same fact twice a
  // session.
  const slotLine = sellerSlotLine(slot, seed);
  const useSlotLine = slotLine && seed < 0.35;
  return {
    sellerLine: useSlotLine ? slotLine : sellerPriceLine(rarity, price, seed),
    friendLine: friendReactionLine({ rarity, slot, seed: (seed + 0.37) % 1 }),
    reactionType: rarity === 'legendary' || rarity === 'epic' ? 'excited' : 'plain',
  };
}

// ---------------------------------------------------------------------------
// Ambient one-liners — tapping a crew member who isn't reacting to a
// purchase. Cooldown-gated by useShopDialogue, not here.
// ---------------------------------------------------------------------------

export const IDLE_LINES = {
  seller: ['Hydrate first.', 'Window shopping?', 'Fresh stock today.', 'Do not blame me if you spend all your coins.'],
  friend: ['I am just here for the outfits.', 'Get the glasses.', 'I vote yes.', 'Ask ME what looks good.'],
  chill: ['...', 'Long run?', '*sips water*', 'Good pace out there today.'],
};

export function getIdleLine(role, seed = Math.random()) {
  return pick(IDLE_LINES[role], seed);
}
