// FeedCard — one activity item: a completed run (who, distance, pace, ground
// taken), the shape of the territory it grew, and — when the run took land off
// somebody — the steal itself, played out on the card.

import React, { useEffect, useRef, useState } from 'react';
import { Dimensions, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pencil } from 'lucide-react-native';
import AppIcon from './AppIcon';
import RouteThumb, { hasRouteData } from './RouteThumb';
import TerritoryStealBanner, { STEAL_HEADROOM } from './TerritoryStealBanner';

import { api, apiPhotoSource } from '../api/client';
import { updateCached } from '../api/cache';
import {
  NB,
  nbAccentFor,
  nbTextOn,
  radius,
  space,
  tintOn,
  withAlpha,
  useTheme,
  useThemedType,
  useThemedStyles,
} from '../theme';
import { NEUTRAL } from '../state/clan';
import { useAvatar } from '../state/avatar';
import { CharacterBust } from './character/CharacterRig';
import PortraitBorder from './PortraitBorder';
import { PressableScale, haptic } from '../ui/motion';
import { INK, framePose, frameVariant } from '../ui/frameRegistry';
import Framed from './ui/Framed';
import { Card, OverflowMenu, Row } from './ui';
import { fmtArea } from './RivalCard';
import GameLottie from './GameLottie';
import ReactionBar, { POPOVER_HEIGHT, POPOVER_WIDTH, ReactionPopover, ReactionTrigger } from './ReactionBar';
import { useRunReactions } from '../hooks/useRunReactions';
import { timeAgo } from '../utils/time';
import { RunPostEditorModal } from './RunPostEditor';

// The runner's portrait on a feed row. At 34 the bust inside the frame was a
// thumbnail of a thumbnail — the whole point of the character is that you can
// tell whose it is at a glance down the feed, and the rank border it wears had
// no room to read at all.
const PORTRAIT = 46;
const POST_PHOTO_W = 272;

// The narrowest the who-and-when block is allowed to get before the buttons
// beside it are sent to their own line.
//
// This used to be the load-bearing fix for a real problem: five actions
// (share, edit, react, comment, kudos) came to a little over 200pt of the
// ~318pt a card has inside its padding, the header handed them that width
// first, and the name was clipped to an ellipsis while "took ground · 8h ago"
// was squeezed away entirely — so your OWN runs were the rows you could not
// read. The floor stopped the crush by forcing a second line instead.
//
// The actions are three slots now (react, kudos, and a menu holding the rest —
// see the header row), which is about 130pt and fits beside the name on every
// phone this ships to. The floor stays as the guarantee rather than as the
// mechanism: if a future action lands back on this row, the name still wins
// and the row still wraps rather than clipping. It is the portrait, its gap,
// and enough left over for the longer of the two lines — the timestamp one.
const IDENTITY_MIN = PORTRAIT + 10 + 118;

// What a stat shows when there is nothing to show. A dash is the usual glyph
// for this and the usual glyph is exactly the problem — the app has no dashes
// in its copy, so the empty slot gets the same mid-dot the app already uses as
// its separator.
const NO_VALUE = '·';

