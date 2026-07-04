import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Path, Rect, G } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

import { TEAMS, TEAM_BY_KEY, SG_BBOX, regionForUser } from '../data/regions';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { colors, radius, shadow, space, type } from '../theme';
import { haptic, PressableScale } from '../ui/motion';

const INK = colors.text;
const INK60 = colors.textMuted;
const INK40 = colors.textDim;
const SURFACE = colors.bg;
const BORDER = colors.border;
const MAP_BG = colors.bgElevated;

const PEEK_VIS = 196; // px of the sheet visible when collapsed
const FULL_FRAC = 0.78; // fraction of the screen the sheet covers when open
const ORD = ['', '1st', '2nd', '3rd', '4th'];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ---------------------------------------------------------------------------
// Procedural "claimed loops" map — land is captured by running closed loops,
// so each territory is an organic polygon (a smoothed closed route) painted
// over an abstract street grid. Mirrors the design mockup.
// ---------------------------------------------------------------------------
const VBW = 412;
const VBH = 760;

function hash(a, b) {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Smooth closed loop via Catmull-Rom -> cubic bezier.
function loopPath(cx, cy, r, seed, irr = 0.34, n = 11) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI * 2 * i) / n + (hash(seed + i * 0.7, seed * 1.3) - 0.5) * 0.25;
    const rad = r * (1 + (hash(seed + i * 1.7, seed * 2.1 + i) - 0.5) * irr * 2) * (i % 2 ? 0.94 : 1.06);
    pts.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.9]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
  }
  return d + 'Z';
}

const LOOPS = [
  { t: 'north', cx: 118, cy: 150, r: 54, s: 1.2 },
  { t: 'north', cx: 242, cy: 120, r: 46, s: 3.7 },
  { t: 'north', cx: 332, cy: 178, r: 48, s: 5.1 },
  { t: 'north', cx: 186, cy: 232, r: 40, s: 7.3 },
  { t: 'west', cx: 78, cy: 312, r: 50, s: 2.2 },
  { t: 'west', cx: 96, cy: 446, r: 54, s: 8.9 },
  { t: 'west', cx: 128, cy: 574, r: 46, s: 4.4 },
  { t: 'west', cx: 66, cy: 672, r: 40, s: 6.6 },
  { t: 'east', cx: 342, cy: 312, r: 50, s: 1.9 },
  { t: 'east', cx: 356, cy: 448, r: 52, s: 9.2 },
  { t: 'east', cx: 330, cy: 580, r: 46, s: 3.3 },
  { t: 'east', cx: 300, cy: 672, r: 42, s: 7.7 },
  { t: 'south', cx: 212, cy: 360, r: 46, s: 2.5 },
  { t: 'south', cx: 258, cy: 436, r: 40, s: 5.8 },
  { t: 'south', cx: 172, cy: 462, r: 38, s: 8.1 },
  { t: 'south', cx: 236, cy: 524, r: 40, s: 3.9 },
  { t: 'south', cx: 288, cy: 344, r: 32, s: 6.2 },
  { t: 'south', cx: 190, cy: 584, r: 34, s: 1.1 },
];

const STREETS_MAJOR = [
  'M -20 250 Q 200 196 440 300',
  'M -20 480 Q 200 540 440 452',
  'M 150 -20 Q 120 320 176 790',
  'M 306 -20 Q 338 360 286 790',
];
const STREETS_MINOR = [
  'M -20 150 Q 210 120 440 170',
  'M -20 360 Q 200 330 440 372',
  'M -20 600 Q 200 636 440 596',
  'M 70 -20 Q 58 360 96 790',
  'M 232 -20 Q 250 380 220 790',
  'M 372 -20 Q 392 360 350 790',
];
const COAST = 'M -10 706 C 90 686 190 712 290 700 C 350 692 400 706 422 700 L 422 780 L -10 780 Z';

