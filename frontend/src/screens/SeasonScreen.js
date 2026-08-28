// Season standings — reached from the Home hero cards. Two scopes:
//   Clubs — collective club performance.
//   Solo  — players who are not currently in a club.
// Each scope can be ranked by land, claims, captures, defenses, or distance.
// Tap a club row to open its profile; solo rows aren't tappable (no profile).
//
// THE SCOPE IS CHOSEN BEFORE YOU GET HERE. `route.params.mode` decides which
// board this is, and there is no control on the page to change it: Home's
// carousel has a Clubs card and a Solo card, so the choice is already made by
// the card that was tapped. A pair of chips up here would be a second control
// for the same axis, able to contradict the card that opened the screen — and
// on the club board they also sat above rows that are clubs, offering to turn
// them into runners. Coming back to the other board is a back-swipe away.
//
// THE HEADER IS CHROME, NOT THE PAGE. It used to carry FIFTEEN chips in three
// wrapped rows — two scopes, five categories, four windows, four fields — under
// a full-size hero panel with a three-line sentence reserved under the title.
// On a phone that is most of the screen spent on the picker, on a page whose
// entire job is to show a ranked list: the first standing was below the fold on
// every board. The picker now reads
//
//     compact panel header · one summary bar
//
// and the twelve remaining chips live in a sheet behind that bar. The bar
// states the whole board in words ("Land held · Season · Everyone"), so nothing
// is hidden — the sentence that used to be the header's subtitle IS the control
// now, which is why the subtitle went away rather than being shortened.
//
// The panel keeps its per-board illustration and colour: whichever board was
// chosen last owns the header art — the scope this screen was opened on, or a
// category chosen inside the sheet. `compact` + `stableArt` means swapping
// between a wide illustration and a tall one can't resize the header underneath
// the reader's thumb.

import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Lock } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import useCoarsePosition from '../hooks/useCoarsePosition';
import { useProEntitlement } from '../pro/ProProvider';
import { useAuth } from '../auth/AuthContext';
import StandingBar from '../components/StandingBar';
import {
  NB,
  nbInk,
  radius,
  space,
  toon,
  tintOn,
  useTheme,
  useThemedStyles,
  useThemedType,
} from '../theme';
import { NEUTRAL } from '../state/clan';
import {
  Screen,
  Card,
  Row,
  Sheet,
  Skeleton,
  EmptyState,
  PANEL_INK,
  ToonButton,
  ToonHeader,
} from '../components/ui';
import ClubAvatar from '../components/ClubAvatar';
import PortraitBorder from '../components/PortraitBorder';
import { CharacterBust } from '../components/character/CharacterRig';
import { useAvatar } from '../state/avatar';
import { Arrival, PressableScale, useArrival } from '../ui/motion';
import { SEASON_CATEGORY_ART, SEASON_SCOPE_ART } from '../config/seasonArt';

const km2 = (m) => (m / 1e6).toFixed(2);
// Matched to the club board's badge beside it, so the two scopes' rows line up
// at the same height. The frame drawn around it can be wider — see
// RunnerPortrait — which is why nothing here is a fixed 40pt box.
const PORTRAIT = 40;
const LEAGUE_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };
// Not a picker any more — the scope arrives as a route param from Home. This
// still owns the two boards' art and the words the page uses for them, so the
// header can name the board it is showing.
const SCOPE_OPTIONS = [
  { key: 'clans', label: 'Clubs', title: 'Club standings', art: SEASON_SCOPE_ART.clans },
  { key: 'solo', label: 'Solo', title: 'Solo standings', art: SEASON_SCOPE_ART.solo },
];
const SCOPE_BY_KEY = Object.fromEntries(SCOPE_OPTIONS.map((item) => [item.key, item]));
const CATEGORY_OPTIONS = [
  { key: 'land', label: 'Land held', shortLabel: 'Land', description: 'land held', art: SEASON_CATEGORY_ART.land },
  { key: 'claims', label: 'Claims completed', shortLabel: 'Claims', description: 'claims completed', art: SEASON_CATEGORY_ART.claims },
  { key: 'captures', label: 'Rival captures', shortLabel: 'Captures', description: 'rival captures', art: SEASON_CATEGORY_ART.captures },
  { key: 'defenses', label: 'Successful defenses', shortLabel: 'Defenses', description: 'successful defenses', art: SEASON_CATEGORY_ART.defenses },
  { key: 'distance', label: 'Distance run', shortLabel: 'Distance', description: 'distance run', art: SEASON_CATEGORY_ART.distance },
];
const CATEGORY_BY_KEY = Object.fromEntries(CATEGORY_OPTIONS.map((item) => [item.key, item]));

