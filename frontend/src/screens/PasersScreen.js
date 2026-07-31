// Pasers — your runners. Reached from the You tab.
//
// One screen, three states driven by the search box:
//   empty search  -> incoming requests (if any) + your pasers
//   typing        -> username search results with an action button per row
// Every mutation returns the other runner's fresh `state`, so rows re-render
// from the response instead of us guessing the next state client-side.

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageCircle, Search, Share2 } from 'lucide-react-native';

import { api } from '../api/client';
import { brand, radius, space, toonRadius, toonSurface, useTheme, useThemedType, useThemedStyles } from '../theme';
import {
  Screen,
  Card,
  Row,
  Button,
  Pill,
  SectionHeader,
  Skeleton,
  EmptyState,
  ToonHeader,
  ToonRow,
  ToonRowGroup,
} from '../components/ui';
import { CharacterBust } from '../components/character/CharacterRig';
import { PressableScale } from '../ui/motion';
import AppIcon from '../components/AppIcon';
import { art } from '../config/onboardingArt';
import { useAuth } from '../auth/AuthContext';
import { toast } from '../ui/toast';

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
            <View style={[styles.bust, { backgroundColor: colors.cardAlt }]}>
              <CharacterBust equipped={runner.avatar} size={40} bg={colors.cardAlt} />
            </View>
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
function InviteRows({ username }) {
  const { colors } = useTheme();
  const message = `Add me on PASER — my username is @${username}. Run, claim ground, keep it.`;

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
    <ToonRowGroup style={{ marginTop: space.md }}>
      <ToonRow
        icon={<Share2 size={20} color={colors.text} />}
        label="Share your username"
        onPress={() => Share.share({ message }).catch(() => {})}
      />
      <ToonRow
        icon={<MessageCircle size={20} color="#25D366" />}
        label="WhatsApp"
        onPress={() => openOr(`whatsapp://send?text=${encodeURIComponent(message)}`, 'WhatsApp')}
      />
      <ToonRow
        icon={<MessageCircle size={20} color={colors.text} />}
        label="Messages"
        onPress={() => openOr(`sms:?&body=${encodeURIComponent(message)}`, 'Messages')}
      />
    </ToonRowGroup>
  );
}

export default function PasersScreen({ navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [data, setData] = useState(null);        // { pasers, incoming, outgoing }
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.pasers()); } catch { setData({ pasers: [], incoming: [], outgoing: [] }); }
    finally { setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const runSearch = async (term) => {
    setQ(term);
    const t = term.trim();
    if (t.length < MIN_QUERY) { setResults(null); return; }
    setSearching(true);
    try { setResults(await api.searchPasers(t)); }
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
    <View style={styles.search}>
      <Search size={18} color={colors.textMuted} />
      <TextInput
        style={[type.body, { flex: 1, color: colors.text, padding: 0 }]}
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
        onPress={() => Share.share({
          message: `Add me on PASER — my username is @${user?.username || 'me'}. `
            + 'Run, claim ground, keep it.',
        }).catch(() => {})}
        accessibilityRole="button"
        accessibilityLabel="Invite a friend to PASER"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <AppIcon name="invite" size={24} />
      </TouchableOpacity>
    </View>
  ), [q, searching, colors, type, styles, user?.username]);

  const header = (
    <ToonHeader
      eyebrow="DON'T RUN ALONE"
      title="ADD PASERS"
      leftArt={art('getStartedLeft')}
      rightArt={art('getStartedRight')}
      solid={brand.teal}
      top={insets.top}
      onBack={() => navigation.goBack()}
    >
      {search}
    </ToonHeader>
  );

  if (!data) {
    return (
      <Screen gutter={false} edges={[]}>
        {header}
        <View style={{ paddingHorizontal: space.gutter }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} width="100%" height={72} style={{ borderRadius: radius.card, marginTop: space.sm }} />
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen gutter={false} edges={[]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.textMuted} />}
      >
        {header}

        <View style={{ paddingHorizontal: space.gutter }}>
        {searchMode ? (
          results === null ? null : results.length === 0 ? (
            <EmptyState
              icon={<AppIcon name="invite" size={44} />}
              title="No runners found"
              body={`Nobody's username starts with "${q.trim()}". Usernames are exact — ask them for theirs.`}
              style={{ paddingTop: space.xl }}
            />
          ) : (
            results.map((r) => (
              <RunnerRow key={r.user_id} runner={r} busy={busyId === r.user_id} {...rowProps} />
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
                {incoming.map((r) => (
                  <RunnerRow key={r.user_id} runner={r} busy={busyId === r.user_id} {...rowProps} />
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
              pasers.map((r) => (
                <RunnerRow key={r.user_id} runner={r} busy={busyId === r.user_id} {...rowProps} />
              ))
            )}

            <SectionHeader
              title="Find pasers from other apps"
              style={{ marginTop: space.xl, marginBottom: space.xs }}
            />
            <InviteRows username={user?.username || 'you'} />
          </>
        )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (colors, scheme) => StyleSheet.create({
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
  bust: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden' },
});
