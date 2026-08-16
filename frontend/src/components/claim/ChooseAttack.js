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
import { Maximize2, ShieldCheck, Swords } from 'lucide-react-native';

import { CharacterBust } from '../character/CharacterRig';
import { Framed } from '../ui';
import {
  dialPointForHeading,
  headingFromDialPoint,
  turnFromRun,
} from './placement';
import { space, toon, toonRadius, useTheme, useThemedStyles, withAlpha } from '../../theme';
import { haptic, PressableScale } from '../../ui/motion';
import { INK, framePose, frameVariant } from '../../ui/frameRegistry';


// Territory has one unit everywhere. Extra precision keeps small steals
// meaningful without making the player mentally convert square metres.
export function landStr(m2) {
  const km2 = Math.max(0, Number(m2) || 0) / 1e6;
  return `${km2.toFixed(km2 >= 0.1 ? 2 : 3)} km²`;
}

const RECOMMENDATIONS = [
  { key: 'most_land_index', label: 'MOST LAND', Icon: Maximize2, color: '#F5B32C' },
  { key: 'biggest_steal_index', label: 'ATTACK', Icon: Swords, color: '#EC4899' },
  { key: 'best_defence_index', label: 'BEST DEFENCE', Icon: ShieldCheck, color: '#8B5CF6' },
];

// What each move is called, in the order the server classifies them. The price
// follows the action, so naming the action is what makes the price make sense.
const ACTION_LABEL = {
  empty: 'Claim open ground',
  reinforce: 'Reinforce your land',
  attack: 'Attack rival',
  fortified: 'Storm a defended border',
};

function GroundMetric({ label, value, color, dim }) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.metric, { borderLeftColor: color }, dim && styles.metricDim]}>
      <Text style={[styles.metricLabel, dim && { color: D.textDim }]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.metricValue, { color: dim ? D.textDim : D.text }]} numberOfLines={1}>{value}</Text>
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
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
const DIAL = 88;
const DIAL_R = DIAL / 2 - 12;

function RotationDial({ deg, accent, onChange, onCommit, onInteractionChange, disabled, children }) {
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
  return (
    <View style={styles.dialWrap} testID="claim-rotator-row">
      <View
        style={styles.dialTouch}
        accessibilityLabel="Claim rotator"
        {...responder.panHandlers}
      >
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
      {children ? <View style={styles.dialOptions}>{children}</View> : null}
    </View>
  );
}