// The PASER PRO half of the board. These change the QUESTION — over what
// stretch of time, against which runners — and never the answer to "where am
// I", which StandingBar answers for free underneath. Every option here is
// `season`/`all` for a free runner, which is the board they already had.
const WINDOW_OPTIONS = [
  { key: 'season', label: 'Season', sentence: 'this season' },
  { key: 'week', label: 'This week', sentence: 'this week' },
  { key: 'month', label: 'This month', sentence: 'this month' },
  { key: 'all', label: 'All time', sentence: 'all time' },
];
const FIELD_OPTIONS = [
  { key: 'all', label: 'Everyone', sentence: '' },
  { key: 'pasers', label: 'Pasers', sentence: ', among your pasers' },
  { key: 'club', label: 'My club', sentence: ', within your club' },
  { key: 'local', label: 'Near me', sentence: ', near you' },
];
const WINDOW_BY_KEY = Object.fromEntries(WINDOW_OPTIONS.map((i) => [i.key, i]));
const FIELD_BY_KEY = Object.fromEntries(FIELD_OPTIONS.map((i) => [i.key, i]));

// The board the screen opens on, and what "Reset" goes back to.
const DEFAULTS = { category: 'land', window: 'season', field: 'all' };

// Every board that owns an illustration, keyed the way `bannerKey` stores it.
const ART_BY_KEY = {
  ...Object.fromEntries(SCOPE_OPTIONS.map((o) => [o.key, o.art])),
  ...Object.fromEntries(CATEGORY_OPTIONS.map((o) => [o.key, o.art])),
};

