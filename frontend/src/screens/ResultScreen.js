// Post-run result — the shareable artifact. Dark "night run" card: captured
// polygon glowing in the team colour, area as the hero stat (count-up),
// distance/pace/duration as a quiet row, then the territory delta.
// The card itself is captured via react-native-view-shot for sharing.

import React, { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

import { darkColors, radius, shadow, space, type, withAlpha } from '../theme';
import { regionForUser } from '../data/regions';
import { useAuth } from '../auth/AuthContext';
import { CountUpText, haptic, PressableScale } from '../ui/motion';
import { toast } from '../ui/toast';

// Open-path conversion (brief §6): distance (km) × 0.05 km² — roughly a
// 50m-wide strip painted along the route. Closing a loop always beats this,
// but a partial run still earns land.
const OPEN_PATH_RATE = 0.05;

const D = darkColors;

// ---------------------------------------------------------------------------
// Polygon -> centered SVG path with a team-colour glow (layered strokes —
// SVG has no shadows on native).
// ---------------------------------------------------------------------------

// All rings share one bounding box so multi-piece territories keep their
// true relative positions.
function ringsToSvgPath(rings, size, pad) {
  const pts = rings.flat();
  if (pts.length < 3) return null;
  const lats = pts.map(([, lat]) => lat);
  const lons = pts.map(([lon]) => lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latMid = (minLat + maxLat) / 2;
  // Correct for longitude compression so shapes aren't squashed.
  const kx = Math.cos((latMid * Math.PI) / 180);
  const w = Math.max((maxLon - minLon) * kx, 1e-9);
  const h = Math.max(maxLat - minLat, 1e-9);
  const scale = (size - pad * 2) / Math.max(w, h);
  const ox = (size - w * scale) / 2;
  const oy = (size - h * scale) / 2;

  let d = '';
  rings.forEach((ring) => {
    if (!ring || ring.length < 3) return;
    ring.forEach(([lon, lat], i) => {
      const x = ox + (lon - minLon) * kx * scale;
      const y = size - (oy + (lat - minLat) * scale); // flip y
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
      {/* glow halo: wide translucent strokes underneath the core line */}
      <Path d={d} fill={team.fill} stroke={withAlpha(team.glow, 0.16)} strokeWidth={14} strokeLinejoin="round" />
      <Path d={d} fill="none" stroke={withAlpha(team.glow, 0.35)} strokeWidth={7} strokeLinejoin="round" />
      <Path d={d} fill="none" stroke={team.glow} strokeWidth={2.5} strokeLinejoin="round" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------

function formatPace(distanceM, durationS) {
  if (!distanceM || distanceM < 50 || !durationS) return '—';
  const minPerKm = durationS / 60 / (distanceM / 1000);
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

function formatDuration(durationS) {
  const total = Math.max(0, Math.round(durationS));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
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

export default function ResultScreen({ navigation, route }) {
  const { result } = route.params;
  const { user } = useAuth();
  const team = regionForUser(user?.username || '');
  const cardRef = useRef(null);
  const [sharing, setSharing] = useState(false);

  const t = result.territory;
  const captured = !!t;

  // Rings for the SVG: server geometry if we captured (all pieces of a
  // MultiPolygon), otherwise the client path from the Running screen.
  const rings = captured
    ? (t.rings?.length ? t.rings : [t.polygon])
    : [(route.params.path || []).map((p) => [p.longitude, p.latitude])];

  const openAreaKm2 = (result.distance_m / 1000) * OPEN_PATH_RATE;
  const heroAreaM2 = captured ? t.area_m2 : openAreaKm2 * 1e6;

  const share = async () => {
    try {
      setSharing(true);
      haptic.light();
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png' });
      } else {
        toast.error('Sharing is not available on this device.');
      }
    } catch (e) {
      toast.error(e.message || 'Could not share');
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* the shareable card */}
      <View ref={cardRef} collapsable={false} style={styles.card}>
        <View style={[styles.eyebrow, { borderColor: team.glow }]}>
          <View style={[styles.eyebrowDot, { backgroundColor: team.glow }]} />
          <Text style={[styles.eyebrowText, { color: team.glow }]}>
            {captured ? `Loop captured · Team ${team.name}` : `Distance converted · Team ${team.name}`}
          </Text>
        </View>

        {rings[0]?.length >= 3 && (
          <View style={styles.polyWrap}>
            <GlowPolygon rings={rings} team={team} />
          </View>
        )}

        <View style={styles.heroRow}>
          <CountUpText
            value={heroAreaM2}
            style={[styles.heroArea, { color: team.glow }]}
          />
          <Text style={styles.heroUnit}> m²</Text>
        </View>
        <Text style={styles.heroCaption}>
          {captured
            ? 'claimed for your team'
            : `open path — ${(result.distance_m / 1000).toFixed(2)} km converted at strip rate`}
        </Text>

        <View style={styles.quietRow}>
          <QuietStat label="Distance" value={`${(result.distance_m / 1000).toFixed(2)} km`} />
          <QuietStat label="Pace" value={formatPace(result.distance_m, result.duration_s)} />
          <QuietStat label="Duration" value={formatDuration(result.duration_s)} />
        </View>

        <View style={styles.deltaRow}>
          <Text style={[styles.deltaText, { color: team.glow }]}>
            +{Math.round(heroAreaM2).toLocaleString()} m²
          </Text>
          <Text style={styles.deltaMuted}>  ·  Team {team.name} grows</Text>
        </View>

        <Text style={styles.watermark}>TERRITORY RUN</Text>
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: D.bg,
    padding: space.lg,
    justifyContent: 'center',
  },

  card: {
    backgroundColor: D.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: D.border,
    padding: space.xl,
    alignItems: 'center',
  },

  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    marginBottom: space.md,
  },
  eyebrowDot: { width: 7, height: 7, borderRadius: 4 },
  eyebrowText: { ...type.labelSm },

  polyWrap: { marginVertical: space.sm },

  heroRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: space.sm },
  heroArea: { ...type.statHero },
  heroUnit: { ...type.statMd, color: D.textMuted, marginBottom: 6 },
  heroCaption: { ...type.caption, color: D.textDim, marginTop: 2 },

  quietRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    marginTop: space.xl,
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: D.border,
  },
  quietStat: { flex: 1, alignItems: 'center' },
  quietLabel: { ...type.labelSm, color: D.textDim, marginBottom: 4 },
  quietValue: { ...type.statSm, color: D.text },

  deltaRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg },
  deltaText: { ...type.bodySmBold },
  deltaMuted: { ...type.bodySm, color: D.textMuted },

  watermark: { ...type.labelSm, color: D.textDim, marginTop: space.lg, letterSpacing: 2 },

  actions: { marginTop: space.xl, gap: space.md },
  shareBtn: {
    paddingVertical: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  shareBtnText: { ...type.button, color: '#fff' },
  doneBtn: {
    paddingVertical: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: D.border,
  },
  doneBtnText: { ...type.button, color: D.text },
});
