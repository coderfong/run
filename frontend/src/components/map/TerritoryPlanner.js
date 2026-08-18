// Territory Planner — draw a route, see whose ground it runs over.
//
// The panel only. The route itself is drawn on the map by GlobalMapScreen,
// which owns the gestures; this owns the reading of it, the mode switch and
// the free allowance.
//
// TWO WAYS TO DRAW, and the toggle between them lives here. Tapping places one
// point per tap and is exact. Drawing traces the route under a finger and is
// how anybody actually wants to describe a loop round a park. Draw mode freezes
// the camera while it is on (a stroke cannot also pan the map), which is the
// reason it is a MODE rather than something the map guesses from the gesture:
// panning and drawing are the same two-dimensional drag, and a map that has to
// guess which one you meant gets it wrong often enough to be maddening.
//
// WHAT IT PROMISES, AND WHAT IT CAREFULLY DOES NOT. Every number on this panel
// comes from src/map/planner.js, whose header explains why the list is as
// short as it is. In particular the land figure is labelled an ESTIMATE and
// says out loud that it is measured from a standing start, because the real
// entitlement depends on what else you have run today and only the server
// knows that. Promising an exact claim and then granting less is the single
// worst thing a planner could do, and it is precisely what the app's own
// economy header records happening once before.
//
// THE FREE ALLOWANCE. Three completed previews, then the paywall. A preview is
// only spent when one actually RUNS — a route of one point, or opening the
// planner and closing it, costs nothing. Charging for a mis-tap turns a trial
// into a trap, and the runner cannot tell the difference between the two by
// looking, so they will assume the worst.

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Undo2, X } from 'lucide-react-native';

import { FREE_PLANNER_PREVIEWS } from '../../config/proExposure';
import { GOLD } from '../../config/pro';
import { radius, shadow, space, useTheme, useThemedType } from '../../theme';
import AppIcon from '../AppIcon';
import { ToonButton } from '../ui';

const km = (m) => {
  const v = Math.max(0, m || 0) / 1000;
  return `${v.toFixed(v >= 10 ? 1 : 2)} km`;
};

const km2 = (m2) => {
  const v = Math.max(0, m2 || 0) / 1e6;
  return `${v.toFixed(v >= 0.1 ? 2 : 3)} km²`;
};

const pct = (share) => `${Math.round((share || 0) * 100)}%`;

