// PASERBY — the surprise beat after the ordinary result and sharing flow.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';

import { EVENTS, track } from '../../analytics';
import { brand, space, toon } from '../../theme';
import { PressableScale, haptic, useReduceMotion } from '../../ui/motion';
import { OutlinedText, ToonButton } from '../ui';
import CharacterRig from '../character/CharacterRig';
import { makeProjection, svgPoints, THUMB_H, THUMB_W } from '../RouteThumb';

const PHASE = { WAIT: 'wait', CROSSING: 'crossing', FOUND: 'found' };
const FALLBACK_ROUTE = [[103.81, 1.29], [103.815, 1.294], [103.82, 1.291], [103.827, 1.298]];
const titleCase = (value) => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function RouteMoment({ path, myAvatar, reduced }) {
  const raw = (path || []).map((p) => [p.longitude, p.latitude]).filter((p) => p.every(Number.isFinite));
  const route = raw.length >= 2 ? raw : FALLBACK_ROUTE;
  const points = makeProjection([route], 18, THUMB_H)(route);
  const middle = points[Math.floor(points.length / 2)];
  const left = Math.max(12, Math.min(82, (middle[0] / THUMB_W) * 100));
  return (
    <Animated.View entering={reduced ? undefined : FadeIn.duration(260)} style={styles.routeStage}>
      <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${THUMB_W} ${THUMB_H}`}>
        <Polyline points={svgPoints(points)} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
        <Polyline points={svgPoints(points)} fill="none" stroke={brand.pink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <View style={[styles.routeRunner, { left: `${left - 8}%` }]}>
        <CharacterRig equipped={myAvatar} size={34} animate={!reduced} />
      </View>
      <Animated.View entering={reduced ? undefined : ZoomIn.delay(500).duration(220)} style={[styles.routeRunner, { left: `${left + 5}%` }]}>
        <View style={styles.silhouette}><Text style={styles.silhouetteMark}>?</Text></View>
      </Animated.View>
    </Animated.View>
  );
}

export default function PaserbyReveal({
  visible, reveal, path, myAvatar, onHighFiveAll, onViewCrossroads, onContinue,
  highFiving = false, highFivedAll = false,
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReduceMotion();
  const encounters = (reveal?.encounters || []).slice(0, 3);
  const encounter = encounters[0];
  const [phase, setPhase] = useState(PHASE.WAIT);
  const timers = useRef([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (!visible || !encounter) { setPhase(PHASE.WAIT); return undefined; }
    setPhase(PHASE.WAIT);
    haptic.light();
    if (reduced) { setPhase(PHASE.FOUND); return undefined; }
    timers.current = [
      setTimeout(() => setPhase(PHASE.CROSSING), 1050),
      setTimeout(() => { setPhase(PHASE.FOUND); haptic.success(); }, 2650),
    ];
    return () => timers.current.forEach(clearTimeout);
  }, [visible, encounter?.id, reduced]);

  useEffect(() => {
    if (phase === PHASE.FOUND && visible) {
      track(EVENTS.PASERBY_REVEAL_VIEWED, { count: encounters.length, source: 'result' });
    }
  }, [phase, visible]);

  const cards = useMemo(() => encounters.map((person) => ({
    ...person,
    meta: [person.clan_name || person.clan_tag, titleCase(person.rank_key)].filter(Boolean).join(', '),
  })), [reveal]);

  if (!visible || !encounter) return null;
  const count = Math.min(3, Number(reveal?.new_count) || encounters.length);
  const heading = count === 1
    ? 'YOU CROSSED PATHS WITH SOMEONE 👀'
    : count === 2 ? 'YOU CROSSED PATHS WITH 2 PASERS 👀' : '3 PASERBYS DISCOVERED 👀';

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={phase === PHASE.FOUND ? onContinue : undefined}>
      <View style={[styles.scrim, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg }]}>
        {phase === PHASE.WAIT && (
          <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(180)} style={styles.center}>
            <OutlinedText style={styles.wait} outline={toon.ink} width={4}>WAIT…</OutlinedText>
            <Text style={styles.prompt}>You crossed paths with someone 👀</Text>
          </Animated.View>
        )}
        {phase === PHASE.CROSSING && (
          <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={styles.center}>
            <Text style={styles.eyebrow}>EARLIER TODAY</Text>
            <RouteMoment path={path} myAvatar={myAvatar} reduced={reduced} />
          </Animated.View>
        )}
        {phase === PHASE.FOUND && (
          <Animated.View entering={reduced ? undefined : FadeIn.duration(280)} style={styles.found}>
            <Text style={styles.eyebrow}>{heading}</Text>
            <View style={styles.cards}>
              {cards.map((person, index) => (
                <Animated.View key={person.id} entering={reduced ? undefined : ZoomIn.delay(index * 90).duration(300)} style={styles.card}>
                  <View style={styles.portrait}>
                    <CharacterRig equipped={person.avatar} size={count === 1 ? 82 : 50} animate={!reduced} />
                  </View>
                  <OutlinedText style={[styles.name, count > 1 && styles.nameSmall]} outline={toon.ink} width={2.5} numberOfLines={1}>
                    {String(person.username || 'PASER').toUpperCase()}
                  </OutlinedText>
                  {person.meta ? <Text style={styles.meta} numberOfLines={2}>{person.meta}</Text> : null}
                  <Text style={styles.when}>You crossed paths {String(person.when || 'recently').toLowerCase()}.</Text>
                  <Text style={styles.familiar}>
                    {Number(person.times_crossed) <= 1 ? 'FIRST ENCOUNTER' : "YOU'VE CROSSED PATHS BEFORE"}
                  </Text>
                </Animated.View>
              ))}
            </View>
            <View style={styles.actions}>
              <ToonButton title={highFivedAll ? 'HIGH FIVED 👋' : '👋  HIGH FIVE'} loading={highFiving} disabled={highFivedAll || highFiving} onPress={() => {
                track(EVENTS.PASERBY_HIGH_FIVE, { count, source: 'result' });
                onHighFiveAll?.();
              }} />
              <ToonButton title={count === 1 ? 'VIEW PROFILE' : 'VIEW CROSSROADS'} variant="neutral" size="sm" onPress={onViewCrossroads} />
              <PressableScale onPress={onContinue} accessibilityRole="button" accessibilityLabel="Done" style={styles.done}>
                <Text style={styles.doneText}>DONE</Text>
              </PressableScale>
            </View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(7,8,12,.96)', paddingHorizontal: space.gutter },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wait: { color: '#fff', fontSize: 48, textAlign: 'center' },
  prompt: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: space.md, textAlign: 'center' },
  eyebrow: { color: brand.teal, fontSize: 14, fontWeight: '900', letterSpacing: 2.2, textAlign: 'center' },
  routeStage: { width: '100%', aspectRatio: THUMB_W / THUMB_H, marginTop: space.xl, justifyContent: 'center' },
  routeRunner: { position: 'absolute', top: '10%', width: 42, height: 92, alignItems: 'center', justifyContent: 'flex-end' },
  silhouette: { width: 38, height: 58, borderRadius: 20, backgroundColor: '#171923', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  silhouetteMark: { color: '#fff', fontSize: 24, fontWeight: '900' },
  found: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cards: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center', gap: space.sm, marginTop: space.lg },
  card: { flex: 1, maxWidth: 250, alignItems: 'center' },
  portrait: { height: 176, justifyContent: 'flex-end', alignItems: 'center' },
  name: { color: '#fff', fontSize: 34, textAlign: 'center' },
  nameSmall: { fontSize: 18 },
  meta: { color: '#fff', fontSize: 14, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  when: { color: 'rgba(255,255,255,.72)', fontSize: 12, marginTop: space.md, textAlign: 'center' },
  familiar: { color: brand.teal, fontSize: 9, fontWeight: '900', letterSpacing: .7, marginTop: 6, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: space.sm, marginTop: space.xl },
  done: { alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10 },
  doneText: { color: 'rgba(255,255,255,.72)', fontSize: 13, fontWeight: '900', letterSpacing: 1.4 },
});
