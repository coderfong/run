// Pasers — your runners. Reached from the You tab.
//
// One screen, three states driven by the search box:
//   empty search  -> incoming requests (if any) + your pasers
//   typing        -> username search results with an action button per row
// Every mutation returns the other runner's fresh `state`, so rows re-render
// from the response instead of us guessing the next state client-side.

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle, Search } from 'lucide-react-native';

import { api } from '../api/client';
import { useQuery } from '../hooks/useQuery';
import { NB_FOCUS, radius, space, toonRadius, toonSurface, useTheme, useThemedType, useThemedStyles } from '../theme';
import {
  Screen,
  Card,
  Row,
  Button,
  Pill,
  SectionHeader,
  Skeleton,
  EmptyState,
  Input,
  Sheet,
  ToonHeader,
  ToonRow,
  ToonRowGroup,
} from '../components/ui';
import { CharacterBust } from '../components/character/CharacterRig';
import PortraitBorder from '../components/PortraitBorder';
import { PressableScale, Reveal, staggerDelay } from '../ui/motion';
import AppIcon from '../components/AppIcon';
import { useAuth } from '../auth/AuthContext';
import { toast } from '../ui/toast';
import { preloadRunnerAssets } from '../utils/runnerAssetPreload';
import { Image } from '../ui/image';

const MIN_QUERY = 2;

// One runner row: bust, name, club tag, and whatever action their state affords.
function RunnerRow({ runner, onOpen, onAdd, onRespond, onRemove, busy }) {
  const type = useThemedType();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const accent = runner.clan_color?.stroke || colors.textMuted;

  const action = () => {
    if (busy) return <ActivityIndicator size="small" color={colors.textMuted} />;
    switch (runner.state) {
      case 'none':
        return <Button title="Add" size="sm" full={false} onPress={() => onAdd(runner)} />;
      case 'pending_out':
        return <Button title="Requested" size="sm" variant="secondary" full={false} onPress={() => onRemove(runner)} />;
      case 'pending_in':
        return (
          <Row gap={6}>
            <Button title="Accept" size="sm" full={false} onPress={() => onRespond(runner, 'accept')} />
            <Button title="Decline" size="sm" variant="secondary" full={false} onPress={() => onRespond(runner, 'decline')} />
          </Row>
        );
      case 'paser':
        return <Button title="Remove" size="sm" variant="secondary" full={false} onPress={() => onRemove(runner)} />;
      default:
        return null;
    }
  };

  return (
    <Card style={{ marginBottom: space.sm }}>
      <Row between>
        <PressableScale style={{ flex: 1 }} onPress={() => onOpen(runner)} accessibilityRole="button" accessibilityLabel={`${runner.username}'s profile`}>
          <Row gap={12} style={{ flex: 1 }}>
            <PortraitBorder borderKey={runner.rank_key || 'wood'} size={40}>
              <CharacterBust equipped={runner.avatar} size={40} bg={colors.cardAlt} />
            </PortraitBorder>
            <View style={{ flex: 1 }}>
              <Row gap={6}>
                <Text style={type.bodyBold} numberOfLines={1}>{runner.username}</Text>
                {runner.clan_tag ? <Pill label={`[${runner.clan_tag}]`} color={accent} /> : null}
              </Row>
              <Text style={type.caption}>Level {runner.level}</Text>
            </View>
          </Row>
        </PressableScale>
        <View style={{ marginLeft: space.sm }}>{action()}</View>
      </Row>
    </Card>
  );
}

