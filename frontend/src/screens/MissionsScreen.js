// Missions — four things to do today, and a box for doing all four.
//
// THE PAGE IS THE DAY, NOT A LIST. A week strip picks which day you are
// looking at, a banner says how far through that day you are and what
// finishing it pays, and the missions themselves sit under it. Everything on
// screen belongs to one date, which is why the strip is at the top rather than
// filed away as a filter.
//
// NOTHING HERE POSTS PROGRESS. The server derives every bar from what actually
// happened (see backend/app/missions.py); this screen only ever asks to be
// PAID. That is what makes a past day openable and payable: the run you did on
// Tuesday is still in the runs table on Friday, so Tuesday's bar is still full
// and its coins are still there.
//
// THE BONUS IS A BOX, AND THE BOX IS THE GAMBLE. Collecting the day bonus
// grants an unopened box and drops straight into the tap to upgrade screen, so
// the reward for a finished day is the app's best moment rather than a fifth
// pile of coins.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from '../ui/image';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { useQuery } from '../hooks/useQuery';
import { useAccent } from '../hooks/useAccent';
import { useAvatar } from '../state/avatar';
import AppIcon from '../components/AppIcon';
import Chest from '../components/lootbox/Chest';
import { BackButton, Card, HardShadow, Row, Screen, Skeleton } from '../components/ui';
import { ProgressTrack } from '../components/ui/toon';
import MissionCard from '../components/missions/MissionCard';
import CoinFly from '../components/missions/CoinFly';
import LootboxGamble from '../components/lootbox/LootboxGamble';
import { rollCosmetic } from '../config/lootboxRoll';
import { toast } from '../ui/toast';
import { CountUpText, Pulse, Reveal, haptic, useReduceMotion } from '../ui/motion';
import { NB, brand, fonts, nbRadius, space, useTheme, useThemedType, withAlpha } from '../theme';

