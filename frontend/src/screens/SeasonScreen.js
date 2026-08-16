// Season standings — reached from the Home season banner. Two scopes:
//   Clubs — collective club performance.
//   Solo  — players who are not currently in a club.
// Each scope can be ranked by land, claims, captures, defenses, or distance.
// Tap a club row to open its profile; solo rows aren't tappable (no profile).
//
// All seven boards live in ONE wrapped chip row under a `panel` ToonHeader —
// Home's hero-card format, shared with Pasers and Rivals: flat brand colour,
// black copy on the left, the board's characters as a cut-out on the right.
// Whichever chip you tap last owns the header art and the panel colour, so the
// illustration for a board is shown whole instead of as a thumbnail in a
// picker.

import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import useCoarsePosition from '../hooks/useCoarsePosition';
import usePro from '../hooks/usePro';
import { useAuth } from '../auth/AuthContext';
import BuyProSheet from '../components/BuyProSheet';
import StandingBar from '../components/StandingBar';
import { radius, space, toon, withAlpha, useTheme, useThemedStyles, useThemedType } from '../theme';
import { NEUTRAL } from '../state/clan';
import { Screen, Card, Row, Skeleton, EmptyState, PANEL_INK, ToonHeader } from '../components/ui';
import ClubAvatar from '../components/ClubAvatar';
import { Arrival, PressableScale, useArrival } from '../ui/motion';
import { SEASON_CATEGORY_ART, SEASON_SCOPE_ART } from '../config/seasonArt';

const km2 = (m) => (m / 1e6).toFixed(2);
const LEAGUE_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };
const SCOPE_OPTIONS = [
  { key: 'clans', label: 'Clubs', art: SEASON_SCOPE_ART.clans },
  { key: 'solo', label: 'Solo', art: SEASON_SCOPE_ART.solo },
];
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

// The seven chips, in strip order. `axis` is what a tap sets — the backend
// board is still scope × category (see routes/leaderboard.py), so the two
// scope chips and the five category chips stay independently selectable
// rather than collapsing into one seven-way choice, which would leave three
// of the ten boards unreachable.
const BOARD_OPTIONS = [
  ...SCOPE_OPTIONS.map((option) => ({ ...option, axis: 'scope', shortLabel: option.label })),
  ...CATEGORY_OPTIONS.map((option) => ({ ...option, axis: 'category' })),
];
const BOARD_BY_KEY = Object.fromEntries(BOARD_OPTIONS.map((item) => [item.key, item]));