// While the server is still working out the shape and the neighbourhood, the
// map above is ALREADY showing the run and the ground it will take (the
// server's resting placement rides along on /end-run). So this says what is
// missing rather than blanking the card — the runner is looking at a real
// answer, just not yet a movable one.
export function ChooseAttackPending({ team }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Framed
      frame={frameVariant('box', 'reading-ground')}
      tint={team.glow}
      fill={colors.cardAlt}
      weight={INK.thin}
      pose={framePose('reading-ground')}
      inset={false}
      style={styles.pendingFrame}
      contentStyle={styles.pendingCard}
    >
      <ActivityIndicator size="small" color={team.glow} />
      <View style={{ flex: 1 }}>
        <Text style={styles.pendingTitle}>Reading the ground…</Text>
        <Text style={styles.pendingBody}>Claiming now takes the ground shown above.</Text>
      </View>
    </Framed>
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
  const { colors: D } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const p = placement;
  const baseT = typeof options?.base_t === 'number' ? options.base_t : 0.5;

  const setT = useCallback((t) => onPose({ ...pose, t }, { commit: false }), [onPose, pose]);
  const commitT = useCallback((t) => onPose({ ...pose, t }, { commit: true }), [onPose, pose]);
  const setDeg = useCallback((deg) => onPose({ ...pose, deg }, { commit: false }), [onPose, pose]);
  const commitDeg = useCallback((deg) => onPose({ ...pose, deg }, { commit: true }), [onPose, pose]);

  // The recommendations are sampled poses, so taking one is just jumping to
  // its (t, heading) — from there the runner can keep dragging.
  // Keep the three choices in a stable row. In particular ATTACK stays visible
  // when this stretch has no rival target; disabling it is much clearer than
  // making the option disappear and looking like the mode was removed.
  // (AS RUN — jump back to where the run itself was — used to sit here as a
  // fourth choice; the position rail's own rest notch at `baseT` already does
  // that job with a snap, so the button was a second control for one thing.)
  const recs = RECOMMENDATIONS.map((r) => ({
    ...r,
    target: options?.[r.key],
    cell: options?.placements?.[options?.[r.key]],
  }));

  const gained = (p?.new_m2 || 0) + (p?.enemy_m2 || 0);
  const rivals = p?.rivals || [];
  const takeable = rivals.filter((r) => !r.defended);
  const held = rivals.filter((r) => r.defended);
  const shownRivals = (takeable.length > 0 ? takeable : held).slice(0, 3);
  const MoveIcon = p?.action === 'attack' || p?.action === 'fortified'
    ? Swords
    : p?.action === 'reinforce'
      ? ShieldCheck
      : Maximize2;

  return (
    <View>
      <View style={styles.recGrid} testID="claim-recommendations">
        {recs.map((r) => {
          const active = !!r.cell &&
            Math.abs(pose.t - r.cell.t) < 0.005 &&
            Math.abs(turnFromRun(pose.deg - r.cell.rotation_deg)) < 1;
          const unavailable = disabled || !r.cell;
          return (
            <PressableScale
              key={r.key}
              disabled={unavailable}
              onPress={() => {
                haptic.light();
                onPose({ t: r.cell.t, deg: r.cell.rotation_deg }, { commit: true });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Move claim to ${r.label.toLowerCase()}`}
              accessibilityState={{ disabled: unavailable, selected: active }}
              containerStyle={styles.recPressable}
              style={styles.recFill}
            >
              <Framed
                frame={frameVariant('chip', r.key)}
                tint={active ? D.text : r.color}
                fill={active ? r.color : withAlpha(r.color, 0.2)}
                weight={active ? INK.medium : INK.thin}
                pose={framePose(r.key)}
                inset={false}
                style={[styles.recFrame, unavailable && styles.recUnavailable]}
                contentStyle={styles.recChip}
              >
                <r.Icon size={30} color={active ? '#FFFFFF' : r.color} strokeWidth={2.6} />
                <Text style={[styles.recText, { color: active ? '#FFFFFF' : D.text }]} numberOfLines={2}>
                  {r.label}
                </Text>
              </Framed>
            </PressableScale>
          );
        })}
      </View>
      {/* one tap to a good answer — nobody wants to study a map mid-cooldown */}
      <PositionRail
        t={pose.t}
        baseT={baseT}
        accent={team.glow}
        onChange={setT}
        onCommit={commitT}
        onInteractionChange={onInteractionChange}
        disabled={disabled}
      />

      <View style={styles.controlsRow}>
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
      <Framed
        frame={frameVariant('box', 'ground-score')}
        tint={team.glow}
        fill={D.cardAlt}
        weight={INK.thin}
        pose={framePose('ground-score')}
        inset={false}
        style={[styles.breakdownFrame, stale && styles.breakdownStale]}
        contentStyle={styles.breakdown}
      >
        <GroundMetric label="NEW" value={landStr(p?.new_m2)} color={team.glow} dim={!p?.new_m2} />
        <GroundMetric label="ENEMY" value={landStr(p?.enemy_m2)} color={D.danger} dim={!p?.enemy_m2} />
        <GroundMetric label="YOURS" value={landStr(p?.mine_m2)} color={withAlpha(team.glow, 0.5)} dim={!p?.mine_m2} />
        <GroundMetric label="GAIN" value={landStr(gained)} color={team.glow} dim={!gained} />
      </Framed>
      </View>

      {/* What this move is. The price used to be here and on the button; it is
          now only ever shown on the meter, so the decision on this screen is
          about GROUND and the energy is a separate fact about the account. */}
      {!!p?.action && (
        <View style={styles.moveRow}>
          <MoveIcon size={18} color={team.glow} strokeWidth={2.7} />
          <Text style={styles.moveAction} numberOfLines={1}>
            {ACTION_LABEL[p.action] || 'Claim'}
          </Text>
          {shownRivals.length > 0 && (
            <View style={styles.avatarStack}>
              {shownRivals.map((r, index) => (
                <View key={r.user_id} style={[styles.avatar, index > 0 && styles.avatarOverlap]}>
                  <CharacterBust
                    equipped={r.avatar}
                    size={25}
                    ring={r.defended ? D.border : D.danger}
                    bg={D.cardAlt}
                  />
                </View>
              ))}
            </View>
          )}
          {rivals.length > 0 && (
            <Text style={styles.moveNote} numberOfLines={1}>
              {takeable.length > 0
                ? `${takeable.length} runner${takeable.length === 1 ? '' : 's'} lose ground here`
                : 'defence holds here'}
            </Text>
          )}
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

const makeStyles = (colors, scheme, type) => StyleSheet.create({
  recGrid: {
    flexDirection: 'row',
    // Three buttons now, not four — the extra room goes to the gap between
    // them rather than sitting unused, so they read as three deliberate
    // choices instead of three squeezed into a row sized for a fourth.
    gap: 10,
    // Each button sizes itself from its own square, so the row must not try to
    // stretch them to a common height it has worked out first.
    alignItems: 'flex-start',
    marginBottom: 7,
  },
  recPressable: { flex: 1, minWidth: 0 },
  recFill: { width: '100%' },
  // SQUARE, from the column width the row gives it. These are the three big
  // choices on the screen and the letterbox they used to be sized the label
  // down to 7.5pt to fit; a square has room for an icon you can read at a
  // glance and type at a normal size. The sheet below the map was grown to
  // match (ResultScreen's `claimSheet`).
  recFrame: { width: '100%', aspectRatio: 1 },
  recUnavailable: { opacity: 0.38 },
  recChip: {
    flex: 1, paddingVertical: 6, paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  // Two lines allowed: "BEST DEFENCE" wraps rather than truncating on a narrow
  // phone, and centred in a square that reads as deliberate.
  recText: { ...type.captionMedium, letterSpacing: 0, fontSize: 11, lineHeight: 13, textAlign: 'center' },

  railWrap: { marginBottom: 4 },
  railLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
    gap: space.sm,
  },
  railEnd: { ...type.captionMedium, color: colors.textDim, letterSpacing: 1, fontSize: 9 },
  // A generous touch target: the rail is 8px of paint but 40px of finger.
  railTouch: { height: 34, justifyContent: 'center' },
  railTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  railFill: { position: 'absolute', height: 6, borderRadius: 3 },
  // Where the claim sits if nothing is touched — the run as it was run.
  restNotch: { position: 'absolute', top: 3, width: 2, height: 28, borderRadius: 1, opacity: 0.7 },
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
    gap: space.sm,
  },
  dialTouch: { width: DIAL, height: DIAL, flexShrink: 0 },
  dialOptions: { flex: 1, minHeight: DIAL, justifyContent: 'center' },

  controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
  breakdownFrame: { flex: 1, minWidth: 0 },
  // One column of four rows, not a 2x2 grid: each metric on its own line,
  // label and number side by side, so both can run bigger than the grid's
  // ~48%-wide cells ever had room for.
  breakdown: { flexDirection: 'column', gap: 4, padding: 8 },
  breakdownStale: { opacity: 0.55 },
  metric: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    minWidth: 0,
    borderLeftWidth: 2,
    paddingLeft: 6,
  },
  metricDim: { opacity: 0.48 },
  metricLabel: { ...type.captionMedium, color: colors.textDim, fontSize: 10, lineHeight: 13 },
  metricValue: { ...type.bodySmBold, color: colors.text, fontSize: 15, lineHeight: 18, marginLeft: 8 },

  moveRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: toonRadius.cell,
    backgroundColor: colors.card,
  },
  moveAction: { ...type.bodySmBold, color: colors.text, flexShrink: 1 },
  avatarStack: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  avatar: { borderRadius: 14 },
  avatarOverlap: { marginLeft: -8 },
  moveNote: { ...type.caption, color: colors.textMuted, flex: 1, minWidth: 0 },

  defendedNote: { ...type.caption, color: colors.textDim, marginBottom: 5 },

  blockedCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    backgroundColor: colors.cardAlt,
    borderRadius: toonRadius.cell,
    padding: 8,
    marginBottom: 6,
  },
  blockedText: { ...type.bodySmBold, color: colors.text },

  pendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
  },
  pendingFrame: { marginBottom: space.md },
  pendingTitle: { ...type.bodySmBold, color: colors.text },
  pendingBody: { ...type.caption, color: colors.textDim, marginTop: 2 },
});
