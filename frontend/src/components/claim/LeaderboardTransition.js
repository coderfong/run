// The last beat: the runner dashes off the map and drags the standings in
// behind them.
//
// The wipe is character-led on purpose — this is meant to feel like the same
// person who just took the ground carrying you to the board, not a route
// change. Under Reduce Motion it becomes a plain crossfade with every piece of
// information intact.
//
// Rows are the app's real LeaderboardRow, not a lookalike. Rank movement is
// only ever animated when leaderboardData found a genuine previous rank; with
// nothing trustworthy to show, the row simply states where the runner is now.
//
// THE TRAVEL. The board arrives at the podium and then scrolls, under its own
// power, all the way down to the runner's own slot — past every standing
// between the two — and their row drops into the gap when it stops. That beat
// replaced a staggered fade-in of five rows, and the reason is the number it
// is trying to make felt: 380th of 387 is a DISTANCE, and a list that simply
// appears states it where a list that travels shows it.
//
// Three things it has to keep:
//
//   * There is always somewhere to travel TO. A runner below the fetched top
//     fifty used to be nowhere on their own standings screen; leaderboardData
//     now builds their row from `/leaderboard/standing` and stitches it on
//     under a gap marker, so the board always ends at them.
//   * The landing happens INSIDE the viewport. The row is held out until the
//     scroll has actually stopped, because a row that pops in while the board
//     is still moving lands off screen and is never seen.
//   * The board is measured, not guessed. Row heights move with text size and
//     club tags, so the target comes from the slot's own layout — see
//     TravelBoard.
//
// THE DRESSING. This is a payoff screen, and it used to be typeset like a
// settings page: a heading, five rows, and half a phone of empty cream. The
// decoration added since is all from the kit rather than invented here — the
// sticker marks from ui/Shapes, the hand-drawn banner and label boxes from
// ui/Framed, the burst rays already in the art registry, the hard drop from
// ui/HardShadow. Two rules it has to keep:
//
//   * The marks are BEHIND everything and cheap. A deterministic scatter, laid
//     out once per size, faded in as one layer — not thirty animated views.
//   * A framed box never sits on a fill of its own (see the frame ink note in
//     ui/Framed): the banner and the labels are drawn straight onto the page,
//     and the only filled boxes here are the rows, which are not framed.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  scrollTo,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  brand,
  nbAccents,
  NB,
  nbInk,
  space,
  toon,
  toonType,
  useTheme,
  useThemedType,
  withAlpha,
} from '../../theme';
import { art } from '../../config/onboardingArt';
import { Image } from '../../ui/image';
import { INK, framePose, frameVariant } from '../../ui/frameRegistry';
import { CharacterBust } from '../character/CharacterRig';
import { LeaderboardRow } from '../LeaderboardView';
import { Framed, HardShadow, OutlinedText, Shape, ToonButton } from '../ui';
import { GAP_ID } from './leaderboardData';
import { timingFor } from './timing';

const DASH_SIZE = 56;
// The runner who took the ground, stood beside the Done button. Big enough to
// read as a character rather than an avatar chip.
const FOOTER_BUST = 72;

// The sticker scatter behind the board.
//
// Fractions of the screen, not points, so the same layout works on an SE and a
// Pro Max. Authored to stay OUT of the middle band where the rows land: these
// are wallpaper, and a burst behind a username makes the username harder to
// read for no gain. Sizes are in points and deliberately mixed — a scatter of
// one size reads as a pattern rather than as confetti.
const CONFETTI = [
  { name: 'burst', size: 74, x: 0.02, y: 0.055, rotate: -14, color: nbAccents.yellow },
  { name: 'sparkle', size: 30, x: 0.84, y: 0.03, rotate: 8, color: nbAccents.teal },
  { name: 'star', size: 44, x: 0.9, y: 0.115, rotate: 16, color: nbAccents.magenta },
  { name: 'squiggle', size: 52, x: 0.07, y: 0.165, rotate: -6, color: nbAccents.blue },
  { name: 'daisy', size: 38, x: 0.93, y: 0.63, rotate: 0, color: nbAccents.coral },
  { name: 'cross', size: 26, x: 0.03, y: 0.55, rotate: 12, color: nbAccents.purple },
  { name: 'star', size: 34, x: 0.06, y: 0.79, rotate: -18, color: nbAccents.teal },
  { name: 'bolt', size: 48, x: 0.88, y: 0.84, rotate: 10, color: nbAccents.yellow },
  { name: 'disc', size: 18, x: 0.5, y: 0.955, rotate: 0, color: nbAccents.magenta },
  { name: 'sparkle', size: 24, x: 0.19, y: 0.925, rotate: -10, color: nbAccents.lilac },
];

