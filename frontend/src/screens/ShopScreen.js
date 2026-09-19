// ShopScreen — the PASER water point: a race-day hydration station where the
// rotating stock is sold over the counter.
//
// NINE ITEMS at a time on a 12-hour clock, not the whole catalogue: a shop
// you can exhaust in one sitting has no reason to be
// revisited, and everything looks equally unremarkable when it's all on
// display at once. The selection is derived from the window index server-side
// (coins.py) so it needs no state and can't drift between client and server.
//
// NINE, AND NO FILTERS. The stock used to be twelve items behind a row of
// slot tabs, which is two pieces of furniture solving a problem nine tiles
// don't have: three rows of three is the whole shop, on one screen, with
// nothing to narrow down. The tabs also lied about the size of the place —
// a "Hats 2" chip implies there is more behind it. There isn't.
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
import { StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAvatar } from '../state/avatar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NB, brand, nbInk, nbRadius, radius, space, useTheme, useThemedType, withAlpha } from '../theme';
import RewardReveal from '../components/RewardReveal';
import { BackButton, Card, Framed, PANEL_INK, Row, Screen, Skeleton, Button } from '../components/ui';
import CharacterRig, { BODY_RATIO, HEADROOM, PartThumb } from '../components/character/CharacterRig';
import { getItem, SLOTS } from '../config/cosmetics';
import { RARITY_COLOR, RARITY_LABEL } from '../components/RewardArt';
import AppIcon from '../components/AppIcon';
import GameAnimation, { AnimationStack } from '../components/GameAnimation';
import BuyEnergySheet from '../components/BuyEnergySheet';
import PitStopScene from '../components/shop/PitStopScene';
import ShopWallet from '../components/shop/ShopWallet';
import { PIT_STOP_ANIM } from '../config/pitStop';
import { IAP_ENABLED } from '../config/releaseFeatures';
import { haptic, Reveal, useReduceMotion } from '../ui/motion';
import { toast } from '../ui/toast';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';

const SLOT_LABEL = Object.fromEntries(SLOTS.map((s) => [s.key, s.label]));
const SLOT_ORDER = Object.fromEntries(SLOTS.map((s, index) => [s.key, index]));
const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
// The fitting mirror, and the runner sized to stand in it WHOLE. Tall enough
// that a hat reads at a glance, short enough that the stock below it is still
// on screen.
//
// CharacterRig's `size` is the body's WIDTH, and with the headroom it keeps
// for hair and hats the runner is ~2.9x as tall as that. This used to hand it
// the mirror's height as a width: a 388pt runner in a 132pt window, and the
// window kept the legs, so the hat, sash or jacket being tried on was never in
// the preview at all. The width is derived from the mirror instead. `pad`
// includes the 2pt stroke, and leaves the swap spring room to overshoot.
const MIRROR = { w: 114, h: 180, pad: 12 };
const PREVIEW_SIZE = (MIRROR.h - MIRROR.pad * 2) / (BODY_RATIO * (1 + HEADROOM));
const PANEL_FX = 180;

// THE SHELF IS ALWAYS THIS BIG. Three rows of three, every window, whatever
// the server sends.
const SHELF_SIZE = 9;
// Which nine, when the server sends more. The app talks to a DEPLOYED backend
// (see the prod-deploy note in the repo docs), so it will keep receiving the
// old twelve until the new coins.py ships — and a plain slice of a
// rarity-sorted list would hand back nine commons and rares and drop the
// legendary, which is the one item on the shelf anybody is saving for.
//
// This mirrors coins.py's FEATURED_MIX. Both being 9 is the point: once the
// backend rotates nine, every item it sends survives this filter untouched.
const SHELF_MIX = { common: 4, rare: 3, epic: 1, legendary: 1 };

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
  if (left == null) return { left, text: null };
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
        {expiresAt && text ? `New items in ${text}` : 'New items soon'}
      </Text>
    </Framed>
  );
});

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

