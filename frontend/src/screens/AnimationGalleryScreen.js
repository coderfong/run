import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path } from 'react-native-svg';
import Animated from 'react-native-reanimated';

import CaptureStylePlayer from '../effects/CaptureStylePlayer';
import CaptureCast, { DEFENDER_SIZE } from '../effects/CaptureCast';
import useCaptureStage from '../effects/useCaptureStage';
import EffectPlayer from '../effects/EffectPlayer';
import { CAPTURE_STYLES, DEV_CAPTURE_STYLES } from '../effects/captureStyles';
import { layoutDefenders } from '../effects/anchors';
import { choreographySignature } from '../effects/choreography';
import { EFFECT_CATEGORY_LABELS } from '../effects/effectCategories';
import { getAllEffects } from '../effects/effectRegistry';
import { useAvatar } from '../state/avatar';
import { fonts, radius, space, useTheme, useThemedType } from '../theme';

const PREFS_KEY = 'dev:animation-gallery:v1';
const BACKGROUNDS = ['dark', 'light', 'checkerboard', 'map'];
const SPEEDS = [0.5, 1, 1.5, 2];
// The four cast sizes every style is validated against, so the lab can be
// pointed at the same cases the tests assert on.
const SCENARIOS = [
  { id: 'empty', label: 'Empty', defenders: 0 },
  { id: 'one', label: '1 rival', defenders: 1 },
  { id: 'two', label: '2 rivals', defenders: 2 },
  { id: 'three', label: '3 rivals', defenders: 3 },
];
// The gallery's own list, kept separate from CAPTURE_STYLES/PLAYABLE_CAPTURE_STYLES
// so a DEV style is browsable here without ever entering pickCaptureStyle()'s
// pool -- see captureStyles.js's DEV_CAPTURE_STYLES note.
const LAB_STYLES = [...CAPTURE_STYLES, ...DEV_CAPTURE_STYLES];
// Mirrors the real victim-side swap in components/LandCaptureAlert.js: the
// remote attacker's avatar and the local player's avatar trade slots, and the
// choreography (which of them braces/knocks back vs. strikes/celebrates)
// plays out unchanged, because it addresses ROLES, not people.
const PERSPECTIVES = [
  { id: 'attacker', label: 'Attacker' },
  { id: 'victim', label: 'Victim' },
];

function Chip({ label, active, onPress }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: colors.border, backgroundColor: active ? colors.text : colors.card },
      ]}
    >
      <Text style={{ color: active ? colors.bg : colors.text, fontSize: 12, fontFamily: fonts.bold }}>{label}</Text>
    </Pressable>
  );
}