// One chip on the PRO row. `locked` still renders as a live control: tapping
// it opens the paywall, which is a better answer than a chip that looks broken
// or one that has been hidden so nobody knows the view exists.
function FilterChip({ label, active, locked, onPress, styles, type }) {
  return (
    <PressableScale
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={locked ? `${label}. Paser Pro` : label}
    >
      <Text
        style={[type.bodySmBold, styles.chipLabel, active && styles.chipLabelActive]}
        numberOfLines={1}
      >
        {locked ? `${label} ✦` : label}
      </Text>
    </PressableScale>
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
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [mode, setMode] = useState(route.params?.mode || 'clans');
  const [category, setCategory] = useState(
    CATEGORY_BY_KEY[route.params?.category] ? route.params.category : 'land'
  );
  // Which chip's illustration the header is wearing — the last one tapped.
  // Home links straight to a scope ("Clubs"/"Solo" on the season banner) with
  // no category, so open on THAT art rather than defaulting to land.
  const [bannerKey, setBannerKey] = useState(() => {
    if (CATEGORY_BY_KEY[route.params?.category]) return route.params.category;
    if (SEASON_SCOPE_ART[route.params?.mode]) return route.params.mode;
    return 'land';
  });
  // One cache entry PER BOARD (scope + category), so flipping between Clubs,
  // Solo, land and distance re-shows a board you have already looked at
  // instantly instead of blanking to skeletons on every toggle. useQuery
  // re-seeds itself when the key changes, which also retires the request-id
  // guard that used to be needed to ignore a slow board arriving late.
  // The PRO filters. `season` + `all` is the free board, so a runner who never
  // touches these chips has exactly the screen they had before.
  const [window_, setWindow] = useState('season');
  const [field, setField] = useState('all');
  const [payOpen, setPayOpen] = useState(false);
  const { isPro } = usePro();
  // Only fetched for the one filter that needs it, and only when it is chosen
  // — asking for a position to draw a board nobody has asked for would be a
  // location prompt out of nowhere.
  const here = useCoarsePosition(field === 'local');

  const boardOpts = { window: window_, filter: field, lat: here?.lat, lon: here?.lon };
  // `local` cannot be requested until a position arrives; the server refuses
  // it outright rather than quietly answering globally.
  const ready = field !== 'local' || !!here;

  const { data: rows, loading } = useQuery(
    ready ? `season:${mode}:${category}:${window_}:${field}` : null,
    () => api.seasonLeaderboard(mode, category, boardOpts),
    { fallback: [] }
  );

  const selectFilter = (axis, key) => {
    // A free runner gets the paywall, not a silent no-op and not a 402 toast.
    if (!isPro && key !== (axis === 'window' ? 'season' : 'all')) {
      setPayOpen(true);
      return;
    }
    (axis === 'window' ? setWindow : setField)(key);
  };

  const banner = BOARD_BY_KEY[bannerKey] || CATEGORY_BY_KEY.land;

  const selectBoard = (option) => {
    // No blanking here: changing the scope/category changes the query key, and
    // a board that's already cached swaps in on the same frame as the tap.
    setBannerKey(option.key);
    if (option.axis === 'scope') setMode(option.key);
    else setCategory(option.key);
  };

  const header = (
    <ToonHeader
      panel
      eyebrow="Season"
      title="Season standings"
      // Home's hero-card format: the selected board's characters as a cut-out
      // on the right of a flat panel in that board's colour, black copy on the
      // left. The illustration used to fill the rectangle behind a scrim, which
      // is why it needed white outlined text over it.
      art={banner.art.source}
      solid={banner.art.bg}
      subtitle={`${mode === 'clans' ? 'Clubs' : 'Solo runners'} ranked by ${CATEGORY_BY_KEY[category].description} ${WINDOW_BY_KEY[window_].sentence}${FIELD_BY_KEY[field].sentence}.`}
      // The two things that differ per board are the art's shape and the
      // length of that sentence, and both were sizing the header — tapping
      // from Captures (a wide illustration, a short sentence) to Land (a tall
      // one, a long sentence) moved the whole board under the reader's thumb.
      // Fixing the art box and reserving the sentence's tallest line count
      // makes the header the same height on all seven.
      stableArt
      subtitleLines={3}
      titleStyle={type.display}
      eyebrowStyle={type.labelSm}
      top={insets.top}
      onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeMain'))}
      style={{ marginBottom: space.md }}
    >
      {/* All seven boards, WRAPPED inside the panel's gutter. This used to be a
          horizontal strip that bled past the gutter to advertise its own
          scrollability — which just cut the last chip in half at the screen
          edge and read as the row escaping the card. */}
      <View style={styles.chipRow}>
        {BOARD_OPTIONS.map((option, index) => {
          const active = option.axis === 'scope' ? option.key === mode : option.key === category;
          return (
            <React.Fragment key={option.key}>
              {/* hairline where "who is ranked" hands over to "ranked by what" */}
              {index === SCOPE_OPTIONS.length ? <View style={styles.chipDivider} /> : null}
              <PressableScale
                onPress={() => selectBoard(option)}
                style={[styles.chip, active && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={
                  option.axis === 'scope'
                    ? `${option.label} standings`
                    : `Rank by ${option.label}`
                }
              >
                <Text
                  style={[type.bodySmBold, styles.chipLabel, active && styles.chipLabelActive]}
                  numberOfLines={1}
                >
                  {option.shortLabel}
                </Text>
              </PressableScale>
            </React.Fragment>
          );
        })}
      </View>

      {/* The PRO row: WHEN and WHO, under the free "who is ranked by what"
          row above. Locked chips stay visible and tappable rather than being
          hidden or dimmed out of reach — a runner should be able to see what
          PRO would give them and open the paywall from the thing itself. */}
      <View style={styles.chipRow}>
        {WINDOW_OPTIONS.map((option) => (
          <FilterChip
            key={`w:${option.key}`}
            label={option.label}
            active={window_ === option.key}
            locked={!isPro && option.key !== 'season'}
            onPress={() => selectFilter('window', option.key)}
            styles={styles}
            type={type}
          />
        ))}
        <View style={styles.chipDivider} />
        {FIELD_OPTIONS.map((option) => (
          <FilterChip
            key={`f:${option.key}`}
            label={option.label}
            active={field === option.key}
            locked={!isPro && option.key !== 'all'}
            onPress={() => selectFilter('field', option.key)}
            styles={styles}
            type={type}
          />
        ))}
      </View>
    </ToonHeader>
  );

  // A disabled query never resolves, so its `loading` never clears — without
  // this, choosing "Near me" with no location permission would sit on
  // skeletons forever instead of reaching the empty state that explains why.
  const waiting = loading && ready;
  const arriving = useArrival(waiting);

  if (waiting) {
    return (
      <Screen gutter={false} edges={[]}>
        {header}
        <View style={{ paddingHorizontal: space.gutter }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={64} style={{ borderRadius: radius.card, marginTop: space.sm }} />
          ))}
        </View>
      </Screen>
    );
  }

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
      <Card style={[{ marginBottom: space.sm }, isMe && { backgroundColor: withAlpha(c.stroke, 0.1) }]}>
        <Row between>
          <Row gap={12} style={{ flex: 1 }}>
            <RankCol rank={rank} top={top} />
            <View style={[styles.avatar, { backgroundColor: c.fill, borderColor: c.stroke }]}>
              <Text style={[type.bodySmBold, { color: c.stroke }]}>
                {(item.username || '?').slice(0, 2).toUpperCase()}
              </Text>
            </View>
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
        data={ready ? rows : []}
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
          field === 'local' && !here ? (
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
      <BuyProSheet visible={payOpen} onClose={() => setPayOpen(false)} />
    </Screen>
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

const makeStyles = () => StyleSheet.create({
  rankCol: { width: 24, alignItems: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  // --- header board chips ---
  // Wrapped, not scrolled, and with no negative margin — the row stays inside
  // the panel's gutter so no chip is ever clipped by the card edge.
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.md,
  },
  // These sit on a bright flat panel now, not on a scrimmed illustration, so
  // the whole set flips from white-on-dark to ink-on-light.
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(20,20,20,0.28)',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  chipActive: { backgroundColor: '#fff', borderColor: toon.ink },
  chipLabel: { color: PANEL_INK, opacity: 0.8 },
  chipLabelActive: { color: toon.ink, opacity: 1 },
  chipDivider: {
    width: 1,
    height: 20,
    marginHorizontal: space.xs,
    backgroundColor: 'rgba(20,20,20,0.28)',
  },
});
