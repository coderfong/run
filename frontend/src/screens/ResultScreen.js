// Post-run result — claim placement + the shareable artifact. The run's
// distance became a circle (circumference = distance); the runner taps
// anywhere along their trail to place it, then the dark card (claimed circle
// glowing, area hero count-up, quiet stat row, steal summary, loop-mark
// watermark) is the shared image; splits and any PRs sit below it.

import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

import { LinearGradient } from 'expo-linear-gradient';

import GameMap, { MAP_READY, TerritoryFill, Trail, UserMarker } from '../components/GameMap';
import { CharacterBust } from '../components/character/CharacterRig';
import { useAvatar } from '../state/avatar';
import { api } from '../api/client';
import { brand, darkColors, radius, shadow, space, type, withAlpha } from '../theme';
import { useClan } from '../state/clan';
import { useSettings } from '../state/settings';
import { CountUpText, Reveal, haptic, PressableScale } from '../ui/motion';
import LoopMark from '../components/LoopMark';
import { toast } from '../ui/toast';

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

function formatArea(m2) {
  if (m2 >= 1e6) return `${(m2 / 1e6).toFixed(2)} km²`;
  return `${Math.round(m2).toLocaleString()} m²`;
}

// --- claim placement helpers ------------------------------------------------

// Midpoint of the trail by cumulative distance — the default circle centre.
function pathMidpoint(path) {
  if (!path?.length) return null;
  let total = 0;
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    total += haversine(path[i - 1], path[i]);
    cum.push(total);
  }
  const half = total / 2;
  let idx = 0;
  while (idx < cum.length - 1 && cum[idx + 1] < half) idx++;
  return path[idx];
}