// One chip inside the filter sheet. `locked` still renders as a live control:
// tapping it opens the paywall, which is a better answer than a chip that looks
// broken or one that has been hidden so nobody knows the view exists.
function SheetChip({ label, active, locked, onPress, styles, type, colors }) {
  return (
    <PressableScale
      onPress={onPress}
      style={[styles.sheetChip, active && styles.sheetChipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={locked ? `${label}. Paser Pro` : label}
    >
      <Text
        style={[type.bodySmBold, { color: active ? colors.primaryInk : colors.text }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {locked ? (
        <Lock size={12} color={active ? colors.primaryInk : colors.textDim} strokeWidth={2.5} />
      ) : null}
    </PressableScale>
  );
}

function ChipGroup({ title, children, styles, type, colors }) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={[type.captionMedium, { color: colors.textMuted, marginBottom: space.sm }]}>
        {title}
      </Text>
      <View style={styles.sheetChipRow}>{children}</View>
    </View>
  );
}

// Rank by / when / who. Selections apply to the board LIVE — the sheet does not
// close on a tap and there is no Apply button, so the header art, the summary
// bar and the rows behind the backdrop all move as the chips are chosen. The
// button at the bottom only dismisses.
function BoardFiltersSheet({
  visible,
  onClose,
  category,
  window_,
  field,
  isPro,
  onCategory,
  onWindow,
  onField,
  onReset,
  changed,
  styles,
  type,
  colors,
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Row between style={{ marginBottom: space.md }}>
        <Text style={type.heading}>Filters</Text>
        {changed ? (
          <TouchableOpacity onPress={onReset} accessibilityRole="button">
            <Text style={[type.captionMedium, { color: colors.textMuted, textDecorationLine: 'underline' }]}>
              Reset
            </Text>
          </TouchableOpacity>
        ) : null}
      </Row>

      <ChipGroup title="Rank by" styles={styles} type={type} colors={colors}>
        {CATEGORY_OPTIONS.map((option) => (
          <SheetChip
            key={`c:${option.key}`}
            label={option.label}
            active={category === option.key}
            onPress={() => onCategory(option.key)}
            styles={styles}
            type={type}
            colors={colors}
          />
        ))}
      </ChipGroup>

      <ChipGroup title="When" styles={styles} type={type} colors={colors}>
        {WINDOW_OPTIONS.map((option) => (
          <SheetChip
            key={`w:${option.key}`}
            label={option.label}
            active={window_ === option.key}
            locked={!isPro && option.key !== DEFAULTS.window}
            onPress={() => onWindow(option.key)}
            styles={styles}
            type={type}
            colors={colors}
          />
        ))}
      </ChipGroup>

      <ChipGroup title="Who" styles={styles} type={type} colors={colors}>
        {FIELD_OPTIONS.map((option) => (
          <SheetChip
            key={`f:${option.key}`}
            label={option.label}
            active={field === option.key}
            locked={!isPro && option.key !== DEFAULTS.field}
            onPress={() => onField(option.key)}
            styles={styles}
            type={type}
            colors={colors}
          />
        ))}
      </ChipGroup>

      <ToonButton title="Show standings" size="sm" onPress={onClose} />
    </Sheet>
  );
}

function metricAmount(item, category) {
  switch (category) {
    case 'claims':
      return { value: (item.claim_count || 0).toLocaleString(), unit: 'claims' };
    case 'captures':
      return { value: (item.capture_count || 0).toLocaleString(), unit: 'captures' };
    case 'defenses':
      return { value: (item.defense_count || 0).toLocaleString(), unit: 'holds' };
    case 'distance':
      return { value: ((item.distance_m || 0) / 1000).toFixed(1), unit: 'km' };
    default:
      return { value: km2(item.total_area_m2 || 0), unit: 'km²' };
  }
}

export default function SeasonScreen({ navigation, route }) {
  const { colors, scheme } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  // Your own portrait, for your own row on the solo board.
  const { equipped: myEquipped, rankKey: myRankKey } = useAvatar();
  // Fixed for the life of the screen — the Home card that opened it chose the
  // scope, and nothing on this page changes it. Not state: a `useState` seeded
  // from a param that no setter is left to call is a value pretending to be a
  // control, and the next reader would go looking for the missing chips.
  const mode = SCOPE_BY_KEY[route.params?.mode] ? route.params.mode : 'clans';
  const [category, setCategory] = useState(
    CATEGORY_BY_KEY[route.params?.category] ? route.params.category : DEFAULTS.category
  );
  // Which board's illustration the header is wearing — the last one chosen.
  // Home links straight to a scope ("Clubs"/"Solo" on the season banner) with
  // no category, so open on THAT art rather than defaulting to land.
  const [bannerKey, setBannerKey] = useState(() => {
    if (CATEGORY_BY_KEY[route.params?.category]) return route.params.category;
    if (SEASON_SCOPE_ART[route.params?.mode]) return route.params.mode;
    return DEFAULTS.category;
  });
  // The PRO filters. `season` + `all` is the free board, so a runner who never
  // opens the sheet has exactly the screen they had before.
  const [window_, setWindow] = useState(DEFAULTS.window);
  const [field, setField] = useState(DEFAULTS.field);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The app's one paywall, opened with the context that explains WHY a
  // board filter is locked. No sheet of its own any more.
  const { isPro, openPaywall } = useProEntitlement();
  // Only fetched for the one filter that needs it, and only when it is chosen
  // — asking for a position to draw a board nobody has asked for would be a
  // location prompt out of nowhere.
  const here = useCoarsePosition(field === 'local');

  const boardOpts = { window: window_, filter: field, lat: here?.lat, lon: here?.lon };
  // `local` cannot be requested until a position arrives; the server refuses
  // it outright rather than quietly answering globally.
  const ready = field !== 'local' || !!here;

  // One cache entry PER BOARD, so flipping between Clubs, Solo, land and
  // distance re-shows a board you have already looked at instantly instead of
  // blanking to skeletons on every toggle. useQuery re-seeds itself when the
  // key changes, which also retires the request-id guard that used to be
  // needed to ignore a slow board arriving late.
  const { data: rows, loading } = useQuery(
    ready ? `season:${mode}:${category}:${window_}:${field}` : null,
    () => api.seasonLeaderboard(mode, category, boardOpts),
    { fallback: [] }
  );

  const selectFilter = (axis, key) => {
    // A free runner gets the paywall, not a silent no-op and not a 402 toast.
    // The sheet closes FIRST: the paywall is a modal of its own, and the app
    // never stacks one on top of another (see MapLayersSheet).
    if (!isPro && key !== DEFAULTS[axis]) {
      setFiltersOpen(false);
      openPaywall('leaderboard_history');
      return;
    }
    (axis === 'window' ? setWindow : setField)(key);
  };

  const selectCategory = (key) => {
    setCategory(key);
    setBannerKey(key);
  };

  const reset = () => {
    setCategory(DEFAULTS.category);
    setWindow(DEFAULTS.window);
    setField(DEFAULTS.field);
    setBannerKey(DEFAULTS.category);
  };

  const art = ART_BY_KEY[bannerKey] || CATEGORY_BY_KEY[DEFAULTS.category].art;
  // What the summary bar says, and what the sheet's Reset appears for. Scope is
  // not counted: it is fixed by the card that opened the screen, and nothing on
  // this page — bar or sheet — can move it.
  const changed =
    (category !== DEFAULTS.category ? 1 : 0) +
    (window_ !== DEFAULTS.window ? 1 : 0) +
    (field !== DEFAULTS.field ? 1 : 0);
  const summary = `${CATEGORY_BY_KEY[category].label} · ${WINDOW_BY_KEY[window_].label} · ${FIELD_BY_KEY[field].label}`;

  const header = (
    <ToonHeader
      panel
      compact
      eyebrow="Season"
      // The board names itself. With the scope chips gone this title is the
      // only thing on the page that says whether these rows are clubs or
      // runners, so it says it rather than settling for "Season standings".
      title={SCOPE_BY_KEY[mode].title}
      // Home's hero-card format: the selected board's characters as a cut-out
      // on the right of a flat panel in that board's colour, black copy on the
      // left. `compact` shrinks the cut-out and moves the back chevron inline
      // with the title, which is about ninety points of the height this page
      // was spending before a single standing was on screen.
      art={art.source}
      solid={art.bg}
      // The board's sentence is the summary bar below, not a subtitle. Two
      // copies of the same sentence in one header is what made it tall.
      stableArt
      titleStyle={type.display}
      eyebrowStyle={type.labelSm}
      top={insets.top}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeMain'))}
      style={{ marginBottom: space.md }}
    >
      {/* RANKED BY WHAT, WHEN, AMONG WHOM — twelve chips stated as one line of
          copy. The bar is the control: it reads as a sentence when you are not
          looking at it and opens the sheet when you are. */}
      <PressableScale
        onPress={() => setFiltersOpen(true)}
        style={styles.summaryBar}
        accessibilityRole="button"
        accessibilityLabel={`Filters. ${summary}`}
        accessibilityHint="Choose what the board ranks, over what period, and who is on it"
      >
        <Text style={[type.bodySmBold, styles.summaryText]} numberOfLines={1}>
          {summary}
        </Text>
        {changed ? (
          <View style={styles.summaryCount}>
            <Text style={[type.captionMedium, styles.summaryCountText]}>{changed}</Text>
          </View>
        ) : null}
        <ChevronDown size={16} color={PANEL_INK} strokeWidth={3} />
      </PressableScale>
    </ToonHeader>
  );

  // A disabled query never resolves, so its `loading` never clears — without
  // this, choosing "Near me" with no location permission would sit on
  // skeletons forever instead of reaching the empty state that explains why.
  const waiting = loading && ready;
  const arriving = useArrival(waiting);

  const openClan = (clanId) => navigation.navigate('ClubDetail', { clanId });

  const renderClan = (item, index) => {
    const rank = index + 1;
    const c = item.color;
    const top = rank === 1;
    const amount = metricAmount(item, category);
    return (
      <PressableScale onPress={() => openClan(item.clan_id)}>
        <Card style={[{ marginBottom: space.sm }, top && { borderWidth: 1, borderColor: c.stroke }]}>
          <Row between>
            <Row gap={12} style={{ flex: 1 }}>
              <RankCol rank={rank} top={top} />
              <ClubAvatar photoUrl={item.photo_url} badgeIcon={item.badge_icon} color={c} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={type.bodyBold} numberOfLines={1}>[{item.tag}] {item.name}</Text>
                <Text style={type.caption}>
                  {item.member_count} members{item.league ? ` · ${LEAGUE_LABEL[item.league]}` : ''}
                </Text>
              </View>
            </Row>
            <Amount value={amount.value} unit={amount.unit} color={c.stroke} />
          </Row>
        </Card>
      </PressableScale>
    );
  };

  const renderSolo = (item, index) => {
    const rank = index + 1;
    const top = rank === 1;
    const isMe = item.user_id === user.id;
    const c = NEUTRAL;
    const amount = metricAmount(item, category);
    return (
      // Your own row is tinted with `fill`, not a translucent `backgroundColor`:
      // an unframed Card has a solid hard drop painted behind it, so a 10%
      // wash lets that block through and the row comes out near-black with the
      // card's own dark ink still on it. `tintOn` resolves the same tint
      // against the card surface, and `fill` is what the stroke and the drop
      // are judged against. See `tintOn` in theme/tokens.
      <Card
        fill={isMe ? tintOn(colors.card, c.stroke, scheme === 'dark' ? 0.22 : 0.12) : undefined}
        style={{ marginBottom: space.sm }}
      >
        <Row between>
          <Row gap={12} style={{ flex: 1 }}>
            <RankCol rank={rank} top={top} />
            <RunnerPortrait
              username={item.username}
              // Your own row is drawn from the avatar context rather than from
              // the board's copy of it, the same rule FeedCard follows: the
              // context is what the You page draws from, so a costume change
              // can't leave the standings showing yesterday's runner.
              avatar={isMe ? myEquipped : item.avatar}
              rankKey={isMe ? myRankKey : item.rank_key}
              color={c}
              styles={styles}
              type={type}
            />
            <View style={{ flex: 1 }}>
              <Text style={type.bodyBold} numberOfLines={1}>{item.username}{isMe ? ' · you' : ''}</Text>
              <Text style={type.caption}>
                {category === 'land'
                  ? `${item.territory_count} territories`
                  : `${km2(item.total_area_m2 || 0)} km² held`}
              </Text>
            </View>
          </Row>
          <Amount value={amount.value} unit={amount.unit} color={c.stroke} />
        </Row>
      </Card>
    );
  };

  return (
    <Screen gutter={false} edges={[]}>
      <FlatList
        // `rows` holds the last board while the query is disabled, which would
        // show the global standings under a "Near me" heading. Empty is the
        // honest state, and the empty component below says why.
        //
        // The skeletons are an EMPTY STATE rather than an early return of a
        // different tree. Changing a filter refetches, and a second tree would
        // unmount the sheet the filter was chosen in — the sheet would slam
        // shut on every tap inside it.
        data={ready && !waiting ? rows : []}
        keyExtractor={(item) => item.clan_id || item.user_id}
        contentContainerStyle={{ paddingHorizontal: space.gutter, paddingBottom: space.xxl }}
        // The header is the full-bleed art rectangle, so it cancels the list's
        // own gutter rather than sitting inside it.
        ListHeaderComponent={
          <>
            <View style={{ marginHorizontal: -space.gutter }}>{header}</View>
            {/* Free, and deliberately ABOVE the board rather than pinned to the
                bottom of it: the first thing a runner should be able to read on
                a standings screen is their own standing. Solo boards only —
                the club board ranks clubs, and one runner has no place on it. */}
            {mode === 'solo' ? (
              <StandingBar
                category={category}
                opts={boardOpts}
                style={{ marginBottom: space.sm }}
              />
            ) : null}
          </>
        }
        ListEmptyComponent={
          waiting ? (
            <View>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton
                  key={i}
                  width="100%"
                  height={64}
                  style={{ borderRadius: radius.card, marginTop: space.sm }}
                />
              ))}
            </View>
          ) : field === 'local' && !here ? (
            <EmptyState
              icon={<AppIcon name="locate" size={44} />}
              title="PASER needs your location for this board"
              body="Turn location on for PASER in your device settings to see the runners around you."
              style={{ marginTop: space.xxl }}
            />
          ) : (
            <EmptyState
              icon={<AppIcon name="trophy" size={44} />}
              title={mode === 'clans' ? 'No clubs on the board yet' : 'No solo runners yet'}
              body={mode === 'clans'
                ? `No club has recorded ${CATEGORY_BY_KEY[category].description} ${WINDOW_BY_KEY[window_].sentence}.`
                : `No solo runner has recorded ${CATEGORY_BY_KEY[category].description} ${WINDOW_BY_KEY[window_].sentence}${FIELD_BY_KEY[field].sentence}.`}
              style={{ marginTop: space.xxl }}
            />
          )
        }
        // The board's HEADER is on screen in both branches — it is drawn above
        // the placeholders too — so the fade goes on the rows alone. Fading the
        // whole page would take a header that never left and blink it.
        renderItem={({ item, index }) => (
          <Arrival active={arriving}>
            {mode === 'clans' ? renderClan(item, index) : renderSolo(item, index)}
          </Arrival>
        )}
      />

      <BoardFiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        category={category}
        window_={window_}
        field={field}
        isPro={isPro}
        onCategory={selectCategory}
        onWindow={(key) => selectFilter('window', key)}
        onField={(key) => selectFilter('field', key)}
        onReset={reset}
        changed={changed}
        styles={styles}
        type={type}
        colors={colors}
      />
    </Screen>
  );
}

