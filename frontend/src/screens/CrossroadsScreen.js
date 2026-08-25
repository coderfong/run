// Crossroads — the runners you have crossed, standing in the plaza.
//
// NOT A LIST. Everyone who turns up here is drawn as their own character, in
// the cosmetics they actually wear, standing somewhere in the square: twenty
// scattered positions (`PLAZA_SPOTS`) that reach from the back of the paving
// out onto the paths in front of it, mapped through `plazaPoint` so they hold
// at any screen shape rather than at a fraction of the window that happens to
// line up on one phone. Size comes from depth (`plazaDepth`), continuously, and
// the furthest are drawn first — perspective and the right z-order for free.
//
// NOTHING IS WRITTEN UNDER THEM. A name, a label and a date under six
// characters turned the plaza into a form; tap a character and their card comes
// up instead, with everything about them and every action in one place.
//
// YOU ARE IN IT. Your own runner stands on the near path at the front (`You`),
// which is what turns the square from a picture of other people into a place
// you are standing in. Anyone you have not seen yet HOPS IN to their spot from
// off the side of the frame and greets you as they land, and you hop back —
// same for a high five, in the other direction. The whole vocabulary is
// CharacterRig's own `celebrate`, a jump with a laughing face, so an arrival, a
// greeting and a high five all read as the same happy gesture.
//
// Everything it shows is still public and still vague: a character, a name, a
// familiarity label and a broad phrase. No place, no route, no time — see
// backend/app/paserby.py for why that is a property of the API rather than of
// this screen's discretion.
//
// More than one plaza-full is a PAGE, not a scroll: swipe sideways and the next
// twenty are standing there. The plaza itself never moves, and neither do you.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { invalidate } from '../api/cache';
import { brand, space, toon, toonType, useTheme, useThemedType } from '../theme';
import {
  Screen,
  Card,
  Row,
  Button,
  Pill,
  Sheet,
  OutlinedText,
  ToonButton,
  ToonHeader,
} from '../components/ui';
import CharacterRig, { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import PlazaScene, { PLAZA_SPOTS, plazaDepth, plazaPoint } from '../components/paserby/PlazaScene';
import CrossroadsIntro from '../components/paserby/CrossroadsIntro';
import { setAtCrossroads } from '../components/CrossroadsAlert';
import { COPY, encounterSubtitle, familiarityLabel } from '../config/paserby';
import { art, ART_BG } from '../config/onboardingArt';
import { useAvatar } from '../state/avatar';
import { useProfile } from '../state/profile';
import { PressableScale, haptic, useReduceMotion } from '../ui/motion';
import { toast } from '../ui/toast';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';

const PAGE = 50;
// One plaza-full of visitors: twenty, four rows deep (see PLAZA_SPOTS).
const SPOTS = PLAZA_SPOTS.length;

// Body width for a character standing at the deck's front kerb; `plazaDepth`
// scales every spot off it, from about two thirds at the back to a fifth over
// on the paths in front. Small on purpose: these people are standing in a
// painted square, not posing for a portrait.
const RIG_FRONT = 42;
// The rig stands this many times its own width once hair headroom is counted
// (BODY_RATIO x 1.14) — needed to place it by its FEET.
const RIG_ASPECT = 2.94;

// The familiarity rungs, coloured. An ordinary first crossing stays neutral —
// only the labels worth earning take a colour.
const RUNG_COLOR = {
  crossed_paths: null,
  familiar_face: brand.teal,
  running_regular: brand.purple,
  local_legend: brand.pink,
};

// The ground the header art was painted on, sampled from the master rather than
// guessed: 11.4:1 against the panel's ink copy, well past the 4.5 floor Pasers
// and Rivals hold their headers to. Using the art's OWN yellow also hides the
// one scrap of background the cut-out's connectivity key cannot reach. It lives
// beside the asset (config/onboardingArt.js) because the intro card wears it
// too, and the two must never drift apart.
const PANEL_YELLOW = ART_BG.panelCrossroads;

// WHERE YOU STAND. Not one of `PLAZA_SPOTS` — those are the square itself, and
// you are not a visitor to it. This is out on the near approach path, in front
// of the front kerb (0.735) and facing the crowd, which is what makes an
// arrival read as somebody coming to see YOU rather than as another sticker
// appearing in a group photo. Drawn last, so the nearest figure is the one in
// front, exactly like the depth ordering behind it.
const YOU_SPOT = { x: 0.5, y: 0.795 };

// A newcomer's walk on: up the near path from off the side of the frame, in
// three hops, landing on their own paving spot.
//
// The trip shrinks them as it goes (`HOP_SCALE`), because the path is nearer
// the camera than the paving is — the same perspective `plazaDepth` gives the
// standing crowd, just in motion. Without it they slid across the picture at a
// fixed size and read as a sticker being dragged.
const HOP_MS = 920;
const HOPS = 3;
const HOP_RISE = 0.15;
const HOP_SCALE = 0.24;
// They arrive one after another rather than as a wave. Short enough that six of
// them is under two seconds.
const HOP_STAGGER_MS = 240;
// Past this many, the rest are simply standing there when you look up. A plaza
// that has been saving up thirty new faces should not make you watch a queue.
const MAX_HOPPERS = 6;

/**
 * One runner, standing on their circle. No label, no button, no chrome — the
 * whole character IS the control.
 *
 * `turn` is their place in the arrival queue, or -1 for somebody who was
 * already here — see `MAX_HOPPERS`.
 */
function Standing({ encounter, spot, box, index, reduced, turn = -1, rigRef, onLanded, onPress }) {
  const width = RIG_FRONT * plazaDepth(spot.y);
  const height = width * RIG_ASPECT;
  const { x, y } = plazaPoint(box, spot.x, spot.y);
  const arriving = turn >= 0 && !reduced;

  // Where the walk on starts: off the side of the frame nearest their own spot,
  // at the depth of the approach path. Measured through `plazaPoint` like
  // everything else here, so it is a point on the PAINTING and holds its
  // relationship to the paving at any screen shape.
  const from = useMemo(() => {
    if (!arriving) return { dx: 0, dy: 0 };
    const entry = plazaPoint(box, spot.x < 0.5 ? -0.15 : 1.15, 0.83);
    return { dx: entry.x - x, dy: entry.y - y };
  }, [arriving, box, spot.x, x, y]);

  // 0 while they are still off frame, 1 once they are standing on their spot.
  const walk = useSharedValue(arriving ? 0 : 1);

  useEffect(() => {
    if (!arriving) return undefined;
    const delay = turn * HOP_STAGGER_MS;
    walk.value = 0;
    walk.value = withDelay(
      delay,
      withTiming(1, { duration: HOP_MS, easing: Easing.out(Easing.quad) })
    );
    // The greeting lands ON the landing, not before it — `celebrate` is the
    // rig's own hop with a laughing face (components/character/CharacterRig).
    const id = setTimeout(() => {
      rigRef?.current?.play('celebrate');
      onLanded?.();
    }, delay + HOP_MS);
    return () => clearTimeout(id);
  }, [arriving, turn, walk, rigRef, onLanded]);

  const walkStyle = useAnimatedStyle(() => {
    const p = walk.value;
    // |sin| gives one arc per half period and touches down at zero between
    // them: three hops, each with a real landing, rather than one long curve.
    const arc = -Math.abs(Math.sin(p * Math.PI * HOPS)) * height * HOP_RISE;
    return {
      // Nothing is drawn until their turn comes round.
      opacity: p > 0 ? 1 : 0,
      transform: [
        { translateX: from.dx * (1 - p) },
        { translateY: from.dy * (1 - p) + arc },
        { scale: 1 + (1 - p) * HOP_SCALE },
      ],
    };
  });

  return (
    <Animated.View
      // The walk is attached only when there IS one. A settled `walkStyle` is
      // opacity 1 and an identity transform, and an animated style that writes
      // opacity every frame is an animated style that overrides the entering
      // fade — so leaving it on for everybody would quietly kill the stagger
      // the twenty standing runners arrive with.
      style={[
        styles.standing,
        { left: x - width / 2, top: y - height, width },
        arriving && walkStyle,
      ]}
      entering={reduced || arriving ? undefined : FadeIn.delay(Math.min(index, 10) * 60).duration(260)}
    >
      {/* The mirror is its own box INSIDE the walk. Flipping the wrapper would
          flip the arrival with it, so a runner entering from the left would hop
          off to the left instead of in from it. */}
      <View style={spot.flip ? styles.flipped : null}>
        <PressableScale
          onPress={() => onPress(encounter)}
          scaleTo={0.94}
          accessibilityRole="button"
          accessibilityLabel={`${encounter.username}, ${familiarityLabel(encounter)}`}
        >
          <CharacterRig ref={rigRef} equipped={encounter.avatar} size={width} />
        </PressableScale>
      </View>
    </Animated.View>
  );
}

/**
 * You, at the front of the square. Not tappable and not part of the crowd: it
 * is the thing every arrival and every high five is aimed at, and the reason
 * the plaza is a place you are standing in rather than a page you are reading.
 *
 * `animate` for the idle bob, which is the whole difference between your own
 * runner being present and being pasted on.
 */
function You({ box, equipped, rigRef }) {
  const width = RIG_FRONT * plazaDepth(YOU_SPOT.y);
  const height = width * RIG_ASPECT;
  const { x, y } = plazaPoint(box, YOU_SPOT.x, YOU_SPOT.y);
  return (
    <View
      style={[styles.standing, { left: x - width / 2, top: y - height, width }]}
      pointerEvents="none"
      accessible={false}
    >
      <CharacterRig ref={rigRef} equipped={equipped} size={width} animate />
    </View>
  );
}

/**
 * The card that comes up when you tap somebody: who they are, how often you
 * have crossed, and everything you can do about it.
 */
function RunnerSheet({ encounter, busy, onClose, onHighFive, onOpen, onHide }) {
  const { colors } = useTheme();
  const type = useThemedType();
  if (!encounter) return null;
  const rung = RUNG_COLOR[encounter.familiarity];

  const confirm = (title, body, label, run) =>
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      { text: label, style: 'destructive', onPress: run },
    ]);

  return (
    <Sheet visible onClose={onClose}>
      <Row gap={space.md} style={{ alignItems: 'center' }}>
        <PortraitBorder borderKey={encounter.rank_key || 'wood'} size={64}>
          <CharacterBust equipped={encounter.avatar} size={64} bg={colors.cardAlt} />
        </PortraitBorder>
        <View style={{ flex: 1 }}>
          <Row gap={6}>
            {/* The NAME gives way, not the club tag. A name is elastic (they run
                to 32 characters) and it is already truncating on the ellipsis;
                a tag is four characters that mean nothing with one cut off. In
                a row neither of them shrinks by default, so the long name took
                the whole width and pushed the pill off the right edge. */}
            <Text
              style={[toonType.sub, { fontSize: 18, color: colors.text, flexShrink: 1 }]}
              numberOfLines={1}
            >
              {encounter.username}
            </Text>
            {encounter.clan_tag ? (
              <Pill
                label={`[${encounter.clan_tag}]`}
                color={encounter.clan_color?.stroke || colors.textMuted}
                style={{ flexShrink: 0 }}
              />
            ) : null}
          </Row>
          <Text style={type.caption} numberOfLines={1}>
            {`Level ${encounter.level || 0}`}
            {encounter.clan_name ? ` · ${encounter.clan_name}` : ''}
          </Text>
          <Text style={[type.caption, { color: rung || colors.textMuted, marginTop: 1 }]}>
            {`${familiarityLabel(encounter)} · ${encounterSubtitle(encounter)}`}
          </Text>
        </View>
      </Row>

      {encounter.high_five_received && !encounter.high_fived ? (
        <Text style={[type.bodySm, { color: brand.teal, marginTop: space.md }]}>
          They gave you a high five.
        </Text>
      ) : null}

      <ToonButton
        title={encounter.high_fived ? COPY.highFiveSent : COPY.highFive}
        variant={encounter.high_fived ? 'teal' : 'primary'}
        disabled={encounter.high_fived || busy}
        loading={busy}
        onPress={() => onHighFive(encounter)}
        style={{ marginTop: space.lg }}
      />
      {/* Two things, side by side: go and look at them, or send them away.
          Report and Block used to sit here as a third row of small buttons, and
          three safety controls under every single face made the card read as a
          moderation queue rather than as somebody you ran past. They now live
          one tap further in, behind "View runner" — RunnerProfileScreen carries
          "Report or block" on every profile that is not your own, which is the
          reachable path App Review's UGC rule asks for. Removing them from HERE
          is a layout decision; removing them from the app is not on the table.

          Remove is `hide`: one-sided, instant, and only about your own plaza.
          It confirms anyway, because the person is gone from the square the
          moment it is tapped and there is no undo on this screen. */}
      <Row gap={space.sm} style={{ marginTop: space.sm }}>
        <Button
          title="View runner"
          variant="secondary"
          onPress={() => onOpen(encounter)}
          style={{ flex: 1 }}
        />
        <Button
          title="Remove"
          variant="destructive"
          style={{ flex: 1 }}
          onPress={() =>
            confirm(
              `Remove ${encounter.username}?`,
              'They leave your Crossroads. You can still cross paths with them again on a future run.',
              'Remove',
              () => onHide(encounter)
            )
          }
        />
      </Row>
    </Sheet>
  );
}

