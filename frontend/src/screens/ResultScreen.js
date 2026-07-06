// Post-run result — the shareable artifact + the run's detail. Dark card
// (captured polygon glowing, area hero count-up, quiet stat row, steal
// summary, loop-mark watermark) is the shared image; splits and any PRs sit
// below it. A run without a loop still gets a dignified result.

import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

import { darkColors, radius, shadow, space, type, withAlpha } from '../theme';
import { useClan } from '../state/clan';
import { CountUpText, haptic, PressableScale } from '../ui/motion';
import LoopMark from '../components/LoopMark';
import { toast } from '../ui/toast';

const OPEN_PATH_RATE = 0.05;
const D = darkColors;

// --- geometry / splits -----------------------------------------------------

function ringsToSvgPath(rings, size, pad) {
  const pts = rings.flat();
  if (pts.length < 3) return null;
  const lats = pts.map(([, lat]) => lat);
  const lons = pts.map(([lon]) => lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
  const w = Math.max((maxLon - minLon) * kx, 1e-9);
  const h = Math.max(maxLat - minLat, 1e-9);
  const scale = (size - pad * 2) / Math.max(w, h);
  const ox = (size - w * scale) / 2, oy = (size - h * scale) / 2;
  let d = '';
  rings.forEach((ring) => {
    if (!ring || ring.length < 3) return;
    ring.forEach(([lon, lat], i) => {
      const x = ox + (lon - minLon) * kx * scale;
      const y = size - (oy + (lat - minLat) * scale);
      d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
    });
    d += 'Z ';
  });
  return d || null;
}

function GlowPolygon({ rings, team, size = 240 }) {
  const d = useMemo(() => ringsToSvgPath(rings, size, 22), [rings, size]);
  if (!d) return null;
  return (
    <Svg width={size} height={size}>
      <Path d={d} fill={team.fill} stroke={withAlpha(team.glow, 0.16)} strokeWidth={14} strokeLinejoin="round" />
      <Path d={d} fill="none" stroke={withAlpha(team.glow, 0.35)} strokeWidth={7} strokeLinejoin="round" />
      <Path d={d} fill="none" stroke={team.glow} strokeWidth={2.5} strokeLinejoin="round" />
    </Svg>
  );
}

function haversine(a, b) {
  const R = 6371000, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude), dLon = toRad(b.longitude - a.longitude);
  const la1 = toRad(a.latitude), la2 = toRad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// Per-km splits from the recorded path (client-side; Phase 6 makes these
// server-authoritative alongside PRs).
function computeSplits(path) {
  if (!path || path.length < 2) return [];
  const splits = [];
  let kmDist = 0, kmTime = 0, kmIndex = 1;
  for (let i = 1; i < path.length; i++) {
    let segD = haversine(path[i - 1], path[i]);
    let segT = (path[i].timestamp - path[i - 1].timestamp) / 1000;
    if (segT <= 0 || !isFinite(segD)) continue;
    while (kmDist + segD >= 1000) {
      const need = 1000 - kmDist;
      const frac = need / segD;
      splits.push({ km: kmIndex, seconds: kmTime + segT * frac });
      kmIndex += 1;
      segD -= need;
      segT -= segT * frac;
      kmDist = 0;
      kmTime = 0;
    }
    kmDist += segD;
    kmTime += segT;
  }
  return splits;
}

function paceStr(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPace(distanceM, durationS) {
  if (!distanceM || distanceM < 50 || !durationS) return '—';
  return `${paceStr((durationS / (distanceM / 1000)))} /km`;
}

function formatDuration(durationS) {
  const total = Math.max(0, Math.round(durationS));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function QuietStat({ label, value }) {
  return (
    <View style={styles.quietStat}>
      <Text style={styles.quietLabel}>{label}</Text>
      <Text style={styles.quietValue}>{value}</Text>
    </View>
  );
}

function Splits({ splits, accent }) {
  if (!splits.length) return null;
  const slowest = Math.max(...splits.map((s) => s.seconds));
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Splits</Text>
      {splits.map((s) => (
        <View key={s.km} style={styles.splitRow}>
          <Text style={styles.splitKm}>{s.km} km</Text>
          <View style={styles.splitBarTrack}>
            <View style={[styles.splitBar, { width: `${Math.max(12, (s.seconds / slowest) * 100)}%`, backgroundColor: accent }]} />
          </View>
          <Text style={styles.splitPace}>{paceStr(s.seconds)}</Text>
        </View>
      ))}
    </View>
  );
}

export default function ResultScreen({ navigation, route }) {
  const { result } = route.params;
  const { color, clan } = useClan();
  const team = color; // {fill, stroke, glow} — clan color or neutral
  const label = clan?.tag || 'Solo';
  const cardRef = useRef(null);
  const [sharing, setSharing] = useState(false);

  const t = result.territory;
  const captured = !!t;
  const path = route.params.path || [];

  const rings = captured
    ? (t.rings?.length ? t.rings : [t.polygon])
    : [path.map((p) => [p.longitude, p.latitude])];

  const heroAreaM2 = captured ? t.area_m2 : (result.distance_m / 1000) * OPEN_PATH_RATE * 1e6;
  const splits = useMemo(() => computeSplits(path), [path]);
  const stolen = result.stolen_m2 || 0;
  const achievements = result.achievements || [];

  const share = async () => {
    try {
      setSharing(true);
      haptic.light();
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/png' });
      else toast.error('Sharing is not available on this device.');
    } catch (e) {
      toast.error(e.message || 'Could not share');
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: D.bg }} contentContainerStyle={styles.scroll}>
      {/* the shareable card */}
      <View ref={cardRef} collapsable={false} style={styles.card}>
        <View style={[styles.eyebrow, { borderColor: team.glow }]}>
          <View style={[styles.eyebrowDot, { backgroundColor: team.glow }]} />
          <Text style={[styles.eyebrowText, { color: team.glow }]}>
            {captured ? `Loop captured · ${label}` : `Distance converted · ${label}`}
          </Text>
        </View>

        {rings[0]?.length >= 3 && (
          <View style={styles.polyWrap}>
            <GlowPolygon rings={rings} team={team} />
          </View>
        )}

        <View style={styles.heroRow}>
          <CountUpText value={heroAreaM2} style={[styles.heroArea, { color: team.glow }]} />
          <Text style={styles.heroUnit}> m²</Text>
        </View>
        <Text style={styles.heroCaption}>
          {captured
            ? 'claimed for your team'
            : `no loop this time — close your path to claim land`}
        </Text>

        <View style={styles.quietRow}>
          <QuietStat label="Distance" value={`${(result.distance_m / 1000).toFixed(2)} km`} />
          <QuietStat label="Pace" value={formatPace(result.distance_m, result.duration_s)} />
          <QuietStat label="Duration" value={formatDuration(result.duration_s)} />
        </View>

        {(captured || stolen > 0) && (
          <View style={styles.deltaRow}>
            {stolen > 0 ? (
              <Text style={[styles.deltaText, { color: team.glow }]}>
                Stole {Math.round(stolen).toLocaleString()} m²{result.stolen_from ? ` from ${result.stolen_from}` : ''}
              </Text>
            ) : (
              <Text style={[styles.deltaText, { color: team.glow }]}>
                +{Math.round(heroAreaM2).toLocaleString()} m² · {label} holds more
              </Text>
            )}
          </View>
        )}

        <View style={styles.watermark}>
          <LoopMark size={16} />
          <Text style={styles.watermarkText}>TERRITORY RUN</Text>
        </View>
      </View>

      {/* PRs (Phase 6 fills achievements) */}
      {achievements.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal records</Text>
          <View style={styles.prWrap}>
            {achievements.map((a) => (
              <View key={a} style={[styles.prChip, { borderColor: team.glow }]}>
                <Text style={[styles.prText, { color: team.glow }]}>{a}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* splits */}
      <Splits splits={splits} accent={team.glow} />

      <View style={styles.actions}>
        <PressableScale
          style={[styles.shareBtn, { backgroundColor: team.stroke }, shadow.glow(team.glow)]}
          onPress={share}
          disabled={sharing}
          accessibilityRole="button"
          accessibilityLabel="Share result card"
        >
          <Text style={styles.shareBtnText}>{sharing ? 'Preparing…' : 'Share'}</Text>
        </PressableScale>
        <PressableScale
          style={styles.doneBtn}
          onPress={() => navigation.getParent()?.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </PressableScale>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space.lg, paddingBottom: space.xxl },

  card: {
    backgroundColor: D.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: D.border,
    padding: space.xl,
    alignItems: 'center',
  },
  eyebrow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: space.md, paddingVertical: 6, marginBottom: space.md,
  },
  eyebrowDot: { width: 7, height: 7, borderRadius: 4 },
  eyebrowText: { ...type.labelSm },
  polyWrap: { marginVertical: space.sm },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.sm },
  heroArea: { ...type.statHero },
  heroUnit: { ...type.statMd, color: D.textMuted, marginBottom: 6 },
  heroCaption: { ...type.caption, color: D.textDim, marginTop: 2, textAlign: 'center' },
  quietRow: {
    flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-between',
    marginTop: space.xl, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: D.border,
  },
  quietStat: { flex: 1, alignItems: 'center' },
  quietLabel: { ...type.labelSm, color: D.textDim, marginBottom: 4 },
  quietValue: { ...type.statSm, color: D.text },
  deltaRow: { marginTop: space.lg },
  deltaText: { ...type.bodySmBold, textAlign: 'center' },
  watermark: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: space.lg },
  watermarkText: { ...type.labelSm, color: D.textDim, letterSpacing: 2 },

  section: { marginTop: space.xl },
  sectionTitle: { ...type.label, color: D.textMuted, marginBottom: space.md },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.sm },
  splitKm: { ...type.statSm, color: D.text, width: 52 },
  splitBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: D.cardAlt, overflow: 'hidden' },
  splitBar: { height: '100%', borderRadius: 4 },
  splitPace: { ...type.statSm, color: D.textMuted, width: 52, textAlign: 'right' },

  prWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  prChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  prText: { ...type.bodySmBold },

  actions: { marginTop: space.xl, gap: space.md },
  shareBtn: { paddingVertical: 16, borderRadius: radius.pill, alignItems: 'center' },
  shareBtnText: { ...type.button, color: '#fff' },
  doneBtn: { paddingVertical: 16, borderRadius: radius.pill, alignItems: 'center', borderWidth: 1, borderColor: D.border },
  doneBtnText: { ...type.button, color: D.text },
});