// The trail point nearest a tapped (lat, lon) — placement snaps to the route.
function nearestOnPath(path, latitude, longitude) {
  let best = null, bestD = Infinity;
  for (const p of path) {
    const d = haversine(p, { latitude, longitude });
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

// Circle outline (radius in meters) around a centre, as map points, via a
// local equirectangular approximation — display only; the server rebuilds
// the authoritative polygon.
function circlePoints(center, radiusM, n = 48) {
  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos((center.latitude * Math.PI) / 180);
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return {
      latitude: center.latitude + (Math.sin(a) * radiusM) / mPerLat,
      longitude: center.longitude + (Math.cos(a) * radiusM) / mPerLon,
    };
  });
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
  const { equipped } = useAvatar();
  const { trailGlowColor } = useSettings();
  const team = color; // {fill, stroke, glow} — clan color or neutral
  const label = clan?.tag || 'Solo';
  const cardRef = useRef(null);
  const [sharing, setSharing] = useState(false);

  const path = route.params.path || [];

  // Claim placement: the run earned a circle (circumference = distance);
  // it becomes territory only once the runner places it on their trail.
  const [claim, setClaim] = useState({
    territory: result.territory || null,
    stolen_m2: result.stolen_m2 || 0,
    stolen_from: result.stolen_from || null,
  });
  const [center, setCenter] = useState(() => pathMidpoint(path));
  const [claiming, setClaiming] = useState(false);

  const t = claim.territory;
  const captured = !!t;
  const claimRadius = result.claim_radius_m || 0;
  const claimArea = result.claim_area_m2 || 0;
  const canPlace = !captured && claimRadius > 0 && path.length >= 2;

  const rings = captured
    ? (t.rings?.length ? t.rings : [t.polygon])
    : [path.map((p) => [p.longitude, p.latitude])];

  const heroAreaM2 = captured ? t.area_m2 : claimArea;
  const splits = useMemo(() => computeSplits(path), [path]);
  const stolen = claim.stolen_m2 || 0;
  const achievements = result.achievements || [];

  const onMapPress = (e) => {
    const c = e?.geometry?.coordinates;
    if (!c || !canPlace) return;
    haptic.light();
    setCenter(nearestOnPath(path, c[1], c[0]));
  };

  const placeClaim = async () => {
    if (!center || claiming || !canPlace) return;
    setClaiming(true);
    try {
      haptic.light();
      const out = await api.claimTerritory(result.run_id, center.latitude, center.longitude);
      setClaim({
        territory: out.territory,
        stolen_m2: out.stolen_m2 || 0,
        stolen_from: out.stolen_from || null,
      });
      haptic.success();
      toast.success('Territory claimed');
    } catch (e) {
      toast.error(e.message || 'Could not place your claim');
    } finally {
      setClaiming(false);
    }
  };

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
      {/* claim placement — tap anywhere on the trail to position the circle */}
      {canPlace && (
        <Reveal style={styles.placeCard}>
          <Text style={styles.placeTitle}>Place your claim</Text>
          <Text style={styles.placeHint}>
            {(result.distance_m / 1000).toFixed(2)} km converts to a {formatArea(claimArea)} circle.
            Tap anywhere along your route to position it.
          </Text>
          {MAP_READY ? (
            <View style={styles.placeMap}>
              <GameMap
                theme="dark"
                initialCenter={center || path[0]}
                initialZoom={14}
                onPress={onMapPress}
              >
                <Trail id="r-trail" points={path} color={trailGlowColor || team.stroke} width={4} glow />
                {center && (
                  <TerritoryFill
                    id="r-claim"
                    points={circlePoints(center, claimRadius)}
                    fillColor={team.stroke}
                    strokeColor={team.glow}
                    fillOpacity={0.22}
                    glow
                  />
                )}
                {/* your portrait marks the centre of the claim */}
                {center && (
                  <UserMarker point={center}>
                    <CharacterBust equipped={equipped} size={36} ring={team.glow} bg="rgba(21,24,29,0.9)" />
                  </UserMarker>
                )}
              </GameMap>
            </View>
          ) : (
            <View style={styles.placeChoices}>
              {[
                ['Start', path[0]],
                ['Middle', pathMidpoint(path)],
                ['End', path[path.length - 1]],
              ].map(([name, p]) => (
                <PressableScale
                  key={name}
                  style={[styles.placeChoice, center === p && { borderColor: team.glow }]}
                  onPress={() => { haptic.light(); setCenter(p); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Place claim at route ${name.toLowerCase()}`}
                >
                  <Text style={[type.bodySmBold, { color: center === p ? team.glow : D.textMuted }]}>{name}</Text>
                </PressableScale>
              ))}
            </View>
          )}
          <PressableScale
            style={[styles.claimBtn, { backgroundColor: team.stroke }, claiming && { opacity: 0.6 }]}
            onPress={placeClaim}
            disabled={claiming || !center}
            accessibilityRole="button"
            accessibilityLabel="Claim territory here"
          >
            <Text style={styles.claimBtnText}>{claiming ? 'Claiming…' : 'Claim here'}</Text>
          </PressableScale>
        </Reveal>
      )}

      {/* the shareable card */}
      <Reveal delay={canPlace ? 140 : 0}>
      <View ref={cardRef} collapsable={false} style={styles.card}>
        <View style={[styles.eyebrow, { borderColor: team.glow }]}>
          <View style={[styles.eyebrowDot, { backgroundColor: team.glow }]} />
          <Text style={[styles.eyebrowText, { color: team.glow }]}>
            {captured ? `Territory claimed · ${label}` : `Claim ready · ${label}`}
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
            ? 'claimed for your club'
            : canPlace
            ? 'your circle is ready — place it on your route above'
            : 'run at least a little further to earn a claim'}
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
      </Reveal>

      {/* PRs (Phase 6 fills achievements) */}
      {achievements.length > 0 && (
        <Reveal delay={220} style={styles.section}>
          <Text style={styles.sectionTitle}>Personal records</Text>
          <View style={styles.prWrap}>
            {achievements.map((a) => (
              <View key={a} style={[styles.prChip, { borderColor: team.glow }]}>
                <Text style={[styles.prText, { color: team.glow }]}>{a}</Text>
              </View>
            ))}
          </View>
        </Reveal>
      )}

      {/* splits */}
      <Reveal delay={300}>
        <Splits splits={splits} accent={team.glow} />
      </Reveal>

      <Reveal delay={380} style={styles.actions}>
        <PressableScale
          style={shadow.glow(brand.pink)}
          onPress={share}
          disabled={sharing || claiming}
          accessibilityRole="button"
          accessibilityLabel="Share result card"
        >
          <LinearGradient
            colors={brand.gradient}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.shareBtn}
          >
            <Text style={styles.shareBtnText}>{sharing ? 'Preparing…' : 'Share'}</Text>
          </LinearGradient>
        </PressableScale>
        <PressableScale
          style={styles.doneBtn}
          onPress={() => navigation.getParent()?.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
        >
          <Text style={styles.doneBtnText}>Done</Text>
        </PressableScale>
      </Reveal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space.lg, paddingBottom: space.xxl },

  placeCard: {
    backgroundColor: D.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: D.border,
    padding: space.lg,
    marginBottom: space.lg,
  },
  placeTitle: { ...type.heading, color: D.text, marginBottom: 4 },
  placeHint: { ...type.caption, color: D.textMuted, marginBottom: space.md },
  placeMap: { height: 300, borderRadius: radius.md, overflow: 'hidden', marginBottom: space.md },
  placeChoices: { flexDirection: 'row', gap: space.sm, marginBottom: space.md },
  placeChoice: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: D.border,
    backgroundColor: D.cardAlt,
  },
  claimBtn: { paddingVertical: 15, borderRadius: radius.pill, alignItems: 'center' },
  claimBtnText: { ...type.button, color: '#fff' },

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
