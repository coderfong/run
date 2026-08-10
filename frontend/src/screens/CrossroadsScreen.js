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
// Everything it shows is still public and still vague: a character, a name, a
// familiarity label and a broad phrase. No place, no route, no time — see
// backend/app/paserby.py for why that is a property of the API rather than of
// this screen's discretion.
//
// More than six is a PAGE, not a scroll: swipe sideways and the next six are
// standing there. The plaza itself never moves.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import Animated, { FadeIn } from 'react-native-reanimated';

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
import { COPY, encounterSubtitle, familiarityLabel } from '../config/paserby';
import { art, ART_BG } from '../config/onboardingArt';
import { useProfile } from '../state/profile';
import { PressableScale, useReduceMotion } from '../ui/motion';
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

/**
 * One runner, standing on their circle. No label, no button, no chrome — the
 * whole character IS the control.
 */
function Standing({ encounter, spot, box, index, reduced, onPress }) {
  const width = RIG_FRONT * plazaDepth(spot.y);
  const height = width * RIG_ASPECT;
  const { x, y } = plazaPoint(box, spot.x, spot.y);
  return (
    <Animated.View
      style={[
        styles.standing,
        { left: x - width / 2, top: y - height, width },
        // Half of them face the other way. The art is symmetrical enough that a
        // mirror costs nothing and it is most of what stops twenty of them
        // reading as one repeated sticker.
        spot.flip && { transform: [{ scaleX: -1 }] },
      ]}
      entering={reduced ? undefined : FadeIn.delay(Math.min(index, 10) * 60).duration(260)}
    >
      <PressableScale
        onPress={() => onPress(encounter)}
        scaleTo={0.94}
        accessibilityRole="button"
        accessibilityLabel={`${encounter.username}, ${familiarityLabel(encounter)}`}
      >
        <CharacterRig equipped={encounter.avatar} size={width} />
      </PressableScale>
    </Animated.View>
  );
}

/**
 * The card that comes up when you tap somebody: who they are, how often you
 * have crossed, and everything you can do about it.
 */
function RunnerSheet({ encounter, busy, onClose, onHighFive, onOpen, onHide, onBlock, onReport }) {
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
            <Text style={[toonType.sub, { fontSize: 18, color: colors.text }]} numberOfLines={1}>
              {encounter.username}
            </Text>
            {encounter.clan_tag ? (
              <Pill
                label={`[${encounter.clan_tag}]`}
                color={encounter.clan_color?.stroke || colors.textMuted}
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
      <Button
        title="View runner"
        variant="secondary"
        onPress={() => onOpen(encounter)}
        style={{ marginTop: space.sm }}
      />

      {/* Hide is one-sided and instant; block and report confirm first, because
          both are hard to walk back. */}
      <Row gap={space.sm} style={styles.safety}>
        <Button title="Hide" variant="secondary" size="sm" full={false} onPress={() => onHide(encounter)} />
        <Button
          title="Report"
          variant="secondary"
          size="sm"
          full={false}
          onPress={() =>
            confirm(
              `Report ${encounter.username}?`,
              'A moderator will review this account. They are not told who reported them.',
              'Report',
              () => onReport(encounter)
            )
          }
        />
        <Button
          title="Block"
          variant="destructive"
          size="sm"
          full={false}
          onPress={() =>
            confirm(
              `Block ${encounter.username}?`,
              "You'll never cross paths again, and the times you already have are removed for both of you.",
              'Block',
              () => onBlock(encounter)
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

  const onBlock = async (e) => {
    setOpenId(null);
    try {
      await api.blockUser(e.user_id);
      // A block removes every crossing with that runner, not just this one.
      setData((prev) =>
        prev ? { ...prev, encounters: (prev.encounters || []).filter((x) => x.user_id !== e.user_id) } : prev
      );
      setMore((prev) => prev.filter((x) => x.user_id !== e.user_id));
      invalidate('me:paserby');
      toast.success(`${e.username} blocked`);
    } catch (err) {
      toast.error(err.message || 'Could not block that runner');
    }
  };

  const onReport = async (e) => {
    setOpenId(null);
    try {
      await api.reportUser(e.user_id, 'paserby_report', null, e.id);
      toast.success('Report sent. Thanks, we’ll take a look.');
    } catch (err) {
      toast.error(err.message || 'Could not send that report');
    }
  };

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
    const placed = rows
      .map((e, i) => ({ e, spot: PLAZA_SPOTS[i], index: i }))
      .sort((a, b) => a.spot.y - b.spot.y);
    return (
      <View
        key={key}
        style={box ? { width: box.width, height: box.height } : null}
        pointerEvents="box-none"
      >
        {placed.map(({ e, spot, index }) => (
          <Standing
            key={e.id}
            encounter={e}
            spot={spot}
            box={box}
            index={index}
            reduced={reduced}
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

      {/* --- the switch, on a card, as low as the tab pill allows --------- */}
      <Card style={[styles.setting, { bottom: insets.bottom + SETTING_LIFT }]} padded={false}>
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
        onBlock={onBlock}
        onReport={onReport}
      />
    </Screen>
  );
}

// Flush to the bottom of the page, where the bottom of the page is the top of
// the floating tab pill rather than the screen edge.
//
// TabBar's dock is `space.sm` of padding, an ~82pt bar, then `insets.bottom - 4`
// — so the pill's top edge sits at `insets.bottom + 78`. Four points less than
// that tucks the card into the dock's own top padding: no gap under it, and it
// still never touches the pill.
const SETTING_LIFT = 74;

const styles = StyleSheet.create({
  transparent: { backgroundColor: 'transparent' },

  standing: { position: 'absolute' },

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

  safety: { marginTop: space.md, justifyContent: 'space-between' },
});
