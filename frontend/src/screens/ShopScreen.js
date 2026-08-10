// ShopScreen — the PASER water point: a race-day hydration station where the
// rotating stock is sold over the counter.
//
// Twelve items at a time on a 12-hour clock, not the whole 155-item
// catalogue: a shop you can exhaust in one sitting has no reason to be
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
import { brand, radius, space, useTheme, useThemedType, withAlpha } from '../theme';
import RewardReveal from '../components/RewardReveal';
import { Card, Row, Screen, Skeleton, Button } from '../components/ui';
import { PartThumb } from '../components/character/CharacterRig';
import { getItem, SLOTS } from '../config/cosmetics';
import { RARITY_COLOR } from '../components/RewardArt';
import AppIcon from '../components/AppIcon';
import GameAnimation, { AnimationStack } from '../components/GameAnimation';
import BuyEnergySheet from '../components/BuyEnergySheet';
import PitStopScene from '../components/shop/PitStopScene';
import { PIT_STOP_ANIM } from '../config/pitStop';
import { CountUpText, haptic, Reveal, useReduceMotion } from '../ui/motion';
import { toast } from '../ui/toast';

const SLOT_LABEL = Object.fromEntries(SLOTS.map((s) => [s.key, s.label]));

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
    <Row gap={6} style={[styles.timer, { backgroundColor: colors.cardAlt, borderColor: colors.border }]}>
      <AppIcon name="timer" size={16} />
      <Text style={[type.captionMedium, { color: colors.textMuted }]}>
        Fresh stock in {expiresAt ? text : '·'}
      </Text>
    </Row>
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
        style={[
          styles.cell,
          {
            backgroundColor: selected ? colors.cardAlt : colors.card,
            borderColor: selected ? tint : item.owned ? colors.border : tint,
            borderWidth: selected ? 2.5 : 1.5,
          },
          item.owned && { opacity: 0.55 },
        ]}
        onPress={() => onSelect(item.item_id)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ selected, disabled: !!disabled }}
        accessibilityLabel={`${cat?.label || item.item_id}, ${item.rarity}, ${
          item.owned ? 'owned' : `${item.price} coins`
        }`}
        accessibilityHint={item.owned ? undefined : 'Shows the item details and the buy button'}
      >
        {/* Art and price only. Rarity still reads off the cell's tinted
            border, and is spelled out in the panel below. */}
        <PartThumb slot={item.slot} item={cat} size={56} />
        {item.owned ? (
          <Text style={[type.caption, { color: colors.textMuted }]}>Owned</Text>
        ) : (
          <Row gap={4}>
            <AppIcon name="coin" size={14} />
            <Text style={[type.captionMedium, { color: colors.text }]}>{item.price}</Text>
          </Row>
        )}
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
  affordable,
  pending,
  celebrating,
  purchaseTick,
  onBuy,
  onClose,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const tint = RARITY_COLOR[item.rarity] || colors.border;
  // Rare and above gets the burst behind the confetti. The gate is what keeps
  // a common restock from looking like a jackpot.
  const rare = item.rarity && item.rarity !== 'common';

  const status = item.owned
    ? 'Owned'
    : affordable
      ? `${item.price} coins`
      : `Not enough coins, ${item.price} needed`;

  return (
    <Reveal from="down" duration={220}>
      <Card style={[styles.panel, { borderColor: tint }]}>
        <View style={styles.panelArt}>
          {/* The glow is the rarity, read at a glance and before the words. */}
          <View
            style={[styles.panelGlow, { backgroundColor: withAlpha(tint, 0.16), borderColor: withAlpha(tint, 0.5) }]}
            pointerEvents="none"
          />
          <PartThumb slot={item.slot} item={cat} size={64} />
          {celebrating ? (
            <AnimationStack
              names={rare ? ['rewardBurst', 'confettiBurst'] : ['confettiBurst']}
              size={140}
              trigger={purchaseTick}
              style={styles.panelFx}
            />
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={type.bodyBold} numberOfLines={1}>
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
        <View style={{ gap: space.sm, alignItems: 'flex-end' }}>
          <Button
            title={item.owned ? 'Owned' : 'Buy'}
            size="sm"
            full={false}
            variant={item.owned || !affordable ? 'secondary' : 'gradient'}
            loading={pending}
            disabled={item.owned || !affordable || pending}
            onPress={onBuy}
          />
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close item details"
            hitSlop={10}
          >
            <Text style={[type.caption, { color: colors.textDim }]}>Close</Text>
          </TouchableOpacity>
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
  const focused = useIsFocused();
  const { equipped, refreshUnlocks } = useAvatar();
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

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const items = data?.items || [];
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

  const selectedCat = selected ? getItem(selected.slot, selected.item_id) : null;
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
      if (e.status === 402) toast.error('Not enough coins');
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
      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: space.xxl }}
      >
        <View onLayout={(e) => setSceneH(e.nativeEvent.layout.height)}>{scene}</View>

        <View style={{ padding: space.gutter, gap: space.md }}>
          {/* What you picked, ABOVE your balance — see SelectedProductPanel. */}
          {selected ? (
            <SelectedProductPanel
              item={selected}
              cat={selectedCat}
              affordable={affordable}
              pending={purchase.status === 'pending'}
              celebrating={purchase.status === 'success'}
              purchaseTick={purchase.tick}
              onBuy={buy}
              onClose={() => setSelectedId(null)}
            />
          ) : null}

          {/* balance + top-up. Held back until the real balance arrives — a
              placeholder 0 reads as "you're broke", not as "still loading". */}
          {data ? (
            <Card style={styles.wallet}>
              <Row gap={8} style={{ alignItems: 'center', flex: 1 }}>
                <AppIcon name="coin" size={28} />
                <View>
                  {/* The balance counts down to what a purchase left you with
                      rather than swapping numbers behind the panel. Spending
                      is the one thing this screen does, so it should be the
                      thing you can see happen. */}
                  <CountUpText
                    value={coins}
                    durationMs={620}
                    style={[type.title, { color: '#eab308' }]}
                  />
                  <Text style={[type.caption, { color: colors.textMuted }]}>
                    Earn coins on every run and level
                  </Text>
                </View>
              </Row>
              <Button title="Get more" size="sm" full={false} onPress={() => setGetMore(true)} />
            </Card>
          ) : (
            <Skeleton width="100%" height={76} style={{ borderRadius: radius.card }} />
          )}

          {loading ? (
            <>
              <Skeleton width="100%" height={120} style={{ borderRadius: radius.card }} />
              <Skeleton width="100%" height={120} style={{ borderRadius: radius.card }} />
            </>
          ) : items.length === 0 ? (
            <Text style={[type.body, { color: colors.textMuted, textAlign: 'center', marginTop: space.lg }]}>
              The station is restocking. Check back when the clock runs out.
            </Text>
          ) : (
            <View style={styles.grid}>
              {items.map((item) => (
                <ShopProductCard
                  key={item.item_id}
                  item={item}
                  cat={getItem(item.slot, item.item_id)}
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
      </ScrollView>

      <BuyEnergySheet
        visible={getMore}
        onClose={() => setGetMore(false)}
        onPurchased={load}
      />

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
  wallet: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  timer: {
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
    paddingVertical: space.sm, paddingHorizontal: space.lg,
    marginTop: space.sm,
    borderRadius: radius.pill, borderWidth: 1,
  },
  grid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
  },
  cellWrap: { width: '31.5%', marginBottom: space.md },
  cell: {
    width: '100%', alignItems: 'center', gap: 4,
    paddingTop: space.md, paddingBottom: space.md,
    borderRadius: radius.card,
  },
  panel: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    borderWidth: 1.5,
  },
  // The art sits in a fixed square so the name column starts in the same place
  // whatever the item is, and so the burst has a centre to fire from.
  panelArt: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  panelGlow: { ...StyleSheet.absoluteFillObject, borderRadius: radius.card, borderWidth: 1.5 },
  // Overflows its 72pt square on purpose — a burst confined to the art box is
  // a rectangle of confetti, not an explosion.
  panelFx: { position: 'absolute', left: -34, top: -34 },
  panelCoin: { position: 'absolute', right: -6, top: -14 },
  rarityDot: { width: 8, height: 8, borderRadius: 4 },
});