// The photo half of the paired map+photo row. Measures its own width rather
// than trusting a fixed pixel size, since it shares the row with the route
// map at whatever width flex leaves it — and that measured width is also
// exactly what each page needs to be for `pagingEnabled` to land on whole
// photos instead of somewhere between two of them.
//
// `inset={false}`: the frame's own ink clearance would otherwise pad the
// ScrollView's content area to something NARROWER than the box this
// component measured, and paging math done against the wrong width is what
// used to make the second and third photo unreachable — a swipe landed
// partway into the next photo instead of squarely on it, and glancing at the
// card mid-swipe read as "it only ever shows the first one".
function PairedPhotoCard({ media, photoPage, onPage, color, itemId }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const [width, setWidth] = useState(0);

  return (
    <View
      testID="paired-photo-card"
      style={styles.pairedPhotoWrap}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      <Framed
        frame={frameVariant('box', `photos:${itemId}`)}
        on={colors.card}
        tint={withAlpha(color, 0.55)}
        weight={INK.thin}
        pose={framePose(`photos:${itemId}`)}
        inset={false}
        style={width > 0 ? { height: width } : styles.pairedPhotoFallback}
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
      </Framed>
    </View>
  );
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

// One stat, in a drawn box with white paper — a raised tile on the coloured
// card rather than a number lost on the fill. The frame and its pose are dealt
// off the run id and the slot, so the three in a row are three different
// drawings instead of three stamps of one (the anti-repeat idiom the rest of
// the app's framed rows use). Text is fixed dark: the paper is always white,
// whatever the scheme, so the theme's own (scheme-flipping) inks would vanish
// on it in dark mode.
function FramedStat({ item, index, label, value, unit, valueColor }) {
  const type = useThemedType();
  const styles = useThemedStyles(makeStyles);
  const seed = `stat:${item.id}:${index}`;
  return (
    <Framed
      frame={frameVariant('box', seed)}
      fill="#FFFFFF"
      weight={INK.thin}
      pose={framePose(seed)}
      style={styles.statCell}
      contentStyle={styles.statCellInner}
    >
      <Text style={[type.labelSm, styles.statLabel]} numberOfLines={1}>{label}</Text>
      <View style={styles.statValueRow}>
        <Text style={[type.statSm, { color: valueColor || NB.ink }]} numberOfLines={1}>{value}</Text>
        {unit ? <Text style={[type.statSm, styles.statUnit]} numberOfLines={1}>{unit}</Text> : null}
      </View>
    </Framed>
  );
}

export default function FeedCard({ item, navigation, autoPlaySteal = false, screenFocused = true, onScreen = true }) {
  const { colors, scheme } = useTheme();
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
  const [pickerAt, setPickerAt] = useState(null);
  const anchorRef = useRef(null);
  const pickerOpen = pickerAt !== null;
  const [editOpen, setEditOpen] = useState(false);
  const [post, setPost] = useState({
    caption: item.caption || '',
    media: item.media || [],
  });
  const [photoPage, setPhotoPage] = useState(0);
  const hasPhotos = post.media.length > 0;
  const hasRoute = hasRouteData({ rings: item.rings, path: item.path });
  const victims = item.victims || [];
  // Seeded off the run id so it is stable for the life of the run. Falls back
  // to the username, so the seeded/bot rows in a fresh database still come out
  // varied rather than all landing on the first colour in the deck.
  const accent = nbAccentFor(item.id || item.username || 'run');
  // The card's paper: the dealt hue washed into the ordinary card surface, not
  // the hue itself. A feed of full-strength deck colours was a wall of shouting
  // blocks, one after another down the page, and it drowned the route and the
  // numbers the card exists to show. A wash keeps each run its own colour and
  // hands the loud part back to the stroke and the drop. Opaque via `tintOn`,
  // because HardShadow paints a solid block behind the card.
  const cardFill = tintOn(colors.card, accent, scheme === 'dark' ? 0.28 : 0.32);
  const onCard = nbTextOn(cardFill);
  // Seeded from the row the feed already handed us, so the chips are on the
  // card at first paint rather than a fetch later.
  const { reactions, mine, burst, react } = useRunReactions(item.id, item);

  useEffect(() => {
    if (!screenFocused) setPickerAt(null);
  }, [screenFocused]);

  // The picker opens UPWARD, out of the card, so it never lands on the route or
  // the caption the way a drop-down did. That puts it outside every ancestor's
  // bounds, which on Android means it would draw and then refuse to be tapped,
  // so it is hosted in an overlay and placed against the trigger's position on
  // screen instead of being laid out inside the card.
  const openPicker = () => {
    haptic.light();
    if (pickerOpen) { setPickerAt(null); return; }
    anchorRef.current?.measureInWindow?.((x, y, width, height) => {
      const screen = Dimensions.get('window');
      // Prefer to hang above the trigger; drop below only when the row is so
      // close to the top of the screen that "above" would be off it.
      const above = y - POPOVER_HEIGHT - space.xs;
      setPickerAt({
        // Centred on the trigger, then held clear of both screen edges.
        left: Math.max(
          space.md,
          Math.min(
            x + width / 2 - POPOVER_WIDTH / 2,
            screen.width - POPOVER_WIDTH - space.md
          )
        ),
        top: above >= space.md ? above : y + height + space.xs,
      });
    });
  };

  // Your own run, out to Instagram. The card the sheet draws is built from
  // exactly what this row already has — the feed ships the route, the rings and
  // the numbers — so there is no fetch between the tap and the preview.
  //
  // `path` here is the feed's [lon, lat] pairs, NOT the recorder's
  // {latitude, longitude} objects; RunShareCard takes either.
  const share = () => {
    setPickerAt(null);
    navigation?.navigate('RunShare', {
      team: c,
      path: item.path || [],
      rings: (item.rings || []).filter((r) => r?.length >= 3),
      run: {
        runId: item.id,
        distanceM: item.distance_m,
        durationS: item.duration_s,
        areaM2: item.area_m2,
        claimed: !!item.closed_loop,
      },
    });
  };

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
        setPickerAt(null);
        navigation?.navigate('RunDetail', { runId: item.id });
      }}
      // Every run card gets a colour dealt off its own id, so the feed reads
      // as a stack of coloured blocks rather than a column of identical white
      // rectangles — which is the single biggest thing separating this from
      // the reference boards. Dealt, not chosen: the same run is the same
      // colour on every render and on every device, and nothing has to store
      // a colour per row. See `nbAccentFor`.
      //
      // It is the card's FILL now, not just its drop — a wash of the dealt
      // hue (see `cardFill`), not the flat saturated block it started as. The pieces that
      // used to need a neutral ground for their own colour (the route map, a
      // photo, the clan-coloured stats) each sit in their own drawn frame with
      // its own paper now, so they no longer read directly against the fill and
      // the clan-colour-wins rule holds where it still meets the chrome.
      accent={accent}
      fill={cardFill}
      style={{ marginBottom: space.md }}
    >
      <Row between testID="feed-card-header" style={styles.header}>
        {/* Grows into whatever the buttons leave, and never below IDENTITY_MIN
            — at which point the header wraps and the buttons take the next
            line instead of taking the name's width. */}
        <Row gap={10} testID="feed-card-identity" style={styles.identity}>
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
          <View style={styles.identityText}>
            {/* On the card's own colour now — `nbTextOn` keeps the name legible
                whichever hue the run was dealt, in either scheme. */}
            <Text style={[type.bodyBold, { color: onCard }]} numberOfLines={1}>
              {item.clan_tag ? `[${item.clan_tag}] ` : ''}{item.username}
              {item.is_you ? ' · you' : ''}
            </Text>
            {/* WHAT HAPPENED AND WHEN, in its own drawn frame. One line, like
                the name above it — left to wrap it would go to two on the
                narrowest phones and push the portrait off centre.

                A framed white chip rather than grey caption text because this
                is the line that says whether the run actually TOOK anything,
                and on a saturated card a plain accent chip would blend into the
                fill it sits on. The drawn frame gives it its own paper and edge
                — the same hand-drawn box the stats below wear. */}
            <Framed
              frame={frameVariant('heading', `meta:${item.id}`)}
              fill="#FFFFFF"
              weight={INK.hairline}
              pose={framePose(`meta:${item.id}`)}
              style={styles.metaChip}
              contentStyle={styles.metaChipInner}
            >
              <Text
                style={[type.captionMedium, { color: NB.ink }]}
                numberOfLines={1}
              >
                {item.closed_loop ? 'took ground' : 'ran a path'} · {timeAgo(item.created_at)}
              </Text>
            </Framed>
          </View>
        </Row>
        <Row gap={2} testID="feed-card-actions" style={styles.actions}>
          {/* THE ROW IS TWO BUTTONS AND A MENU.
              React and kudos stay out here because they are the two things
              people actually do to a run, they are one tap each, and both
              carry state the row has to show (which emote you picked, whether
              the heart is on). Share, edit and comment all navigate or open
              something, so nothing is lost by costing a tap more — and moving
              them is what gets the header back onto ONE line for every row
              rather than only for other people's. See `styles.header`. */}
          <View ref={anchorRef} testID="feed-card-reaction-anchor" collapsable={false} style={styles.reactionAnchor}>
            <ReactionTrigger
              mine={mine}
              active={pickerOpen}
              color={c.stroke}
              onPress={openPicker}
            />
          </View>
          <View style={styles.kudosSlot}>
            {/* Cleared when it finishes. It used to be left mounted on its last
                frame forever, which is a burst you cannot see sitting over a
                button you can no longer press. */}
            {kudosFx > 0 ? (
              <GameLottie
                name="kudos"
                size={86}
                trigger={kudosFx}
                onFinish={() => setKudosFx(0)}
                style={styles.kudosFx}
              />
            ) : null}
            <PressableScale
              onPress={kudos}
              style={styles.action}
              accessibilityRole="button"
              accessibilityState={{ selected: kudoed }}
              accessibilityLabel={kudoed ? 'Remove kudos' : 'Give kudos'}
            >
              {/* Kudos still has two states, but the "not yet" one is a step
                  down rather than a fade to grey — the heart keeps its colour so
                  the difference reads as weight, not as availability. Without
                  the step there was nothing to see at all on a run nobody else
                  has kudoed: the count is hidden at zero, so tapping the heart
                  on and off changed the card not at all. */}
              <AppIcon name="like" size={28} opacity={kudoed ? 1 : 0.62} />
              {count > 0 ? <Text style={[type.captionMedium, { color: kudoed ? c.stroke : onCard }]}>{count}</Text> : null}
            </PressableScale>
          </View>
          {/* Everything else. The list is built per row rather than being a
              fixed menu with disabled entries: a menu that offers "Share" on
              somebody else's run and then refuses is worse than one that never
              claimed to. `hidden` entries are dropped by the menu itself, and
              it renders nothing at all if that leaves it empty. */}
          <OverflowMenu
            label="More actions for this run"
            onOpen={() => setPickerAt(null)}
            actions={[
              {
                key: 'comment',
                label: 'Comments',
                icon: 'comment',
                count: item.comment_count || 0,
                onPress: () => navigation?.navigate('RunDetail', { runId: item.id, focusComments: true }),
              },
              {
                // Your own runs only. The card that gets posted carries YOUR
                // avatar and says the ground was claimed, which is not a thing
                // to hand somebody about a run they did not do.
                key: 'share',
                label: 'Share this run',
                icon: 'share',
                hidden: !item.is_you,
                onPress: share,
              },
              {
                // One shot: once a caption or a photo has actually been saved,
                // the entry goes away rather than staying up as a standing
                // "edit me again" invitation.
                key: 'edit',
                label: 'Add caption or photo',
                icon: ({ color, size }) => <Pencil size={size} color={color} strokeWidth={2.3} />,
                hidden: !item.is_you || !!post.caption || post.media.length > 0,
                onPress: () => setEditOpen(true),
              },
            ]}
          />
        </Row>
      </Row>

      {/* Map on the left, photos on the right, when there are both — one row
          about the run instead of two stacked blocks. Standalone, each keeps
          the fuller full-width layout: a lone map or a lone photo strip does
          not need to give up half its width to nothing. */}
      {hasRoute && hasPhotos ? (
        <View style={styles.pairedRow}>
          <RouteThumb id={item.id} rings={item.rings} path={item.path} color={c.stroke} style={styles.thumbCompact} compact />
          <PairedPhotoCard
            media={post.media}
            photoPage={photoPage}
            onPage={setPhotoPage}
            color={c.stroke}
            itemId={item.id}
          />
        </View>
      ) : hasRoute ? (
        <RouteThumb id={item.id} rings={item.rings} path={item.path} color={c.stroke} style={styles.thumb} />
      ) : hasPhotos ? (
        <Framed
          frame={frameVariant('box', `photos:${item.id}`)}
          tint={withAlpha(c.stroke, 0.55)}
          on={colors.card}
          weight={INK.thin}
          pose={framePose(`photos:${item.id}`)}
          style={styles.postPhotoFrame}
        >
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
        </Framed>
      ) : null}

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

      {/* The chip summary only — the picker itself now lives on the trigger
          up in the header (see `reactionAnchor`), not here. It costs no row
          at all when there is nothing to show. */}
      <ReactionBar
        compact
        reactions={reactions}
        mine={mine}
        color={c.stroke}
        onReact={react}
        burst={burst}
        style={styles.reactionsRow}
      />

      {/* The steal, on the card. It starts SETTLED — heads on the bar pulling
          a face, the amount stamped on — and detonates when tapped, because a
          feed that blows itself up as you scroll is noise rather than a
          payoff. Home lets exactly ONE steal per visit play itself, the first
          one it has properly seen, and tells every card whether it is on
          screen at all (see createFeedVisibility in HomeScreen), so the heads
          on a card scrolled out of view hold still.

          Pulled up by its own headroom: the banner reserves 90pt of empty
          stage above the bar for the fireball to have somewhere to go, and
          stacked normally that stage is a big blank gap between whatever
          comes before it and the STOLEN bar. The negative margin ALWAYS
          applies now — trying to spare it only when there was no caption or
          reactions row put that same blank gap right back the moment either
          one was on the card, which was most of them. The blast plays over
          the caption or the reactions instead of over the map in that case;
          a gap the height of the card's next section reads far worse than an
          explosion crossing a line of text it is already sitting under. */}
      {victims.length > 0 && (
        <TerritoryStealBanner
          trigger={item.id}
          victims={victims}
          amount={fmtArea(item.stolen_m2 || 0)}
          // NOT gated on focus as well. It was, and every return to Home
          // flipped it back on and set the same steal off again.
          autoPlay={autoPlaySteal}
          active={onScreen}
          haptics={false}
          style={{ marginTop: space.sm - STEAL_HEADROOM }}
        />
      )}

      {/* The three numbers, each in its own drawn frame with white paper — so
          they read as raised tiles on the coloured card rather than text lost
          on the fill. Distance and pace always; the third is the claim, in the
          clan's colour when the run took ground. */}
      <View style={styles.statRow}>
        <FramedStat
          item={item}
          index={0}
          label="Distance"
          value={`${(item.distance_m / 1000).toFixed(2)}`}
          unit="km"
        />
        <FramedStat
          item={item}
          index={1}
          label="Pace"
          value={pace(item.distance_m, item.duration_s)}
          unit="/km"
        />
        <FramedStat
          item={item}
          index={2}
          label={item.closed_loop ? 'Claimed' : 'Not claimed'}
          value={item.closed_loop ? formatArea(item.area_m2).split(' ')[0] : NO_VALUE}
          unit={item.closed_loop ? formatArea(item.area_m2).split(' ')[1] : ''}
          valueColor={item.closed_loop ? c.stroke : undefined}
        />
      </View>
    </Card>
    {/* The picker. `transparent` and un-animated, so what you see is the strip
        arriving on its own 160ms rise and nothing else — a modal that dims or
        slides would read as a screen, not as a thing that popped up under your
        thumb. Anywhere else closes it. */}
    {pickerOpen ? (
      <Modal
        transparent
        visible
        animationType="none"
        // NOT statusBarTranslucent: the strip is placed from measureInWindow,
        // whose origin is the app window. A modal that reaches up under the
        // status bar has a different origin, and the picker would sit a status
        // bar's height off on Android.
        onRequestClose={() => setPickerAt(null)}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setPickerAt(null)}
          accessibilityRole="button"
          accessibilityLabel="Close reactions"
        />
        <ReactionPopover
          selected={mine}
          onPick={(emote) => {
            haptic.light();
            react(emote);
            setPickerAt(null);
          }}
          style={[styles.pickerOverlay, { left: pickerAt.left, top: pickerAt.top }]}
        />
      </Modal>
    ) : null}
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
    pairedPhotoWrap: { flex: 1 },
    // Only used for the one frame before its first onLayout — square, same
    // as the route's compact box, so the row doesn't jump once measured.
    pairedPhotoFallback: { aspectRatio: 1 },
    // The header is ONE line when the name and the buttons both fit and TWO
    // when they do not, rather than always one with the name paying for it.
    // Every row carries the same three slots now — react, kudos, menu — so in
    // practice it stays on one line and, more to the point, your own runs and
    // everybody else's are the same height. The wrap is the safety net.
    header: { flexWrap: 'wrap', rowGap: space.sm },
    // No `flex: 1` here, deliberately. That sets flexBasis to 0, and the wrap
    // decision is made on flex BASIS, not on what the content actually needs —
    // a zero-basis identity always "fits", so the header would never break and
    // the name would go straight back to being crushed.
    identity: { flexGrow: 1, flexShrink: 1, minWidth: IDENTITY_MIN },
    identityText: { flexGrow: 1, flexShrink: 1 },
    // `flex-start` so the drawn chip is only as wide as its own text —
    // stretched to the identity column's full width it would read as a banner
    // across the card rather than as a chip under the name.
    metaChip: {
      alignSelf: 'flex-start',
      marginTop: 4,
      maxWidth: '100%',
    },
    metaChipInner: { paddingHorizontal: 2 },
    // The three framed stat tiles, sharing the row evenly with a small gap.
    statRow: {
      flexDirection: 'row',
      gap: space.sm,
      marginTop: space.md,
    },
    statCell: { flex: 1 },
    statCellInner: { alignItems: 'center' },
    // Fixed inks, not the theme's: the tile's paper is always white, so a
    // scheme-flipping label/value colour would disappear on it in dark mode.
    statLabel: { color: '#5c5c66', marginBottom: 2 },
    statValueRow: { flexDirection: 'row', alignItems: 'flex-end' },
    statUnit: { color: '#5c5c66', marginLeft: 3, marginBottom: 2 },
    // Never shrinks: 40pt is already the minimum a thumb can hit. `marginLeft:
    // auto` is what keeps the strip against the right edge on the wrapped
    // line, where `between` has nothing to push it away from.
    actions: { flexShrink: 0, marginLeft: 'auto' },
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
    // The trigger's own wrapper — what the picker is measured against, so the
    // strip lands on the button that was actually tapped.
    reactionAnchor: { position: 'relative' },
    // Placed by `openPicker` against the trigger's position on screen. `bottom`
    // is cleared because the shared floating style hangs the strip off the
    // bottom of whatever it is laid out in, and in here there is no such thing.
    pickerOverlay: {
      position: 'absolute',
      bottom: undefined,
      marginBottom: 0,
      width: POPOVER_WIDTH,
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
    // Framed like the route box and the caption box above it — a photo used
    // to sit on the bare card background, the one piece of the card with no
    // drawn edge of its own.
    postPhotoFrame: { marginTop: space.md },
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
