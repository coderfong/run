// FeedCard — one activity item. Phase 4: a completed run (who, distance,
// pace, area claimed). Phase 5 adds territory/clan event variants; Phase 6
// adds kudos. Route thumbnails need the run geometry (not carried in the
// feed) — deferred to keep the feed lightweight.

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import AppIcon from './AppIcon';

import { api } from '../api/client';
import { radius, space, withAlpha, useTheme, useThemedType, useThemedStyles } from '../theme';
import { NEUTRAL } from '../state/clan';
import { useAvatar } from '../state/avatar';
import { CharacterBust } from './character/CharacterRig';
import { PressableScale, haptic } from '../ui/motion';
import { Card, Row, StatValue } from './ui';

// Virtual drawing box; the <Svg> scales it to the card width, aspect preserved.
const THUMB_W = 300;
const THUMB_H = 84;

// Normalize [lon,lat] points into the virtual box (Y flipped: north is up).
function project(points, pad = 10) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const scale = Math.min((THUMB_W - pad * 2) / spanX, (THUMB_H - pad * 2) / spanY);
  const offX = (THUMB_W - spanX * scale) / 2;
  const offY = (THUMB_H - spanY * scale) / 2;
  return points
    .map(([lon, lat]) => `${(offX + (lon - minX) * scale).toFixed(1)},${(THUMB_H - (offY + (lat - minY) * scale)).toFixed(1)}`)
    .join(' ');
}

// A claim's shape: filled polygon for closed loops, a trail line otherwise.
function RouteThumb({ item, color }) {
  const styles = useThemedStyles(makeStyles);
  const ring = item.closed_loop && item.rings?.[0]?.length >= 3 ? item.rings[0] : null;
  const line = !ring && item.path?.length >= 2 ? item.path : null;
  const src = ring || line;
  if (!src) return null;
  const pts = project(src);
  return (
    <View style={styles.thumb}>
      <Svg width="100%" height={THUMB_H} viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}>
        {ring ? (
          <Polygon points={pts} fill={withAlpha(color, 0.22)} stroke={color} strokeWidth={2.5} strokeLinejoin="round" />
        ) : (
          <Polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
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
  if (!distanceM || distanceM < 50 || !durationS) return '—';
  const mpk = durationS / 60 / (distanceM / 1000);
  const m = Math.floor(mpk);
  const sec = Math.round((mpk - m) * 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatArea(m2) {
  // Always km² — small claims read as fractions.
  return `${(m2 / 1e6).toFixed(m2 >= 1e5 ? 2 : 3)} km²`;
}

export default function FeedCard({ item, navigation }) {
  const { colors } = useTheme();
  const type = useThemedType();
  const c = item.clan_color || NEUTRAL;
  const { equipped } = useAvatar();
  const [kudoed, setKudoed] = useState(item.kudoed);
  const [count, setCount] = useState(item.kudos_count || 0);

  const kudos = async () => {
    haptic.light();
    setKudoed((k) => !k);
    setCount((n) => n + (kudoed ? -1 : 1));
    try {
      const r = await api.toggleKudos(item.id);
      setKudoed(r.kudoed);
      setCount(r.kudos_count);
    } catch {
      setKudoed(item.kudoed);
      setCount(item.kudos_count || 0);
    }
  };

  return (
    <Card onPress={() => navigation?.navigate('RunDetail', { runId: item.id })} style={{ marginBottom: space.md }}>
      <Row between>
        <Row gap={10}>
          {/* character portrait — yours from local state, others' from the
              avatar the server returns; initials only when none exists yet */}
          {item.is_you || item.avatar ? (
            <CharacterBust equipped={item.is_you ? equipped : item.avatar} size={34} bg={c.fill} />
          ) : (
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={[type.bodySmBold, { color: c.stroke }]}>
                {(item.username || '?').slice(0, 2).toUpperCase()}
              </Text>
            </View>
          )}
          <View>
            <Text style={type.bodyBold}>
              {item.clan_tag ? `[${item.clan_tag}] ` : ''}{item.username}
              {item.is_you ? ' · you' : ''}
            </Text>
            <Text style={type.caption}>
              {item.closed_loop ? 'claimed land' : 'ran a path'} · {timeAgo(item.created_at)}
            </Text>
          </View>
        </Row>
        <Row gap={2}>
          <PressableScale
            onPress={() => navigation?.navigate('RunDetail', { runId: item.id, focusComments: true })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, padding: 4 }}
            accessibilityRole="button"
            accessibilityLabel="View comments"
          >
            <AppIcon name="comment" size={20} faded />
            {(item.comment_count || 0) > 0 ? (
              <Text style={[type.captionMedium, { color: colors.textMuted }]}>{item.comment_count}</Text>
            ) : null}
          </PressableScale>
          <PressableScale onPress={kudos} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, padding: 4 }} accessibilityRole="button" accessibilityLabel="Give kudos">
            <AppIcon name="like" size={20} faded={!kudoed} />
            {count > 0 ? <Text style={[type.captionMedium, { color: kudoed ? c.stroke : colors.textMuted }]}>{count}</Text> : null}
          </PressableScale>
        </Row>
      </Row>

      <RouteThumb item={item} color={c.stroke} />

      <Row between style={{ marginTop: space.md }}>
        <StatValue size="sm" label="Distance" value={`${(item.distance_m / 1000).toFixed(2)}`} unit="km" />
        <StatValue size="sm" label="Pace" value={pace(item.distance_m, item.duration_s)} unit="/km" />
        <StatValue
          size="sm"
          label={item.closed_loop ? 'Claimed' : 'No loop'}
          value={item.closed_loop ? formatArea(item.area_m2).split(' ')[0] : '—'}
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
  });
