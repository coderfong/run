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
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { invalidate } from '../api/cache';
import { useQuery } from '../hooks/useQuery';
import { useAccent } from '../hooks/useAccent';
import { useAvatar } from '../state/avatar';
import AppIcon from '../components/AppIcon';
import GameAnimation from '../components/GameAnimation';
import { Card, HardShadow, PANEL_INK, Row, Screen, Skeleton, ToonHeader } from '../components/ui';
import { ProgressTrack } from '../components/ui/toon';
import DayStrip from '../components/missions/DayStrip';
import MissionCard from '../components/missions/MissionCard';
import CoinFly from '../components/missions/CoinFly';
import LootboxGamble from '../components/lootbox/LootboxGamble';
import RewardReveal from '../components/RewardReveal';
import { RARITY_COLOR } from '../components/RewardArt';
import { rollCosmetic } from '../config/lootboxRoll';
import { toast } from '../ui/toast';
import { Pulse, Reveal, haptic, useReduceMotion } from '../ui/motion';
import { NB, brand, fonts, nbRadius, space, useTheme, useThemedType, withAlpha } from '../theme';

// Cut off its baked indigo ground by scripts/cut-header-art.py, from
// assets/art/ui/header-missions.png.
const MISSIONS_ART = require('../../assets/art/panel/missions.png');

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
      <GameAnimation
        name="giftBox"
        size={54}
        loop={ready && !reduced}
        still={!ready || reduced}
      />
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
  const accent = useAccent();
  const { equipped, isUnlocked, refreshUnlocks } = useAvatar();

  // Which day is on screen. Null means today, which is also what the endpoint
  // defaults to, so the common case sends no parameter and shares one cache
  // key with everything else that wants today.
  const [day, setDay] = useState(null);
  const key = day ? `me:missions:${day}` : 'me:missions';
  const { data, loading, error, refresh, setData } = useQuery(
    key,
    useCallback(() => api.missions(day), [day])
  );

  const [busy, setBusy] = useState(null);
  const [gamble, setGamble] = useState(null);
  const [reveal, setReveal] = useState(null);

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
      // The purse and every board that counts coins are now wrong.
      invalidate('me:coins');
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
  }, [busy, day, to, refresh, setData]);

  const claimBonus = useCallback(async () => {
    if (busy) return;
    setBusy('bonus');
    try {
      await api.claimMissionBonus(day);
      haptic.success();
      // Straight into the gamble. The box IS the reward, and a toast saying
      // one was added to a list somewhere is how this moment gets thrown away.
      const sequence = await api.openLootbox();
      invalidate('me:missions');
      invalidate('me:progression');
      refresh();
      setGamble(sequence);
    } catch (e) {
      if (e.status === 409 || e.status === 403) refresh();
      else toast.error(e.message || 'Could not collect the box');
    } finally {
      setBusy(null);
    }
  }, [busy, day, refresh]);

  // The gamble finished: roll an item of whatever rarity it landed on, keep
  // it, and show it.
  const onOpened = useCallback(async (rarity) => {
    setGamble(null);
    try {
      const roll = rollCosmetic(rarity, isUnlocked);
      await api.addUnlock(roll.item.id);
      setReveal({
        rewards: [{ kind: 'cosmetic', key: `${roll.slot}:${roll.item.id}`, label: roll.item.label }],
        accent: RARITY_COLOR[rarity] || brand.pink,
        fromLootbox: true,
      });
      refreshUnlocks?.();
    } catch (e) {
      toast.error(e.message || 'Could not open that box');
    }
  }, [isUnlocked, refreshUnlocks]);

  const state = data;
  const label = useMemo(
    () => dayName(state?.day, state?.today),
    [state?.day, state?.today]
  );

  // What this day has actually paid. The purse used to read the WORD "Coins"
  // under a coin, which is a label with nothing to say — and it is the thing
  // the collected coins fly into, so it has to be worth landing on. Derived
  // from the missions already on screen rather than from the balance endpoint:
  // the claim response rewrites this day in place, so the number ticks up on
  // the frame the coins leave the card, with no second request and nothing to
  // go stale.
  const collected = useMemo(
    () => (state?.missions || []).reduce((sum, m) => (m.claimed ? sum + (m.reward || 0) : sum), 0),
    [state?.missions]
  );

  // Keep the coin-flight destination in the fixed header.
  const purse = (
    <HardShadow offset={NB.offsetSm} radius={nbRadius.sm} on="#fff" style={styles.purseWrap}>
      <View
        ref={purseRef}
        collapsable={false}
        onLayout={measurePurse}
        style={styles.purse}
        accessible
        accessibilityLabel={`${collected} coins collected ${label === 'today' ? 'today' : `on ${label}`}`}
      >
        <AppIcon name="coin" size={18} />
        <Text style={styles.purseText}>{collected}</Text>
      </View>
    </HardShadow>
  );

  return (
    <Screen gutter={false} edges={[]}>
      {/* The Crossroads header: `compact` puts the chevron in the title row
          and sizes the row by the type rather than the art, and the art is a
          cut-out on the panel's own fill rather than a boxed tile. The purse
          stays in the header because it is where the coins fly to. */}
      <ToonHeader
        panel
        compact
        eyebrow="Missions"
        title={state?.day === state?.today ? 'Today' : label.charAt(0).toUpperCase() + label.slice(1)}
        art={MISSIONS_ART}
        titleStyle={type.display}
        eyebrowStyle={type.labelSm}
        solid={brand.purple}
        top={insets.top}
        onBack={navigation?.canGoBack?.() ? () => navigation.goBack() : undefined}
        style={styles.header}
      >
        <View style={styles.headerFooter}>
          <Text style={styles.subtitle}>Finish all four for a box</Text>
          {purse}
        </View>
      </ToonHeader>

      <Screen
        scroll
        edges={['bottom']}
        style={styles.body}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => refresh()} tintColor={accent} />}
      >
        {state?.week ? (
          <DayStrip
            week={state.week}
            selected={state.day}
            accent={accent}
            onSelect={(d) => setDay(d === state.today ? null : d)}
            style={styles.strip}
          />
        ) : null}

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
        onOpened={onOpened}
        onClose={() => setGamble(null)}
      />
      <RewardReveal
        visible={!!reveal}
        rewards={reveal?.rewards}
        accent={reveal?.accent}
        fromLootbox={!!reveal?.fromLootbox}
        onClose={() => setReveal(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  strip: { marginBottom: space.md },
  skeletons: { marginTop: space.sm },
  error: { marginTop: space.md },

  header: { marginBottom: space.md },
  headerFooter: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  subtitle: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, lineHeight: 20, color: PANEL_INK },
  purseWrap: { flexShrink: 0 },
  // The same white tile the panel's back chevron wears, for the same reason:
  // a panel is a saturated brand fill in both schemes, so its controls are
  // fixed white-on-ink rather than themed.
  purse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: space.sm,
    backgroundColor: '#fff',
    borderColor: PANEL_INK,
    borderWidth: NB.stroke,
    borderRadius: nbRadius.sm,
  },
  purseText: { fontFamily: fonts.bold, fontSize: 15, color: PANEL_INK },

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
