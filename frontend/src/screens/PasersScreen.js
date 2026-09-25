// Pasers — your runners, shown off. Reached from the Pasers shortcut on Home.
//
// A SOCIAL SHOWCASE, NOT A SETTINGS LIST. Cosmetics are half of what PASER is,
// and your pasers are who you dress up for, so the page leads with them: a
// grid of cards, each one the runner WHOLE (head to shoes, in what they
// actually wear), their name, their rank and their level. Tap one for their
// profile. The park the page used to be painted on stays, faded, as a strip
// behind the header — decoration, not the content.
//
// ADDING IS SECONDARY. It is one "+ Add" in the header (share your code, or
// search) and the search box under it, and it only takes the page over while
// you are typing. Somebody with pasers should not scroll past half a screen of
// add controls to see them; somebody without gets an empty state that says,
// in two buttons, what to do.
//
// One screen, three states driven by the search box:
//   empty search  -> incoming requests (if any) + your pasers
//   typing        -> username search results with an action button per row
// Every mutation returns the other runner's fresh `state`, so rows re-render
// from the response instead of us guessing the next state client-side.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { MessageCircle, Plus, Search } from 'lucide-react-native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import {
  NB_FOCUS,
  brand,
  radius,
  space,
  tintOn,
  toonRadius,
  toonSurface,
  useTheme,
  useThemedType,
  useThemedStyles,
  withAlpha,
} from '../theme';
import {
  BackButton,
  Button,
  Card,
  EmptyState,
  Input,
  OverflowMenu,
  Pill,
  Row,
  Sheet,
  Skeleton,
  ToonRow,
  ToonRowGroup,
} from '../components/ui';
import RankedAvatar from '../components/identity/RankedAvatar';
import RankCrest from '../components/identity/RankCrest';
import RunnerFigure from '../components/identity/RunnerFigure';
import { tierByKey } from '../config/rankLadder';
import { art } from '../config/onboardingArt';
import { PressableScale, Reveal, staggerDelay } from '../ui/motion';
import AppIcon from '../components/AppIcon';
import { useAuth } from '../auth/AuthContext';
import { toast } from '../ui/toast';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';
import { Image } from '../ui/image';

const MIN_QUERY = 2;

// The showcase grid. Two across on a phone, three on anything wide enough
// that two would make each runner taller than the screen wants.
const GRID_GAP = space.md;
function columnsFor(width) {
  return width >= 640 ? 3 : 2;
}
// The runner's stage inside a card, as a share of the card's width. Tall
// enough that shoes, a top and a hat all read; the figure is fitted inside it
// whole (RunnerFigure contains, it never crops).
const STAGE_RATIO = 1.12;

// --- the park showcase -------------------------------------------------
// The art (assets/art/pasers-park.png) is five stacked levels — grass, then a
// band of dirt, five times down a 941x1672 canvas — meant to be stood on, not
// just looked at. This is the page now: pasers scattered across those levels
// as their whole runner, not a grid of cards under a decorative sliver.
//
// LEVEL LINES, measured off the art (fraction of the image's own height from
// its top, where each level's grass meets its dirt). Approximate — the bands
// repeat close to evenly but were read off the picture rather than the export
// coordinates, so nudge these first if a runner's feet don't land on the
// grass on a real device.
const PARK_LEVELS_Y = [0.18, 0.38, 0.57, 0.77, 0.97];
const PARK_ASPECT = 1672 / 941;
// Two runners to a level before the rest fall back to the plain grid below —
// enough to fill the scene without it reading as a crowd scene, and a list of
// any size still renders (see `showcased`/`gridRows` in the screen itself).
const SHOWCASE_MAX = PARK_LEVELS_Y.length * 2;
const SHOWCASE_FIGURE_H = 72;
// Half the column's own width, so `left: x%` plus this (as a transform)
// centres the figure on that x rather than starting its left edge there.
const SHOWCASE_COL_W = 68;

