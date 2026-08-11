// FeedCard — one activity item: a completed run (who, distance, pace, ground
// taken), the shape of the territory it grew, and — when the run took land off
// somebody — the steal itself, played out on the card.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import AppIcon from './AppIcon';
import TerritoryStealBanner from './TerritoryStealBanner';

import { api } from '../api/client';
import { updateCached } from '../api/cache';
import { radius, space, withAlpha, useTheme, useThemedType, useThemedStyles } from '../theme';
import { NEUTRAL } from '../state/clan';
import { useAvatar } from '../state/avatar';
import { CharacterBust } from './character/CharacterRig';
import PortraitBorder from './PortraitBorder';
import { PressableScale, haptic } from '../ui/motion';
import { Card, Row, StatValue } from './ui';
import { fmtArea } from './RivalCard';
import GameLottie from './GameLottie';
import ReactionBar, { ReactionTrigger } from './ReactionBar';
import { useRunReactions } from '../hooks/useRunReactions';

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
  return (points) =>
    points
      .map(([lon, lat]) =>
        `${(offX + (lon - minX) * scale).toFixed(1)},${(THUMB_H - (offY + (lat - minY) * scale)).toFixed(1)}`)
      .join(' ');
}

// The claim, as the card sees it: the territory the run grew, with the route
// drawn INSIDE it. That pairing is the whole point of the new claim model —
// the land is the shape of the run, and the card is where you can tell.
function RouteThumb({ item, color }) {
  const styles = useThemedStyles(makeStyles);
  const rings = (item.rings || []).filter((r) => r?.length >= 3);
  const line = item.path?.length >= 2 ? item.path : null;
  if (!rings.length && !line) return null;
  const project = makeProjection([...rings, ...(line ? [line] : [])]);
  return (
    <View style={styles.thumb}>
      <Svg width="100%" height={THUMB_H} viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}>
        {rings.map((ring, i) => (
          <Polygon
            key={i}
            points={project(ring)}
            fill={withAlpha(color, 0.22)}
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        ))}
        {line && (
          <Polyline
            points={project(line)}
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

      {/* Under the header, above the map thumb: the chips belong to the person
          and the run, not to the stats. Draws nothing at all until the run has
          a reaction on it or the picker is open, so a quiet feed is unchanged. */}
      <ReactionBar
        compact
        reactions={reactions}
        mine={mine}
        burst={burst}
        color={c.stroke}
        onReact={react}
        open={pickerOpen}
        inlinePicker
        onRequestClose={() => setPickerOpen(false)}
      />

      <RouteThumb item={item} color={c.stroke} />

      {/* The steal, on the card. It starts SETTLED — heads on the bar pulling
          a face, the amount stamped on — and detonates when tapped, because a
          feed that blows itself up as you scroll is noise rather than a
          payoff. The newest steal on the page is the one that plays itself. */}
      {victims.length > 0 && (
        <TerritoryStealBanner
          trigger={item.id}
          victims={victims}
          amount={fmtArea(item.stolen_m2 || 0)}
          autoPlay={autoPlaySteal}
          haptics={autoPlaySteal}
          style={{ marginTop: space.sm }}
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
  );
}

const makeStyles = (colors) =>
  StyleSheet.create({
    thumb: {
      marginTop: space.md,
      height: THUMB_H,
      borderRadius: radius.md,
      backgroundColor: colors.bg,
      overflow: 'hidden',
      justifyContent: 'center',
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
  });