// A solo row's runner: their character portrait inside their rank frame, the
// way every other player surface in the app draws them (FeedCard, PasersScreen,
// RivalCard). Initials only when the account has no avatar yet.
//
// PortraitBorder sizes itself to the RING, which on an ornate tier is wider
// than the portrait inside it — so there is no fixed box around it here. A
// 40pt clipping wrapper would shear the frame's crown off, and that is exactly
// the detail the tier is for.
function RunnerPortrait({ username, avatar, rankKey, color, styles, type }) {
  const { colors } = useTheme();
  if (!avatar) {
    return (
      <View style={[styles.avatar, { backgroundColor: color.fill, borderColor: color.stroke }]}>
        <Text style={[type.bodySmBold, { color: color.stroke }]}>
          {(username || '?').slice(0, 2).toUpperCase()}
        </Text>
      </View>
    );
  }
  return (
    <PortraitBorder borderKey={rankKey || 'wood'} size={PORTRAIT}>
      <CharacterBust equipped={avatar} size={PORTRAIT} bg={colors.cardAlt} />
    </PortraitBorder>
  );
}

function RankCol({ rank, top }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.rankCol}>
      {top ? <AppIcon name="crown" size={20} /> : <Text style={[type.statSm, { color: colors.textMuted }]}>{rank}</Text>}
    </View>
  );
}