// Faint on purpose. These have to survive being drawn over a cream page and
// under a dark one, and anything louder competes with the rows.
const CONFETTI_OPACITY = 0.16;

// `bleed` cancels the content wrapper's gutter and safe-area padding. Without
// it the marks are laid out in the padding box while their coordinates are
// fractions of the SCREEN, so the whole scatter slides inward and the ones on
// the right run off the edge. It lives inside that wrapper rather than beside
// it so it fades in with the board instead of over the map during the wipe.
function Confetti({ width, height, bleed, reducedMotion, playToken }) {
  const { colors } = useTheme();
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = 0;
    enter.value = withDelay(
      reducedMotion ? 0 : 220,
      withTiming(1, { duration: reducedMotion ? 160 : 420 })
    );
  }, [playToken, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const style = useAnimatedStyle(() => ({ opacity: enter.value * CONFETTI_OPACITY }));

  // Laid out once per screen size. Re-rolling this on every render is what
  // would make the marks crawl as the rows land behind them.
  const marks = useMemo(
    () =>
      CONFETTI.map((mark, index) => (
        <View
          key={`${mark.name}-${index}`}
          style={{
            position: 'absolute',
            left: Math.round(width * mark.x),
            top: Math.round(height * mark.y),
          }}
        >
          <Shape
            name={mark.name}
            size={mark.size}
            color={mark.color}
            on={colors.bg}
            weight={NB.strokeThin}
            rotate={mark.rotate}
          />
        </View>
      )),
    [width, height, colors.bg]
  );

  return (
    <Animated.View style={[styles.confetti, bleed, style]} pointerEvents="none">
      {marks}
    </Animated.View>
  );
}

// Counts from one rank to another over ~450ms. Small deltas only ever need a
// few steps, so this stays a handful of state updates rather than a per-frame
// animation.
function useRankCounter(from, to, enabled) {
  const [value, setValue] = useState(to);
  const timers = useRef(new Set());

  useEffect(() => {
    const set = timers.current;
    set.forEach(clearTimeout);
    set.clear();

    if (!enabled || from == null || to == null || from === to) {
      setValue(to);
      return () => {
        set.forEach(clearTimeout);
        set.clear();
      };
    }

    const steps = Math.min(Math.abs(from - to), 12);
    const step = (to - from) / steps;
    setValue(from);
    for (let i = 1; i <= steps; i++) {
      const id = setTimeout(() => {
        setValue(i === steps ? to : Math.round(from + step * i));
      }, 320 + i * 45);
      set.add(id);
    }

    return () => {
      set.forEach(clearTimeout);
      set.clear();
    };
  }, [from, to, enabled]);

  return value;
}