const ShopProductCard = memo(function ShopProductCard({ item, cat, selected, disabled, onSelect }) {
  const { colors, scheme } = useTheme();
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
        style={styles.cellTouch}
        onPress={() => onSelect(item.item_id)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: !!disabled }}
        accessibilityLabel={`${cat?.label || item.item_id}, ${item.rarity}, ${
          item.owned ? 'owned' : `${item.price} coins`
        }`}
        accessibilityHint={item.owned ? undefined : 'Shows the item details and the buy button'}
      >
        {/* A plain stroked tile, art over price. A tile is functional chrome,
            so it takes the NB stroke rather than a drawn frame, and the whole
            shelf reads as one even grid. Rarity is the picked tile's wash and
            is spelled out in the panel. */}
        <View
          style={[
            styles.cell,
            {
              backgroundColor: selected ? withAlpha(tint, 0.22) : colors.card,
              borderColor: nbInk(scheme, colors.card),
            },
          ]}
        >
          {/* Owned dims the ART, not the tile: fading the whole card took its
              outline with it and washed the shelf out. */}
          <View style={item.owned ? styles.ownedArt : null}>
            <PartThumb slot={item.slot} item={cat} size={68} />
          </View>
          {item.owned ? (
            <Text style={[type.caption, { color: colors.textMuted }]}>Owned</Text>
          ) : (
            <Row gap={4}>
              <AppIcon name="coin" size={14} />
              <Text style={[type.captionMedium, { color: colors.text }]}>{item.price}</Text>
            </Row>
          )}
        </View>
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
// It is one card now, directly under the scene: art, name, rarity, price and
// Buy together, and when you cannot afford it, how far short you are. "This
// costs 240" is only useful next to "you have 180", and the purse is up in
// the header, so the panel does that sum itself.
//
// The purchase burst plays HERE, over the item that was bought, rather than
// over an empty patch of counter.

const SelectedProductPanel = memo(function SelectedProductPanel({
  item,
  cat,
  equipped,
  affordable,
  coins,
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

  const status = item.owned ? 'Owned' : `${item.price} coins`;
  // How far short, in words: a dimmed button alone does not say whether you
  // are 5 coins away or 5,000.
  const short = !item.owned && !affordable && coins != null
    ? `${Number(item.price - coins).toLocaleString()} coins short. Run to earn more.`
    : null;

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
                size={PANEL_FX}
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
                {`${RARITY_LABEL[item.rarity] || item.rarity} ${(SLOT_LABEL[item.slot] || item.slot).toLowerCase()}`}
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
            {short ? (
              <Text style={[type.caption, { color: colors.danger }]}>{short}</Text>
            ) : null}
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
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { equipped, isUnlocked, refreshUnlocks } = useAvatar();
  const { data, loading, error, refresh: load, setData } = useQuery('me:coins', api.shop);
  const [selectedId, setSelectedId] = useState(null);
  // `tick` bumps on every confirmed purchase so the scene replays its
  // celebration even when the same item is bought twice in a row.
  const [purchase, setPurchase] = useState({ status: 'idle', tick: 0 });
  const [getMore, setGetMore] = useState(false);
  // What the purchase reveal is showing, in the same shape the pass uses.
  const [reveal, setReveal] = useState(null);
  const resetTimer = useRef(null);
  // The details panel sits at the top of the page now, so a tap on a cell four
  // rows down would fill a panel nobody can see. The scroller brings it into
  // view; `sceneH` is how far down the page it starts.
  const scroller = useRef(null);
  const [sceneH, setSceneH] = useState(0);
  // The floating header's height. Seeded with its sum so the scene's crop is
  // right on the first frame; onLayout corrects it once it is measured.
  const [barH, setBarH] = useState(() => insets.top + space.xs + 38 + space.sm);
  // THE BAR IS SEE-THROUGH over the painting and turns solid as the stock
  // scrolls up under it: sky behind floating buttons reads as a picture,
  // tiles sliding beneath them read as a rendering fault.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  // Until the scene has been measured there is nothing to be solid over.
  const solidAt = sceneH > 0 ? Math.max(24, sceneH - barH) : 1e6;
  const barFade = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [solidAt - 24, solidAt], [0, 1], Extrapolation.CLAMP),
  }));
  // Mirrored to JS only on the crossing, for the status bar's ink.
  const [solid, setSolid] = useState(false);
  useAnimatedReaction(
    () => scrollY.value >= solidAt - 12,
    (now, before) => {
      if (now !== before) runOnJS(setSolid)(now);
    },
    [solidAt]
  );

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
  // NINE, filled by the mix above. A shelf that is sometimes nine and
  // sometimes twelve is a shelf whose last row you learn to scroll for, so
  // the cap is applied here rather than left to whatever the server sends.
  const shown = useMemo(() => {
    if (items.length <= SHELF_SIZE) return items;
    const room = { ...SHELF_MIX };
    const keep = new Set();
    for (const item of items) {
      if (keep.size >= SHELF_SIZE) break;
      if (!(room[item.rarity] > 0)) continue;
      room[item.rarity] -= 1;
      keep.add(item.item_id);
    }
    // Top up in catalogue order with whatever the mix passed over: a window
    // short on one rarity must still fill all nine cells rather than leave a
    // hole where the epic would have been.
    for (const item of items) {
      if (keep.size >= SHELF_SIZE) break;
      keep.add(item.item_id);
    }
    return items.filter((i) => keep.has(i.item_id));
  }, [items]);
  const coins = data?.coins ?? 0;

  // Looked up in the SHELF, not the whole window: an item the cap left off is
  // not on sale as far as this screen is concerned, and must never end up in
  // the panel with a live buy button.
  const selected = useMemo(
    () => shown.find((i) => i.item_id === selectedId) || null,
    [shown, selectedId]
  );
  // A rotation can land while the panel is open — drop a selection that is no
  // longer on sale rather than leaving a dead buy button on screen.
  useEffect(() => {
    if (selectedId && data && !shown.some((i) => i.item_id === selectedId)) setSelectedId(null);
  }, [shown, selectedId, data]);

  const selectedCat = selected?.cat || null;
  const affordable = !!selected && coins >= selected.price;
  // PASER stock never sells out — the rotation is deterministic and endless —
  // so the scene's "can't sell you this" branch covers the two cases that do
  // exist: you already own it, or you can't afford it yet.
  const unavailable = !!selected && (selected.owned || !affordable);

  const select = useCallback((id) => {
    haptic.light();
    setSelectedId((cur) => {
      const next = cur === id ? null : id;
      // Only on SELECT. Deselecting and being yanked to the top would be the
      // page moving under a tap that meant "never mind".
      // To the scene's foot, less the floating bar, so the panel lands just
      // under the buttons rather than behind them.
      if (next) scroller.current?.scrollTo({ y: Math.max(0, sceneH - barH), animated: true });
      return next;
    });
  }, [sceneH, barH]);

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
      headroom={barH}
    />
  );

  // THE HEADER: back on the left, purse on the right, FLOATING over the
  // painting. There is no title: the stall's own sign says "Water point", and
  // the art runs all the way up under the status bar. The native bar is off
  // for this screen (App.js), so the row pays the status-bar inset itself,
  // exactly once. It is PINNED: the balance is the number every tile is
  // judged against, so it never scrolls away.
  //
  // Both controls are white tiles with fixed dark ink whatever the scheme,
  // because the sky behind them is the same painting in both.
  const header = (
    <View
      style={[styles.header, { paddingTop: insets.top + space.xs }]}
      onLayout={(e) => setBarH(e.nativeEvent.layout.height)}
      pointerEvents="box-none"
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.headerSolid,
          { backgroundColor: colors.bg, borderBottomColor: nbInk(scheme, colors.bg) },
          barFade,
        ]}
      />
      <BackButton onPress={() => navigation.goBack()} fill="#fff" ink={PANEL_INK} size={38} />
      <ShopWallet
        coins={data ? coins : null}
        fill="#fff"
        ink={PANEL_INK}
        onGetMore={IAP_ENABLED ? () => setGetMore(true) : undefined}
      />
    </View>
  );

  // The status bar sits on the painted sky, which is light in both schemes,
  // so its ink is dark until the bar turns solid over a dark page.
  const statusBar = focused ? (
    <StatusBar barStyle={solid && scheme === 'dark' ? 'light-content' : 'dark-content'} />
  ) : null;

  // The scene stays up through loading, empty and error states — the station
  // is the screen, and swapping it for a blank page to say "try again" loses
  // more than it explains.
  // A failed refresh over a stocked shelf leaves the shelf; only a failure with
  // nothing cached to fall back on gets the retry page.
  if (loading && error) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {statusBar}
        {scene}
        <Screen center>
          <Text style={[type.body, { textAlign: 'center' }]}>Couldn’t load the shop.</Text>
          <Button title="Try again" size="sm" full={false} onPress={load} style={{ marginTop: space.md }} />
        </Screen>
        {header}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {statusBar}
      <Animated.ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
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
              coins={data ? coins : null}
              pending={purchase.status === 'pending'}
              celebrating={purchase.status === 'success'}
              purchaseTick={purchase.tick}
              onBuy={buy}
              onClose={() => setSelectedId(null)}
            />
          ) : null}

          {loading ? (
            <View style={styles.grid}>
              {Array.from({ length: SHELF_SIZE }, (_, i) => (
                <View key={i} style={styles.cellWrap}>
                  <Skeleton width="100%" height={116} style={{ borderRadius: radius.card }} />
                </View>
              ))}
            </View>
          ) : shown.length === 0 ? (
            <Text style={[type.body, { color: colors.textMuted, textAlign: 'center', marginTop: space.lg }]}>
              The station is restocking. Check back when the clock runs out.
            </Text>
          ) : (
            /* THE WHOLE SHOP, in one grid. No tabs above it and no case
               around it: nine tiles is small enough to be its own index, and
               the framed box the grid used to sit in only added a second
               border round things that already have one. */
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

          {/* The restock clock, LAST. It is a fact about the shop, not an
              instruction: nothing on this page waits on it and nothing is
              chosen because of it, so it sits under the stock it describes
              rather than between you and the stock. */}
          <RefreshBar expiresAt={data?.expires_at} onExpire={load} />
        </View>
      </Animated.ScrollView>

      {/* Drawn AFTER the scroller, so it floats over the painting. */}
      {header}

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
  // Three across, three down, on the page itself. The row gap is a real point
  // value rather than a percentage: a percentage gap resolves against the
  // container's WIDTH in both axes, so the vertical spacing grew with the
  // phone and the grid got baggy on a big screen.
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', columnGap: '3%', rowGap: space.sm,
  },
  cellWrap: { width: '31.3%' },
  cellTouch: { width: '100%' },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
    paddingBottom: space.sm,
    zIndex: 5,
  },
  headerSolid: { borderBottomWidth: NB.strokeThin },
  // Taller than the old twelve-item tile, because nine of them fit. The art
  // is what you are shopping by, so the art is what got the extra room.
  cell: {
    width: '100%',
    minHeight: 116,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 8,
    borderRadius: nbRadius.sm,
    borderWidth: NB.strokeThin,
  },
  ownedArt: { opacity: 0.5 },
  // No border of its own: the Card brings the neo-brutalist stroke. The rarity
  // read lives on the mirror behind the runner and the spelled-out rarity line.
  panel: { gap: space.md },
  panelTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  // The fitting mirror. A fixed box, so the info column starts in the same
  // place whatever the item is and the burst has a centre to fire from.
  mirror: {
    width: MIRROR.w,
    height: MIRROR.h,
    paddingBottom: MIRROR.pad,
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
  // Centred on the mirror, so the burst goes off round the runner.
  panelFx: {
    position: 'absolute',
    left: (MIRROR.w - PANEL_FX) / 2,
    top: (MIRROR.h - PANEL_FX) / 2,
  },
  panelCoin: { position: 'absolute', right: -6, top: -14 },
  rarityDot: { width: 8, height: 8, borderRadius: 4 },
});