// One paser standing in the scene: the runner, and their name in a small tag
// at their feet rather than a card wrapped around them — the environment is
// the card here.
function ShowcaseFigure({ runner, xFrac, yFrac, onOpen }) {
  const styles = useThemedStyles(makeStyles);
  const tier = tierByKey(runner.rank_key);
  const name = runner.username || 'Runner';
  return (
    <PressableScale
      onPress={() => onOpen(runner)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${tier.label} rank. Open profile`}
      style={[
        styles.showcaseFigure,
        { left: `${xFrac * 100}%`, bottom: `${(1 - yFrac) * 100}%` },
      ]}
    >
      <RunnerFigure equipped={runner.avatar} height={SHOWCASE_FIGURE_H} accessibilityLabel={`${name}'s runner`} />
      <View style={styles.showcaseTag}>
        <RankCrest tierKey={tier.key} size={11} />
        <Text style={styles.showcaseTagText} numberOfLines={1}>{name}</Text>
      </View>
    </PressableScale>
  );
}

// The scene itself: the park at its own aspect ratio, full width, with
// whichever pasers are being shown off standing in it. `runners` is capped by
// the caller at SHOWCASE_MAX — this component just places whatever it is given
// two to a level, alternating left and right of centre so a level with both
// slots filled reads as two runners who happen to be on the same path rather
// than a queue.
function ParkShowcase({ runners, onOpen, width, children }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.parkShowcase, { height: Math.round(width * PARK_ASPECT) }]}>
      <Image source={PASERS_PARK} style={StyleSheet.absoluteFill} resizeMode="cover" accessible={false} />
      {runners.map((r, i) => (
        <ShowcaseFigure
          key={r.user_id}
          runner={r}
          xFrac={i % 2 === 0 ? 0.27 : 0.7}
          yFrac={PARK_LEVELS_Y[Math.floor(i / 2) % PARK_LEVELS_Y.length]}
          onOpen={onOpen}
        />
      ))}
      {children}
    </View>
  );
}

