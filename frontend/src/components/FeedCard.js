// FeedCard — one activity item: a completed run (who, distance, pace, ground
// taken), the shape of the territory it grew, and — when the run took land off
// somebody — the steal itself, played out on the card.

import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { Pencil } from 'lucide-react-native';
import AppIcon from './AppIcon';
import TerritoryStealBanner, { STEAL_HEADROOM } from './TerritoryStealBanner';
import EmoteIcon from '../effects/EmoteIcon';
import ReactionEffect from '../effects/ReactionEffect';

import { api } from '../api/client';
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
import {
  expandReactionStickers,
  scatterReactionStickers,
} from './feedReactionStickers';
import { RunPostEditorModal } from './RunPostEditor';

// Virtual drawing box; the <Svg> scales it to the card width, aspect preserved.
// Taller than it was: a claim is now the shape of the RUN rather than a disc,
// and an L or a lap needs vertical room to read as one.
const THUMB_W = 300;
const THUMB_H = 110;

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

// One shared projection for every layer on the thumbnail. The territory and
// the route have to be normalised TOGETHER — fitted separately, a run would
// float somewhere over a claim it is supposed to sit inside.
function makeProjection(layers, pad = 10) {
  const all = layers.flat();
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const scale = Math.min((THUMB_W - pad * 2) / spanX, (THUMB_H - pad * 2) / spanY);
  const offX = (THUMB_W - spanX * scale) / 2;
  const offY = (THUMB_H - spanY * scale) / 2;
  return (points) => points.map(([lon, lat]) => [
    offX + (lon - minX) * scale,
    THUMB_H - (offY + (lat - minY) * scale),
  ]);
}

// Sticker coordinates are chosen from the projected route itself in
// feedReactionStickers, then converted back to percentages here so they remain
// registered with the SVG when a card is wider than its 300-unit viewBox.
const STICKER = 28;

const svgPoints = (points) => points
  .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
  .join(' ');

