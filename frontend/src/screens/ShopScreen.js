// ShopScreen — the PASER water point: a race-day hydration station where the
// rotating stock is sold over the counter.
//
// Twelve items at a time on a 12-hour clock, not the whole catalogue: a shop
// you can exhaust in one sitting has no reason to be
// revisited, and everything looks equally unremarkable when it's all on
// display at once. The selection is derived from the window index server-side
// (coins.py) so it needs no state and can't drift between client and server.
//
// Prices come from the SERVER catalogue — the numbers here are decoration.
// Buying an item that has since rotated out returns 410, which is handled by
// reloading rather than by trusting the local list.
//
// Coin packs deliberately DON'T live here — they're real-money IAP and sit
// with the energy packs in one "Get more" sheet.
//
// TAP SELECTS, IT DOESN'T BUY. Tapping a cell used to fire the purchase, so a
// mis-tap spent coins with no way back. Now a tap fills the panel at the
// bottom — art, name, rarity, price, ownership — and buying is a second,
// deliberate press. The scene above reacts to the selection, which is what
// the panel and the illustration are for.
//
// Everything above the stock is decoration: components/shop/PitStopScene is
// pointerEvents="none" and hidden from screen readers, so it can never
// intercept a purchase or add a focus stop.

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAvatar } from '../state/avatar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NB, brand, nbInk, nbRadius, radius, space, useTheme, useThemedType, withAlpha } from '../theme';
import RewardReveal from '../components/RewardReveal';
import { Card, Framed, Row, Screen, Skeleton, Button } from '../components/ui';
import CharacterRig, { PartThumb } from '../components/character/CharacterRig';
import { getItem, SLOTS } from '../config/cosmetics';
import { RARITY_COLOR } from '../components/RewardArt';
import AppIcon from '../components/AppIcon';
import GameAnimation, { AnimationStack } from '../components/GameAnimation';
import BuyEnergySheet from '../components/BuyEnergySheet';
import PitStopScene from '../components/shop/PitStopScene';
import ShopWallet from '../components/shop/ShopWallet';
import ShopSlotTabs, { ALL_SLOTS } from '../components/shop/ShopSlotTabs';
import { PIT_STOP_ANIM } from '../config/pitStop';
import { IAP_ENABLED } from '../config/releaseFeatures';
import { haptic, Reveal, useReduceMotion } from '../ui/motion';
import { toast } from '../ui/toast';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';

const SLOT_LABEL = Object.fromEntries(SLOTS.map((s) => [s.key, s.label]));
const SLOT_ORDER = Object.fromEntries(SLOTS.map((s, index) => [s.key, index]));
const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
// How tall the runner stands in the fitting mirror. Big enough that a hat
// reads at a glance, small enough that the stock below it is still on screen.
const PREVIEW_SIZE = 132;

