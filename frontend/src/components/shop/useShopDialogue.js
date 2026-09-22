// useShopDialogue — sequences the Water Point's crew reactions.
//
// Three bubble slots, one per crew role (seller / friend / chill), each
// `{ text, tick, tone } | null`. `tick` changes on every new line so
// NPCSpeechBubble's entrance spring (Pop) replays even when the text is
// identical to what was already showing — picking the same rare item twice
// in a row should react twice.
//
// THE SEQUENCE IS OWNED HERE, NOT IN shopDialogue.js. That module is pure
// (what to say); this hook is the only thing that knows WHEN — the seller
// speaks first, the friend notices ~850ms later, and a purchase's "Done!" /
// "Nice pick." pair briefly overrides whatever was showing. Keeping the two
// concerns apart means the timing can be retuned without touching a single
// line of dialogue, and vice versa.

import { useEffect, useMemo, useRef, useState } from 'react';

import { getIdleLine, getProductDialogue } from './shopDialogue';

// Selecting an item: seller reacts fast, friend catches up a beat later —
// see the brief's own timing table (section 19).
const SELLER_DELAY = 250;
const FRIEND_DELAY = 1200;
const AUTO_DISMISS = 6200;

// A purchase is a short, snappy exchange, not a browse — it must not still
// be on screen when RewardReveal opens over it.
const BUY_SELLER = ['Done!', 'There you go!', 'Nice.'];
const BUY_FRIEND = ['Nice pick.', 'Looking sharp.', 'That was worth it.'];
const BUY_DISMISS = 1500;

// However fast someone pokes a crew member, two bubbles from the same mouth
// inside this window is spam, not liveliness.
const IDLE_COOLDOWN = 2600;

function pickOne(list, seed = Math.random()) {
  return list[Math.floor(seed * list.length) % list.length];
}

export function useShopDialogue({ selected, purchaseStatus, coins }) {
  const [bubbles, setBubbles] = useState({ seller: null, friend: null, chill: null });
  const timers = useRef([]);
  const cooldowns = useRef({ seller: 0, friend: 0, chill: 0 });

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const after = (ms, fn) => {
    timers.current.push(setTimeout(fn, ms));
  };
  const say = (role, text, tone) => {
    setBubbles((b) => ({ ...b, [role]: text ? { text, tick: Date.now() + Math.random(), tone } : null }));
  };

  // The product conversation: fires once per NEWLY selected item. Re-keyed
  // on the item id alone (not price/coins) so a coin balance ticking up
  // elsewhere never replays a line the shopper already read.
  const selectedId = selected?.item_id || null;
  useEffect(() => {
    clearTimers();
    // Deselecting (or a purchase starting) clears the conversation right
    // away rather than leaving it to its own auto-dismiss timer — a bubble
    // still on screen for an item the placard has already closed on reads as
    // a stuck UI, not a lingering thought.
    say('seller', null);
    say('friend', null);
    if (!selectedId || purchaseStatus !== 'idle') return clearTimers;
    const affordable = coins >= selected.price;
    const missingCoins = selected.price - coins;
    const dlg = getProductDialogue({ product: selected, affordable, missingCoins, seed: Math.random() });
    if (!dlg) return clearTimers;
    after(SELLER_DELAY, () => say('seller', dlg.sellerLine, dlg.reactionType));
    after(FRIEND_DELAY, () => say('friend', dlg.friendLine, dlg.reactionType));
    after(AUTO_DISMISS, () => say('seller', null));
    after(AUTO_DISMISS + 300, () => say('friend', null));
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, purchaseStatus]);

  // The purchase moment: overrides whatever the browse conversation left
  // showing with a short, happy pair, then clears for RewardReveal.
  const wasSuccess = useRef(false);
  useEffect(() => {
    if (purchaseStatus !== 'success' || wasSuccess.current) {
      if (purchaseStatus !== 'success') wasSuccess.current = false;
      return undefined;
    }
    wasSuccess.current = true;
    const seed = Math.random();
    say('seller', pickOne(BUY_SELLER, seed), 'excited');
    say('friend', null);
    const t1 = setTimeout(() => say('friend', pickOne(BUY_FRIEND, (seed + 0.5) % 1), 'excited'), 260);
    const t2 = setTimeout(() => { say('seller', null); say('friend', null); }, BUY_DISMISS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [purchaseStatus]);

  useEffect(() => clearTimers, []);

  const poke = (role) => {
    const now = Date.now();
    if (now - (cooldowns.current[role] || 0) < IDLE_COOLDOWN) return;
    cooldowns.current[role] = now;
    say(role, getIdleLine(role));
    setTimeout(() => say(role, null), 3400);
  };

  return useMemo(() => ({
    bubbles,
    pokeSeller: () => poke('seller'),
    pokeFriend: () => poke('friend'),
    pokeChill: () => poke('chill'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [bubbles]);
}