// Deterministic, so a card does not reshuffle its stickers as the feed
// re-renders or scrolls — the same rule the frame variants follow.
// The claim, as the card sees it: the territory the run grew, with the route
// drawn INSIDE it. That pairing is the whole point of the new claim model —
// the land is the shape of the run, and the card is where you can tell.
//
// The reactions live in here too, as STICKERS round the edge of the drawing.
// They used to be a row of bordered chips between the header and the map, which
// bought a whole line of card for a thing that is a decoration on the run — and
// on a card with two reactions on it, that line was mostly empty. A sticker
// costs no layout at all.
function RouteThumb({ item, color, reactions = [], mine, burst = 0, onReact }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const rings = (item.rings || []).filter((r) => r?.length >= 3);
  const line = item.path?.length >= 2 ? item.path : null;
  if (!rings.length && !line) return null;
  const project = makeProjection([...rings, ...(line ? [line] : [])]);
  const projectedRings = rings.map(project);
  const projectedLine = line ? project(line) : null;
  // A count is people, not a number stamped on one icon. Expand it into
  // individual emoji, then place them furthest from the projected route.
  const stickers = scatterReactionStickers(
    expandReactionStickers(reactions),
    projectedLine ? [projectedLine] : projectedRings,
    item.id,
    { width: THUMB_W, height: THUMB_H, size: STICKER }
  );
  const activeSticker = [...stickers].reverse().find((row) => row.emote === mine);
  return (
    // A DRAWN BOX, not a grey plate. The plate was `colors.bg` (#f7f8fa) inside
    // a `colors.card` (#ffffff) card, with the steal bar's `colors.cardAlt`
    // (#eef0f4) under it — three off-whites within four points of each other,
    // stacked. That is not depth, it is a card that looks like it is made of
    // two different whites, and it is what "two different colours inside the
    // cards" is pointing at. The frame gives the route an edge without needing
    // a second surface colour to do it.
    <Framed
      frame={frameVariant('box', `route:${item.id}`)}
      // Drawn straight onto the card, with no paper of its own, so the card's
      // surface is what the line has to read against — a pale clan colour on a
      // white card is a box you cannot see.
      on={colors.card}
      tint={withAlpha(color, 0.55)}
      weight={INK.thin}
      pose={framePose(`route:${item.id}`)}
      inset={false}
      style={styles.thumb}
    >
      <Svg width="100%" height={THUMB_H} viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}>
        {projectedRings.map((ring, i) => (
          <Polygon
            key={i}
            points={svgPoints(ring)}
            fill={withAlpha(color, 0.22)}
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        ))}
        {line && (
          <Polyline
            points={svgPoints(projectedLine)}
            fill="none"
            // Lighter than the territory outline so the route reads as the
            // thing inside the land, not as a second border around it.
            stroke={rings.length ? withAlpha(color, 0.75) : color}
            strokeWidth={rings.length ? 2 : 2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
      </Svg>

      {stickers.map((row) => {
        const active = burst > 0 && row.key === activeSticker?.key;
        return (
          <PressableScale
            key={row.key}
            onPress={() => { haptic.light(); onReact?.(row.emote); }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: row.emote === mine }}
            accessibilityLabel={row.emote}
            style={[
              styles.sticker,
              {
                left: `${(row.x / THUMB_W) * 100}%`,
                top: `${(row.y / THUMB_H) * 100}%`,
                transform: [
                  { translateX: -STICKER / 2 },
                  { translateY: -STICKER / 2 },
                  { rotate: `${row.tilt}deg` },
                ],
              },
            ]}
          >
            {/* Three reactions are three scattered emoji, not one emoji with
                a number attached to it. */}
            <EmoteIcon reaction={row.emote} size={STICKER} />
            {active ? (
              <ReactionEffect
                reaction={mine}
                point={{ x: STICKER / 2, y: STICKER / 2 }}
                centered
                size={58}
                playToken={burst}
                style={styles.reactionFx}
              />
            ) : null}
          </PressableScale>
        );
      })}
    </Framed>
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
  const victims = item.victims || [];
  // Seeded from the row the feed already handed us, so the chips are on the
  // card at first paint rather than a fetch later.
  const { reactions, mine, burst, react } = useRunReactions(item.id, item);

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

      {post.caption ? <Text style={[type.body, styles.caption]}>{post.caption}</Text> : null}

      {post.media.length > 0 ? (
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
                source={{ uri }}
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
      ) : null}

      {/* The reactions ride ON the route now — see RouteThumb — so nothing
          between the header and the map costs a row. */}
      <RouteThumb
        item={item}
        color={c.stroke}
        reactions={reactions}
        mine={mine}
        burst={burst}
        onReact={react}
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
          anyway. */}
      {victims.length > 0 && (
        <TerritoryStealBanner
          trigger={item.id}
          victims={victims}
          amount={fmtArea(item.stolen_m2 || 0)}
          autoPlay={autoPlaySteal}
          haptics={autoPlaySteal}
          style={{ marginTop: space.sm - STEAL_HEADROOM }}
        />
      )}

      {/* The picker only. It is transient and it has to be big enough to hit,
          so it takes a row while it is open and none at all when it is not. */}
      <ReactionBar
        compact
        reactions={[]}
        mine={mine}
        color={c.stroke}
        onReact={react}
        open={pickerOpen}
        inlinePicker
        onRequestClose={() => setPickerOpen(false)}
      />

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
    // No background and no radius: the drawn box is the edge, and the card
    // underneath is the surface. NOT clipped either — the stickers sit on the
    // perimeter and a couple of them deliberately hang over it, the way a
    // sticker stuck near the corner of a photo does.
    thumb: {
      marginTop: space.md,
      height: THUMB_H,
      justifyContent: 'center',
    },
    sticker: {
      position: 'absolute',
      width: STICKER,
      height: STICKER,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 3,
    },
    reactionFx: { zIndex: 5 },
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
    caption: { color: colors.text, marginTop: space.md },
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