function useCountdown(expiresAt) {
  const remaining = (expiry) => (expiry ? Math.max(0, expiry * 1000 - Date.now()) : 0);
  // Keep the expiry beside the value. When a new window arrives, the previous
  // window may have ended at zero; without this identity check RefreshBar can
  // mistake that stale zero for the NEW window and immediately reload again.
  const [clock, setClock] = useState(() => ({ expiresAt, left: remaining(expiresAt) }));
  useEffect(() => {
    if (!expiresAt) {
      setClock({ expiresAt, left: 0 });
      return undefined;
    }
    const tick = () => setClock({ expiresAt, left: remaining(expiresAt) });
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const ready = clock.expiresAt === expiresAt;
  const left = ready ? clock.left : null;
  if (left == null) return { left, text: '·' };
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return { left, text: `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s` };
}

// ---------------------------------------------------------------------------
// Refresh bar — the countdown, isolated
// ---------------------------------------------------------------------------
//
// This is the only thing on the screen that re-renders every second, and it
// is deliberately a leaf: keeping the interval in here is what stops a
// ticking clock from re-rendering the illustrated scene sixty times a minute.

const RefreshBar = memo(function RefreshBar({ expiresAt, onExpire }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const { left, text } = useCountdown(expiresAt);
  const fired = useRef(null);

  useEffect(() => {
    if (!expiresAt || left == null || left !== 0) return;
    // Once per window, or a server still handing back a stale expiry would
    // put the screen in a reload loop.
    if (fired.current === expiresAt) return;
    fired.current = expiresAt;
    onExpire?.();
  }, [left, expiresAt, onExpire]);

  return (
    <Framed
      frame={frameVariant('chip', 'shop-restock')}
      weight={INK.thin}
      pose={framePose('shop-restock')}
      inset={3}
      tint={colors.textMuted}
      fill={colors.cardAlt}
      on={colors.cardAlt}
      style={styles.timer}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
    >
      <AppIcon name="timer" size={16} />
      <Text style={[type.captionMedium, { color: colors.textMuted, paddingHorizontal: space.xs }]}>
        Fresh stock in {expiresAt ? text : '·'}
      </Text>
    </Framed>
  );
});

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

const ShopProductCard = memo(function ShopProductCard({ item, cat, selected, disabled, onSelect }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const tint = RARITY_COLOR[item.rarity] || colors.border;
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = reduced ? 1 : withTiming(selected ? 1.025 : 1, { duration: 160 });
  }, [selected, reduced, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[styles.cellWrap, style]}>
      <TouchableOpacity
        style={[styles.cellTouch, item.owned && { opacity: 0.55 }]}
        onPress={() => onSelect(item.item_id)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: !!disabled }}
        accessibilityLabel={`${cat?.label || item.item_id}, ${item.rarity}, ${
          item.owned ? 'owned' : `${item.price} coins`
        }`}
        accessibilityHint={item.owned ? undefined : 'Shows the item details and the buy button'}
      >
        <Framed
          frame={frameVariant('card', `shop:${item.item_id}`)}
          tint={selected ? colors.text : tint}
          fill={selected ? withAlpha(tint, 0.2) : colors.card}
          weight={selected ? INK.medium : INK.thin}
          pose={framePose(`shop:${item.item_id}`)}
          // Only the selected tile boils — see ProgressionScreen's header
          // frame for the same rule: a grid of boiling tiles is a grid that
          // will not sit still, so the animated look is reserved for the one
          // thing you actually picked.
          boil={selected}
          inset={false}
          style={styles.cell}
          contentStyle={styles.cellContent}
        >
          {/* Rarity remains both a section heading and the card's tinted
              frame now that the name is gone from the tile itself. */}
          <PartThumb slot={item.slot} item={cat} size={52} />
          {item.owned ? (
            <Text style={[type.caption, { color: colors.textMuted }]}>Owned</Text>
          ) : (
            <Row gap={4}>
              <AppIcon name="coin" size={14} />
              <Text style={[type.captionMedium, { color: colors.text }]}>{item.price}</Text>
            </Row>
          )}
        </Framed>
      </TouchableOpacity>
    </Animated.View>
  );
});

// ---------------------------------------------------------------------------
// Selected product panel — the only thing that can spend coins
// ---------------------------------------------------------------------------
//
// This used to be TWO things in two places: the product rose off the counter
// inside the illustration, and a bar slid up from the bottom edge to carry the
// name, price and buy button. Between them the thing you had actually picked
// was never in one piece, and half of it lived inside a decorative layer that
// takes no touches and answers to no screen reader.
//
// It is one card now, and it sits directly ABOVE THE WALLET — art, name,
// rarity, price and Buy together, with your coin balance as the very next
// thing you read. That adjacency is the point: "this costs 240" is only useful
// next to "you have 180".
//
// The purchase burst plays HERE, over the item that was bought, rather than
// over an empty patch of counter.