export default function CrossroadsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const type = useThemedType();
  const focused = useIsFocused();
  const reduced = useReduceMotion();
  // The first visit gets the explainer (see components/paserby/CrossroadsIntro).
  // `profileLoading` matters: the flag is read from disk, and rendering before
  // it lands would flash the card at somebody who has already read it.
  const { profile, loading: profileLoading, completeCrossroadsIntro } = useProfile();
  // Your own runner, standing at the front of the square (see `You`).
  const { equipped } = useAvatar();

  // While this screen is up, the arrival banner stands down: the hop-in below
  // says the same thing better, and a card telling you to come to the plaza
  // while you are standing in it is noise. See components/CrossroadsAlert.
  useEffect(() => {
    setAtCrossroads(focused);
    return () => setAtCrossroads(false);
  }, [focused]);

  const { data, refresh, setData } = useQuery(
    'me:paserby:crossroads',
    () => api.crossroads(PAGE, 0),
    { fallback: { encounters: [], unseen: 0, total: 0, enabled: true } }
  );
  const [more, setMore] = useState([]);
  const [box, setBox] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const loadingMore = useRef(false);
  const exhausted = useRef(false);

  // A ref per runner on the plaza, plus one for you, so anything that happens
  // TO somebody can be played ON them: the greeting when they land, the hop
  // when a high five goes out.
  const meRig = useRef(null);
  const rigs = useRef({});
  const rigFor = useCallback((id) => {
    if (!rigs.current[id]) rigs.current[id] = React.createRef();
    return rigs.current[id];
  }, []);

  // Who is NEW this visit. Latched from the first list that arrives and never
  // recomputed: opening this screen marks everything seen (below), and the
  // refresh that lands a moment later carries `seen: true` for all of them — so
  // reading the live list a beat later would find nobody new and nothing would
  // ever hop in.
  //
  // Latched during RENDER rather than in an effect, deliberately. An effect
  // resolves one commit late, and that commit is the one where the plaza is
  // first drawn — every newcomer would have already played the standing fade
  // before being told to arrive, and would then blink out and hop in again.
  const latched = useRef(null);
  if (latched.current === null && data?.encounters) {
    latched.current = new Set(data.encounters.filter((e) => !e.seen).map((e) => e.id));
  }
  const arrivals = latched.current;

  // You wave back. Throttled, because six arrivals 240 ms apart would otherwise
  // restart your own hop before it finished and read as a twitch.
  //
  // No haptic: this fires on its own, up to six times, at a moment nobody
  // asked for anything. Buzzing is for things you did — see the high five.
  const lastGreet = useRef(0);
  const greet = useCallback(() => {
    const now = Date.now();
    if (now - lastGreet.current < 600) return;
    lastGreet.current = now;
    meRig.current?.play('celebrate');
  }, []);

  const encounters = useMemo(() => [...(data?.encounters || []), ...more], [data, more]);
  const enabled = data?.enabled !== false;
  const open = encounters.find((e) => e.id === openId) || null;

  // Six to a plaza. The back row is laid FIRST so the front row draws over it.
  const pages = useMemo(() => {
    const out = [];
    for (let i = 0; i < encounters.length; i += SPOTS) out.push(encounters.slice(i, i + SPOTS));
    return out;
  }, [encounters]);

  useEffect(() => {
    if (encounters.length) preloadRunnerAssets(encounters);
  }, [encounters]);

  // Arriving IS seeing them — clear the badge here and in the summary Home
  // reads, so the count doesn't linger on the way back.
  const unseen = data?.unseen || 0;
  useEffect(() => {
    if (!unseen) return;
    api
      .markPaserbySeen()
      .then(() => {
        setData((prev) => ({ ...(prev || {}), unseen: 0 }));
        invalidate('me:paserby');
      })
      .catch(() => {});
  }, [unseen, setData]);

  const loadMore = async () => {
    if (loadingMore.current || exhausted.current || encounters.length < PAGE) return;
    loadingMore.current = true;
    try {
      const next = await api.crossroads(PAGE, encounters.length);
      const rows = next.encounters || [];
      if (!rows.length) exhausted.current = true;
      setMore((prev) => [...prev, ...rows]);
    } catch {
      // A failed page leaves the plaza as it is; the next swipe retries.
    } finally {
      loadingMore.current = false;
    }
  };

  // Apply a change to whichever list the runner lives in, so a wave or a hide
  // lands without a refetch.
  const patch = useCallback(
    (id, fn) => {
      setData((prev) =>
        prev
          ? { ...prev, encounters: (prev.encounters || []).flatMap((e) => (e.id === id ? fn(e) : [e])) }
          : prev
      );
      setMore((prev) => prev.flatMap((e) => (e.id === id ? fn(e) : [e])));
    },
    [setData]
  );

  const onHighFive = async (e) => {
    setBusyId(e.id);
    try {
      const out = await api.highFive(e.id);
      patch(e.id, (row) => [{ ...row, high_fived: true }]);
      // The payoff is the PERSON, not the toast. Drop the card so they are
      // visible again, hop them (CharacterRig's `celebrate` is a jump with a
      // laughing face), then hop yourself back a beat later so it reads as an
      // exchange rather than as two things happening at once.
      setOpenId(null);
      haptic.success();
      rigFor(e.id).current?.play('celebrate');
      setTimeout(() => meRig.current?.play('celebrate'), 220);
      toast.success(out.xp_gained > 0 ? `High five sent · +${out.xp_gained} XP` : 'High five sent');
    } catch (err) {
      toast.error(err.message || 'Could not send that high five');
    } finally {
      setBusyId(null);
    }
  };

  const onHide = async (e) => {
    setOpenId(null);
    patch(e.id, () => []);
    try {
      await api.hideEncounter(e.id);
    } catch (err) {
      toast.error(err.message || 'Could not hide that');
      refresh();
    }
  };

  // Report and Block are no longer on this card — they are on the runner's own
  // profile, one tap through "View runner" (see RunnerSheet). Blocking there
  // still empties this plaza of that runner; `me:paserby` is invalidated by
  // that path, so coming back re-fetches without them.

  const onOpen = (e) => {
    setOpenId(null);
    navigation.navigate('RunnerProfile', { userId: e.user_id, username: e.username });
  };

  const setEnabled = async (next) => {
    setData((prev) => ({ ...(prev || {}), enabled: next }));
    try {
      await api.setPaserby(next);
      invalidate('me:paserby');
    } catch (err) {
      setData((prev) => ({ ...(prev || {}), enabled: !next }));
      toast.error(err.message || 'Could not change that setting');
    }
  };

  // Spots are filled NEAREST first (so one visitor stands at the front) but
  // drawn FURTHEST first, or someone at the back would paint over the person
  // in front of them.
  const crowd = (rows, key) => {
    const placed = rows.map((e, i) => ({ e, spot: PLAZA_SPOTS[i], index: i }));

    // Arrival turns are handed out in STANDING order, not draw order, so the
    // hops come in from the front of the square backwards — which is the order
    // the list is in, and the order somebody would actually notice them.
    const turns = new Map();
    placed.forEach(({ e }) => {
      if (arrivals?.has(e.id) && turns.size < MAX_HOPPERS) turns.set(e.id, turns.size);
    });

    const drawn = [...placed].sort((a, b) => a.spot.y - b.spot.y);
    return (
      <View
        key={key}
        style={box ? { width: box.width, height: box.height } : null}
        pointerEvents="box-none"
      >
        {drawn.map(({ e, spot, index }) => (
          <Standing
            key={e.id}
            encounter={e}
            spot={spot}
            box={box}
            index={index}
            reduced={reduced}
            turn={turns.has(e.id) ? turns.get(e.id) : -1}
            rigRef={rigFor(e.id)}
            onLanded={greet}
            onPress={() => setOpenId(e.id)}
          />
        ))}
      </View>
    );
  };

  return (
    <Screen gutter={false} edges={[]} style={styles.transparent}>
      {/* The plaza is the page. `active` is focus, so the sky stops moving
          while the screen is parked behind another one. */}
      <PlazaScene
        style={StyleSheet.absoluteFill}
        butterflies={5}
        active={focused}
        contentStyle={styles.transparent}
      />

      {/* The measuring layer: `plazaPoint` needs the box the scene was laid out
          in to know where the painted circles ended up. */}
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setBox((b) => (b && b.width === width && b.height === height ? b : { width, height }));
        }}
      >
        {box && pages.length > 1 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={StyleSheet.absoluteFill}
            onScroll={({ nativeEvent: n }) => {
              const nearEnd =
                n.layoutMeasurement.width + n.contentOffset.x >= n.contentSize.width - n.layoutMeasurement.width;
              if (nearEnd) loadMore();
            }}
            scrollEventThrottle={200}
          >
            {pages.map((rows, i) => crowd(rows, i))}
          </ScrollView>
        ) : box && pages.length === 1 ? (
          crowd(pages[0], 0)
        ) : null}
      </View>

      {/* You, OUTSIDE the pager and after the crowd. Outside, because swiping
          to the next plaza-full moves the visitors and not the ground you are
          standing on; after, because you stand nearest the camera and everybody
          else is behind you. */}
      {box ? <You box={box} equipped={equipped} rigRef={meRig} /> : null}

      {/* --- the header, back on its panel ------------------------------- */}
      {/* `compact`: the plaza is what this page is, and the header is chrome
          over it. The chevron rides in the title row, the cut-out is smaller,
          and the panel gives about ninety points back to the sky. */}
      <ToonHeader
        panel
        compact
        eyebrow={
          encounters.length
            ? `${encounters.length} ${encounters.length === 1 ? 'runner' : 'runners'}` +
              (pages.length > 1 ? ` · ${pages.length} plazas` : '')
            : 'nobody yet'
        }
        title="CROSSROADS"
        art={art('panelCrossroads')}
        titleStyle={type.display}
        eyebrowStyle={type.labelSm}
        solid={PANEL_YELLOW}
        top={insets.top}
        onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('YouMain'))}
      />

      {/* --- nobody home ------------------------------------------------- */}
      {encounters.length === 0 ? (
        <View style={styles.emptyWrap} pointerEvents="box-none">
          <OutlinedText style={[toonType.sub, styles.emptyTitle]} outline={toon.ink} width={2.5}>
            {enabled ? COPY.emptyTitle : 'Crossed Paths is off'}
          </OutlinedText>
          <OutlinedText style={[toonType.label, styles.emptyBody]} outline={toon.ink} width={1.5}>
            {enabled ? COPY.empty : COPY.disabled}
          </OutlinedText>
        </View>
      ) : null}

      {/* --- the switch, on a card, at the bottom of the page ------------- */}
      <Card style={[styles.setting, { bottom: SETTING_LIFT }]} padded={false}>
        <View style={styles.settingRow}>
          <View style={{ flex: 1, paddingRight: space.md }}>
            <Text style={type.bodyBold}>{COPY.setting}</Text>
            <Text style={type.caption} numberOfLines={1}>
              They never see your route, location or crossing time.
            </Text>
          </View>
          <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: PANEL_YELLOW }} />
        </View>
      </Card>

      {/* Last, so it sits over everything the plaza draws. Tied to `focused`
          as well as to the flag: both tab stacks register this screen, and a
          copy parked behind another one must not put a modal over it. */}
      <CrossroadsIntro
        visible={focused && !profileLoading && !profile.crossroadsIntroSeen}
        onClose={completeCrossroadsIntro}
      />

      <RunnerSheet
        encounter={open}
        busy={busyId === openId}
        onClose={() => setOpenId(null)}
        onHighFive={onHighFive}
        onOpen={onOpen}
        onHide={onHide}
      />
    </Screen>
  );
}

