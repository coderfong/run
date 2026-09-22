// shopStateMachine — names for where the Water Point experience currently
// is, derived rather than tracked.
//
// A DERIVATION, NOT A REDUCER WITH ITS OWN TRANSITIONS. The brief asks for
// something like AMBIENT -> PRODUCT_SELECT -> SELLER_REACTION -> TRY_ON ->
// READY_TO_BUY -> BUYING -> PURCHASE_REACTION -> REWARD_REVEAL, and it is
// tempting to build that as a real state machine with actions and guards.
// But every one of those inputs (what is selected, whether the purchase
// mutation is in flight, whether it can be afforded) already lives as state
// ShopScreen owns for other reasons — the purchase call, the coin balance,
// the selection — and NONE of it should be re-homed into a second store just
// to satisfy a naming exercise: two sources of truth for "is something
// selected" is how a shop ends up showing a Buy button for an item that was
// deselected a frame ago.
//
// So this is one pure function. It reads the existing state and returns
// which named stage it corresponds to. SELLER_REACTION and TRY_ON are not
// distinct STATES here because the UI never needs to know which one it is in
// separately from PRODUCT_SELECT — the dialogue's own timing (useShopDialogue)
// and the mirror's own entrance animation (TryOnMirror's Pop) handle that
// beat internally, off the same `selected` value, without a name for it.
// REWARD_REVEAL is likewise not tracked here: it is a distinct piece of state
// in ShopScreen (`reveal`) already, because RewardReveal's payload (the
// rewards array, the accent) is not something this function's inputs
// contain.

export const SHOP_STAGE = Object.freeze({
  AMBIENT: 'ambient',
  TRY_ON: 'try_on',
  READY_TO_BUY: 'ready_to_buy',
  BUYING: 'buying',
  PURCHASE_REACTION: 'purchase_reaction',
});

/**
 * `selected`       the shelf item object, or null
 * `affordable`     coins >= selected.price (meaningless if !selected)
 * `purchaseStatus` 'idle' | 'pending' | 'success' | 'error' — ShopScreen's
 *                  own purchase state, unchanged by this redesign
 */
export function getShopStage({ selected, affordable, purchaseStatus }) {
  if (purchaseStatus === 'pending') return SHOP_STAGE.BUYING;
  if (purchaseStatus === 'success') return SHOP_STAGE.PURCHASE_REACTION;
  if (!selected) return SHOP_STAGE.AMBIENT;
  if (!selected.owned && affordable) return SHOP_STAGE.READY_TO_BUY;
  // Owned, or not affordable yet: still worth trying on, just not buyable —
  // this is also where the "not enough coins" / "you already own this"
  // dialogue branches live (see shopDialogue.js), so TRY_ON is correct for
  // both rather than a separate error stage.
  return SHOP_STAGE.TRY_ON;
}