// The rank, on a medallion. The burst is the mark this whole style puts behind
// a number that matters, and it is the piece that turns "#3" from a label into
// the point of the screen.
function PlayerSummary({ data, reducedMotion }) {
  const { colors, scheme } = useTheme();
  const hasMovement = data?.rankDelta != null && data.rankDelta !== 0;
  const rank = useRankCounter(data?.previousRank, data?.newRank, hasMovement && !reducedMotion);

  const pop = useSharedValue(0);
  useEffect(() => {
    pop.value = 0;
    pop.value = withDelay(
      reducedMotion ? 0 : 200,
      reducedMotion
        ? withTiming(1, { duration: 160 })
        : withSpring(1, { damping: 11, stiffness: 190, mass: 0.7 })
    );
  }, [data?.newRank, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const medallionStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ scale: 0.7 + pop.value * 0.3 }],
  }));

  if (!data?.newRank) return null;

  const up = data.rankDelta > 0;
  const chipFill = hasMovement
    ? (up ? nbAccents.teal : nbAccents.coral)
    : nbAccents.yellow;

  return (
    <View style={styles.summary}>
      <Animated.View style={[styles.medallion, medallionStyle]}>
        <Shape
          name="burst"
          size={132}
          color={nbAccents.yellow}
          on={colors.bg}
          weight={NB.stroke}
        />
        <View style={styles.medallionInner} pointerEvents="none">
          <OutlinedText style={[toonType.hero, styles.summaryRank]} outline={toon.ink} width={3}>
            {`#${rank}`}
          </OutlinedText>
        </View>
      </Animated.View>

      {/* One line under the medallion, and it always says something. Before
          this it went blank for anyone outside the fetched page, which is the
          exact runner most in need of being told where they are. */}
      <Framed
        frame={frameVariant('chip', 'rank-delta')}
        fill={chipFill}
        on={chipFill}
        tint={nbInk(scheme, chipFill)}
        weight={INK.thin}
        pose={framePose('rank-delta')}
        inset={3}
        style={styles.chip}
      >
        <Text style={[toonType.label, { color: nbInk(scheme, chipFill), paddingHorizontal: space.xs }]}>
          {hasMovement
            ? (up
                ? `UP ${data.rankDelta} RANK${data.rankDelta === 1 ? '' : 'S'}`
                : `DOWN ${Math.abs(data.rankDelta)}`)
            : (data.fieldSize
                ? `OF ${data.fieldSize.toLocaleString()} RUNNERS`
                : 'WORLDWIDE')}
        </Text>
      </Framed>
    </View>
  );
}

// The runners skipped between the podium and the player's neighbourhood. A
// stated number, not an ellipsis: "how far off the podium am I" is the whole
// question this divider is standing in for.
function GapRow({ count }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <View style={styles.gap} accessibilityRole="text">
      <View style={[styles.gapRule, { backgroundColor: withAlpha(colors.text, 0.18) }]} />
      <Text style={[type.caption, { color: colors.textMuted }]}>
        {`${count.toLocaleString()} more`}
      </Text>
      <View style={[styles.gapRule, { backgroundColor: withAlpha(colors.text, 0.18) }]} />
    </View>
  );
}

