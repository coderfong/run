// Post-run result — claim placement + the shareable artifact. The run's
// distance became a circle (circumference = distance); the runner taps
// anywhere along their trail to place it, then the dark card (claimed circle
// glowing, area hero count-up, quiet stat row, steal summary, loop-mark
// watermark) is the shared image; splits and any PRs sit below it.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PanResponder, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { Confetti, CountUpText, Reveal, haptic, PressableScale } from '../ui/motion';
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
  return `${(m2 / 1e6).toFixed(m2 >= 1e5 ? 2 : 3)} km²`;
}

// worklet-safe km² formatter for the animated hero number.
function km2(n) {
  'worklet';
  const v = n / 1e6;
  return v >= 0.1 ? v.toFixed(2) : v.toFixed(3);
}

// A pace-aware pat on the back, shown after every run.
function encouragement(distanceM, durationS, xp) {
  const km = distanceM / 1000;
  const pace = durationS && distanceM ? durationS / 60 / km : 0; // min/km
  if (km >= 10) return 'Huge distance today — your legs earned this. 🔥';
  if (pace && pace < 5) return "Blazing pace! That's how territory gets taken. ⚡";
  if (km >= 5) return 'Strong run. The map is yours for the claiming. 💪';
  if (km >= 2) return 'Nice work out there — every km is more ground. 🏃';
  return 'Every run counts. Lace up again soon! 👟';
}

// --- claim placement helpers ------------------------------------------------

// Cumulative distance along the trail — the slider's coordinate system.
function cumulativePath(path) {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += haversine(path[i - 1], path[i]);
    cum.push(total);
  }
  return { cum, total: Math.max(total, 1e-6) };
}

// The exact point `frac` (0..1) of the way along the trail, interpolated
// between vertices so the circle glides smoothly with the slider.
function pointAtFraction(path, geo, frac) {
  const target = Math.max(0, Math.min(1, frac)) * geo.total;
  let i = 0;
  while (i < geo.cum.length - 2 && geo.cum[i + 1] < target) i++;
  const a = path[i];
  const b = path[Math.min(i + 1, path.length - 1)];
  const seg = geo.cum[i + 1] - geo.cum[i] || 1e-6;
  const t = Math.max(0, Math.min(1, (target - geo.cum[i]) / seg));
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t,
  };
}

// Fraction along the trail of the vertex nearest a tapped (lat, lon).
function fractionNearest(path, geo, latitude, longitude) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversine(path[i], { latitude, longitude });
    if (d < bestD) { bestD = d; best = i; }
  }
  return geo.cum[best] / geo.total;
}

