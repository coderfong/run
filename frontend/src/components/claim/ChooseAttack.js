// "Choose your attack" — the move the run earned.
//
// A run earns ONE piece of ground, in the shape of the run itself. This is
// where the runner decides where to put it: slide it anywhere along the route
// and turn it to any heading. Same land whatever they choose — the move is
// what it lands ON. Empty ground, a rival's border, or on top of what they
// already hold.
//
// Both axes are CONTINUOUS. That is the whole point of the control and it is
// why the geometry is local: the shape, its pivot and the route come down once
// from `api.claimOptions`, and `placement.js` redoes the server's rigid move
// on every frame, so the polygon tracks the finger with no request in the
// loop. What the server is still asked for is the NUMBERS — who is under it,
// what it costs — and that call is debounced, because a breakdown that lags a
// quarter second behind the picture is fine and one that fires per pixel is
// not.
//
// The rails are deliberately not the map itself: dragging on a Mapbox view
// fights the map's own pan, and the runner needs that pan to look around
// before deciding.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line } from 'react-native-svg';

import { CharacterBust } from '../character/CharacterRig';
import {
  dialPointForHeading,
  headingFromDialPoint,
  normaliseDeg,
  turnFromRun,
} from './placement';
import { darkColors, radius, space, toon, toonRadius, type, withAlpha } from '../../theme';
import { haptic, PressableScale } from '../../ui/motion';

const D = darkColors;

