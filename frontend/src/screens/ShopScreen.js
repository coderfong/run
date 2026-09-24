// ShopScreen — PASER WATER POINT: a race-day hydration station you have run
// into, rebuilt as a place rather than a grid.
//
// NINE ITEMS at a time on a 12-hour clock, not the whole catalogue: a shop
// you can exhaust in one sitting has no reason to be revisited, and
// everything looks equally unremarkable when it's all on display at once.
// The selection is derived from the window index server-side (coins.py) so
// it needs no state and can't drift between client and server.
//
// NINE, AND NO FILTERS. The stock used to be twelve items behind a row of
// slot tabs. Three rows of three is the whole shop, on one screen, with
// nothing to narrow down.
//
// Prices come from the SERVER catalogue — the numbers here are decoration.
// Buying an item that has since rotated out returns 410, which is handled by
// reloading rather than by trusting the local list.
//
// Coin packs deliberately DON'T live here — they're real-money IAP and sit
// with the energy packs in one "Get more" sheet.
//
// TAP SELECTS, IT DOESN'T BUY. A tap outlines the card, sets the crew
// reacting and docks the placard, which shows your runner wearing the item;
// buying is a second, deliberate press on the placard's Buy button.
//
// TWO LAYERS, NEVER MIXED (2026-09-23). The top of the screen is the Water
// Point itself: the looping movie, the crew, the stall's own sign, and only
// the back button and purse floating over it. The bottom is the STOREFRONT:
// a warm panel pulled out from under the counter holding the nine cards and
// the restock clock. Nothing is placed on the painted counter or shelves any
// more, and there are no category tabs (nine cards is its own index). The
// data and purchase logic are exactly what they were: the SHELF_SIZE /
// SHELF_MIX cap, the 402/409/410 handling, RewardReveal, the coin wallet.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAvatar } from '../state/avatar';

import { brand, nbInk, space, useTheme, useThemedType } from '../theme';
import RewardReveal from '../components/RewardReveal';
import { BackButton, Button, PANEL_INK } from '../components/ui';
import { getItem, SLOTS } from '../config/cosmetics';
import { isHiddenId } from '../config/hiddenCosmetics';
import { RARITY_COLOR } from '../components/RewardArt';
import BuyEnergySheet from '../components/BuyEnergySheet';
import PitStopScene from '../components/shop/PitStopScene';
import ShopProductCard from '../components/shop/ShopProductCard';
import RestockTimer from '../components/shop/RestockTimer';
import ProductPlacard from '../components/shop/ProductPlacard';
import ShopWallet from '../components/shop/ShopWallet';
import { PIT_STOP_ANIM, shopSceneLayout } from '../config/pitStop';
import { IAP_ENABLED } from '../config/releaseFeatures';
import { haptic } from '../ui/motion';
import { toast } from '../ui/toast';
import { TIP, useTutorialTip } from '../tutorial';

const SLOT_ORDER = Object.fromEntries(SLOTS.map((s, index) => [s.key, index]));
const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

// THE SHELF IS ALWAYS THIS BIG. Three rows of three, every window, whatever
// the server sends.
const SHELF_SIZE = 9;
// Which nine, when the server sends more. The app talks to a DEPLOYED
// backend, so it will keep receiving the old twelve until the new coins.py
// ships — and a plain slice of a rarity-sorted list would hand back nine
// commons and rares and drop the legendary, which is the one item on the
// shelf anybody is saving for.
//
// This mirrors coins.py's FEATURED_MIX. Both being 9 is the point: once the
// backend rotates nine, every item it sends survives this filter untouched.
const SHELF_MIX = { common: 4, rare: 3, epic: 1, legendary: 1 };

// How long the Water Point gets to react to a purchase (the crew's pop, the
// placard's confetti) before RewardReveal's full-screen modal takes the
// payoff over.
const REACTION_MS = 400;

// The Water Point's own blue, sampled off the movie's counter: the selected
// card, the card outlines and the restock pill. Pink stays the Buy button.
const WATER_BLUE = '#0A86E0';
// The panel's rounded top; the movie runs on behind its corners.
const PANEL_RADIUS = 28;
const GRID_GAP = 10;
// Room under the grid for the docked placard, so the last row can scroll
// clear of it.
const PLACARD_ROOM = 190;