// A dependency-free slider (PanResponder) — slides the claim circle along
// the route. Captures the gesture so the surrounding ScrollView never wins.
function PathSlider({ frac, onChange, accent }) {
  const widthRef = useRef(1);
  const setFromX = (x) => {
    const f = Math.max(0, Math.min(1, x / widthRef.current));
    onChange(Math.round(f * 400) / 400);
  };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
      onPanResponderTerminationRequest: () => false,
    })
  ).current;
  return (
    <View
      style={styles.sliderWrap}
      onLayout={(e) => { widthRef.current = Math.max(1, e.nativeEvent.layout.width); }}
      {...pan.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel="Slide the claim circle along your route"
    >
      <View style={styles.sliderTrack} />
      <View style={[styles.sliderFill, { width: `${frac * 100}%`, backgroundColor: accent }]} />
      <View style={[styles.sliderThumb, { left: `${frac * 100}%`, borderColor: accent }]} />
    </View>
  );
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
  // The circle's position = a fraction along the trail (slider-driven; a
  // map tap snaps it too). Derived, so it can never be null while a path
  // exists — the claim button always has a live target.
  const geo = useMemo(() => cumulativePath(path), [path]);
  const [frac, setFrac] = useState(0.5);
  const center = useMemo(
    () => (path.length >= 2 ? pointAtFraction(path, geo, frac) : null),
    [path, geo, frac]
  );
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
  const xpGained = result.xp_gained || 0;
  const cheer = useMemo(
    () => encouragement(result.distance_m, result.duration_s, xpGained),
    [result.distance_m, result.duration_s, xpGained]
  );
  // Celebrate the finish once, on mount.
  const [showConfetti, setShowConfetti] = useState(true);
  useEffect(() => {
    haptic.success();
    const id = setTimeout(() => setShowConfetti(false), 2800);
    return () => clearTimeout(id);
  }, []);

  const onMapPress = (e) => {
    const c = e?.geometry?.coordinates;
    if (!c || !canPlace) return;
    haptic.light();
    setFrac(fractionNearest(path, geo, c[1], c[0]));
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
      // Unmissable — a silent failure here looks like a dead button.
      Alert.alert('Could not place your claim', e.message || 'Check your connection and try again.');
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
    <View style={{ flex: 1, backgroundColor: D.bg }}>
    <ScrollView style={{ flex: 1, backgroundColor: D.bg }} contentContainerStyle={styles.scroll}>
      {/* finish celebration: encouraging line + XP earned */}
      <Reveal from="up" style={styles.cheerCard}>
        <Text style={[styles.cheerText, { color: team.glow }]}>{cheer}</Text>
        {xpGained > 0 && (
          <View style={[styles.xpPill, { borderColor: team.glow }]}>
            <Text style={[styles.xpPillText, { color: team.glow }]}>+{xpGained} XP</Text>
          </View>
        )}
      </Reveal>

      {/* claim placement — slide the circle along the route (map tap works too) */}
      {canPlace && (
        <View style={styles.placeCard}>
          <Text style={styles.placeTitle}>Place your claim</Text>
          <Text style={styles.placeHint}>
            {(result.distance_m / 1000).toFixed(2)} km converts to a {formatArea(claimArea)} circle.
            Slide it anywhere along your route.
          </Text>
          {MAP_READY && (
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
          )}

          {/* the slider: start of the route ⟷ end of the route */}
          <PathSlider frac={frac} onChange={setFrac} accent={team.stroke} />
          <View style={styles.sliderLabels}>
            <Text style={[type.caption, { color: D.textDim }]}>Start</Text>
            <Text style={[type.caption, { color: D.textMuted }]}>
              {((frac * geo.total) / 1000).toFixed(2)} km mark
            </Text>
            <Text style={[type.caption, { color: D.textDim }]}>Finish</Text>
          </View>

          <TouchableOpacity
            style={[styles.claimBtn, { backgroundColor: team.stroke, opacity: claiming ? 0.6 : 1 }]}
            onPress={placeClaim}
            disabled={claiming}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Claim territory here"
          >
            <Text style={styles.claimBtnText}>{claiming ? 'Claiming…' : 'Claim here'}</Text>
          </TouchableOpacity>
        </View>
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
          <CountUpText value={heroAreaM2} format={km2} style={[styles.heroArea, { color: team.glow }]} />
          <Text style={styles.heroUnit}> km²</Text>
        </View>
        <Text style={styles.heroCaption}>
          {captured
            ? `claimed for your club · strength ×${(t.strength || 1).toFixed(1)}`
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
                Stole {formatArea(stolen)}{result.stolen_from ? ` from ${result.stolen_from}` : ''}
              </Text>
            ) : (
              <Text style={[styles.deltaText, { color: team.glow }]}>
                +{formatArea(heroAreaM2)} · {label} holds more
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
    {showConfetti && <Confetti />}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space.lg, paddingBottom: space.xxl },

  cheerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.md,
  },
  cheerText: { ...type.bodyBold, flex: 1 },
  xpPill: {
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 5,
  },
  xpPillText: { ...type.bodySmBold },

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

  sliderWrap: { height: 44, justifyContent: 'center', marginHorizontal: 4 },
  sliderTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 6,
    borderRadius: 3,
    backgroundColor: D.cardAlt,
  },
  sliderFill: { position: 'absolute', left: 0, height: 6, borderRadius: 3 },
  sliderThumb: {
    position: 'absolute',
    width: 26,
    height: 26,
    marginLeft: -13,
    borderRadius: 13,
    borderWidth: 3,
    backgroundColor: '#fff',
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space.md,
    marginTop: 2,
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