function Stat({ label, value, tint, colors, type }) {
  return (
    <View style={styles.stat}>
      <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.bodySmBold, tint ? { color: tint } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * @param {Array}   points        the route as drawn
 * @param {object}  analysis      analyseRoute() output, or null before preview
 * @param {number}  previewsLeft  Infinity for PRO
 * @param {boolean} isPro
 */
export default function TerritoryPlanner({
  points = [],
  analysis,
  previewsLeft,
  isPro,
  busy = false,
  drawMode = false,
  onToggleDrawMode,
  onPreview,
  onUndo,
  onClear,
  onClose,
  onUnlock,
}) {
  const { colors } = useTheme();
  const type = useThemedType();

  const canPreview = points.length >= 2;
  const exhausted = !isPro && previewsLeft <= 0;

  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.headRow}>
        <AppIcon name="route" size={24} />
        <View style={{ flex: 1 }}>
          <Text style={type.bodyBold}>Territory Planner</Text>
          <Text style={[type.caption, { color: colors.textMuted }]} numberOfLines={1}>
            {busy
              ? 'Reading your line…'
              : points.length === 0
                ? (drawMode ? 'Draw your route on the map' : 'Tap the map to start your route')
                : points.length === 1
                  ? (drawMode ? 'Keep drawing, or tap to place points' : 'Tap again to draw the next leg')
                  : `${points.length} points · ${km(analysis?.distanceM ?? 0)}`}
          </Text>
        </View>
        {/* The mode switch. A filled block when draw mode is on rather than a
            tint, because it changes what the whole map does under your finger
            and that is not a subtle state to be in. */}
        {onToggleDrawMode ? (
          <TouchableOpacity
            onPress={onToggleDrawMode}
            hitSlop={10}
            style={[
              styles.mode,
              {
                backgroundColor: drawMode ? GOLD : 'transparent',
                borderColor: drawMode ? GOLD : colors.border,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: drawMode }}
            accessibilityLabel={drawMode ? 'Switch to tapping points' : 'Switch to drawing the route'}
          >
            <Text
              style={[
                type.captionMedium,
                { color: drawMode ? '#141414' : colors.textMuted },
              ]}
            >
              {drawMode ? 'Draw' : 'Tap'}
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={onUndo} disabled={!points.length} hitSlop={10}
          accessibilityRole="button" accessibilityLabel="Undo last point">
          <Undo2 size={20} color={points.length ? colors.text : colors.textDim} strokeWidth={2.5} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} hitSlop={10}
          accessibilityRole="button" accessibilityLabel="Close planner">
          <X size={20} color={colors.textDim} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>

      {analysis ? (
        <ScrollView style={{ maxHeight: 230 }} showsVerticalScrollIndicator={false}>
          <View style={styles.statRow}>
            <Stat label="Route" value={km(analysis.distanceM)} colors={colors} type={type} />
            <Stat
              label="Could earn"
              value={km2(analysis.estimatedClaimM2)}
              tint={GOLD}
              colors={colors}
              type={type}
            />
          </View>

          {/* Said plainly, every time, right under the number it qualifies.
              A caveat in a help screen is a caveat nobody reads. */}
          <Text style={[type.caption, { color: colors.textDim, marginTop: 2 }]}>
            {analysis.estimateIsCapped
              ? 'At the maximum a single claim can cover. The land you actually get is decided when you finish.'
              : 'Estimated from a standing start. What you actually claim depends on the rest of your day and is settled by the server.'}
          </Text>

          {!analysis.qualifies ? (
            <Text style={[type.caption, { color: colors.warn, marginTop: space.xs }]}>
              {analysis.shortfallM > 0
                ? `${km(analysis.shortfallM)} short of the distance a claim needs.`
                : 'This route is long enough to claim, as long as the run itself qualifies.'}
            </Text>
          ) : null}

          <Text style={[type.captionMedium, { color: colors.textMuted, marginTop: space.md }]}>
            GROUND IT CROSSES
          </Text>
          <View style={styles.statRow}>
            <Stat label="Open" value={pct(analysis.openShare)} colors={colors} type={type} />
            <Stat label="Yours" value={pct(analysis.ownShare)} colors={colors} type={type} />
            <Stat label="Theirs" value={pct(analysis.rivalShare)} colors={colors} type={type} />
          </View>

          {analysis.crossings.length ? (
            <View style={{ marginTop: space.sm }}>
              {analysis.crossings.slice(0, 5).map((c) => (
                <View key={c.id} style={[styles.crossRow, { borderBottomColor: colors.border }]}>
                  <Text style={[type.caption, { flex: 1, color: colors.textMuted }]} numberOfLines={1}>
                    {c.mine ? 'Your land' : c.username || 'Another runner'}
                    {c.clanTag ? ` · ${c.clanTag}` : ''}
                  </Text>
                  <Text style={[type.bodySmBold]}>{km2(c.areaM2)}</Text>
                </View>
              ))}
              {analysis.crossings.length > 5 ? (
                <Text style={[type.caption, { color: colors.textDim, marginTop: 4 }]}>
                  {`and ${analysis.crossings.length - 5} more`}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text style={[type.caption, { color: colors.textMuted, marginTop: space.xs }]}>
              This route runs entirely over open ground.
            </Text>
          )}
        </ScrollView>
      ) : null}

      {/* The allowance, stated before the button rather than after the refusal.
          Somebody about to spend their last free preview should know it is
          their last one while they can still decide not to. */}
      {!isPro ? (
        <Text style={[type.caption, { color: exhausted ? GOLD : colors.textMuted, marginTop: space.sm }]}>
          {exhausted
            ? 'You have used your free previews.'
            : `${previewsLeft} of ${FREE_PLANNER_PREVIEWS} free previews left`}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {exhausted ? (
          <ToonButton
            title="Unlock unlimited planning"
            variant="gold"
            size="sm"
            onPress={onUnlock}
            style={{ flex: 1 }}
          />
        ) : (
          <ToonButton
            title={busy ? 'Reading the ground…' : analysis ? 'Preview again' : 'Preview this route'}
            variant={canPreview ? 'primary' : 'neutral'}
            size="sm"
            onPress={onPreview}
            disabled={!canPreview || busy}
            style={{ flex: 1 }}
          />
        )}
        {points.length ? (
          <TouchableOpacity onPress={onClear} style={styles.clear} accessibilityRole="button">
            <Text style={[type.captionMedium, { color: colors.textMuted }]}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    bottom: space.xl,
    borderRadius: radius.card,
    borderWidth: 2,
    padding: space.md,
    ...shadow.raised,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mode: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  statRow: { flexDirection: 'row', gap: space.md, marginTop: space.sm },
  stat: { flex: 1, minWidth: 0 },
  crossRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  clear: { paddingHorizontal: space.sm, paddingVertical: 12 },
});
