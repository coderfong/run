// FeedCard — one activity item: a completed run (who, distance, pace, ground
// taken), the shape of the territory it grew, and — when the run took land off
// somebody — the steal itself, played out on the card.

import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pencil } from 'lucide-react-native';
import AppIcon from './AppIcon';
import RouteThumb, { hasRouteData } from './RouteThumb';
import TerritoryStealBanner, { STEAL_HEADROOM } from './TerritoryStealBanner';

import { api, apiPhotoSource } from '../api/client';
import { updateCached } from '../api/cache';
import { radius, space, withAlpha, useTheme, useThemedType, useThemedStyles } from '../theme';
import { NEUTRAL } from '../state/clan';
import { useAvatar } from '../state/avatar';
import { CharacterBust } from './character/CharacterRig';
import PortraitBorder from './PortraitBorder';
import { PressableScale, haptic } from '../ui/motion';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import Framed from './ui/Framed';
import { Card, Row, StatValue } from './ui';
import { fmtArea } from './RivalCard';
import GameLottie from './GameLottie';
import ReactionBar, { ReactionTrigger } from './ReactionBar';
import { useRunReactions } from '../hooks/useRunReactions';
import { RunPostEditorModal } from './RunPostEditor';

// The runner's portrait on a feed row. At 34 the bust inside the frame was a
// thumbnail of a thumbnail — the whole point of the character is that you can
// tell whose it is at a glance down the feed, and the rank border it wears had
// no room to read at all.
const PORTRAIT = 46;
const POST_PHOTO_W = 272;

// What a stat shows when there is nothing to show. A dash is the usual glyph
// for this and the usual glyph is exactly the problem — the app has no dashes
// in its copy, so the empty slot gets the same mid-dot the app already uses as
// its separator.
const NO_VALUE = '·';