const SelectedProductPanel = memo(function SelectedProductPanel({
  item,
  cat,
  equipped,
  affordable,
  pending,
  celebrating,
  purchaseTick,
  onBuy,
  onClose,
}) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const tint = RARITY_COLOR[item.rarity] || colors.border;
  // Rare and above gets the burst behind the confetti. The gate is what keeps
  // a common restock from looking like a jackpot.
  const rare = item.rarity && item.rarity !== 'common';

  // TRY IT ON. The runner is drawn WEARING the candidate, not standing beside
  // a picture of it. A cut-out thumbnail tells you what an item is; it cannot
  // tell you the thing you are actually deciding, which is whether it looks
  // right on the character you have already dressed. Every shop worth copying
  // puts the character in the preview for exactly this reason.
  //
  // Merged over the live outfit rather than shown alone, so a hat is judged
  // against your own hair and jacket. Nothing is written anywhere: this is a
  // render prop, and closing the panel is all it takes to undo.
  const worn = useMemo(
    () => ({ ...(equipped || {}), [item.slot]: item.item_id }),
    [equipped, item.slot, item.item_id]
  );

  const status = item.owned
    ? 'Owned'
    : affordable
      ? `${item.price} coins`
      : `Not enough coins, ${item.price} needed`;

  return (
    <Reveal from="down" duration={220}>
      <Card style={styles.panel}>
        <View style={styles.panelTop}>
          {/* The fitting mirror. Tinted in the rarity so the frame round the
              runner is the same signal the tile carried. */}
          <View
            style={[
              styles.mirror,
              { backgroundColor: withAlpha(tint, 0.16), borderColor: withAlpha(tint, 0.55) },
            ]}
          >
            <CharacterRig
              equipped={worn}
              size={PREVIEW_SIZE}
              animate={!reduced}
              animateSwaps={!reduced}
            />
            {celebrating ? (
              <AnimationStack
                names={rare ? ['rewardBurst', 'confettiBurst'] : ['confettiBurst']}
                size={180}
                trigger={purchaseTick}
                style={styles.panelFx}
              />
            ) : null}
          </View>

          <View style={styles.panelInfo}>
            {/* The item on its own, beside the runner wearing it: the cut-out
                is what you recognise in the grid, the rig is what you are
                buying it for. */}
            <View
              style={[
                styles.chip,
                { backgroundColor: colors.cardAlt, borderColor: nbInk(scheme, colors.cardAlt) },
              ]}
            >
              <PartThumb slot={item.slot} item={cat} size={40} />
            </View>
            <Text style={type.bodyBold} numberOfLines={2}>
              {cat?.label || item.item_id}
            </Text>
            <Row gap={6} style={{ alignItems: 'center' }}>
              {/* Rarity is spelled out, not just tinted — colour alone is not a
                  label. */}
              <View style={[styles.rarityDot, { backgroundColor: tint }]} />
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {item.rarity} · {SLOT_LABEL[item.slot] || item.slot}
              </Text>
            </Row>
            <Row gap={4} style={{ alignItems: 'center' }}>
              {!item.owned ? <AppIcon name="coin" size={14} /> : null}
              <Text
                style={[
                  type.captionMedium,
                  { color: item.owned || affordable ? colors.textMuted : colors.danger },
                ]}
              >
                {status}
              </Text>
            </Row>
          </View>
        </View>

        {/* The buy row runs the full width under the fitting, so the button is
            a real target rather than something wedged into a third column. */}
        <View style={styles.panelActions}>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close item details"
            hitSlop={10}
            style={styles.close}
          >
            <Text style={[type.captionMedium, { color: colors.textDim }]}>Close</Text>
          </TouchableOpacity>
          <Button
            title={item.owned ? 'Owned' : affordable ? `Buy for ${item.price}` : 'Not enough coins'}
            size="sm"
            full={false}
            variant={item.owned || !affordable ? 'secondary' : 'gradient'}
            loading={pending}
            disabled={item.owned || !affordable || pending}
            onPress={onBuy}
          />
        </View>

        {reduced ? null : (
          <GameAnimation
            name="coinSpin"
            size={48}
            trigger={purchaseTick}
            visible={celebrating}
            style={styles.panelCoin}
          />
        )}
      </Card>
    </Reveal>
  );
});

// ---------------------------------------------------------------------------

