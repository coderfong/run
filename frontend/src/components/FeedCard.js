// FeedCard — one activity item. Phase 4: a completed run (who, distance,
// pace, area claimed). Phase 5 adds territory/clan event variants; Phase 6
// adds kudos. Route thumbnails need the run geometry (not carried in the
// feed) — deferred to keep the feed lightweight.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Heart } from 'lucide-react-native';

import { api } from '../api/client';
import { colors, space, type } from '../theme';
import { NEUTRAL } from '../state/clan';
import { PressableScale, haptic } from '../ui/motion';
import { Card, Row, StatValue } from './ui';

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
  if (m2 >= 1e6) return `${(m2 / 1e6).toFixed(2)} km²`;
  return `${Math.round(m2).toLocaleString()} m²`;
}

export default function FeedCard({ item, navigation }) {
  const c = item.clan_color || NEUTRAL;
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
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={[type.bodySmBold, { color: c.stroke }]}>
              {(item.username || '?').slice(0, 2).toUpperCase()}
            </Text>
          </View>
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
        <PressableScale onPress={kudos} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, padding: 4 }} accessibilityRole="button" accessibilityLabel="Give kudos">
          <Heart size={18} color={kudoed ? c.stroke : colors.textDim} fill={kudoed ? c.stroke : 'transparent'} />
          {count > 0 ? <Text style={[type.captionMedium, { color: kudoed ? c.stroke : colors.textMuted }]}>{count}</Text> : null}
        </PressableScale>
      </Row>

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