export default function ShopScreen() {
  // One card, the first time this screen is opened. See src/tutorial/tips.js.
  useTutorialTip(TIP.SHOP);
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [screenH, setScreenH] = useState(window.height);
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
  const revealTimer = useRef(null);

  useEffect(() => () => {
    clearTimeout(resetTimer.current);
    clearTimeout(revealTimer.current);
  }, []);

  // The server owns rotation and prices; the client adds its stat/pass unlock
  // knowledge so the shop never offers a Buy button for an already-equippable
  // item. Sort by rarity, then wearable slot, then the visible name.
  // Hidden items (hiddenCosmetics.js) are dropped here as well as from the
  // server's catalogue, so a backend that has not been redeployed since an
  // item was hidden still cannot put it on the shelf.
  const items = useMemo(() => (data?.items || [])
    .filter((item) => !isHiddenId(item.item_id))
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
  // the placard with a live buy button.
  const selected = useMemo(
    () => shown.find((i) => i.item_id === selectedId) || null,
    [shown, selectedId]
  );
  // A rotation can land while the placard is open — drop a selection that is
  // no longer on sale rather than leaving a dead buy button on screen.
  useEffect(() => {
    if (selectedId && data && !shown.some((i) => i.item_id === selectedId)) setSelectedId(null);
  }, [shown, selectedId, data]);

  const selectedCat = selected?.cat || null;
  const affordable = !!selected && coins >= selected.price;

  const select = useCallback((id) => {
    haptic.light();
    setSelectedId((cur) => (cur === id ? null : id));
  }, []);

  const buy = useCallback(async () => {
    if (!selected || selected.owned || purchase.status === 'pending') return;
    setPurchase((p) => ({ ...p, status: 'pending' }));
    try {
      const res = await api.buyCosmetic(selected.item_id);
      haptic.success();
      // The purchase gets the same payoff the pass tiers get — held back a
      // beat so the Water Point gets to react first (see REACTION_MS above)
      // rather than the reveal's full-screen modal cutting the scene off
      // mid-celebration. A toast that is gone in two seconds is a receipt;
      // buying a legendary should land like opening one.
      const rewardPayload = {
        rewards: [
          {
            kind: 'cosmetic',
            key: `${selected.slot}:${selected.item_id}`,
            label: getItem(selected.slot, selected.item_id)?.label || selected.item_id,
          },
        ],
        accent: RARITY_COLOR[selected.rarity] || brand.pink,
      };
      clearTimeout(revealTimer.current);
      revealTimer.current = setTimeout(() => setReveal(rewardPayload), REACTION_MS);
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
      // Held at least as long as the scene's own celebration (the crew's pop,
      // or the rarer reveal beat) so the purchase status does not flip back
      // to idle mid-animation.
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

  const headroom = insets.top + space.xs + 38 + space.sm;
  const { cropTop, panelTop } = shopSceneLayout({ width: window.width, height: screenH, headroom });

  // Three across on a phone, four once there is room for four readable cards.
  const columns = window.width >= 600 ? 4 : 3;
  const cardWidth = Math.floor(
    (window.width - space.gutter * 2 - GRID_GAP * (columns - 1)) / columns
  );
  const disabled = purchase.status === 'pending';

  const renderCard = useCallback(({ item }) => (
    <ShopProductCard
      item={item}
      width={cardWidth}
      accent={WATER_BLUE}
      selected={selectedId === item.item_id}
      equipped={!!item.owned && equipped?.[item.slot] === item.item_id}
      disabled={disabled}
      onSelect={select}
    />
  ), [cardWidth, selectedId, equipped, disabled, select]);

  // THE HEADER: back on the left, purse on the right, floating over the
  // movie. There is no title: the stall's own sign says "Water point". The
  // native bar is off for this screen (App.js), so the row pays the
  // status-bar inset itself, exactly once. Both controls are white tiles with
  // fixed dark ink whatever the scheme, because the sky behind them is the
  // same movie in both.
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space.xs }]} pointerEvents="box-none">
      <BackButton onPress={() => navigation.goBack()} fill="#fff" ink={PANEL_INK} size={38} />
      <ShopWallet
        coins={data ? coins : null}
        fill="#fff"
        ink={PANEL_INK}
        onGetMore={IAP_ENABLED ? () => setGetMore(true) : undefined}
      />
    </View>
  );

  let empty = null;
  if (!data && loading) {
    empty = <ActivityIndicator color={WATER_BLUE} style={{ marginTop: space.xl }} />;
  } else if (!data && error) {
    empty = (
      <View style={styles.empty}>
        <Text style={[type.body, { textAlign: 'center' }]}>Couldn't load the shop.</Text>
        <Button title="Try again" size="sm" full={false} onPress={load} style={{ marginTop: space.md }} />
      </View>
    );
  } else if (shown.length === 0) {
    empty = (
      <Text style={[type.body, styles.empty, { color: colors.textMuted, textAlign: 'center' }]}>
        The station is restocking. Check back when the clock runs out.
      </Text>
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.bg }}
      onLayout={(e) => setScreenH(e.nativeEvent.layout.height)}
    >
      {focused ? <StatusBar barStyle="dark-content" /> : null}

      {/* THE WATER POINT. Drawn a panel radius past the panel's top edge so
          the movie runs on behind its rounded corners. Takes no touches. */}
      <View style={[styles.scene, { height: panelTop + PANEL_RADIUS }]} pointerEvents="none">
        <PitStopScene
          selectedProductId={selectedId}
          selectedRarity={selected?.rarity || null}
          isSelectedUnavailable={!!selected && (selected.owned || !affordable)}
          purchaseStatus={purchase.status}
          active={focused}
          cropTop={cropTop}
          height={panelTop + PANEL_RADIUS}
        />
      </View>

      {/* THE STOREFRONT, pulled out from under the counter. */}
      <View
        style={[
          styles.panel,
          { top: panelTop, backgroundColor: colors.bg, borderColor: nbInk(scheme, colors.bg) },
        ]}
      >
        {empty || (
          <FlatList
            data={shown}
            key={`cols-${columns}`}
            numColumns={columns}
            keyExtractor={(item) => item.item_id}
            renderItem={renderCard}
            columnWrapperStyle={{ gap: GRID_GAP }}
            contentContainerStyle={[
              styles.grid,
              { paddingBottom: (selected ? PLACARD_ROOM : 0) + insets.bottom + space.lg },
            ]}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={(
              <RestockTimer expiresAt={data?.expires_at} onExpire={load} accent={WATER_BLUE} />
            )}
            ListFooterComponentStyle={{ marginTop: space.sm }}
          />
        )}
      </View>

      {header}

      {/* What you picked, docked to the bottom of the screen over the grid:
          the runner wearing it, the price, and the one button that spends. */}
      {selected ? (
        <ProductPlacard
          item={selected}
          cat={selectedCat}
          affordable={affordable}
          coins={data ? coins : null}
          pending={purchase.status === 'pending'}
          celebrating={purchase.status === 'success'}
          purchaseTick={purchase.tick}
          equipped={equipped}
          onBuy={buy}
          onClose={() => setSelectedId(null)}
          bottomInset={insets.bottom}
        />
      ) : null}

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
  scene: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  panel: {
    position: 'absolute',
    // Pulled a stroke wider than the screen so the side strokes fall off the
    // edge and only the rounded top reads as the panel's lip.
    left: -2.5,
    right: -2.5,
    bottom: 0,
    borderTopLeftRadius: PANEL_RADIUS,
    borderTopRightRadius: PANEL_RADIUS,
    borderTopWidth: 2.5,
    borderLeftWidth: 2.5,
    borderRightWidth: 2.5,
    overflow: 'hidden',
  },
  grid: { paddingHorizontal: space.gutter + 2.5, paddingTop: space.lg, gap: GRID_GAP },
  empty: { marginTop: space.xl, paddingHorizontal: space.gutter, alignItems: 'center' },
});