function TerritoryMap({ myKey, focus }) {
  const loops = useMemo(
    () => LOOPS.map((b, i) => ({ ...b, i, mine: b.t === myKey, d: loopPath(b.cx, b.cy, b.r, b.s) })),
    [myKey],
  );
  const you = loops.find((b) => b.mine) || loops[12];
  const myStroke = (TEAM_BY_KEY[myKey] || TEAM_BY_KEY.south).stroke;

  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${VBW} ${VBH}`} preserveAspectRatio="xMidYMid slice">
      <Rect x="0" y="0" width={VBW} height={VBH} fill={MAP_BG} />
      <Path d={COAST} fill="#e6eaec" />
      <G fill="none" strokeLinecap="round">
        {STREETS_MAJOR.map((d, i) => (
          <Path key={`M${i}`} d={d} stroke="#e8e3d8" strokeWidth={7} />
        ))}
        {STREETS_MINOR.map((d, i) => (
          <Path key={`m${i}`} d={d} stroke="#ece8df" strokeWidth={3} />
        ))}
      </G>
      {loops.map((b) => {
        const t = TEAM_BY_KEY[b.t];
        const dim = focus && b.t !== focus;
        return (
          <Path
            key={b.i}
            d={b.d}
            fill={t.fill}
            fillOpacity={dim ? 0.18 : b.mine ? 0.78 : 0.62}
            stroke={t.stroke}
            strokeOpacity={dim ? 0.3 : 1}
            strokeWidth={b.mine ? 2.5 : 1.5}
            strokeLinejoin="round"
          />
        );
      })}
      {/* a live, still-open run (counts as distance until it closes) */}
      <Path
        d="M 196 360 C 150 330 150 300 200 296 C 250 292 286 318 300 352"
        fill="none"
        stroke={myStroke}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="6 7"
        opacity={0.9}
      />
      {you && (
        <G>
          <Circle cx={you.cx} cy={you.cy} r={10} fill={myStroke} fillOpacity={0.45} />
          <Circle cx={you.cx} cy={you.cy} r={8} fill={myStroke} stroke="#fff" strokeWidth={2.5} />
          <Circle cx={you.cx} cy={you.cy} r={2.8} fill="#fff" />
        </G>
      )}
    </Svg>
  );
}

// ---------------------------------------------------------------------------

function StatTile({ label, value, you, accent }) {
  return (
    <View style={[styles.stat, you && { borderColor: accent, borderWidth: 1 }]}>
      <Text style={styles.statEy}>{label}</Text>
      <Text style={[styles.statVal, you && { color: accent }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();

  const myTeam = useMemo(() => regionForUser(user.username), [user.username]);
  const accent = myTeam.stroke;

  const sheetH = Math.round(H * FULL_FRAC);
  const peekTy = sheetH - PEEK_VIS;

  const [focus, setFocus] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [territoryCount, setTerritoryCount] = useState(null);
  const [myArea, setMyArea] = useState(null);
  const [myZones, setMyZones] = useState(null);
  const [standings, setStandings] = useState(null);

  // Permissions up front (safe to call repeatedly; OS only prompts once).
  useEffect(() => {
    (async () => {
      try {
        await Location.requestForegroundPermissionsAsync();
      } catch {}
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') await Notifications.requestPermissionsAsync();
      } catch {}
    })();
  }, []);

  // Live territory totals for the user.
  const [statsError, setStatsError] = useState(false);
  const loadStats = React.useCallback(async () => {
    try {
      const data = await api.mapPolygons({
        minLon: SG_BBOX.minLon,
        minLat: SG_BBOX.minLat,
        maxLon: SG_BBOX.maxLon,
        maxLat: SG_BBOX.maxLat,
      });
      const ts = data.territories || [];
      setTerritoryCount(ts.length);
      const mine = ts.filter((t) => t.user_id === user.id);
      setMyZones(mine.length);
      setMyArea(mine.reduce((s, t) => s + (t.area_m2 || 0), 0));
      setStatsError(false);
    } catch {
      setTerritoryCount(0);
      setMyZones(0);
      setMyArea(0);
      setStatsError(true);
    }
  }, [user.id]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Team standings, aggregated from the leaderboard by team.
  useEffect(() => {
    (async () => {
      const base = {};
      TEAMS.forEach((t) => (base[t.key] = { ...t, area: 0, zones: 0 }));
      try {
        const rows = await api.leaderboard();
        (rows || []).forEach((r) => {
          const k = regionForUser(r.username).key;
          base[k].area += r.total_area_m2 || 0;
          base[k].zones += r.territory_count || 0;
        });
      } catch {}
      const rows = Object.values(base)
        .map((t) => ({ ...t, areaKm: t.area / 1e6 }))
        .sort((a, b) => b.area - a.area);
      setStandings(rows);
    })();
  }, []);

  const myRank = standings ? standings.findIndex((t) => t.key === myTeam.key) + 1 : 0;
  const myHeldKm = standings ? standings.find((t) => t.key === myTeam.key)?.areaKm || 0 : 0;
  const aheadTeam = standings && myRank > 1 ? standings[myRank - 2] : null;
  const behindGap = aheadTeam ? (aheadTeam.areaKm - myHeldKm).toFixed(1) : null;

  // ---- draggable bottom sheet ------------------------------------------
  const ty = useRef(new Animated.Value(peekTy)).current;
  const tyVal = useRef(peekTy);
  const dragBase = useRef(peekTy);
  useEffect(() => {
    const id = ty.addListener(({ value }) => (tyVal.current = value));
    return () => ty.removeListener(id);
  }, [ty]);

  const snapTo = (open) => {
    setExpanded(open);
    Animated.spring(ty, {
      toValue: open ? 0 : peekTy,
      useNativeDriver: true,
      bounciness: 2,
      speed: 14,
    }).start();
  };
  // Re-snap if the sheet height changes (rotation / first layout).
  useEffect(() => {
    ty.setValue(expanded ? 0 : peekTy);
  }, [peekTy]); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        dragBase.current = tyVal.current;
      },
      onPanResponderMove: (_e, g) => {
        const next = Math.max(0, Math.min(peekTy, dragBase.current + g.dy));
        ty.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dy) < 4) {
          snapTo(tyVal.current > peekTy * 0.5);
          return;
        }
        snapTo(tyVal.current < peekTy * 0.5);
      },
    }),
  ).current;

  const loading = territoryCount === null;
  const isNew = myZones === 0;

  return (
    <View style={styles.home}>
      {/* full-bleed map */}
      <View style={styles.mapFull}>
        <TerritoryMap myKey={myTeam.key} focus={focus} />
      </View>
      <View style={[styles.veilTop, { height: insets.top + 110 }]} pointerEvents="none" />

      {/* floating top controls */}
      <View style={[styles.floatTop, { top: insets.top + 8 }]}>
        <TouchableOpacity
          style={[styles.glass, styles.ava, { backgroundColor: myTeam.fill, borderColor: accent }]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Profile')}
        >
          <Text style={[styles.avaText, { color: myTeam.text }]}>
            {(user.username || '?').slice(0, 2).toUpperCase()}
          </Text>
        </TouchableOpacity>

        <View style={[styles.glass, styles.teamPill]}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
          <Text style={[styles.teamPillText, { color: myTeam.text }]}>Team {myTeam.name}</Text>
          <View style={styles.live}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>live</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.glass, styles.locate]}
          activeOpacity={0.8}
          onPress={() => setFocus((f) => (f === myTeam.key ? null : myTeam.key))}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Circle cx={12} cy={12} r={3.4} fill={accent} />
            <Circle cx={12} cy={12} r={7} stroke={accent} strokeWidth={1.8} />
            <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke={accent} strokeWidth={1.8} strokeLinecap="round" />
          </Svg>
        </TouchableOpacity>
      </View>

      <Text style={[styles.greeting, { top: insets.top + 60 }]}>
        {greeting()}, {user.username}
      </Text>

      {/* legend */}
      <View style={[styles.legend, styles.glass, { bottom: PEEK_VIS + 14 }]}>
        {TEAMS.map((t) => (
          <View key={t.key} style={styles.legendItem}>
            <View style={[styles.legendSw, { backgroundColor: t.fill, borderColor: t.stroke }]} />
            <Text style={styles.legendLabel}>{t.name}</Text>
          </View>
        ))}
      </View>

      {/* world-map shortcut */}
      <TouchableOpacity
        style={[styles.glass, styles.worldBtn, { bottom: PEEK_VIS + 14 }]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('GlobalMap')}
      >
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={9} stroke={INK} strokeWidth={1.7} />
          <Path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" stroke={INK} strokeWidth={1.4} />
        </Svg>
        <Text style={styles.worldBtnText}>World</Text>
      </TouchableOpacity>

      {/* bottom sheet */}
      <Animated.View style={[styles.sheet, { height: sheetH, transform: [{ translateY: ty }] }]}>
        <View style={styles.handleWrap} {...pan.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.sheetFixed}>
          <PressableScale
            style={[styles.startBtn, { backgroundColor: accent, shadowColor: accent }]}
            onPress={() => {
              haptic.light();
              navigation.navigate('Running');
            }}
            accessibilityRole="button"
            accessibilityLabel="Start run"
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path d="M7 4l13 8-13 8V4z" fill="#fff" />
            </Svg>
            <Text style={styles.startBtnText}>Start run</Text>
          </PressableScale>

          <Pressable style={styles.summary} onPress={() => snapTo(!expanded)}>
            <View style={styles.rankBig}>
              <Text style={[styles.rankBigNum, { color: myTeam.text }]}>{myRank || '—'}</Text>
              <Text style={styles.rankBigOrd}>{myRank ? ORD[myRank].slice(-2) : ''}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.summaryT} numberOfLines={1}>
                {myRank ? `You're ${ORD[myRank]} · Team ${myTeam.name}` : `Team ${myTeam.name}`}
              </Text>
              <Text style={styles.summaryS} numberOfLines={1}>
                {standings
                  ? behindGap
                    ? `${myHeldKm.toFixed(1)} km² held · ${behindGap} behind ${aheadTeam.name}`
                    : `${myHeldKm.toFixed(1)} km² held · leading the city`
                  : 'Loading standings…'}
              </Text>
            </View>
            <View style={[styles.chev, expanded && { transform: [{ rotate: '180deg' }] }]}>
              <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                <Path d="M6 15l6-6 6 6" stroke={INK60} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </Pressable>
        </View>

        <Animated.ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
          {/* standings */}
          <View style={styles.secH}>
            <Text style={styles.secHTitle}>Team standings</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Leaderboard')}>
              <Text style={styles.secHSub}>full leaderboard ›</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.stand}>
            {standings ? (
              standings.map((t, i) => {
                const maxA = Math.max(standings[0].areaKm, 0.001);
                const me = t.key === myTeam.key;
                return (
                  <Pressable
                    key={t.key}
                    style={[styles.standRow, focus === t.key && styles.standRowActive]}
                    onPress={() => setFocus(focus === t.key ? null : t.key)}
                  >
                    <Text style={styles.standRank}>{i + 1}</Text>
                    <View style={[styles.standDot, { backgroundColor: t.stroke }]} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.standNameRow}>
                        <Text style={[styles.standName, { color: t.text }]}>{t.name}</Text>
                        {me && (
                          <View style={[styles.youTag, { backgroundColor: accent }]}>
                            <Text style={styles.youTagText}>You</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.bar}>
                        <View
                          style={[styles.barFill, { width: `${(t.areaKm / maxA) * 100}%`, backgroundColor: t.stroke }]}
                        />
                      </View>
                    </View>
                    <View style={styles.standVal}>
                      <Text style={[styles.standArea, { color: t.text }]}>
                        {t.areaKm.toFixed(1)}
                        <Text style={styles.standUnit}> km²</Text>
                      </Text>
                      <Text style={styles.standZones}>{t.zones} zones</Text>
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <ActivityIndicator color={accent} style={{ marginVertical: 20 }} />
            )}
          </View>

          {/* contextual banner */}
          <TouchableOpacity
            style={styles.banner}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Running')}
          >
            <View style={[styles.bannerIc, { backgroundColor: myTeam.fill }]}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M6 3v18M6 4h11l-2.5 3.5L17 11H6"
                  stroke={accent}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.bannerT}>
                {isNew ? 'Run your first loop to claim land' : `Defend Team ${myTeam.name}`}
              </Text>
              <Text style={styles.bannerS}>
                {isNew
                  ? 'Close a loop and the ground inside becomes yours'
                  : behindGap
                  ? `${behindGap} km² behind ${aheadTeam.name} — close a loop to catch up`
                  : 'Keep closing loops to hold your lead'}
              </Text>
            </View>
            <Text style={styles.bannerGo}>›</Text>
          </TouchableOpacity>

          {/* your stats */}
          <View style={[styles.secH, { marginBottom: 10 }]}>
            <Text style={styles.secHTitle}>Your land</Text>
            {statsError ? (
              <TouchableOpacity onPress={loadStats} accessibilityRole="button">
                <Text style={[styles.secHSub, { color: accent }]}>
                  couldn't load · retry
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.secHSub}>all time</Text>
            )}
          </View>
          <View style={styles.statGrid}>
            <StatTile
              label="Area claimed"
              you
              accent={accent}
              value={
                loading ? '—' : `${(myArea / 1e6).toFixed(2)} km²`
              }
            />
            <StatTile label="Your zones" value={loading ? '—' : String(myZones)} />
            <StatTile label="Team rank" value={myRank ? ORD[myRank] : '—'} />
            <StatTile label="Zones on map" value={loading ? '—' : String(territoryCount)} />
          </View>
        </Animated.ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  home: { flex: 1, backgroundColor: MAP_BG },
  mapFull: { ...StyleSheet.absoluteFillObject },
  veilTop: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(247,248,250,0.55)' },

  glass: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 0.5,
    borderColor: 'rgba(22,24,29,0.06)',
    ...shadow.card,
  },

  floatTop: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ava: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
  },
  avaText: { ...type.bodySmBold },
  teamPill: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
  },
  teamPillText: { ...type.bodySmBold },
  dot: { width: 10, height: 10, borderRadius: 5 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 2 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ok },
  liveText: { ...type.caption },
  locate: {
    marginLeft: 'auto',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },

  greeting: { position: 'absolute', left: space.lg, zIndex: 5, ...type.bodySm, color: INK60 },

  legend: {
    position: 'absolute',
    left: 14,
    zIndex: 5,
    flexDirection: 'row',
    flexWrap: 'wrap',
    maxWidth: 150,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 14,
    gap: 5,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5, width: 64 },
  legendSw: { width: 11, height: 11, borderRadius: 3, borderWidth: 1.5 },
  legendLabel: { ...type.caption },

  worldBtn: {
    position: 'absolute',
    right: 14,
    zIndex: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  worldBtnText: { ...type.bodySmBold },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    backgroundColor: SURFACE,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 0.5,
    borderColor: BORDER,
    ...shadow.raised,
  },
  handleWrap: { paddingTop: 10, paddingBottom: 6, alignItems: 'center' },
  handle: { width: 38, height: 5, borderRadius: radius.pill, backgroundColor: colors.border },
  sheetFixed: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md },

  startBtn: {
    height: 56,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  startBtnText: { ...type.button },

  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 2 },
  rankBig: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  rankBigNum: { ...type.statMd, lineHeight: 26 },
  rankBigOrd: { ...type.caption, marginBottom: 2 },
  summaryT: { ...type.bodySmBold },
  summaryS: { ...type.caption, marginTop: 2 },
  chev: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sheetBody: { flex: 1, paddingHorizontal: space.lg },
  secH: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 2, marginTop: space.sm },
  secHTitle: { ...type.heading },
  secHSub: { ...type.caption },

  stand: { marginTop: 6 },
  standRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: space.sm, borderRadius: radius.md },
  standRowActive: { backgroundColor: colors.cardAlt },
  standRank: { ...type.caption, color: INK40, width: 12 },
  standDot: { width: 12, height: 12, borderRadius: 6 },
  standNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  standName: { ...type.bodySmBold },
  youTag: { borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  youTagText: { ...type.labelSm, color: '#fff' },
  bar: { height: 6, borderRadius: radius.pill, backgroundColor: colors.bgElevated, marginTop: 7, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.pill },
  standVal: { alignItems: 'flex-end' },
  standArea: { ...type.statSm },
  standUnit: { ...type.caption },
  standZones: { ...type.caption, marginTop: 4 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 0.5,
    borderColor: BORDER,
    marginTop: space.lg,
    ...shadow.card,
  },
  bannerIc: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  bannerT: { ...type.bodySmBold },
  bannerS: { ...type.caption, marginTop: 2 },
  bannerGo: { ...type.heading, color: INK40 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: space.xxl },
  stat: {
    width: '47.6%',
    flexGrow: 1,
    backgroundColor: colors.card,
    borderWidth: 0.5,
    borderColor: BORDER,
    borderRadius: radius.md,
    padding: 14,
    ...shadow.card,
  },
  statEy: { ...type.labelSm },
  statVal: { ...type.statMd, marginTop: 9 },
});