function PreviewBackground({ mode, children, style }) {
  const dark = mode === 'dark' || mode === 'map';
  return (
    <View style={[styles.preview, { backgroundColor: dark ? '#171B22' : '#F3F0E9' }, style]}>
      {mode === 'checkerboard' ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Array.from({ length: 8 }, (_, row) => (
            <View key={row} style={{ flex: 1, flexDirection: 'row' }}>
              {Array.from({ length: 10 }, (_, column) => (
                <View
                  key={column}
                  style={{ flex: 1, backgroundColor: (row + column) % 2 ? '#D5D5D5' : '#FAFAFA' }}
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {mode === 'map' ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={[styles.mapRoad, { top: '30%', transform: [{ rotate: '-8deg' }] }]} />
          <View style={[styles.mapRoad, { top: '62%', transform: [{ rotate: '12deg' }] }]} />
          <View style={[styles.mapBlock, { left: '9%', top: '12%' }]} />
          <View style={[styles.mapBlock, { right: '8%', bottom: '10%' }]} />
        </View>
      ) : null}
      {children}
    </View>
  );
}

function EffectCard({ effect, background, loop, speed, replayToken, favorite, unusable, onFavorite, onUnusable }) {
  const { colors } = useTheme();
  const type = useThemedType();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: unusable ? 0.52 : 1 }]}>
      <PreviewBackground mode={background}>
        <EffectPlayer
          key={`${effect.id}:${replayToken}`}
          effect={effect}
          size={132}
          loop={loop || !!effect.loop}
          speed={speed}
          playToken={replayToken}
          allowReducedMotion
        />
      </PreviewBackground>
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={[type.bodySmBold, { color: colors.text }]}>{effect.name || effect.id}</Text>
            <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>{effect.id}</Text>
          </View>
          <Pressable onPress={onFavorite} hitSlop={8}><Text style={{ fontSize: 20 }}>{favorite ? '★' : '☆'}</Text></Pressable>
        </View>
        <Text style={[type.caption, { color: colors.textMuted }]}>
          {effect.type}, {effect.frameWidth ? `${effect.frameWidth}×${effect.frameHeight}` : 'vector'}
          {effect.frameCount ? `, ${effect.frameCount}f` : ''}{effect.fps ? `, ${effect.fps} FPS` : ''}
        </Text>
        <Text numberOfLines={2} style={[type.caption, { color: colors.textMuted }]}>{(effect.tags || []).join(', ')}</Text>
        <Pressable onPress={onUnusable} style={styles.markButton}>
          <Text style={[type.caption, { color: unusable ? colors.danger : colors.textMuted }]}>
            {unusable ? 'Marked unusable' : 'Mark unusable'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function LibraryGallery() {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [tag, setTag] = useState(null);
  const [background, setBackground] = useState('checkerboard');
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [replayToken, setReplayToken] = useState(0);
  const [favorites, setFavorites] = useState([]);
  const [unusable, setUnusable] = useState([]);
  const effects = useMemo(() => getAllEffects(), []);

  useEffect(() => {
    AsyncStorage.getItem(PREFS_KEY).then((raw) => {
      if (!raw) return;
      const saved = JSON.parse(raw);
      setFavorites(saved.favorites || []);
      setUnusable(saved.unusable || []);
    }).catch(() => {});
  }, []);
  const persist = useCallback((nextFavorites, nextUnusable) => {
    AsyncStorage.setItem(PREFS_KEY, JSON.stringify({ favorites: nextFavorites, unusable: nextUnusable })).catch(() => {});
  }, []);
  const toggle = useCallback((id, current, setter, other) => {
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    setter(next);
    persist(setter === setFavorites ? next : other, setter === setUnusable ? next : other);
  }, [persist, setFavorites, setUnusable]);

  const categories = useMemo(() => {
    const values = [...new Set(effects.map((effect) => effect.category))];
    return ['all', 'capture', ...values.sort()];
  }, [effects]);
  const tags = useMemo(() => {
    const counts = new Map();
    effects.forEach((effect) => effect.tags?.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([value]) => value);
  }, [effects]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return effects
      .filter((effect) => category === 'all' || (category === 'capture' ? effect.tags?.includes('capture') : effect.category === category))
      .filter((effect) => !tag || effect.tags?.includes(tag))
      .filter((effect) => !needle || `${effect.id} ${effect.name} ${(effect.tags || []).join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) || a.id.localeCompare(b.id));
  }, [category, effects, favorites, query, tag]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.filters}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search ID, name, or tag"
          placeholderTextColor={colors.textMuted}
          style={[styles.search, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {categories.map((value) => (
            <Chip key={value} label={EFFECT_CATEGORY_LABELS[value] || value} active={category === value} onPress={() => setCategory(value)} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Chip label="Any tag" active={!tag} onPress={() => setTag(null)} />
          {tags.map((value) => <Chip key={value} label={value} active={tag === value} onPress={() => setTag(value)} />)}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {BACKGROUNDS.map((value) => <Chip key={value} label={value} active={background === value} onPress={() => setBackground(value)} />)}
          <Chip label={loop ? 'Loop on' : 'Loop off'} active={loop} onPress={() => setLoop((value) => !value)} />
          {SPEEDS.map((value) => <Chip key={value} label={`${value}×`} active={speed === value} onPress={() => setSpeed(value)} />)}
          <Chip label="Replay all" active={false} onPress={() => setReplayToken((value) => value + 1)} />
        </ScrollView>
      </View>
      <Text style={{ color: colors.textMuted, paddingHorizontal: space.md, paddingBottom: space.sm }}>{filtered.length} registered effects</Text>
      <FlatList
        data={filtered}
        keyExtractor={(effect) => effect.id}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        contentContainerStyle={styles.list}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={3}
        removeClippedSubviews
        renderItem={({ item }) => (
          <EffectCard
            effect={item}
            background={background}
            loop={loop}
            speed={speed}
            replayToken={replayToken}
            favorite={favorites.includes(item.id)}
            unusable={unusable.includes(item.id)}
            onFavorite={() => toggle(item.id, favorites, setFavorites, unusable)}
            onUnusable={() => toggle(item.id, unusable, setUnusable, favorites)}
          />
        )}
      />
    </View>
  );
}

function CaptureStyleLab() {
  const { colors } = useTheme();
  const type = useThemedType();
  const { equipped } = useAvatar();
  const [styleId, setStyleId] = useState(LAB_STYLES[0].id);
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [reduced, setReduced] = useState(false);
  const [playToken, setPlayToken] = useState(1);
  const [stage, setStage] = useState({ width: 320, height: 430 });
  const [revealed, setRevealed] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [background, setBackground] = useState('map');
  const [perspective, setPerspective] = useState(PERSPECTIVES[0]);
  // DEV-only comparison filter: narrows the style row to just the Seedance
  // candidates, so switching between them (e.g. Stamp vs. Party Burst) is a
  // single tap rather than scrolling past every production style first.
  const [seedanceOnly, setSeedanceOnly] = useState(false);
  // The lab drives the same scene and the same body the live claim does, so a
  // style watched here is the style that ships. Without these the gallery
  // would preview only the sprite track — which is exactly the partial view
  // that let fifteen "different" styles look fine in isolation.
  const captureStage = useCaptureStage(reduced);
  const castRef = useRef(null);
  const replay = useCallback(() => {
    setRevealed(null);
    setPlayToken((value) => value + 1);
  }, []);
  const reveal = useCallback((spec) => setRevealed(spec || {}), []);
  const center = useMemo(() => ({ x: stage.width / 2, y: stage.height * 0.58 }), [stage.height, stage.width]);
  const ring = useMemo(() => [
    { x: center.x - 105, y: center.y - 52 }, { x: center.x - 44, y: center.y - 105 },
    { x: center.x + 86, y: center.y - 74 }, { x: center.x + 112, y: center.y + 28 },
    { x: center.x + 28, y: center.y + 84 }, { x: center.x - 96, y: center.y + 52 },
  ], [center]);
  const rings = useMemo(() => [ring], [ring]);
  const d = useMemo(() => `M ${ring.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`, [ring]);
  const characterRect = useMemo(
    () => ({ x: center.x - 29, y: center.y - 29, width: 58, height: 58 }),
    [center]
  );
  const selected = useMemo(() => LAB_STYLES.find((item) => item.id === styleId), [styleId]);
  // The lab casts the same rivals the live claim would, laid out by the same
  // function against the same shape, so "how does this style read against
  // three people" is answerable at a desk. Seeded off the style so switching
  // styles reshuffles who stands where, and replaying one does not.
  //
  // Under Victim perspective this becomes exactly one entry, the local
  // player -- the same shape components/LandCaptureAlert.js casts for a real
  // victim replay (`[{ user_id: 'me', ... avatar: equipped }]`), never the
  // scenario's cast size, because a real victim replay is always one person.
  const isVictim = perspective.id === 'victim';
  const effectiveDefenderCount = isVictim ? 1 : scenario.defenders;
  const labDefenders = useMemo(
    () => (isVictim
      ? [{ id: 'lab-victim-you', avatar: equipped, clan_color: { stroke: '#FF8C6B' } }]
      : Array.from({ length: scenario.defenders }, (_, index) => ({
        id: `lab-${index}`,
        avatar: equipped,
        clan_color: { stroke: '#FF8C6B' },
      }))),
    [equipped, isVictim, scenario.defenders]
  );
  const labRects = useMemo(
    () => layoutDefenders(
      effectiveDefenderCount,
      { bounds: stage, claimPoint: center, territoryRings: rings },
      `lab:${styleId}:${perspective.id}`,
      DEFENDER_SIZE
    ),
    [center, effectiveDefenderCount, perspective.id, rings, stage, styleId]
  );
  // Attacker∕defender trade slots for Victim perspective, same as the real
  // victim-side alert: an empty cosmetics object stands in for "the remote
  // attacker", since the lab only has the signed-in player's own avatar to
  // draw from. The choreography does not care whose avatar is in a role.
  const labAttacker = isVictim ? {} : equipped;
  const visibleStyles = seedanceOnly ? DEV_CAPTURE_STYLES : LAB_STYLES;

  return (
    <ScrollView contentContainerStyle={styles.lab}>
      <Text style={[type.title, { color: colors.text }]}>Capture Style Lab</Text>
      <Text style={[type.bodySm, { color: colors.textMuted }]}>Uses the same style player and current avatar as the live post-run claim.</Text>
      <View style={styles.chipRow}>
        <Chip
          label={seedanceOnly ? 'Seedance / PASER only' : 'Seedance / PASER'}
          active={seedanceOnly}
          onPress={() => {
            const next = !seedanceOnly;
            setSeedanceOnly(next);
            // Switching the filter on while a production style is selected
            // would otherwise leave the row with nothing marked active.
            if (next && !DEV_CAPTURE_STYLES.some((item) => item.id === styleId)) {
              setStyleId(DEV_CAPTURE_STYLES[0].id);
              replay();
            }
          }}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {visibleStyles.map((item) => <Chip key={item.id} label={item.name} active={styleId === item.id} onPress={() => { setStyleId(item.id); replay(); }} />)}
      </ScrollView>
      <View style={styles.chipRow}>
        {SCENARIOS.map((item) => (
          <Chip
            key={item.id}
            label={item.label}
            active={scenario.id === item.id}
            // 0/1/2/3 only means anything for Attacker perspective -- Victim
            // is always exactly 1, matching the real victim-side replay.
            onPress={() => { if (!isVictim) { setScenario(item); replay(); } }}
          />
        ))}
        <Chip label={reduced ? 'Reduced on' : 'Reduced off'} active={reduced} onPress={() => { setReduced((value) => !value); replay(); }} />
        <Chip label="Replay" active={false} onPress={replay} />
      </View>
      <View style={styles.chipRow}>
        {PERSPECTIVES.map((item) => <Chip key={item.id} label={item.label} active={perspective.id === item.id} onPress={() => { setPerspective(item); replay(); }} />)}
        {BACKGROUNDS.map((value) => <Chip key={value} label={value} active={background === value} onPress={() => setBackground(value)} />)}
        {SPEEDS.map((value) => <Chip key={value} label={`${value}×`} active={speed === value} onPress={() => setSpeed(value)} />)}
      </View>
      <PreviewBackground
        mode={background}
        style={styles.labStage}
      >
        {/* One stage, exactly as ResultScreen mounts it: the ground, the body
            and the art all take the camera cues together. `onLayout` reports
            pre-transform layout, so a zoom cannot feed back into the bounds
            the style is laid out against. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, captureStage.style]}
          onLayout={(event) => setStage(event.nativeEvent.layout)}
        >
          <Svg style={StyleSheet.absoluteFill}>
            <Path d={d} fill={revealed ? 'rgba(84,231,165,0.32)' : 'rgba(255,255,255,0.03)'} stroke="#54E7A5" strokeWidth={3} />
          </Svg>
          <CaptureCast
            ref={castRef}
            attacker={labAttacker}
            attackerPoint={center}
            defenders={labDefenders}
            defenderRects={labRects}
            bounds={stage}
            reducedMotion={reduced}
          />
          <CaptureStylePlayer
            style={styleId}
            playToken={playToken}
            bounds={stage}
            claimPoint={center}
            territoryRings={rings}
            characterRect={characterRect}
            defenderRects={labRects}
            defenderCount={effectiveDefenderCount}
            reducedMotion={reduced}
            seed={`lab:${styleId}:${perspective.id}`}
            // `timeScale` stretches DELAYS (see useCaptureStage.js's own
            // note): a value > 1 is slower, < 1 is faster -- the inverse of
            // the "0.5x is slower" convention `speed` reads as everywhere
            // else in this screen (EffectPlayer's playback-rate `speed`).
            timeScale={1 / speed}
            tint="#54E7A5"
            ink="#54E7A5"
            onTerritoryReveal={reveal}
            stage={captureStage}
            cast={castRef}
          />
        </Animated.View>
      </PreviewBackground>
      <Text style={[type.bodySmBold, { color: colors.text }]}>{selected?.name}</Text>
      <Text style={[type.bodySm, { color: colors.textMuted }]}>{selected?.description}</Text>
      {/* The movement, with the art taken out of it — the same string the
          uniqueness test compares. Reading two of these side by side is the
          fastest way to tell whether a new style is actually a new style or
          a repaint of one that already ships. */}
      <Text style={[type.bodySm, { color: colors.textMuted, marginTop: space.xs }]}>
        {selected?.archetype}
      </Text>
      <Text style={[type.caption, { color: colors.textMuted }]}>
        {selected ? choreographySignature(selected) : null}
      </Text>
    </ScrollView>
  );
}

export default function AnimationGalleryScreen() {
  const { colors } = useTheme();
  const [section, setSection] = useState('library');
  if (!__DEV__) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={[styles.sectionTabs, { borderBottomColor: colors.border }] }>
        <Chip label="Animation Library" active={section === 'library'} onPress={() => setSection('library')} />
        <Chip label="Capture Styles" active={section === 'styles'} onPress={() => setSection('styles')} />
      </View>
      {section === 'library' ? <LibraryGallery /> : <CaptureStyleLab />}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTabs: { flexDirection: 'row', gap: 8, padding: space.md, borderBottomWidth: 1 },
  filters: { gap: 8, padding: space.md },
  search: { height: 42, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12 },
  chipRow: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 7 },
  list: { paddingHorizontal: space.sm, paddingBottom: 80 },
  columns: { gap: space.sm },
  card: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: radius.md, overflow: 'hidden', marginBottom: space.sm },
  preview: { height: 166, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cardBody: { padding: space.sm, gap: 4 },
  cardTitleRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  markButton: { paddingTop: 5, alignSelf: 'flex-start' },
  mapRoad: { position: 'absolute', left: '-10%', width: '120%', height: 18, backgroundColor: '#323A43' },
  mapBlock: { position: 'absolute', width: 84, height: 58, borderWidth: 1, borderColor: '#39434E', backgroundColor: '#20262E' },
  lab: { padding: space.md, gap: space.md, paddingBottom: 80 },
  labStage: { width: '100%', height: 430, borderRadius: radius.lg },
});