export default function ShopScreen() {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { equipped, isUnlocked, refreshUnlocks } = useAvatar();
  const { data, loading, error, refresh: load, setData } = useQuery('me:coins', api.shop);
  const [selectedId, setSelectedId] = useState(null);
  // `tick` bumps on every confirmed purchase so the scene replays its
  // celebration even when the same item is bought twice in a row.
  const [purchase, setPurchase] = useState({ status: 'idle', tick: 0 });
  const [getMore, setGetMore] = useState(false);
  // Which shelf is on show. Browsing is by SLOT now — see ShopSlotTabs for
  // why rarity stopped being the thing you navigate by.
  const [slot, setSlot] = useState(ALL_SLOTS);
  // What the purchase reveal is showing, in the same shape the pass uses.
  const [reveal, setReveal] = useState(null);
  const resetTimer = useRef(null);
  // The details panel sits at the top of the page now, so a tap on a cell four
  // rows down would fill a panel nobody can see. The scroller brings it into
  // view; `sceneH` is how far down the page it starts.
  const scroller = useRef(null);
  const [sceneH, setSceneH] = useState(0);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  // The server owns rotation and prices; the client adds its stat/pass unlock
  // knowledge so the shop never offers a Buy button for an already-equippable
  // item. Sort by rarity, then wearable slot, then the visible name.
  const items = useMemo(() => (data?.items || [])
    .map((item) => {
      const cat = getItem(item.slot, item.item_id);
      return { ...item, cat, owned: item.owned || (!!cat && isUnlocked(cat)) };
    })
    .sort((a, b) => (
      RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
      || (SLOT_ORDER[a.slot] ?? 99) - (SLOT_ORDER[b.slot] ?? 99)
      || (a.cat?.label || a.item_id).localeCompare(b.cat?.label || b.item_id)
    )), [data?.items, isUnlocked]);
  // One tab per slot that actually has stock this window, "All" first. A tab
  // leading to an empty shelf is a dead end, and the rotation only ever holds
  // a handful of slots at a time.
  const tabs = useMemo(() => {
    const counts = new Map();
    for (const item of items) counts.set(item.slot, (counts.get(item.slot) || 0) + 1);
    return [
      { key: ALL_SLOTS, label: 'All', count: items.length },
      ...SLOTS
        .filter((sl) => counts.has(sl.key))
        .map((sl) => ({ key: sl.key, label: sl.label, count: counts.get(sl.key) })),
    ];
  }, [items]);

  // A tab can vanish under you when the shop rotates. Fall back to All rather
  // than leaving the shelf empty with a tab selected that no longer exists.
  useEffect(() => {
    if (slot !== ALL_SLOTS && !tabs.some((t) => t.key === slot)) setSlot(ALL_SLOTS);
  }, [tabs, slot]);

  const shown = useMemo(
    () => (slot === ALL_SLOTS ? items : items.filter((item) => item.slot === slot)),
    [items, slot]
  );
  const coins = data?.coins ?? 0;

  const selected = useMemo(
    () => items.find((i) => i.item_id === selectedId) || null,
    [items, selectedId]
  );
  // A rotation can land while the panel is open — drop a selection that is no
  // longer on sale rather than leaving a dead buy button on screen.
  useEffect(() => {
    if (selectedId && data && !items.some((i) => i.item_id === selectedId)) setSelectedId(null);
  }, [items, selectedId, data]);

  const selectedCat = selected?.cat || null;
  const affordable = !!selected && coins >= selected.price;
  // PASER stock never sells out — the rotation is deterministic and endless —
  // so the scene's "can't sell you this" branch covers the two cases that do
  // exist: you already own it, or you can't afford it yet.
  const unavailable = !!selected && (selected.owned || !affordable);

  // Changing shelf keeps whatever is selected: the panel is a fitting room,
  // and having it emptied because you went to look at the hats would undo the
  // comparison you were in the middle of making.
  const pickSlot = useCallback((key) => {
    haptic.light();
    setSlot(key);
  }, []);

  const select = useCallback((id) => {
    haptic.light();
    setSelectedId((cur) => {
      const next = cur === id ? null : id;
      // Only on SELECT. Deselecting and being yanked to the top would be the
      // page moving under a tap that meant "never mind".
      if (next) scroller.current?.scrollTo({ y: sceneH, animated: true });
      return next;
    });
  }, [sceneH]);

  const buy = useCallback(async () => {
    if (!selected || selected.owned || purchase.status === 'pending') return;
    setPurchase((p) => ({ ...p, status: 'pending' }));
    try {
      const res = await api.buyCosmetic(selected.item_id);
      haptic.success();
      // The purchase gets the same payoff the pass tiers get. A toast that is
      // gone in two seconds is a receipt; buying a legendary should land like
      // opening one.
      setReveal({
        rewards: [
          {
            kind: 'cosmetic',
            key: `${selected.slot}:${selected.item_id}`,
            label: getItem(selected.slot, selected.item_id)?.label || selected.item_id,
          },
        ],
        accent: RARITY_COLOR[selected.rarity] || brand.pink,
      });
      setData((d) => (d ? {
        ...d,
        coins: res.coins,
        items: d.items.map((i) => (i.item_id === selected.item_id ? { ...i, owned: true } : i)),
      } : d));
      refreshUnlocks?.();
      // Only now, with the purchase confirmed by the server, does the scene
      // get to celebrate.
      setPurchase((p) => ({ status: 'success', tick: p.tick + 1 }));
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(
        () => setPurchase((p) => ({ ...p, status: 'idle' })),
        Math.max(
          PIT_STOP_ANIM.purchase.total,
          PIT_STOP_ANIM.reveal[selected.rarity] || 0
        )
      );
    } catch (e) {
      // The energy shortfall on the claim screen does the same thing — offer
      // the sheet that fixes it, not just a toast saying what's wrong.
      if (e.status === 402) { toast.error('Not enough coins'); if (IAP_ENABLED) setGetMore(true); }
      else if (e.status === 409) toast.error('You already own that');
      else if (e.status === 410) { toast.error('That just rotated out'); setSelectedId(null); load(); }
      else toast.error(e.message || 'Could not buy that');
      // Back to the selected item — the toast is the error surface.
      setPurchase((p) => ({ ...p, status: 'idle' }));
    }
  }, [selected, purchase.status, refreshUnlocks, load]);

  const scene = (
    <PitStopScene
      selectedProductId={selectedId}
      selectedRarity={selected?.rarity || null}
      isSelectedUnavailable={unavailable}
      purchaseStatus={purchase.status}
      active={focused}
    />
  );

  // The scene stays up through loading, empty and error states — the station
  // is the screen, and swapping it for a blank page to say "try again" loses
  // more than it explains.
  // A failed refresh over a stocked shelf leaves the shelf; only a failure with
  // nothing cached to fall back on gets the retry page.
  if (loading && error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {scene}
        <Screen center>
          <Text style={[type.body, { textAlign: 'center' }]}>Couldn’t load the shop.</Text>
          <Button title="Try again" size="sm" full={false} onPress={load} style={{ marginTop: space.md }} />
        </Screen>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* PINNED. The balance is the number every tile is judged against, so it
          sits in the chrome and never scrolls away — and it carries the
          selected item's price beside it, which is the comparison the whole
          screen exists to support. */}
      <ShopWallet
        coins={data ? coins : null}
        cost={selected && !selected.owned ? selected.price : null}
        affordable={affordable}
        onGetMore={IAP_ENABLED ? () => setGetMore(true) : undefined}
        top={insets.top}
      />
      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        // Clear the home indicator: this screen is a raw ScrollView with no
        // Screen wrapper, so the restock clock (the LAST row) sat right on the
        // bottom edge on a device with a home bar.
        contentContainerStyle={{ paddingBottom: insets.bottom + space.huge }}
      >
        <View onLayout={(e) => setSceneH(e.nativeEvent.layout.height)}>{scene}</View>

        <View style={{ padding: space.gutter, gap: space.md }}>
          {/* What you picked, ABOVE your balance — see SelectedProductPanel. */}
          {selected ? (
            <SelectedProductPanel
              item={selected}
              cat={selectedCat}
              equipped={equipped}
              affordable={affordable}
              pending={purchase.status === 'pending'}
              celebrating={purchase.status === 'success'}
              purchaseTick={purchase.tick}
              onBuy={buy}
              onClose={() => setSelectedId(null)}
            />
          ) : null}

          {loading ? (
            <>
              <Skeleton width="100%" height={44} style={{ borderRadius: radius.pill }} />
              <Skeleton width="100%" height={200} style={{ borderRadius: radius.card }} />
            </>
          ) : items.length === 0 ? (
            <Text style={[type.body, { color: colors.textMuted, textAlign: 'center', marginTop: space.lg }]}>
              The station is restocking. Check back when the clock runs out.
            </Text>
          ) : (
            <>
              {/* Browse by WHAT YOU WANT, not by how rare it is. Rarity is
                  still the colour of every tile's frame and is spelled out on
                  the item you pick; it just stopped being the thing you
                  navigate by. See ShopSlotTabs. */}
              <ShopSlotTabs tabs={tabs} value={slot} onChange={pickSlot} accent={brand.pink} />

              {/* ONE SHELF, not four rarity bands. The stock is a case of
                  goods now: a single framed box with the grid inside it, so it
                  reads as a thing you are shopping FROM rather than as a list
                  the page happens to end with. */}
              <Framed
                frame={frameVariant('box', 'shop-shelf')}
                tint={colors.border}
                fill={colors.card}
                weight={INK.thin}
                pose={framePose('shop-shelf')}
                inset={space.sm}
                contentStyle={styles.shelf}
              >
                {shown.length === 0 ? (
                  <Text style={[type.caption, { color: colors.textMuted, textAlign: 'center', padding: space.md }]}>
                    Nothing in this shelf today.
                  </Text>
                ) : (
                  <View style={styles.grid}>
                    {shown.map((item) => (
                      <ShopProductCard
                        key={item.item_id}
                        item={item}
                        cat={item.cat}
                        selected={selectedId === item.item_id}
                        disabled={purchase.status === 'pending'}
                        onSelect={select}
                      />
                    ))}
                  </View>
                )}
              </Framed>
            </>
          )}

          {/* The restock clock, LAST. It is a fact about the shop, not an
              instruction: nothing on this page waits on it and nothing is
              chosen because of it, so it sits under the stock it describes
              rather than between you and the stock. */}
          <RefreshBar expiresAt={data?.expires_at} onExpire={load} />
        </View>
      </ScrollView>

      {IAP_ENABLED ? (
        <BuyEnergySheet
          visible={getMore}
          onClose={() => setGetMore(false)}
          onPurchased={load}
        />
      ) : null}

      {/* The payoff, shared with the reward pass so buying and claiming feel
          like the same kind of moment. */}
      <RewardReveal
        visible={!!reveal}
        rewards={reveal?.rewards}
        accent={reveal?.accent}
        equipped={equipped}
        onClose={() => setReveal(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  timer: { alignSelf: 'center', marginTop: space.sm },
  // The case the stock sits in. Its own padding, because the frame's ink
  // clearance is the shelf's inside edge.
  shelf: { padding: space.sm },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: '2.75%',
  },
  cellWrap: { width: '31.5%' },
  cellTouch: { width: '100%' },
  cell: {
    width: '100%', minHeight: 92,
  },
  cellContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, padding: 7 },
  // No border of its own: the Card brings the neo-brutalist stroke. The rarity
  // read lives on the mirror behind the runner and the spelled-out rarity line.
  panel: { gap: space.md },
  panelTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // The fitting mirror. A fixed box, so the info column starts in the same
  // place whatever the item is and the burst has a centre to fire from.
  mirror: {
    width: PREVIEW_SIZE * 0.86,
    height: PREVIEW_SIZE,
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderRadius: radius.card,
    borderWidth: 2,
    overflow: 'hidden',
  },
  panelInfo: { flex: 1, gap: 4 },
  chip: {
    width: 52,
    height: 52,
    borderRadius: nbRadius.sm,
    borderWidth: NB.strokeThin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { paddingVertical: 6, paddingHorizontal: space.sm },
  // Overflows its 72pt square on purpose — a burst confined to the art box is
  // a rectangle of confetti, not an explosion.
  panelFx: { position: 'absolute', left: -34, top: -34 },
  panelCoin: { position: 'absolute', right: -6, top: -14 },
  rarityDot: { width: 8, height: 8, borderRadius: 4 },
});