// The photo half of the paired map+photo row. Sized by measuring itself
// rather than a fixed pixel width, because it shares the row with the route
// map at whatever width that leaves it — there is no width to hand a
// snapToInterval ScrollView up front the way the full-width photo strip can.
function PairedPhotoCard({ media, photoPage, onPage }) {
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);

  return (
    <View
      testID="paired-photo-card"
      style={styles.pairedPhoto}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      {width > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          pagingEnabled
          onMomentumScrollEnd={(event) => {
            const page = Math.round(event.nativeEvent.contentOffset.x / width);
            onPage(Math.max(0, Math.min(media.length - 1, page)));
          }}
        >
          {media.map((uri, index) => (
            <Image
              key={`${index}:${uri.length}`}
              source={apiPhotoSource(uri)}
              style={{ width, height: '100%' }}
              resizeMode="cover"
              accessibilityLabel={`Run post photo ${index + 1} of ${media.length}`}
            />
          ))}
        </ScrollView>
      ) : null}
      {media.length > 1 ? (
        <View style={styles.photoCount}>
          <Text style={[type.captionMedium, { color: '#FFFFFF' }]}>
            {photoPage + 1}/{media.length}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function timeAgo(iso) {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function pace(distanceM, durationS) {
  if (!distanceM || distanceM < 50 || !durationS) return NO_VALUE;
  const mpk = durationS / 60 / (distanceM / 1000);
  const m = Math.floor(mpk);
  const sec = Math.round((mpk - m) * 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatArea(m2) {
  // Always km² — small claims read as fractions.
  return `${(m2 / 1e6).toFixed(m2 >= 1e5 ? 2 : 3)} km²`;
}

export default function FeedCard({ item, navigation, autoPlaySteal = false, screenFocused = true }) {
  const { colors } = useTheme();
  const type = useThemedType();
  // The themed sheet. `RouteThumb` above builds its own; this one was missed
  // when the file moved to themed styles, and since the only two uses of it
  // down here are the kudos slot, the result was a bare `ReferenceError:
  // styles is not defined` on EVERY feed row — which the per-tab
  // ErrorBoundary turned into "Something went wrong" on Home, with the stack
  // swallowed. An empty feed rendered fine, so it looked intermittent.
  const styles = useThemedStyles(makeStyles);
  const c = item.clan_color || NEUTRAL;
  const { equipped, rankKey: myRankKey } = useAvatar();
  const [kudoed, setKudoed] = useState(item.kudoed);
  const [count, setCount] = useState(item.kudos_count || 0);
  const [kudosFx, setKudosFx] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [post, setPost] = useState({
    caption: item.caption || '',
    media: item.media || [],
  });
  const [photoPage, setPhotoPage] = useState(0);
  const hasPhotos = post.media.length > 0;
  const hasRoute = hasRouteData({ rings: item.rings, path: item.path });
  const victims = item.victims || [];
  // Seeded from the row the feed already handed us, so the chips are on the
  // card at first paint rather than a fetch later.
  const { reactions, mine, burst, react } = useRunReactions(item.id, item);
  // Matches ReactionBar's own `compact` visibility rule — needed here too, so
  // the steal banner below knows whether this row is actually taking a line.
  const showsReactionsRow = reactions.length > 0 || pickerOpen;

  useEffect(() => {
    if (!screenFocused) setPickerOpen(false);
  }, [screenFocused]);

  const kudos = async () => {
    haptic.light();
    if (!kudoed) setKudosFx((token) => token + 1);
    setKudoed((k) => !k);
    setCount((n) => n + (kudoed ? -1 : 1));
    try {
      const r = await api.toggleKudos(item.id);
      setKudoed(r.kudoed);
      setCount(r.kudos_count);
      // The row is rebuilt from the cached feed when you come back to Home, so
      // the heart has to be written there too — otherwise it reverts until the
      // next fetch and reads as the tap not having registered.
      updateCached('feed', (feed) => ({
        ...feed,
        items: (feed.items || []).map((row) =>
          (row.id === item.id ? { ...row, kudoed: r.kudoed, kudos_count: r.kudos_count } : row)
        ),
      }));
    } catch {
      setKudoed(item.kudoed);
      setCount(item.kudos_count || 0);
    }
  };

  return (
    <>
    <Card
      onPress={() => {
        setPickerOpen(false);
        navigation?.navigate('RunDetail', { runId: item.id });
      }}
      style={{ marginBottom: space.md }}
    >
      <Row between>
        {/* Shrinks, so the wider portrait is never paid for by the comment and
            kudos buttons being pushed off the right edge on a long username. */}
        <Row gap={10} style={{ flexShrink: 1 }}>
          {/* character portrait — yours from local state, others' from the
              avatar the server returns; initials only when none exists yet.
              The BORDER follows the same rule: your own row reads the tier
              from /me/stats via the avatar context, which is the same source
              the You page draws from, so the two can't disagree. Falling back
              to `wood` for yourself made your feed row show a bare frame while
              your profile showed your real one. */}
          {item.is_you || item.avatar ? (
            <PortraitBorder
              borderKey={(item.is_you ? myRankKey : item.rank_key) || 'wood'}
              size={PORTRAIT}
            >
              <CharacterBust equipped={item.is_you ? equipped : item.avatar} size={PORTRAIT} bg={c.fill} />
            </PortraitBorder>
          ) : (
            <View style={{ width: PORTRAIT, height: PORTRAIT, borderRadius: PORTRAIT / 2, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[type.bodySmBold, { color: c.stroke }]}>
                {(item.username || '?').slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flexShrink: 1 }}>
            <Text style={type.bodyBold} numberOfLines={1}>
              {item.clan_tag ? `[${item.clan_tag}] ` : ''}{item.username}
              {item.is_you ? ' · you' : ''}
            </Text>
            <Text style={type.caption}>
              {item.closed_loop ? 'took ground' : 'ran a path'} · {timeAgo(item.created_at)}
            </Text>
          </View>
        </Row>
        <Row gap={2}>
          {item.is_you ? (
            <PressableScale
              onPress={() => { setPickerOpen(false); setEditOpen(true); }}
              style={styles.action}
              accessibilityRole="button"
              accessibilityLabel="Edit run post"
            >
              <Pencil size={22} color={colors.text} strokeWidth={2.3} />
            </PressableScale>
          ) : null}
          {/* Reactions sit LEFT of comment and kudos: those two are the actions
              that have always been here, and the new one should not displace
              the muscle memory for either. */}
          <ReactionTrigger
            mine={mine}
            active={pickerOpen}
            color={c.stroke}
            onPress={() => { haptic.light(); setPickerOpen((v) => !v); }}
          />
          <PressableScale
            onPress={() => {
              setPickerOpen(false);
              navigation?.navigate('RunDetail', { runId: item.id, focusComments: true });
            }}
            style={styles.action}
            accessibilityRole="button"
            accessibilityLabel="View comments"
          >
            {/* Full strength. At the shared 0.45 `faded` these two read as
                greyed-out — disabled, not "tap me" — which is the wrong signal
                for the only two things you can do to somebody else's run. */}
            <AppIcon name="comment" size={28} />
            {(item.comment_count || 0) > 0 ? (
              <Text style={[type.captionMedium, { color: colors.textMuted }]}>{item.comment_count}</Text>
            ) : null}
          </PressableScale>
          <View style={styles.kudosSlot}>
            {kudosFx > 0 ? <GameLottie name="kudos" size={86} trigger={kudosFx} style={styles.kudosFx} /> : null}
            <PressableScale onPress={kudos} style={styles.action} accessibilityRole="button" accessibilityLabel="Give kudos">
              {/* Kudos still has two states, but the "not yet" one is a step
                  down rather than a fade to grey — the heart keeps its colour so
                  the difference reads as weight, not as availability. */}
              <AppIcon name="like" size={28} />
              {count > 0 ? <Text style={[type.captionMedium, { color: kudoed ? c.stroke : colors.textMuted }]}>{count}</Text> : null}
            </PressableScale>
          </View>
        </Row>
      </Row>

      {/* A photo sits BESIDE the map rather than stacked under it, so the two
          read as one row about the run instead of two separate blocks.
          Standalone, each keeps the fuller layout it already had — a photo
          alone does not need to give up half its width to nothing. */}
      {hasPhotos && hasRoute ? (
        <View style={styles.pairedRow}>
          <RouteThumb id={item.id} rings={item.rings} path={item.path} color={c.stroke} style={styles.thumbCompact} compact />
          <PairedPhotoCard media={post.media} photoPage={photoPage} onPage={setPhotoPage} />
        </View>
      ) : hasPhotos ? (
        <View style={styles.postPhotoWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={POST_PHOTO_W + space.sm}
            decelerationRate="fast"
            contentContainerStyle={styles.postPhotoRow}
            onMomentumScrollEnd={(event) => {
              const page = Math.round(
                event.nativeEvent.contentOffset.x / (POST_PHOTO_W + space.sm)
              );
              setPhotoPage(Math.max(0, Math.min(post.media.length - 1, page)));
            }}
          >
            {post.media.map((uri, index) => (
              <Image
                key={`${index}:${uri.length}`}
                source={apiPhotoSource(uri)}
                style={styles.postPhoto}
                resizeMode="cover"
                accessibilityLabel={`Run post photo ${index + 1} of ${post.media.length}`}
              />
            ))}
          </ScrollView>
          {post.media.length > 1 ? (
            <View style={styles.photoCount}>
              <Text style={[type.captionMedium, { color: '#FFFFFF' }]}>
                {photoPage + 1}/{post.media.length}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <RouteThumb id={item.id} rings={item.rings} path={item.path} color={c.stroke} style={styles.thumb} />
      )}

      {/* Caption sits directly under the map, above its reactions — read
          order goes what happened → what they said about it → how people
          reacted. Framed and labelled like the app's other "here's a moment"
          boxes (see ClaimPayoff's people-you-took-land-from card) instead of
          a stray line of small grey text. */}
      {post.caption ? (
        <Framed
          frame={frameVariant('box', `caption:${item.id}`)}
          tint={withAlpha(c.stroke, 0.55)}
          fill={colors.card}
          weight={INK.thin}
          pose={framePose(`caption:${item.id}`)}
          inset={false}
          style={styles.captionFrame}
          contentStyle={styles.captionInner}
        >
          <Text style={[type.labelSm, { color: c.stroke }]}>NOTE</Text>
          <Text style={[type.bodyBold, styles.captionBody]}>{post.caption}</Text>
        </Framed>
      ) : null}

      {/* Reactions below the caption, not above it — this is the same bar
          that also hosts the "add a reaction" popover, so the chip summary
          and the picker never compete for separate space. It costs no row at
          all when there is nothing to show and no picker open (ReactionBar's
          own `compact` rule). */}
      <ReactionBar
        compact
        reactions={reactions}
        mine={mine}
        color={c.stroke}
        onReact={react}
        burst={burst}
        open={pickerOpen}
        inlinePicker
        onRequestClose={() => setPickerOpen(false)}
        style={styles.reactionsRow}
      />

      {/* The steal, on the card. It starts SETTLED — heads on the bar pulling
          a face, the amount stamped on — and detonates when tapped, because a
          feed that blows itself up as you scroll is noise rather than a
          payoff. The newest steal on the page is the one that plays itself.

          Pulled up by its own headroom: the banner reserves 90pt of empty stage
          above the bar for the fireball to have somewhere to go, and stacked
          normally that stage was a blank white gap between the route and the
          STOLEN bar. Negative margin puts the bar directly under the map and
          lets the blast play OVER it, which is where an explosion should be
          anyway. That trick only works when the map is what sits directly
          above it — with the reactions row or a caption in between, the pull
          would drag the bar up over one of those instead, so it only pulls
          tight when there is neither. */}
      {victims.length > 0 && (
        <TerritoryStealBanner
          trigger={item.id}
          victims={victims}
          amount={fmtArea(item.stolen_m2 || 0)}
          autoPlay={autoPlaySteal}
          haptics={autoPlaySteal}
          style={{
            marginTop: post.caption || showsReactionsRow ? space.md : space.sm - STEAL_HEADROOM,
          }}
        />
      )}

      <Row between style={{ marginTop: space.md }}>
        <StatValue size="sm" label="Distance" value={`${(item.distance_m / 1000).toFixed(2)}`} unit="km" />
        <StatValue size="sm" label="Pace" value={pace(item.distance_m, item.duration_s)} unit="/km" />
        <StatValue
          size="sm"
          label={item.closed_loop ? 'Claimed' : 'Not claimed'}
          value={item.closed_loop ? formatArea(item.area_m2).split(' ')[0] : NO_VALUE}
          unit={item.closed_loop ? formatArea(item.area_m2).split(' ')[1] : ''}
          color={item.closed_loop ? c.stroke : colors.textDim}
        />
      </Row>
    </Card>
    <RunPostEditorModal
      visible={editOpen}
      onClose={() => setEditOpen(false)}
      runId={item.id}
      initialCaption={post.caption}
      initialMedia={post.media}
      onSaved={(next) => setPost({ caption: next.caption || '', media: next.media || [] })}
    />
    </>
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    // Sizing (aspect ratio, centring) is RouteThumb's own default style —
    // this is only the layout this ROW wants around it.
    thumb: { marginTop: space.md },
    // The map's half of the paired row — margin lives on `pairedRow` instead,
    // since this box now shares a line with the photo rather than starting
    // one of its own.
    thumbCompact: { flex: 1 },
    pairedRow: {
      flexDirection: 'row',
      gap: space.sm,
      marginTop: space.md,
    },
    pairedPhoto: {
      flex: 1,
      aspectRatio: 1,
      borderRadius: radius.md,
      overflow: 'hidden',
      backgroundColor: colors.cardAlt,
    },
    kudosSlot: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
    kudosFx: { position: 'absolute', zIndex: 4 },
    action: {
      minWidth: 40,
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      padding: 4,
    },
    // Its own line under the map now, not scattered on top of it — see
    // RouteThumb and the note above the ReactionBar render.
    reactionsRow: { marginTop: space.md },
    captionFrame: { marginTop: space.md },
    captionInner: { padding: space.md },
    // `bodyBold` alone (15pt) was the same weight the header row's stat labels
    // use — bumped a couple of points so a caption reads as the bigger, more
    // deliberate thing it is now that it has its own framed box and header.
    captionBody: { fontSize: 17, lineHeight: 23, marginTop: 2 },
    postPhotoWrap: {
      height: 190,
      marginTop: space.md,
    },
    postPhotoRow: { gap: space.sm, paddingRight: space.md },
    postPhoto: {
      width: POST_PHOTO_W,
      height: 190,
      borderRadius: radius.md,
      backgroundColor: colors.cardAlt,
    },
    photoCount: {
      position: 'absolute',
      right: 10,
      bottom: 10,
      minWidth: 34,
      height: 30,
      paddingHorizontal: 8,
      borderRadius: 15,
      backgroundColor: 'rgba(0,0,0,0.72)',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
