// Season standings — reached from the Home hero cards. Two scopes:
//   Clubs — collective club performance.
//   Solo  — players who are not currently in a club.
// Each scope can be ranked by land, claims, captures, defenses, or distance.
// Tap a club row to open its profile; solo rows aren't tappable (no profile).
//
import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown } from 'lucide-react-native';
import AppIcon from '../components/AppIcon';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { useAuth } from '../auth/AuthContext';
import StandingBar from '../components/StandingBar';
import {
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
  Framed,
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
import { RankCrest, RunnerFigure } from '../components/identity/PlayerIdentity';
import { useAvatar } from '../state/avatar';
import { Arrival, PressableScale, useArrival } from '../ui/motion';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import { SEASON_CATEGORY_ART, SEASON_SCOPE_ART } from '../config/seasonArt';

const km2 = (m) => (m / 1e6).toFixed(2);
// Matched to the club board's badge beside it, so the two scopes' rows line up
// at the same height. The frame drawn around it can be wider — see
// RunnerPortrait — which is why nothing here is a fixed 40pt box.
const PORTRAIT = 40;
// The solo podium's runners. First stands tallest.
const PODIUM_FIRST_H = 118;
const PODIUM_H = 94;
const LEAGUE_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' };
// The scope defaults from a route param (Home's leaderboards card opens on
// Clubs) but is now also a filter in the sheet, alongside category — this
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

const DEFAULTS = { category: 'land', mode: 'clans' };

// Every board that owns an illustration, keyed the way `bannerKey` stores it.
const ART_BY_KEY = {
  ...Object.fromEntries(SCOPE_OPTIONS.map((o) => [o.key, o.art])),
  ...Object.fromEntries(CATEGORY_OPTIONS.map((o) => [o.key, o.art])),
};

// One chip inside the filter sheet. `locked` still renders as a live control:
// tapping it opens the paywall, which is a better answer than a chip that looks
// broken or one that has been hidden so nobody knows the view exists.
function SheetChip({ label, active, onPress, styles, type, colors }) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Framed
        frame={frameVariant('chip', `season:${label}`)}
        fill={active ? colors.primary : colors.bgElevated}
        on={active ? colors.primary : colors.bgElevated}
        tint={active ? colors.primaryInk : colors.textMuted}
        weight={active ? INK.medium : INK.thin}
        pose={framePose(`season:${label}`)}
        inset={3}
        contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        <Text
          style={[
            type.bodySmBold,
            { color: active ? colors.primaryInk : colors.text, paddingHorizontal: space.xs },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>

      </Framed>
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

// Rank by / Clubs / Solo. Selections apply to the board LIVE — the sheet does not
// close on a tap and there is no Apply button, so the header art, the summary
// bar and the rows behind the backdrop all move as the chips are chosen. The
// button at the bottom only dismisses.
function BoardFiltersSheet({
  visible,
  onClose,
  category,
  mode,
  onCategory,
  onMode,
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

      <ChipGroup title="Clubs / Solo" styles={styles} type={type} colors={colors}>
        {SCOPE_OPTIONS.map((option) => (
          <SheetChip key={option.key} label={option.label} active={mode === option.key}
            onPress={() => onMode(option.key)} styles={styles} type={type} colors={colors} />
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
  const [mode, setMode] = useState(SCOPE_BY_KEY[route?.params?.mode] ? route.params.mode : DEFAULTS.mode);
  const [category, setCategory] = useState(
    CATEGORY_BY_KEY[route?.params?.category] ? route.params.category : DEFAULTS.category
  );
  // Which board's illustration the header is wearing — the last one chosen.
  // Home links straight to a scope ("Clubs"/"Solo" on the season banner) with
  // no category, so open on THAT art rather than defaulting to land.
  const [bannerKey, setBannerKey] = useState(() => {
    if (CATEGORY_BY_KEY[route?.params?.category]) return route.params.category;
    if (SEASON_SCOPE_ART[route?.params?.mode]) return route.params.mode;
    return DEFAULTS.category;
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const boardOpts = { window: 'season', filter: 'all' };
  const { data: rows, loading } = useQuery(
    `season:${mode}:${category}:season:all`,
    () => api.seasonLeaderboard(mode, category, boardOpts),
    { fallback: [] }
  );
  const selectMode = (key) => {
    setMode(key);
    setBannerKey(key);
  };

  const selectCategory = (key) => {
    setCategory(key);
    setBannerKey(key);
  };

  const reset = () => {
    setCategory(DEFAULTS.category);
    setMode(DEFAULTS.mode);
    setBannerKey(DEFAULTS.category);
  };

  const art = ART_BY_KEY[bannerKey] || CATEGORY_BY_KEY[DEFAULTS.category].art;
  const changed = (category !== DEFAULTS.category ? 1 : 0) + (mode !== DEFAULTS.mode ? 1 : 0);
  const summary = `${SCOPE_BY_KEY[mode].label} by ${CATEGORY_BY_KEY[category].description}`;

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
        accessibilityHint="Choose rank by and Clubs or Solo"
      >
        <Framed
          frame={frameVariant('action', 'season-filter-bar')}
          fill="#ffffff"
          on={art.bg}
          tint={PANEL_INK}
          weight={INK.thin}
          pose={framePose('season-filter-bar')}
          style={styles.summaryBarFramed}
          contentStyle={styles.summaryBarInner}
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
        </Framed>
      </PressableScale>
    </ToonHeader>
  );

  // A disabled query never resolves, so its `loading` never clears — without
  // this, choosing "Near me" with no location permission would sit on
  // skeletons forever instead of reaching the empty state that explains why.
  const waiting = loading;
  const arriving = useArrival(waiting);

  const openClan = (clanId) => navigation.navigate('ClubDetail', { clanId });

  const renderClan = (item, index) => {
    const rank = index + 1;
    const c = item.color;
    const top = rank === 1;
    const amount = metricAmount(item, category);
    return (
      <PressableScale onPress={() => openClan(item.clan_id)}>
        <Card style={{ marginBottom: space.sm }} accent={top ? c.color : undefined} accentDrop={top}>
          <Row between>
            <Row gap={12} style={{ flex: 1 }}>
              <RankCol rank={rank} top={top} />
              <ClubAvatar photoUrl={item.photo_url} badgeIcon={item.badge_icon} color={c} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={type.bodyBold} numberOfLines={1}>[{item.tag}] {item.name}</Text>
                <Text style={type.caption}>
                  {item.member_count} members{item.league ? `, ${LEAGUE_LABEL[item.league]} league` : ''}
                </Text>
              </View>
            </Row>
            <Amount value={amount.value} unit={amount.unit} color={c.stroke} />
          </Row>
        </Card>
      </PressableScale>
    );
  };

  // THE SOLO PODIUM. The top three stand as their whole runner (outfit,
  // shoes, rank crest at their feet); everyone from fourth down is a compact
  // row with a portrait, which is what keeps this list cheap however long the
  // board is. Clubs have no runner to show, so their board is rows only.
  const soloPodium = mode === 'solo' && !waiting && (rows || []).length > 0;
  const podiumRows = soloPodium ? rows.slice(0, 3) : [];
  const listRows = soloPodium ? rows.slice(3) : rows;
  const rankOffset = soloPodium ? 3 : 0;

  const podium = soloPodium ? (
    <View style={styles.podium} accessibilityRole="summary">
      {[podiumRows[1], podiumRows[0], podiumRows[2]].filter(Boolean).map((item) => {
        const rank = rows.indexOf(item) + 1;
        const isMe = item.user_id === user.id;
        const amount = metricAmount(item, category);
        return (
          <View key={item.user_id} style={[styles.podiumCol, rank === 1 && styles.podiumFirst]}>
            {rank === 1 ? <AppIcon name="crown" size={20} style={{ marginBottom: 2 }} /> : null}
            <View style={styles.podiumRunner}>
              <RunnerFigure
                equipped={isMe ? myEquipped : item.avatar}
                height={rank === 1 ? PODIUM_FIRST_H : PODIUM_H}
                accessibilityLabel={`${item.username}'s runner`}
              />
              <RankCrest
                tierKey={(isMe ? myRankKey : item.rank_key) || 'wood'}
                size={24}
                style={styles.podiumCrest}
              />
            </View>
            <Text style={[type.statSm, { color: colors.textMuted }]}>{`#${rank}`}</Text>
            <Text style={type.bodySmBold} numberOfLines={1}>{item.username}{isMe ? ' (you)' : ''}</Text>
            <Text style={type.caption} numberOfLines={1}>{`${amount.value} ${amount.unit}`}</Text>
          </View>
        );
      })}
    </View>
  ) : null;

  const renderSolo = (item, index) => {
    const rank = index + 1 + rankOffset;
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
              <Text style={type.bodyBold} numberOfLines={1}>{item.username}{isMe ? ' (you)' : ''}</Text>
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
        data={!waiting ? listRows : []}
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
            {podium}
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
          ) : soloPodium ? null : (
            // A board of three or fewer is ALL podium: nothing is missing.
            <EmptyState
              icon={<AppIcon name="trophy" size={44} />}
              title={mode === 'clans' ? 'No clubs on the board yet' : 'No solo runners yet'}
              body={mode === 'clans'
                ? `No club has recorded ${CATEGORY_BY_KEY[category].description} this season.`
                : `No solo runner has recorded ${CATEGORY_BY_KEY[category].description} this season.`}
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
        mode={mode}
        onCategory={selectCategory}
        onMode={selectMode}
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
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: space.lg,
    marginVertical: space.md,
  },
  podiumCol: { alignItems: 'center', width: 96 },
  podiumFirst: { marginBottom: space.md },
  podiumRunner: { alignItems: 'center', justifyContent: 'flex-end', marginBottom: 4 },
  podiumCrest: { position: 'absolute', right: -6, bottom: -2 },
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
  summaryBar: { marginTop: space.md, alignSelf: 'stretch' },
  summaryBarFramed: { alignSelf: 'stretch' },
  summaryBarInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
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
});