// "Find pasers from other apps" — pasers are added by username, so every row
// shares the same invite text; the deep-link rows fall back to a toast when
// the app isn't installed. (No copy-link row: that needs expo-clipboard,
// which isn't a dependency yet.)
function ShareCodeSheet({ visible, onClose, username }) {
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
    <Sheet visible={visible} onClose={onClose} closeLabel="Close sharing">
      <View style={styles.shareHeading}>
        <AppIcon name="invite" size={42} />
        <Text style={[styles.shareTitle, { color: colors.text }]}>SHARE YOUR PASER CODE</Text>
        <Text style={[styles.code, { color: colors.text }]}>@{username}</Text>
        <Text style={[styles.shareHint, { color: colors.textMuted }]}>Friends can search this username to add you as a Paser.</Text>
      </View>
      <ToonRowGroup style={{ marginTop: space.md, marginBottom: space.md }}>
        <ToonRow icon={<AppIcon name="share" size={24} />} label="Share your code" onPress={() => Share.share({ message }).catch(() => {})} />
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
  const { user } = useAuth();

  // { pasers, incoming, outgoing } — shares the 'pasers' key with the badge on
  // the profile, so arriving from You draws the list at once.
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
  const [shareOpen, setShareOpen] = useState(false);

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

  const rowProps = { onOpen, onAdd, onRespond, onRemove };
  const searchMode = q.trim().length >= MIN_QUERY;
  const pasers = data?.pasers || [];
  const incoming = data?.incoming || [];

  const search = useMemo(() => (
    <View style={[styles.search, focused && { borderColor: NB_FOCUS }]}>
      <Search size={18} color={colors.textMuted} />
      {/* The ring goes on the WRAPPER, not on this field: the search box's
          stroke belongs to `styles.search` (the pill with the magnifier in it),
          and the input inside it has no edge of its own to recolour. */}
      <Input
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
      {/* Invite shortcut — the full share rows live further down the page, but
          adding someone who isn't on PASER yet is the common case, so it gets
          a tap here too. */}
      <TouchableOpacity
        onPress={() => setShareOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Invite a friend to PASER"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <AppIcon name="invite" size={24} />
      </TouchableOpacity>
    </View>
  ), [q, searching, focused, colors, type, styles]);

  const header = (
    <ToonHeader
      onArt
      eyebrow="YOUR RUNNING CIRCLE"
      title="PASERS"
      titleStyle={type.display}
      eyebrowStyle={type.labelSm}
      subtitle="Find friends, accept requests, and grow your crew."
      top={insets.top}
      // These screens are reachable straight from another tab, where there
      // may be nothing beneath them to pop back to — fall through to the
      // profile rather than leaving a back button that does nothing.
      onBack={() =>
        (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('YouMain'))
      }
    >
      {search}
      <PressableScale
        onPress={() => setShareOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Share your Paser code"
        style={styles.shareCodeButton}
      >
        <AppIcon name="share" size={22} />
        <View style={{ flex: 1 }}>
          <Text style={[type.bodyBold, { color: colors.text }]}>Share your code</Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>@{user?.username || 'you'}</Text>
        </View>
        <Text style={[type.labelSm, { color: colors.text }]}>OPEN</Text>
      </PressableScale>
    </ToonHeader>
  );

  if (loading) {
    return (
      <View style={styles.page}>
        <Image source={PASERS_PARK} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        <Screen gutter={false} edges={[]} style={styles.transparent}>
        {header}
        <View style={{ paddingHorizontal: space.gutter }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={72} style={{ borderRadius: radius.card, marginTop: space.sm }} />
          ))}
        </View>
        </Screen>
        <ShareCodeSheet visible={shareOpen} onClose={() => setShareOpen(false)} username={user?.username || 'you'} />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <Image source={PASERS_PARK} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
      <Screen gutter={false} edges={[]} style={styles.transparent}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={colors.textMuted} />}
      >
        {header}

        <View style={{ paddingHorizontal: space.gutter }}>
        {searchMode ? (
          results === null ? null : results.length === 0 ? (
            <EmptyState
              icon={<AppIcon name="invite" size={44} />}
              title="No runners found"
              body={`Nobody's username starts with "${q.trim()}". Usernames are exact, so ask them for theirs.`}
              style={{ paddingTop: space.xl }}
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
            {incoming.length > 0 && (
              <>
                <SectionHeader
                  title="Paser requests"
                  action={`${incoming.length}`}
                  style={{ marginTop: space.md, marginBottom: space.md }}
                />
                {incoming.map((r, i) => (
                  <Reveal key={r.user_id} delay={staggerDelay(i)}>
                    <RunnerRow runner={r} busy={busyId === r.user_id} {...rowProps} />
                  </Reveal>
                ))}
              </>
            )}

            <SectionHeader
              title="Your pasers"
              action={pasers.length ? `${pasers.length}` : undefined}
              style={{ marginTop: space.xl, marginBottom: space.md }}
            />
            {pasers.length === 0 ? (
              <EmptyState
                icon={<AppIcon name="invite" size={64} />}
                title="No pasers yet"
                body="Search a username above, or send your own to a friend."
                style={{ paddingTop: space.lg }}
              />
            ) : (
              pasers.map((r, i) => (
                <Reveal key={r.user_id} delay={staggerDelay(i)}>
                  <RunnerRow runner={r} busy={busyId === r.user_id} {...rowProps} />
                </Reveal>
              ))
            )}

          </>
        )}
        </View>
      </ScrollView>
      </Screen>
      <ShareCodeSheet visible={shareOpen} onClose={() => setShareOpen(false)} username={user?.username || 'you'} />
    </View>
  );
}

// The supplied park is the page itself; cards and controls stand on its open
// platforms rather than placing another hero illustration over the top.
const PASERS_PARK = require('../../assets/art/pasers-park.png');

const makeStyles = (colors, scheme) => StyleSheet.create({
  page: { flex: 1, backgroundColor: '#62BAF4' },
  transparent: { backgroundColor: 'transparent' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.card,
    borderRadius: toonRadius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
    marginTop: space.md,
    ...toonSurface(colors, scheme).outline,
  },
  shareCodeButton: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.card, borderRadius: toonRadius.card,
    paddingHorizontal: space.lg, paddingVertical: 12, marginTop: space.sm,
    ...toonSurface(colors, scheme).outline,
  },
  shareHeading: { alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.sm },
  shareTitle: { fontSize: 20, fontWeight: '900', marginTop: space.sm, textAlign: 'center' },
  code: { fontSize: 28, fontWeight: '900', marginTop: space.sm },
  shareHint: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: space.xs },
});