// The user's board art: wood frame, carved "Daily Missions" title, and a torn
// parchment sheet. It owns the screen chrome now; mission UI is laid over the
// blank paper instead of living under a separate purple header.
const MISSIONS_BG = require('../../assets/art/panel/missions-board.png');

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Wednesday" from a YYYY-MM-DD, without dragging in a date library. */
function dayName(iso, today) {
  if (!iso) return 'today';
  if (iso === today) return 'today';
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * The banner: how far through the day, and the box waiting at the end of it.
 *
 * It is the only thing on the page that is ever gold, which is what makes the
 * finished state impossible to walk past.
 */
function DayBanner({ state, label, accent, busy, onClaim, chestRef }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const reduced = useReduceMotion();
  const ready = state.all_complete && !state.bonus_claimed;
  const done = state.bonus_claimed;

  // THE SAME BOX THE PASS DRAWS. This banner used to show the per-rarity crate
  // PNG, which is the one place in the app still doing that — the pass's
  // pending-box row and every lootbox reward tile moved to the animated gift
  // box long ago (see RewardArt), so the box you tap here looked nothing like
  // the box you get. It moves only when there is one to collect: a chest
  // jiggling at 0/4 is advertising something you cannot have yet.
  //
  // `still` rather than nothing under Reduce Motion, and whenever the day is
  // unfinished — the box IS the reward, so it has to be on screen either way.
  const chest = (
    <View ref={chestRef} collapsable={false} style={styles.chestSlot}>
      <Chest width={54} />
    </View>
  );

  return (
    <Card
      style={[
        styles.banner,
        ready && { borderColor: colors.ok, backgroundColor: withAlpha(colors.ok, 0.14) },
      ]}
      onPress={ready && !busy ? onClaim : undefined}
      accessibilityLabel={
        ready
          ? `Every mission for ${label} is done. Collect your box.`
          : `${state.complete_count} of ${state.total} missions done for ${label}.`
      }
    >
      <Row gap={space.md} style={styles.bannerRow}>
        <View style={styles.bannerText}>
          <Text style={[type.bodyBold, { color: colors.text }]}>
            {done
              ? `${label}'s box is yours`
              : ready
                ? `Collect ${label}'s box`
                : `Finish every mission for ${label}'s box`}
          </Text>
          <View style={styles.bannerTrack}>
            <ProgressTrack
              value={state.total ? state.complete_count / state.total : 0}
              height={16}
              fill={ready || done ? colors.ok : accent || brand.pink}
              on={colors.card}
            />
            <Text style={[styles.bannerPair, { color: colors.text }]}>
              {`${state.complete_count}/${state.total}`}
            </Text>
          </View>
        </View>
        {ready && !busy ? <Pulse min={1} max={1.09} durationMs={1100}>{chest}</Pulse> : chest}
      </Row>
    </Card>
  );
}

export default function MissionsScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const accent = useAccent();
  const { equipped, isUnlocked, refreshUnlocks } = useAvatar();

  // Which day is on screen. Null means today, which is also what the endpoint
  // defaults to, so the common case sends no parameter and shares one cache
  // key with everything else that wants today.
  const day = null;
  const key = day ? `me:missions:${day}` : 'me:missions';
  const { data, loading, error, refresh, setData } = useQuery(
    key,
    useCallback(() => api.missions(day), [day])
  );

  // The purse is the WALLET: the same `me:coins` entry the Shop reads, so the
  // two screens show one number rather than two that can disagree.
  const { data: wallet, setData: setWallet } = useQuery('me:coins', api.shop);

  const [busy, setBusy] = useState(null);
  const [gamble, setGamble] = useState(null);

  // Coin flight endpoints, measured rather than guessed: the card can be
  // anywhere down a scrolling page and the counter moves with the safe area.
  const [flight, setFlight] = useState(0);
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const purseRef = useRef(null);
  const cardRects = useRef({});

  const measurePurse = useCallback(() => {
    purseRef.current?.measureInWindow?.((x, y, w, h) => {
      setTo({ x: x + w / 2, y: y + h / 2 });
    });
  }, []);

  const claim = useCallback(async (mission) => {
    if (busy) return;
    setBusy(mission.id);
    try {
      const res = await api.claimMission(mission.id, day);
      haptic.success();
      // Throw the coins from the card that paid them.
      const rect = cardRects.current[mission.id];
      if (rect && to) {
        setFrom({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
        setFlight((n) => n + 1);
      }
      // Pay the purse off the response, on the frame the coins leave the
      // card. `coins` is the balance the server just wrote; a server too old
      // to send it is covered by adding the reward, which is the same number
      // because a grant is never clipped. Written through the shared
      // `me:coins` entry, so the Shop shows it too with no refetch.
      setWallet((prev) => (prev
        ? { ...prev, coins: res.coins ?? prev.coins + (res.reward || 0) }
        : prev));
      // Every board that counts coins earned is now wrong.
      invalidate('me:stats');
      // The claim response already IS this day, freshly derived. Writing it
      // beats re-asking the server for what it just told us, and it means the
      // card settles on the same frame the coins leave it.
      setData((prev) => (prev && res.day === prev.day ? { ...prev, ...res } : prev));
      invalidate('me:missions');
    } catch (e) {
      // A 409 or 403 means this screen is behind what the server knows —
      // another device collected it, or the run that finished the mission was
      // still in flight. Re-reading is the fix, not an error message.
      if (e.status === 409 || e.status === 403) refresh();
      else toast.error(e.message || 'Could not collect that');
    } finally {
      setBusy(null);
    }
  }, [busy, day, to, refresh, setData, setWallet]);

  const claimBonus = useCallback(async () => {
    if (busy) return;
    setBusy('bonus');
    try {
      await api.claimMissionBonus(day);
      haptic.success();
      // Straight into the gamble. The box IS the reward, and a toast saying
      // one was added to a list somewhere is how this moment gets thrown away.
      const sequence = await api.openLootbox();
      const rarity = sequence.final_rarity || sequence.rarity;
      const roll = rollCosmetic(rarity, isUnlocked);
      await api.addUnlock(roll.item.id);
      invalidate('me:missions');
      invalidate('me:progression');
      refresh();
      setGamble({
        ...sequence,
        reward: { kind: 'cosmetic', key: `${roll.slot}:${roll.item.id}`, label: roll.item.label },
      });
      refreshUnlocks?.();
    } catch (e) {
      if (e.status === 409 || e.status === 403) refresh();
      else toast.error(e.message || 'Could not collect the box');
    } finally {
      setBusy(null);
    }
  }, [busy, day, isUnlocked, refresh, refreshUnlocks]);

  const onCollect = useCallback(() => {
    setGamble(null);
  }, []);

  const state = data;
  const label = useMemo(
    () => dayName(state?.day, state?.today),
    [state?.day, state?.today]
  );

  // Your balance, the same number the Shop's purse shows. It used to be what
  // the selected DAY had paid, which put two different coin figures in front
  // of one player and read as the wallet being wrong. Null until the balance
  // lands, drawn as `·`: a placeholder 0 reads as "you are broke".
  const coins = wallet?.coins ?? null;
  const titleTop = Math.max(insets.top + 52, height * 0.067);
  const paperTop = Math.max(insets.top + 132, height * 0.15);
  const paperSide = Math.max(40, width * 0.11);
  const boardSide = Math.max(36, width * 0.1);

  // Keep the coin-flight destination in the fixed header.
  const purse = (
    <HardShadow offset={NB.offsetSm} radius={nbRadius.sm} on="#fff" style={styles.purseWrap}>
      <View
        ref={purseRef}
        collapsable={false}
        onLayout={measurePurse}
        style={styles.purse}
        accessible
        accessibilityLabel={coins == null ? 'Your coins' : `You have ${coins.toLocaleString()} coins`}
      >
        <AppIcon name="coin" size={18} />
        {coins == null ? (
          <Text style={[styles.purseText, styles.purseEmpty]}>·</Text>
        ) : (
          // Counts like the Shop's purse, so a claim is watched landing.
          <CountUpText value={coins} durationMs={1200} style={styles.purseText} />
        )}
      </View>
    </HardShadow>
  );

  return (
    <Screen gutter={false} edges={[]} style={styles.screen}>
      {/* The wanted-poster board. Behind everything: it's the first child, so
          the header and the scrolling body (both painted after it) sit on
          top of it. Non-interactive and absolutely filled, same as the other
          page backdrops (SceneBackdrop, PassBackdrop) — it adds no layout
          height of its own. */}
      <Image
        source={MISSIONS_BG}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        fadeDuration={0}
        pointerEvents="none"
      />

      <View
        pointerEvents="box-none"
        style={[styles.boardTop, { top: titleTop, left: boardSide, right: boardSide }]}
      >
        {navigation?.canGoBack?.() ? (
          <BackButton
            onPress={() => navigation.goBack()}
            fill="#F6D797"
            on="#8A4614"
            ink="#3A1D0A"
            size={36}
            style={styles.boardBack}
          />
        ) : null}
        {purse}
      </View>

      <Screen
        scroll
        edges={['bottom']}
        style={[styles.body, styles.transparent]}
        contentStyle={[
          styles.paperContent,
          { paddingTop: paperTop, paddingHorizontal: paperSide },
        ]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => refresh()} tintColor={accent} />}
      >
        {loading && !state ? (
          <View style={styles.skeletons}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={i === 0 ? 78 : 92} style={{ marginTop: space.md }} />
            ))}
          </View>
        ) : null}

        {error && !state ? (
          <Card style={styles.error}>
            <Text style={[type.body, { color: colors.textMuted }]}>
              Missions could not load. Pull down to try again.
            </Text>
          </Card>
        ) : null}

        {state ? (
          <>
            <Reveal from="none">
              <DayBanner
                state={state}
                label={label}
                accent={accent}
                busy={busy === 'bonus'}
                onClaim={claimBonus}
              />
            </Reveal>

            {state.missions.map((mission, i) => (
              <Reveal key={mission.id} delay={i * 50} from="none">
                <MissionCard
                  mission={mission}
                  accent={accent}
                  busy={busy === mission.id}
                  onClaim={() => claim(mission)}
                  onLayout={(e) => {
                    // measureInWindow, not the layout rect: the card's own
                    // layout is relative to the scroll content, and the coins
                    // are drawn in screen space over everything.
                    e.currentTarget?.measureInWindow?.((x, y, w, h) => {
                      cardRects.current[mission.id] = { x, y, w, h };
                    });
                  }}
                />
              </Reveal>
            ))}

            <Text style={[type.caption, { color: colors.textDim, marginTop: space.lg }]}>
              New missions every day at midnight.
            </Text>
          </>
        ) : null}
      </Screen>

      <CoinFly from={from} to={to} flight={flight} />

      <LootboxGamble
        visible={!!gamble}
        sequence={gamble}
        reward={gamble?.reward}
        onCollect={onCollect}
        onClose={() => setGamble(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Transparent so the wanted-poster board painted behind it shows through
  // instead of the theme's flat page colour.
  screen: { backgroundColor: 'transparent' },
  transparent: { backgroundColor: 'transparent' },
  body: { flex: 1 },
  paperContent: {
    paddingBottom: space.xl,
  },
  skeletons: { marginTop: space.sm },
  error: { marginTop: space.md },

  boardTop: {
    position: 'absolute',
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  boardBack: { marginTop: 2 },
  purseWrap: { flexShrink: 0, alignSelf: 'flex-start' },
  purse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: space.sm,
    backgroundColor: '#F6D797',
    borderColor: '#3A1D0A',
    borderWidth: NB.stroke,
    borderRadius: nbRadius.sm,
  },
  purseText: { fontFamily: fonts.bold, fontSize: 15, color: '#3A1D0A' },
  purseEmpty: { color: withAlpha('#3A1D0A', 0.45) },

  banner: { padding: space.md, borderWidth: 2 },
  bannerRow: { alignItems: 'center' },
  bannerText: { flex: 1 },
  bannerTrack: { marginTop: space.sm, justifyContent: 'center' },
  bannerPair: {
    position: 'absolute',
    alignSelf: 'center',
    fontFamily: fonts.bold,
    fontSize: 11,
  },
  chestSlot: { width: 58, alignItems: 'center' },
});