// One runner row, for search results and requests: portrait in its rank
// frame, name, club tag, and whatever action their state affords.
function RunnerRow({ runner, onOpen, onAdd, onRespond, onRemove, busy }) {
  const type = useThemedType();
  const { colors } = useTheme();
  const accent = runner.clan_color?.stroke || colors.textMuted;

  const action = () => {
    if (busy) return <ActivityIndicator size="small" color={colors.textMuted} />;
    switch (runner.state) {
      case 'none':
        return <Button title="Add" size="sm" full={false} onPress={() => onAdd(runner)} />;
      case 'pending_out':
        return <Button title="Requested" size="sm" variant="secondary" full={false} onPress={() => onRemove(runner)} />;
      case 'pending_in':
        // Two buttons are too wide to share a line with the name on a phone
        // (the level was wrapping to two lines between them), so a request
        // answers on its own line under who sent it.
        return null;
      case 'paser':
        return <Button title="Remove" size="sm" variant="secondary" full={false} onPress={() => onRemove(runner)} />;
      default:
        return null;
    }
  };

  const request = runner.state === 'pending_in';
  return (
    <Card style={{ marginBottom: space.sm }} onPress={() => onOpen(runner)} accessibilityLabel={`${runner.username}'s profile`}>
      <Row between>
        <Row gap={space.sm} style={{ flex: 1, minWidth: 0 }}>
          <RankedAvatar equipped={runner.avatar} rankKey={runner.rank_key} size={40} bg={colors.cardAlt} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Row gap={6}>
              <Text style={[type.cardTitle, { flexShrink: 1 }]} numberOfLines={1}>{runner.username}</Text>
              {runner.clan_tag ? <Pill label={`[${runner.clan_tag}]`} color={accent} /> : null}
            </Row>
            <Text style={[type.metadata, { color: colors.textMuted }]} numberOfLines={1}>
              {request ? `Level ${runner.level ?? 0} · wants to be your Paser` : `Level ${runner.level ?? 0}`}
            </Text>
          </View>
        </Row>
        {request ? null : <View style={{ marginLeft: space.sm }}>{action()}</View>}
      </Row>
      {request ? (
        busy ? (
          <ActivityIndicator size="small" color={colors.textMuted} style={{ marginTop: space.sm }} />
        ) : (
          <Row gap={space.sm} style={{ marginTop: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button title="Accept" variant="gradient" size="sm" onPress={() => onRespond(runner, 'accept')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Decline" variant="outline" size="sm" onPress={() => onRespond(runner, 'decline')} />
            </View>
          </Row>
        )
      ) : null}
    </Card>
  );
}

// One paser in the showcase: the whole runner on a stage washed in their
// tier's colour, then who they are. The card is the button (their profile);
// the corner menu holds the one thing you might do TO them.
const PaserCard = React.memo(function PaserCard({ runner, width, busy, onOpen, onRemove }) {
  const type = useThemedType();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tier = tierByKey(runner.rank_key);
  const stageH = Math.round(width * STAGE_RATIO);
  const name = runner.username || 'Runner';
  return (
    <Card
      padded={false}
      onPress={() => onOpen(runner)}
      accessibilityLabel={`${name}, ${tier.label} rank, level ${runner.level ?? 0}. Open profile`}
      style={[styles.paserCard, { width }]}
    >
      <View style={[styles.stage, { height: stageH, backgroundColor: tintOn(colors.card, tier.color, 0.16) }]}>
        {/* A shadow to stand on, so the runner is ON the card, not floating. */}
        <View style={[styles.floor, { backgroundColor: withAlpha(tier.ink, 0.18) }]} pointerEvents="none" />
        <RunnerFigure
          equipped={runner.avatar}
          height={stageH - space.md}
          width={width - space.md}
          accessibilityLabel={`${name}'s runner`}
        />
        {busy ? (
          <View style={[StyleSheet.absoluteFill, styles.busy]}>
            <ActivityIndicator color={colors.text} />
          </View>
        ) : null}
      </View>
      <View style={styles.paserInfo}>
        <Text style={[type.cardTitle, { color: colors.text }]} numberOfLines={1}>
          {runner.clan_tag ? `[${runner.clan_tag}] ` : ''}{name}
        </Text>
        <Row gap={6} style={styles.paserRank}>
          <RankCrest tierKey={tier.key} size={14} />
          <Text style={[type.secondary, { color: colors.textMuted, flexShrink: 1 }]} numberOfLines={1}>
            {`${tier.label} · Level ${runner.level ?? 0}`}
          </Text>
        </Row>
      </View>
      <OverflowMenu
        label={`More for ${name}`}
        style={styles.paserMenu}
        actions={[
          { key: 'profile', label: 'View profile', icon: 'invite', onPress: () => onOpen(runner) },
          { key: 'remove', label: 'Remove paser', destructive: true, onPress: () => onRemove(runner) },
        ]}
      />
    </Card>
  );
});

// "+ Add": the ways to get a new paser. Pasers are added by username, so the
// share rows all send the same invite text; the deep-link rows fall back to a
// toast when the app isn't installed.
function AddPaserSheet({ visible, onClose, username, onSearch }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const message = `Add me on PASER. My username is @${username}. Run, claim ground, keep it.`;

  // iOS only answers canOpenURL for schemes declared in
  // LSApplicationQueriesSchemes (app.json) — and that list can't cover
  // everything, so a false answer isn't proof the app is missing. Try to open
  // regardless and only report failure if openURL itself throws.
  const openOr = async (url, label) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast.error(`${label} isn't available on this device`);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} closeLabel="Close">
      <View style={styles.shareHeading}>
        <AppIcon name="invite" size={42} />
        <Text style={[styles.shareTitle, { color: colors.text }]}>ADD A PASER</Text>
        <Text style={[styles.shareHint, { color: colors.textMuted }]}>Your code is your username</Text>
        <Text style={[styles.code, { color: colors.text }]}>@{username}</Text>
      </View>
      <ToonRowGroup style={{ marginTop: space.md, marginBottom: space.md }}>
        <ToonRow icon={<Search size={20} color={colors.text} />} label="Search by username" onPress={onSearch} />
        <ToonRow icon={<AppIcon name="share" size={24} />} label="Share my code" onPress={() => Share.share({ message }).catch(() => {})} />
        <ToonRow icon={<MessageCircle size={20} color="#25D366" />} label="WhatsApp" onPress={() => openOr(`whatsapp://send?text=${encodeURIComponent(message)}`, 'WhatsApp')} />
        <ToonRow icon={<AppIcon name="comment" size={24} />} label="Messages" onPress={() => openOr(`sms:?&body=${encodeURIComponent(message)}`, 'Messages')} />
      </ToonRowGroup>
    </Sheet>
  );
}

export default function PasersScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const searchRef = useRef(null);

  // { pasers, incoming, outgoing } — shares the 'pasers' key with the request
  // badge on Home's Pasers shortcut, so arriving from it draws the list at once.
  const { data, loading, refresh: load } = useQuery('pasers', api.pasers, {
    fallback: { pasers: [], incoming: [], outgoing: [] },
  });
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [pulling, setPulling] = useState(false);
  // Lifted out of the field and onto the box around it — see the search row.
  const [focused, setFocused] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // The search box itself is secondary: it does not exist on the page until
  // the runner asks for it (+Add -> Find by username), and stays once they
  // have, since backing out of a search they typed is a clear field, not a
  // box that vanishes under their thumb.
  const [searchOpen, setSearchOpen] = useState(false);

  // Portraits warm up behind rows that are already on screen.
  useEffect(() => {
    if (data) preloadRunnerAssets([data.pasers, data.incoming, data.outgoing]);
  }, [data]);

  const onRefresh = async () => {
    setPulling(true);
    try {
      await load();
    } finally {
      setPulling(false);
    }
  };

  const runSearch = async (term) => {
    setQ(term);
    const t = term.trim();
    if (t.length < MIN_QUERY) { setResults(null); return; }
    setSearching(true);
    try {
      const nextResults = await api.searchPasers(t);
      preloadRunnerAssets(nextResults);
      setResults(nextResults);
    }
    catch { setResults([]); }
    finally { setSearching(false); }
  };

  // Apply a fresh card from a mutation to whichever lists are on screen, so
  // both the search results and the pasers list stay in sync without a refetch.
  const applyCard = (card) => {
    setResults((prev) => prev && prev.map((r) => (r.user_id === card.user_id ? { ...r, ...card } : r)));
    load();
  };

  const guard = async (runner, fn) => {
    setBusyId(runner.user_id);
    try { applyCard(await fn()); }
    catch (e) { toast.error(e.message || 'Something went wrong'); }
    finally { setBusyId(null); }
  };

  const onAdd = (r) => guard(r, async () => {
    const card = await api.addPaser(r.user_id);
    toast.success(card.state === 'paser' ? `You and ${r.username} are pasers` : `Request sent to ${r.username}`);
    return card;
  });

  const onRespond = (r, action) => guard(r, async () => {
    const card = await api.respondToPaser(r.request_id, action);
    if (action === 'accept') toast.success(`You and ${r.username} are pasers`);
    return card;
  });

  const onRemove = (r) => guard(r, async () => {
    await api.removePaser(r.user_id);
    return { ...r, state: 'none', request_id: null };
  });

  const onOpen = (r) => navigation.navigate('RunnerProfile', { userId: r.user_id, username: r.username });

  const focusSearch = () => {
    setAddOpen(false);
    setSearchOpen(true);
    // After the sheet has let go of the keyboard's focus.
    setTimeout(() => searchRef.current?.focus?.(), 250);
  };

  const rowProps = { onOpen, onAdd, onRespond, onRemove };
  const searchMode = q.trim().length >= MIN_QUERY;
  const pasers = data?.pasers || [];
  const incoming = data?.incoming || [];
  // The scene shows the first SHOWCASE_MAX, two to a level; anyone past that
  // keeps their own place in the plain grid below rather than the page
  // pretending they do not exist.
  const showcased = pasers.slice(0, SHOWCASE_MAX);
  const gridRows = pasers.slice(SHOWCASE_MAX);

  const cols = columnsFor(width);
  const cardW = Math.floor((width - space.gutter * 2 - GRID_GAP * (cols - 1)) / cols);

  const search = useMemo(() => (
    <View style={[styles.search, focused && { borderColor: NB_FOCUS }]}>
      <Search size={18} color={colors.textMuted} />
      {/* The ring goes on the WRAPPER, not on this field: the search box's
          stroke belongs to `styles.search` (the pill with the magnifier in it),
          and the input inside it has no edge of its own to recolour. */}
      <Input
        ref={searchRef}
        style={[type.body, { flex: 1, color: colors.text, padding: 0 }]}
        focusable={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        value={q}
        onChangeText={runSearch}
        placeholder="Find a runner by username"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Search runners by username"
      />
      {searching ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
    </View>
  ), [q, searching, focused, colors, type, styles]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.titleRow}>
        {navigation?.canGoBack?.() ? (
          <BackButton size={36} onPress={() => navigation.goBack()} on={colors.bg} />
        ) : null}
        <Text style={[type.pageTitle, styles.title]} numberOfLines={1} accessibilityRole="header">
          Pasers
        </Text>
        <Button
          title="Add"
          variant="outline"
          size="sm"
          full={false}
          icon={<Plus size={16} color={brand.pink} strokeWidth={3} />}
          onPress={() => setAddOpen(true)}
          style={styles.addButton}
        />
      </View>
      {/* Secondary, on purpose: this box does not exist on the page until the
          runner has actually asked to search (+Add -> Find by username, or
          the empty state's own CTA), both of which call focusSearch. */}
      {searchOpen || searchMode ? search : null}
    </View>
  );

  // The main event: pasers standing in the park, two to a level. Search
  // results replace it while typing — reading a results list and a scenic
  // showcase in the same scroll would be two pages pretending to be one.
  const showcase = !searchMode ? (
    <ParkShowcase runners={showcased} onOpen={onOpen} width={width}>
      {!loading && pasers.length === 0 ? (
        <View style={styles.showcaseEmptyCta} pointerEvents="box-none">
          <LinearGradient
            colors={['transparent', withAlpha(colors.bg, 0.92)]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <Image source={art('panelPasers')} style={styles.emptyArt} resizeMode="contain" accessible={false} />
          <EmptyState title="No Pasers yet" body="Find runners or share your code." style={styles.empty} />
          <View style={styles.emptyActions}>
            <Button title="Find a Paser" variant="gradient" onPress={focusSearch} icon={<Search size={18} color="#fff" strokeWidth={2.6} />} />
            <Button title="Share my code" variant="outline" onPress={() => setAddOpen(true)} />
          </View>
        </View>
      ) : null}
    </ParkShowcase>
  ) : null;

  // Everything above the grid: the scene, then the search results while
  // typing, otherwise requests waiting on you and the grid's own heading.
  const listHeader = (
    <View>
      {header}
      {showcase}
      <View style={styles.body}>
        {loading ? null : searchMode ? (
          results === null ? (
            searching ? (
              <View style={styles.searching}>
                <ActivityIndicator size="large" color={colors.textMuted} />
                <Text style={[type.metadata, { color: colors.textMuted, marginTop: space.sm }]}>Searching...</Text>
              </View>
            ) : null
          ) : results.length === 0 ? (
            <EmptyState
              icon={<AppIcon name="invite" size={44} />}
              title="No runners found"
              body={`Nobody's username starts with "${q.trim()}". Usernames are exact, so ask them for theirs.`}
              style={{ paddingTop: space.lg }}
            />
          ) : (
            results.map((r, i) => (
              <Reveal key={r.user_id} delay={staggerDelay(i)}>
                <RunnerRow runner={r} busy={busyId === r.user_id} {...rowProps} />
              </Reveal>
            ))
          )
        ) : (
          <>
            {incoming.length > 0 ? (
              <>
                <Row between style={styles.sectionHead}>
                  <Text style={type.sectionTitle} accessibilityRole="header">Paser requests</Text>
                  <Text style={[type.secondary, { color: colors.textMuted }]}>{incoming.length}</Text>
                </Row>
                {incoming.map((r, i) => (
                  <Reveal key={r.user_id} delay={staggerDelay(i)}>
                    <RunnerRow runner={r} busy={busyId === r.user_id} {...rowProps} />
                  </Reveal>
                ))}
              </>
            ) : null}
            {/* Only when someone overflows the scene into the plain grid
                below — most runners' whole list fits in the showcase, and a
                heading over an empty grid would be a caption for nothing. */}
            {gridRows.length > 0 ? (
              <Row between style={styles.sectionHead}>
                <Text style={type.sectionTitle} accessibilityRole="header">Your Pasers</Text>
                <Text style={[type.secondary, { color: colors.textMuted }]}>{pasers.length}</Text>
              </Row>
            ) : null}
          </>
        )}
      </View>
    </View>
  );

  // FlatList's own empty state now only ever needs to cover LOADING: the
  // zero-pasers CTA moved into the scene itself (see `showcase`), and an
  // empty grid under a full showcase is the ordinary case for anyone whose
  // whole list fits on two levels — it is not "empty", it has nothing left
  // over, which is not the same thing and needs no message of its own.
  const empty = loading ? (
    <View style={[styles.body, styles.grid]}>
      {Array.from({ length: cols * 2 }).map((_, i) => (
        <Skeleton
          key={i}
          width={cardW}
          height={Math.round(cardW * STAGE_RATIO) + 56}
          style={{ borderRadius: radius.card, marginBottom: GRID_GAP }}
        />
      ))}
    </View>
  ) : null;

  // Under a full grid: one line and one button, not a second add screen.
  const footer = !loading && !searchMode && pasers.length > 0 ? (
    <View style={[styles.body, styles.findMore]}>
      <Text style={type.sectionTitle} accessibilityRole="header">Find more Pasers</Text>
      <Text style={[type.metadata, styles.findMoreHint]}>
        Search a username above, or send yours to a friend.
      </Text>
      <Button title="Share my code" variant="outline" size="sm" full={false} onPress={() => setAddOpen(true)} />
    </View>
  ) : null;

  return (
    <View style={styles.page}>
      <FlatList
        key={`cols-${cols}`}
        data={searchMode || loading ? [] : gridRows}
        keyExtractor={(r) => String(r.user_id)}
        numColumns={cols}
        columnWrapperStyle={cols > 1 ? styles.gridRow : undefined}
        renderItem={({ item, index }) => (
          <Reveal delay={staggerDelay(index)}>
            <PaserCard
              runner={item}
              width={cardW}
              busy={busyId === item.user_id}
              onOpen={onOpen}
              onRemove={onRemove}
            />
          </Reveal>
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: space.xxl + insets.bottom }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={cols * 3}
        maxToRenderPerBatch={cols * 2}
        windowSize={5}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={colors.textMuted} />}
      />
      <AddPaserSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        username={user?.username || 'you'}
        onSearch={focusSearch}
      />
    </View>
  );
}

const PASERS_PARK = require('../../assets/art/pasers-park.png');

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: space.gutter },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { flex: 1, color: colors.text },
  addButton: { height: 40, paddingHorizontal: space.md },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.card,
    borderRadius: toonRadius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    marginTop: space.md,
    ...toonSurface(colors, scheme).outline,
  },
  body: { paddingHorizontal: space.gutter },
  searching: { alignItems: 'center', paddingTop: space.xl },
  sectionHead: { alignItems: 'baseline', marginTop: space.lg, marginBottom: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: space.lg },
  gridRow: { paddingHorizontal: space.gutter, gap: GRID_GAP, marginBottom: GRID_GAP },

  paserCard: { overflow: 'hidden' },
  stage: { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: space.xs },
  floor: { position: 'absolute', bottom: space.xs, width: '56%', height: 12, borderRadius: 6 },
  busy: { alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(colors.bg, 0.5) },
  paserInfo: { paddingHorizontal: space.sm + 2, paddingTop: space.sm, paddingBottom: space.sm + 2 },
  paserRank: { marginTop: 2 },
  paserMenu: { position: 'absolute', top: 2, right: 2 },

  emptyArt: { width: 200, height: 156, alignSelf: 'center', marginTop: space.xl },
  empty: { paddingTop: space.sm, paddingBottom: space.md },
  emptyActions: { gap: space.sm },
  findMore: { marginTop: space.lg, gap: space.xs, alignItems: 'flex-start' },
  findMoreHint: { color: colors.textMuted, marginBottom: space.sm },

  // The park itself: full width, its own aspect ratio (see PARK_ASPECT), and
  // the ONLY thing behind the header from here down — not a faded strip
  // fighting the page colour for attention, the scene the whole page is for.
  parkShowcase: { width: '100%', marginTop: space.sm, overflow: 'hidden' },
  // Anchored by `bottom` (a fraction of the scene's own height, from
  // PARK_LEVELS_Y) rather than `top`, so the figure's FEET sit on the grass
  // line regardless of how tall that runner's own outfit renders.
  showcaseFigure: {
    position: 'absolute',
    alignItems: 'center',
    width: SHOWCASE_COL_W,
    transform: [{ translateX: -SHOWCASE_COL_W / 2 }],
  },
  showcaseTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
    maxWidth: SHOWCASE_COL_W,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: toonRadius.pill,
    backgroundColor: withAlpha(colors.bg, 0.85),
    ...toonSurface(colors, scheme).outline,
  },
  showcaseTagText: { ...type.metadata, fontSize: 10, color: colors.text, flexShrink: 1 },
  // The zero-pasers CTA, read as part of the scene rather than a card dropped
  // on it: a gradient up from the page's own colour so the buttons stay
  // legible over whichever level ends up behind them, not a solid panel that
  // hides the park it is supposed to be sitting in.
  showcaseEmptyCta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: '30%',
    paddingHorizontal: space.gutter,
    paddingBottom: space.lg,
  },

  shareHeading: { alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.sm },
  shareTitle: { ...type.pageTitle, marginTop: space.sm, textAlign: 'center' },
  code: { ...type.display, textTransform: 'none', marginTop: 2 },
  shareHint: { ...type.metadata, textAlign: 'center', marginTop: space.xs },
});