export default function LeaderboardTransition({
  visible,
  data,
  attacker,
  reducedMotion = false,
  playToken = 0,
  onDone,
}) {
  const { colors } = useTheme();
  const type = useThemedType();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const T = timingFor(reducedMotion);

  const wipe = useSharedValue(0);
  const dashX = useSharedValue(-160);
  const dashOpacity = useSharedValue(0);
  const content = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;

    wipe.value = 0;
    content.value = 0;
    dashOpacity.value = 0;
    dashX.value = -160;

    if (reducedMotion) {
      // Straight crossfade — same phases, no travel.
      wipe.value = withTiming(1, { duration: T.leaderboardWipe });
      content.value = withDelay(T.leaderboardWipe, withTiming(1, { duration: 180 }));
      return;
    }

    // 2 + 3. the character dashes across, streaks trailing
    dashOpacity.value = withSequence(
      withTiming(1, { duration: 90 }),
      withDelay(T.leaderboardWipe - 60, withTiming(0, { duration: 140 }))
    );
    dashX.value = withTiming(screenW + 120, {
      duration: T.leaderboardWipe + 120,
      easing: Easing.inOut(Easing.cubic),
    });

    // 4. the wipe follows the dash across
    wipe.value = withDelay(
      110,
      withTiming(1, { duration: T.leaderboardWipe, easing: Easing.out(Easing.cubic) })
    );

    // 5 + 6. board arrives behind the wipe
    content.value = withDelay(
      T.leaderboardWipe + 140,
      withSpring(1, { damping: 15, stiffness: 180, mass: 0.6 })
    );
  }, [visible, playToken, reducedMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  const wipeStyle = useAnimatedStyle(() =>
    reducedMotion
      ? { opacity: wipe.value }
      : { opacity: 1, transform: [{ translateX: -screenW + wipe.value * screenW }] }
  );

  const dashStyle = useAnimatedStyle(() => ({
    opacity: dashOpacity.value,
    transform: [{ translateX: dashX.value }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: content.value,
    transform: [{ translateY: (1 - content.value) * 18 }],
  }));

  const rows = useMemo(() => data?.travelRows || data?.boardRows || [], [data]);
  const playerId = data?.playerRow?.user_id;
  const rays = art('burstRays');
  // Memoized because it is a STYLE OBJECT handed to a child: a fresh identity
  // every render is the same trap that was re-stringifying the map's GeoJSON
  // on every pan. See the perf note in GameMap.
  const bleed = useMemo(
    () => ({
      left: -space.gutter,
      right: -space.gutter,
      top: -(insets.top + space.lg),
      bottom: -(insets.bottom + space.lg),
    }),
    [insets.top, insets.bottom]
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onDone}>
      <View style={styles.root} pointerEvents="box-none">
        {/* the wipe itself — app background, travelling in behind the dash */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }, wipeStyle]}
          pointerEvents="none"
        />

        {/* the runner, leading it */}
        {!reducedMotion && (
          <Animated.View style={[styles.dash, dashStyle]} pointerEvents="none">
            <View style={styles.streaks}>
              <View style={[styles.streak, { top: 14, width: 30 }]} />
              <View style={[styles.streak, { top: 26, width: 46 }]} />
              <View style={[styles.streak, { top: 38, width: 24 }]} />
            </View>
            <CharacterBust equipped={attacker || {}} size={DASH_SIZE} bg="transparent" />
          </Animated.View>
        )}

        <Animated.View
          style={[
            styles.content,
            { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg },
            contentStyle,
          ]}
        >
          <Confetti
            width={screenW}
            height={screenH}
            bleed={bleed}
            reducedMotion={reducedMotion}
            playToken={playToken}
          />

          <View style={styles.header} pointerEvents="none">
            {rays ? (
              <Image source={rays} style={styles.rays} resizeMode="contain" fadeDuration={0} />
            ) : null}
            <Framed frame="banner" weight={INK.thin} inset={4} style={styles.banner}>
              <OutlinedText
                style={[toonType.headline, styles.title]}
                outline={toon.ink}
                width={2.5}
              >
                STANDINGS
              </OutlinedText>
            </Framed>
          </View>

          <PlayerSummary data={data} reducedMotion={reducedMotion} />

          {visible && (
            <TravelBoard
              key={playToken}
              rows={rows}
              playerId={playerId}
              reducedMotion={reducedMotion}
              startDelay={T.leaderboardWipe + T.travelLead}
            >
              {!data && (
                <Text style={[type.caption, styles.fallback, { color: colors.textMuted }]}>
                  Standings are unavailable right now. Your territory is safely claimed.
                </Text>
              )}
            </TravelBoard>
          )}

          <View style={styles.actions}>
            {/* The same runner who dashed the board in, stood next to the way
                out of it. Hidden under Reduce Motion's tighter layout only if
                the screen is genuinely short. */}
            <View style={styles.bustSlot} pointerEvents="none">
              <CharacterBust equipped={attacker || {}} size={FOOTER_BUST} bg="transparent" />
            </View>
            {/* No HardShadow here: ToonButton is FRAMED, so its silhouette is
                a drawn wobbly box and it carries its own drop for exactly that
                reason. See the `shadow` note in ui/ToonButton. */}
            <View style={styles.cta}>
              <ToonButton title="Done" variant="teal" onPress={onDone} />
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// Measure before travelling so large text and short screens still land on
// the player's actual slot. Remount for each replay to start at the podium.
function TravelBoard({ rows, playerId, reducedMotion, startDelay, children }) {
  const boardRef = useAnimatedRef();
  const offset = useSharedValue(0);
  const driving = useSharedValue(false);
  const landed = useSharedValue(reducedMotion ? 1 : 0);
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [slot, setSlot] = useState(null);
  const [finished, setFinished] = useState(false);
  const started = useRef(false);
  const hasPlayer = playerId != null && rows.some(row => row.user_id === playerId);
  const finish = useCallback(() => setFinished(true), []);

  useDerivedValue(() => {
    if (driving.value) scrollTo(boardRef, 0, offset.value, false);
  });

  useEffect(() => {
    if (started.current || !viewport || !contentHeight || (hasPlayer && !slot)) return;
    started.current = true;
    const target = slot
      ? Math.max(0, Math.min(slot.y - (viewport - slot.height) / 2, contentHeight - viewport))
      : 0;
    driving.value = true;
    if (reducedMotion || !hasPlayer) {
      offset.value = target;
      landed.value = 1;
      setFinished(true);
      return;
    }
    // Reserve the player's real slot while travelling. Insert only after the
    // scroll has stopped, so the landing never happens outside the viewport.
    offset.value = withDelay(startDelay, withTiming(target, {
      duration: target > 0 ? Math.min(2400, 900 + target * 0.65) : 350,
      easing: Easing.inOut(Easing.cubic),
    }, complete => {
      if (!complete) return;
      driving.value = false;
      landed.value = withSpring(1, { damping: 16, stiffness: 150, mass: 0.8 }, done => {
        if (done) runOnJS(finish)();
      });
    }));
  }, [viewport, contentHeight, slot, hasPlayer, reducedMotion, startDelay, finish]);

  useEffect(() => () => {
    cancelAnimation(offset);
    cancelAnimation(landed);
    driving.value = false;
  }, [offset, landed, driving]);

  const playerStyle = useAnimatedStyle(() => ({
    opacity: landed.value,
    transform: [
      { translateX: reducedMotion ? 0 : (1 - landed.value) * 110 },
      { scale: reducedMotion ? 1 : 0.92 + landed.value * 0.08 },
    ],
  }));

  return (
    <Animated.ScrollView
      ref={boardRef}
      style={styles.board}
      contentContainerStyle={styles.boardContent}
      showsVerticalScrollIndicator={false}
      scrollEnabled={finished || !hasPlayer}
      onTouchStart={() => { if (finished) driving.value = false; }}
      onLayout={event => setViewport(event.nativeEvent.layout.height)}
      onContentSizeChange={(_, height) => setContentHeight(height)}
      testID="standings-travel-board"
    >
      {rows.map((row, index) => {
        const isMe = row.user_id === playerId;
        return (
          <View
            key={row.user_id === GAP_ID ? `${GAP_ID}-${index}` : row.user_id}
            onLayout={isMe ? event => setSlot(event.nativeEvent.layout) : undefined}
          >
            {isMe ? (
              <Animated.View style={playerStyle} testID="standings-player-slot">
                <HardShadow accent={brand.teal} radius={12} style={styles.meShadow}>
                  <LeaderboardRow item={row} isMe board="land" celebrateDelta={finished} />
                </HardShadow>
              </Animated.View>
            ) : row.user_id === GAP_ID ? <GapRow count={row.gap} /> : (
              <LeaderboardRow item={row} board="land" />
            )}
          </View>
        );
      })}
      {children}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, paddingHorizontal: space.gutter },
  confetti: { position: 'absolute' },

  header: { alignItems: 'center' },
  // Behind the banner and wider than it, so the rays read as light coming off
  // the heading rather than as a picture behind a box.
  rays: {
    position: 'absolute',
    alignSelf: 'center',
    top: -46,
    width: 320,
    height: 200,
    opacity: 0.2,
  },
  banner: { alignSelf: 'center' },
  title: { color: '#fff', textAlign: 'center' },

  summary: { alignItems: 'center', marginTop: space.sm },
  medallion: { alignItems: 'center', justifyContent: 'center' },
  medallionInner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRank: { color: '#fff', fontSize: 42, lineHeight: 50 },
  chip: { marginTop: -6 },

  board: { flex: 1, marginTop: space.lg },
  boardContent: { paddingBottom: space.md },
  meShadow: { marginBottom: NB.offset },
  gap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  gapRule: { height: 2, flex: 1, maxWidth: 72, borderRadius: 1 },
  fallback: { textAlign: 'center', marginTop: space.xl },

  actions: { paddingTop: space.lg },
  // Sits ON the button's row, overlapping it from the left, so the character
  // leans into the CTA instead of costing the layout another band of height.
  bustSlot: { position: 'absolute', left: -6, bottom: space.lg - 6, zIndex: 2 },
  cta: { marginLeft: FOOTER_BUST - 18 },

  dash: {
    position: 'absolute',
    top: '46%',
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  streaks: { width: 52, height: DASH_SIZE, marginRight: 2 },
  streak: {
    position: 'absolute',
    right: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    opacity: 0.7,
  },
});