// Land reads in m² until it stops being readable — a claim is usually a
// couple of km², but the interesting numbers (what you took off someone) are
// often a few thousand square metres and round to "0.00 km²".
export function landStr(m2) {
  const v = Math.max(0, Math.round(m2 || 0));
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)} km²`;
  // Grouped by hand rather than via toLocaleString: Hermes' Intl support is
  // not something a number this prominent should depend on.
  return `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} m²`;
}

const RECOMMENDATIONS = [
  { key: 'most_land_index', label: 'MOST LAND' },
  { key: 'biggest_steal_index', label: 'BIGGEST STEAL' },
  { key: 'best_defence_index', label: 'BEST DEFENCE' },
];

// What each move is called, in the order the server classifies them. The price
// follows the action, so naming the action is what makes the price make sense.
const ACTION_LABEL = {
  empty: 'Claim open ground',
  reinforce: 'Reinforce your land',
  attack: 'Attack rival',
  fortified: 'Storm a defended border',
};

function StatRow({ label, value, color, dim }) {
  return (
    <View style={styles.statRow}>
      <View style={[styles.swatch, { backgroundColor: color, opacity: dim ? 0.35 : 1 }]} />
      <Text style={[styles.statLabel, dim && { color: D.textDim }]}>{label}</Text>
      <Text style={[styles.statValue, { color: dim ? D.textDim : D.text }]}>{value}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Position — a continuous rail along the route
// ---------------------------------------------------------------------------

// No stops and no snapping. There is nothing to snap TO any more: every point
// on the route is a real pose, so a handle that jumped between nine of them
// would be inventing a constraint the game no longer has.
//
// The one landmark it keeps is AS RUN — a notch at `baseT` with a little
// magnetism, because "put it back where I earned it" is a thing runners
// actually want and hitting an exact float by dragging is not possible.
function PositionRail({ t, baseT, accent, onChange, onCommit, onInteractionChange, disabled }) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  widthRef.current = width;
  const tRef = useRef(t);
  tRef.current = t;

  const pick = useCallback(
    (x, commit) => {
      const w = widthRef.current;
      if (w <= 0) return;
      let next = Math.max(0, Math.min(1, x / w));
      // Magnetism at the resting pose, ~8px wide. Small enough that it never
      // fights a deliberate drag past it, big enough to be catchable.
      if (baseT != null && Math.abs(next - baseT) * w < 8) {
        if (Math.abs(tRef.current - baseT) > 1e-6) haptic.light();
        next = baseT;
      }
      onChange(next);
      if (commit) onCommit?.(next);
    },
    [baseT, onChange, onCommit]
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onStartShouldSetPanResponderCapture: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        // The rail sits inside a scroll view; without this the scroll steals
        // the gesture the moment the finger moves.
        onMoveShouldSetPanResponderCapture: () => !disabled,
        onPanResponderGrant: (e) => {
          onInteractionChange?.(true);
          pick(e.nativeEvent.locationX, false);
        },
        onPanResponderMove: (e) => pick(e.nativeEvent.locationX, false),
        onPanResponderRelease: (e) => {
          pick(e.nativeEvent.locationX, true);
          onInteractionChange?.(false);
        },
        onPanResponderTerminate: () => {
          onCommit?.(tRef.current);
          onInteractionChange?.(false);
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [disabled, onCommit, onInteractionChange, pick]
  );

  const handleAt = width * Math.max(0, Math.min(1, t));

  return (
    <View style={styles.railWrap}>
      <View style={styles.railLabels}>
        <Text style={styles.railEnd}>START</Text>
        <Text style={styles.railHint}>drag to slide your claim along the run</Text>
        <Text style={styles.railEnd}>FINISH</Text>
      </View>
      <View
        style={styles.railTouch}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        {...responder.panHandlers}
      >
        {/* Every child is pointerEvents="none" so the rail itself is always
            the touch target: `locationX` is only relative to the responder
            view, and a tap landing on a child would be measured from the
            child's own left edge instead. */}
        <View style={styles.railTrack} pointerEvents="none" />
        <View
          pointerEvents="none"
          style={[styles.railFill, { width: handleAt, backgroundColor: withAlpha(accent, 0.5) }]}
        />
        {baseT != null && width > 0 && (
          <View
            pointerEvents="none"
            style={[styles.restNotch, { left: width * baseT - 1, backgroundColor: D.textDim }]}
          />
        )}
        {width > 0 && (
          <View
            style={[
              styles.handle,
              { left: handleAt - HANDLE / 2, borderColor: accent, backgroundColor: toon.ink },
            ]}
            pointerEvents="none"
          >
            <View style={[styles.handleCore, { backgroundColor: accent }]} />
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Heading — a dial, because an angle is not a line
// ---------------------------------------------------------------------------

// The rotation used to be a second rail, which meant 359° and 1° sat at
// opposite ends of the control despite being the same heading. A dial has no
// seam: drag anywhere in it and the claim points at your finger.
const DIAL = 112;
const DIAL_R = DIAL / 2 - 12;

function RotationDial({ deg, accent, onChange, onCommit, onInteractionChange, disabled }) {
  const centre = DIAL / 2;
  const degRef = useRef(deg);
  degRef.current = deg;

  const pick = useCallback(
    (x, y, commit) => {
      const dx = x - centre;
      const dy = y - centre;
      // Ignore a touch right on the pivot: the angle there is noise.
      if (Math.hypot(dx, dy) < 10) return;
      // Screen y grows downward, the claim's frame grows north — so the sign
      // of dy flips on the way in. atan2 is measured from east; the dial reads
      // from north, which is the extra quarter turn.
      let next = headingFromDialPoint(x, y, centre, centre);
      // Magnetism at the eighths, ~4°, so a heading can be squared up
      // deliberately instead of landing on 88°. `((d + 540) % 360) - 180` is
      // the signed angular distance — the +540 is +180 for the centring plus
      // a full turn to keep the modulo off negative numbers.
      let snapped = false;
      for (const mark of [0, 45, 90, 135, 180, 225, 270, 315]) {
        if (Math.abs(((next - mark + 540) % 360) - 180) < 4) {
          next = mark;
          snapped = true;
          break;
        }
      }
      if (snapped && Math.round(next) !== Math.round(degRef.current)) haptic.light();
      onChange(next);
      if (commit) onCommit?.(next);
    },
    [centre, onChange, onCommit]
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onStartShouldSetPanResponderCapture: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponderCapture: () => !disabled,
        onPanResponderGrant: (e) => {
          onInteractionChange?.(true);
          pick(e.nativeEvent.locationX, e.nativeEvent.locationY, false);
        },
        onPanResponderMove: (e) => pick(e.nativeEvent.locationX, e.nativeEvent.locationY, false),
        onPanResponderRelease: (e) => {
          pick(e.nativeEvent.locationX, e.nativeEvent.locationY, true);
          onInteractionChange?.(false);
        },
        onPanResponderTerminate: () => {
          onCommit?.(degRef.current);
          onInteractionChange?.(false);
        },
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [disabled, onCommit, onInteractionChange, pick]
  );

  // Use the same frame as the picker: 0 degrees is the top of the dial and
  // positive turns move anticlockwise. The old -90 drew the needle opposite
  // the finger, which made a correct gesture feel broken.
  const [needleX, needleY] = dialPointForHeading(deg, DIAL_R);
  const nx = centre + needleX;
  const ny = centre + needleY;
  const turn = Math.round(turnFromRun(deg));

  return (
    <View style={styles.dialWrap}>
      <View style={styles.dialTouch} {...responder.panHandlers}>
        <Svg width={DIAL} height={DIAL}>
          <Circle cx={centre} cy={centre} r={DIAL_R} fill="none" stroke={D.border} strokeWidth={2} />
          <G>
            {[0, 45, 90, 135, 180, 225, 270, 315].map((m) => {
              const r = ((m + 90) * Math.PI) / 180;
              const inner = m % 90 === 0 ? DIAL_R - 7 : DIAL_R - 4;
              return (
                <Line
                  key={m}
                  x1={centre + Math.cos(r) * inner}
                  y1={centre - Math.sin(r) * inner}
                  x2={centre + Math.cos(r) * DIAL_R}
                  y2={centre - Math.sin(r) * DIAL_R}
                  stroke={m === 0 ? accent : D.border}
                  strokeWidth={m === 0 ? 2.5 : 1.5}
                />
              );
            })}
          </G>
          <Line
            x1={centre}
            y1={centre}
            x2={nx}
            y2={ny}
            stroke={accent}
            strokeWidth={3}
            strokeLinecap="round"
          />
          <Circle cx={nx} cy={ny} r={7} fill={toon.ink} stroke={accent} strokeWidth={2.5} />
          <Circle cx={centre} cy={centre} r={3.5} fill={accent} />
        </Svg>
      </View>
      <View style={styles.dialText}>
        <Text style={styles.railEnd}>HEADING</Text>
        <Text style={[styles.dialValue, { color: accent }]}>
          {turn === 0 ? 'as run' : `${Math.abs(turn)}° ${turn > 0 ? 'left' : 'right'}`}
        </Text>
        <Text style={styles.dialHint}>
          Drag the dial to turn your claim. It pivots on its own centre, so it
          stays on the ground you ran.
        </Text>
      </View>
    </View>
  );
}

// While the server is still working out the shape and the neighbourhood, the
// map above is ALREADY showing the run and the ground it will take (the
// server's resting placement rides along on /end-run). So this says what is
// missing rather than blanking the card — the runner is looking at a real
// answer, just not yet a movable one.
export function ChooseAttackPending({ team }) {
  return (
    <View style={styles.pendingCard}>
      <ActivityIndicator size="small" color={team.glow} />
      <View style={{ flex: 1 }}>
        <Text style={styles.pendingTitle}>Reading the ground…</Text>
        <Text style={styles.pendingBody}>Claiming now takes the ground shown above.</Text>
      </View>
    </View>
  );
}

/**
 * @param pose      {t, deg} — the live pose, owned by the screen
 * @param onPose    (pose, {commit}) — commit is false mid-drag, true on release
 * @param placement the breakdown for (roughly) this pose; may lag a drag
 * @param stale     true while a fresher breakdown is in flight
 */
export default function ChooseAttack({
  options,
  pose,
  onPose,
  placement,
  stale,
  team,
  onInteractionChange,
  disabled,
}) {
  const p = placement;
  const baseT = typeof options?.base_t === 'number' ? options.base_t : 0.5;
  const atRest = Math.abs(pose.t - baseT) < 1e-6 && normaliseDeg(pose.deg) === 0;

  const setT = useCallback((t) => onPose({ ...pose, t }, { commit: false }), [onPose, pose]);
  const commitT = useCallback((t) => onPose({ ...pose, t }, { commit: true }), [onPose, pose]);
  const setDeg = useCallback((deg) => onPose({ ...pose, deg }, { commit: false }), [onPose, pose]);
  const commitDeg = useCallback((deg) => onPose({ ...pose, deg }, { commit: true }), [onPose, pose]);

  // The recommendations are sampled poses, so taking one is just jumping to
  // its (t, heading) — from there the runner can keep dragging.
  const recs = RECOMMENDATIONS.map((r) => ({ ...r, target: options?.[r.key] }))
    .filter((r) => r.target != null)
    .map((r) => ({ ...r, cell: options?.placements?.[r.target] }))
    .filter((r) => r.cell);

  const gained = (p?.new_m2 || 0) + (p?.enemy_m2 || 0);
  const rivals = p?.rivals || [];
  const takeable = rivals.filter((r) => !r.defended);
  const held = rivals.filter((r) => r.defended);

  return (
    <View>
      {/* one tap to a good answer — nobody wants to study a map mid-cooldown */}
      {(recs.length > 0 || !atRest) && (
        <View style={styles.recRow}>
          {recs.map((r) => {
            const active =
              Math.abs(pose.t - r.cell.t) < 0.005 &&
              Math.abs(turnFromRun(pose.deg - r.cell.rotation_deg)) < 1;
            return (
              <PressableScale
                key={r.key}
                disabled={disabled}
                onPress={() => {
                  haptic.light();
                  onPose({ t: r.cell.t, deg: r.cell.rotation_deg }, { commit: true });
                }}
                accessibilityRole="button"
                accessibilityLabel={`Move claim to ${r.label.toLowerCase()}`}
                style={[
                  styles.recChip,
                  { borderColor: active ? team.glow : D.border },
                  active && { backgroundColor: withAlpha(team.glow, 0.16) },
                ]}
              >
                <Text
                  style={[styles.recText, { color: active ? team.glow : D.textMuted }]}
                  numberOfLines={1}
                >
                  {r.label}
                </Text>
              </PressableScale>
            );
          })}
          {!atRest && (
            <PressableScale
              disabled={disabled}
              onPress={() => {
                haptic.light();
                onPose({ t: baseT, deg: 0 }, { commit: true });
              }}
              accessibilityRole="button"
                accessibilityLabel="Reset claim to its starting route pose"
              style={[styles.recChip, { borderColor: D.border }]}
            >
              <Text style={[styles.recText, { color: D.textMuted }]} numberOfLines={1}>
                RESET
              </Text>
            </PressableScale>
          )}
        </View>
      )}

      <PositionRail
        t={pose.t}
        baseT={baseT}
        accent={team.glow}
        onChange={setT}
        onCommit={commitT}
        onInteractionChange={onInteractionChange}
        disabled={disabled}
      />

      <RotationDial
        deg={pose.deg}
        accent={team.glow}
        onChange={setDeg}
        onCommit={commitDeg}
        onInteractionChange={onInteractionChange}
        disabled={disabled}
      />

      {/* What this position actually does to the map. Dimmed rather than
          replaced while a fresher answer is in flight: the shape on the map is
          already right and blanking the numbers every time the finger moves
          reads as breakage, not as loading. */}
      <View style={[styles.breakdown, stale && styles.breakdownStale]}>
        <StatRow label="New land" value={landStr(p?.new_m2)} color={team.glow} dim={!p?.new_m2} />
        <StatRow label="Enemy land" value={landStr(p?.enemy_m2)} color={D.danger} dim={!p?.enemy_m2} />
        <StatRow
          label="Your land"
          value={landStr(p?.mine_m2)}
          color={withAlpha(team.glow, 0.5)}
          dim={!p?.mine_m2}
        />
        {p?.ally_m2 > 0 && (
          <StatRow label="Club land" value={landStr(p.ally_m2)} color={D.textDim} dim />
        )}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>GROUND GAINED</Text>
          <Text style={[styles.totalValue, { color: team.glow }]}>{landStr(gained)}</Text>
        </View>
      </View>

      {/* What this move is. The price used to be here and on the button; it is
          now only ever shown on the meter, so the decision on this screen is
          about GROUND and the energy is a separate fact about the account. */}
      {!!p?.action && (
        <View style={styles.costCard}>
          <Text style={styles.costAction}>{ACTION_LABEL[p.action] || 'Claim'}</Text>
        </View>
      )}

      {/* Why this particular move is closed, in the server's own words. The
          claim button is disabled to match, so the reason and the dead button
          always appear together. */}
      {p?.available === false && p?.unavailable_reason ? (
        <View style={styles.blockedCard}>
          <Text style={styles.blockedText}>{p.unavailable_reason}</Text>
        </View>
      ) : null}

      {/* who is standing on it */}
      {rivals.length > 0 && (
        <View style={styles.faces}>
          {takeable.slice(0, 5).map((r) => (
            <View key={r.user_id} style={styles.face}>
              <CharacterBust equipped={r.avatar} size={30} ring={D.danger} bg="rgba(21,24,29,0.9)" />
              <Text style={styles.faceName} numberOfLines={1}>{r.username}</Text>
            </View>
          ))}
          {held.slice(0, 3).map((r) => (
            <View key={r.user_id} style={[styles.face, { opacity: 0.55 }]}>
              <CharacterBust equipped={r.avatar} size={30} ring={D.border} bg="rgba(21,24,29,0.9)" />
              <Text style={styles.faceName} numberOfLines={1}>{r.username}</Text>
            </View>
          ))}
          <Text style={styles.facesNote}>
            {takeable.length > 0
              ? `${takeable.length} runner${takeable.length === 1 ? '' : 's'} lose ground here`
              : 'their defence holds here, nothing to take'}
          </Text>
        </View>
      )}

      {/* the honest caveat: defended ground gets carved back out, so the
          claim that lands here is smaller than the one being previewed */}
      {p?.defended_m2 > 0 && (
        <Text style={styles.defendedNote}>
          {landStr(p.defended_m2)} under this claim is too well defended. It stays theirs, and
          you hold {landStr(p.held_m2)} of {landStr(p.area_m2)}.
        </Text>
      )}
    </View>
  );
}

const HANDLE = 26;

const styles = StyleSheet.create({
  recRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.md, flexWrap: 'wrap' },
  recChip: {
    flex: 1,
    minWidth: 74,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  recText: { ...type.captionMedium, letterSpacing: 0.4, fontSize: 10 },

  railWrap: { marginBottom: space.md },
  railLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: space.sm,
  },
  railEnd: { ...type.captionMedium, color: D.textDim, letterSpacing: 1, fontSize: 9 },
  railHint: { ...type.caption, color: D.textDim, flex: 1, textAlign: 'center', fontSize: 10 },
  // A generous touch target: the rail is 8px of paint but 40px of finger.
  railTouch: { height: 40, justifyContent: 'center' },
  railTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: D.cardAlt,
    borderWidth: 1,
    borderColor: D.border,
  },
  railFill: { position: 'absolute', height: 6, borderRadius: 3 },
  // Where the claim sits if nothing is touched — the run as it was run.
  restNotch: { position: 'absolute', top: 6, width: 2, height: 28, borderRadius: 1, opacity: 0.7 },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleCore: { width: 10, height: 10, borderRadius: 5 },

  dialWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.md,
  },
  dialTouch: { width: DIAL, height: DIAL },
  dialText: { flex: 1 },
  dialValue: { ...type.statSm, marginTop: 2, marginBottom: 3 },
  dialHint: { ...type.caption, color: D.textDim, fontSize: 10, lineHeight: 14 },

  breakdown: {
    backgroundColor: D.cardAlt,
    borderRadius: toonRadius.cell,
    padding: space.md,
    marginBottom: space.md,
  },
  breakdownStale: { opacity: 0.55 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 7 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  statLabel: { ...type.bodySm, color: D.textMuted, flex: 1 },
  statValue: { ...type.bodySmBold },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: D.border,
    paddingTop: space.sm,
    marginTop: 3,
  },
  totalLabel: { ...type.captionMedium, color: D.textDim, letterSpacing: 1 },
  totalValue: { ...type.statSm },

  costCard: {
    borderWidth: 1.5,
    borderColor: D.border,
    borderRadius: toonRadius.cell,
    padding: space.md,
    marginBottom: space.md,
  },
  costAction: { ...type.bodySmBold, color: D.text },

  faces: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  face: { alignItems: 'center', width: 46 },
  faceName: { ...type.caption, color: D.textDim, fontSize: 9, marginTop: 2 },
  facesNote: { ...type.caption, color: D.textMuted, flex: 1, minWidth: 120 },

  defendedNote: { ...type.caption, color: D.textDim, marginBottom: space.md },

  blockedCard: {
    borderLeftWidth: 4,
    borderLeftColor: D.danger,
    backgroundColor: D.cardAlt,
    borderRadius: toonRadius.cell,
    padding: space.md,
    marginBottom: space.md,
  },
  blockedText: { ...type.bodySmBold, color: D.text },

  pendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: D.cardAlt,
    borderRadius: toonRadius.cell,
    padding: space.md,
    marginBottom: space.md,
  },
  pendingTitle: { ...type.bodySmBold, color: D.text },
  pendingBody: { ...type.caption, color: D.textDim, marginTop: 2 },
});