// How far the card sits off the bottom of the PAGE.
//
// It used to be `insets.bottom + 74`, on the belief that the tab bar floats
// over the screen and the card had to clear it itself. It does not: the tab
// navigator lays its dock out BELOW the scene (App.js, tabBarPosition="bottom"),
// so the bottom of this screen is already the top of that dock — and the card
// was paying the home-indicator inset and the bar's height a second time,
// hovering the better part of two hundred points above where it looked like it
// belonged. One gutter of air off the real page bottom is the whole rule now,
// and it also gives your own runner (see `You`) the plaza back.
const SETTING_LIFT = space.md;

const styles = StyleSheet.create({
  transparent: { backgroundColor: 'transparent' },

  standing: { position: 'absolute' },
  // Half of them face the other way. The art is symmetrical enough that a
  // mirror costs nothing and it is most of what stops twenty of them reading as
  // one repeated sticker.
  flipped: { transform: [{ scaleX: -1 }] },

  emptyWrap: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    top: '52%',
    alignItems: 'center',
    gap: space.xs,
  },
  emptyTitle: { color: '#fff', fontSize: 20 },
  emptyBody: { color: 'rgba(255,255,255,0.94)', textTransform: 'none', textAlign: 'center' },

  setting: { position: 'absolute', left: space.gutter, right: space.gutter },
  // One tight row rather than the default card padding: this sits over the
  // scene, so every point of height it takes is a point of plaza it covers.
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
});