function Amount({ value, unit, color }) {
  const type = useThemedType();
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={[type.statSm, { color }]}>{value}</Text>
      <Text style={type.caption}>{unit}</Text>
    </View>
  );
}

const makeStyles = (colors, scheme) => StyleSheet.create({
  rankCol: { width: 24, alignItems: 'center' },
  // The initials fallback for a runner with no avatar yet. Sized to PORTRAIT,
  // which is also the diameter RunnerPortrait draws a real bust at, so a board
  // of mixed accounts has one row height.
  avatar: {
    width: PORTRAIT,
    height: PORTRAIT,
    borderRadius: PORTRAIT / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // --- header controls ---
  // The summary bar, and nothing else: the scope chips that used to sit above
  // it went with the scope picker. Single-line by construction, so the
  // header's height is fixed on all ten boards.
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(20,20,20,0.32)',
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  summaryText: { flex: 1, color: PANEL_INK },
  // How many axes are off their default. The sentence already says WHICH, so
  // this only has to say "you changed something" at a glance.
  summaryCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: toon.ink,
  },
  summaryCountText: { color: '#fff' },

  // --- filter sheet ---
  sheetChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sheetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: NB.strokeThin,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  sheetChipActive: {
    backgroundColor: colors.primary,
    borderColor: nbInk(scheme, colors.primary),
  },
});
