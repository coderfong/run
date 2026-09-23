// GameMap — the single map surface for the whole app. Screens import ONLY
// from here (never from '@rnmapbox/maps'), so the SDK is swappable in one
// file. The camera is hard-locked to the active city's bounds + zoom.
//
// Coordinates: screens speak {latitude, longitude}; Mapbox speaks [lon, lat].
// The helpers below convert at the boundary so screen data stays unchanged.
//
// NOTE: @rnmapbox/maps renders nothing in Expo Go — it needs an EAS dev
// build (see SETUP_MAPBOX.md). MAP_READY is false until a public token is
// configured; screens can render a placeholder in that case.

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { activeCity, cityMaxBounds } from '../config/cities';
import { MAPBOX_PUBLIC_TOKEN, MAP_READY as MAP_CONFIGURED, styleForTheme } from '../config/map';
import { space, useTheme, useThemedStyles } from '../theme';
import { useReduceMotion } from '../ui/motion';

// @rnmapbox/maps has NO native module in Expo Go — importing or using it there
// redboxes the whole app at startup (this module is pulled in eagerly via the
// map screens). So load it only OUTSIDE Expo Go, behind try/catch, and fall
// back to a placeholder anywhere the map would render.
const IN_EXPO_GO = Constants.executionEnvironment === 'storeClient';

let RN = null;
if (!IN_EXPO_GO) {
  try {
    RN = require('@rnmapbox/maps');
  } catch (e) {
    RN = null;
  }
}
const Mapbox = RN?.default ?? null;
const { Camera, CircleLayer, FillLayer, LineLayer, MapView, MarkerView, ShapeSource, UserLocation } = RN ?? {};

export const MAPBOX_AVAILABLE = !!(RN && MapView);

// MAP_READY now also requires the native module, so it is false in Expo Go and
// every screen that guards on it shows a placeholder instead of crashing.
export const MAP_READY = MAP_CONFIGURED && MAPBOX_AVAILABLE;

// Set the runtime public token once. Telemetry off — this is a fitness app.
if (MAPBOX_AVAILABLE && MAPBOX_PUBLIC_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_PUBLIC_TOKEN);
  Mapbox.setTelemetryEnabled(false);
}

const toLngLat = (p) => [p.longitude, p.latitude];

// --- geometry helpers (produce GeoJSON the ShapeSources consume) ----------

function lineFeature(points) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: points.map(toLngLat) },
    properties: {},
  };
}

function polygonFeature(points) {
  const ring = points.map(toLngLat);
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push(ring[0]); // close the ring
  }
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {},
  };
}

// --- the map container -----------------------------------------------------

// `theme` is an OVERRIDE, not a requirement: left off, the map wears whatever
// the app is wearing. Every screen used to hard-code theme="dark", so the one
// surface that fills the whole screen stayed black in light mode.
const GameMap = forwardRef(function GameMap(
  { theme, onPress, onIdle, onViewportChange, onReady, showsUserLocation = false, children, style, initialCenter, initialZoom, constrainToCity = true, locked = false },
  ref
) {
  const { scheme } = useTheme();
  const placeholderStyles = useThemedStyles(makePlaceholderStyles);
  const cameraRef = useRef(null);
  const mapRef = useRef(null);
  const lastPreviewRef = useRef(0);
  const handleCameraChanged = useCallback((state) => {
    if (!onViewportChange || Date.now() - lastPreviewRef.current < 200) return;
    const p = state?.properties;
    if (!p?.bounds) return;
    lastPreviewRef.current = Date.now();
    onViewportChange({ bounds: p.bounds, zoom: p.zoom });
  }, [onViewportChange]);

  // Map settled → hand the viewport (bounds + zoom) up so screens can query
  // /map-polygons for what's visible. Fires only when movement stops.
  //
  // useCallback (keyed only on `onIdle`, which screens now keep stable) so
  // this function's identity survives GameMap's own re-renders. MapView and
  // ShapeSource are PureComponents (react-native @rnmapbox/maps) — an
  // onMapIdle prop that changes reference every render was defeating that,
  // forcing a full re-render (and a JSON.stringify of the territory
  // GeoJSON) on every pan/zoom settle even when nothing visible changed.
  const handleIdle = useCallback((state) => {
    if (!onIdle) return;
    const p = state?.properties || {};
    if (!p.bounds) return;
    onIdle({ bounds: p.bounds, zoom: p.zoom, center: p.center });
  }, [onIdle]);

  // The placeholder path below never loads a map, so it would never report
  // ready — and a screen that holds its content until this fires (see
  // ScreenIn) would sit blank forever in Expo Go. Say ready on mount instead:
  // the placeholder IS the finished content there.
  useEffect(() => {
    if (!MAPBOX_AVAILABLE) onReady?.();
  }, [onReady]);

  // Imperative API screens use instead of touching Mapbox directly.
  useImperativeHandle(ref, () => ({
    flyTo(latlng, zoom, durationMs = 500) {
      cameraRef.current?.setCamera({
        centerCoordinate: toLngLat(latlng),
        ...(zoom != null ? { zoomLevel: zoom } : {}),
        animationDuration: durationMs,
      });
    },
    // The full camera, including the two axes `flyTo` does not expose: PITCH
    // (0 = straight down, up to 60 = looking along the ground) and HEADING
    // (which compass direction is "up"). Together they are what makes the map
    // read as a place rather than as a diagram, which is the whole point of
    // the run flyover — see claim/runFlyover.js.
    //
    // `animationMode` matters here and is not cosmetic: the default easeTo
    // accelerates and decelerates, so a chain of short hops along a route
    // stutters at every joint. A flyover passes 'linearTo' so the joints
    // disappear and the camera reads as one continuous move.
    setCameraTo({ center, zoom, pitch, heading, durationMs = 500, mode }) {
      cameraRef.current?.setCamera({
        ...(center ? { centerCoordinate: toLngLat(center) } : {}),
        ...(zoom != null ? { zoomLevel: zoom } : {}),
        ...(pitch != null ? { pitch } : {}),
        ...(heading != null ? { heading } : {}),
        animationDuration: durationMs,
        ...(mode ? { animationMode: mode } : {}),
      });
    },
    fitToPoints(points, paddingPx = 48, durationMs = 500) {
      if (!points?.length) return;
      const lons = points.map((p) => p.longitude);
      const lats = points.map((p) => p.latitude);
      cameraRef.current?.fitBounds(
        [Math.max(...lons), Math.max(...lats)],
        [Math.min(...lons), Math.min(...lats)],
        paddingPx,
        durationMs
      );
    },
    // Geographic → screen coordinates, in this map view's own pixel space.
    // The claim reveal draws a polygon in an SVG overlay, so it needs to know
    // where each vertex actually sits on screen. Only valid while the camera
    // is still: project after movement stops, and re-project if it moves.
    async projectCoordinate(latlng) {
      const point = await mapRef.current?.getPointInView(toLngLat(latlng));
      if (!point) return null;
      return { x: point[0], y: point[1] };
    },
    // The inverse: screen → geographic. What free drawing needs, because a
    // finger dragged over the map produces pixels and a route is made of
    // coordinates.
    //
    // Points are converted in a BATCH rather than one per touch event. A drag
    // fires these faster than the bridge can answer, and awaiting each sample
    // in turn would both drop points and let them arrive out of order — so the
    // gesture collects pixels synchronously and hands the whole stroke here
    // once, on release. `Promise.all` keeps the returned order regardless of
    // which call settles first, which is the property the route depends on.
    async unprojectPoints(points) {
      if (!points?.length || !mapRef.current) return [];
      const converted = await Promise.all(
        points.map(async ({ x, y }) => {
          try {
            const lngLat = await mapRef.current?.getCoordinateFromView([x, y]);
            if (!lngLat) return null;
            const [longitude, latitude] = lngLat;
            return Number.isFinite(latitude) && Number.isFinite(longitude)
              ? { latitude, longitude }
              : null;
          } catch {
            // One unconvertible sample (off the globe, or the view went away
            // mid-gesture) drops that sample, never the stroke.
            return null;
          }
        })
      );
      return converted.filter(Boolean);
    },
  }));

  // Expo Go / no native module — show a graceful placeholder instead of the
  // native map (which would crash). Hooks above already ran, so this early
  // return is safe.
  if (!MAPBOX_AVAILABLE) {
    return (
      <View style={[styles.map, placeholderStyles.placeholder, style]}>
        <Text style={placeholderStyles.placeholderTitle}>Map preview</Text>
        <Text style={placeholderStyles.placeholderBody}>
          The live map needs a development build. It can’t render in Expo Go, but everything else works here.
        </Text>
      </View>
    );
  }

  const bounds = cityMaxBounds();

  return (
    <MapView
      ref={mapRef}
      style={[styles.map, style]}
      styleURL={styleForTheme(theme || scheme)}
      onPress={locked ? undefined : onPress}
      onMapIdle={handleIdle}
      onCameraChanged={handleCameraChanged}
      // Style parsed and the first frame drawn. Screens use it to hold their
      // reveal until there is a map to reveal, rather than fading up over grey.
      onDidFinishLoadingMap={onReady}
      scaleBarEnabled={false}
      logoEnabled={false}
      attributionEnabled
      attributionPosition={{ bottom: 8, right: 8 }}
      compassEnabled={false}
      // `locked` freezes the camera during the claim reveal — a pan mid-reveal
      // would slide the map out from under the projected SVG polygon.
      scrollEnabled={!locked}
      zoomEnabled={!locked}
      pitchEnabled={!locked}
      rotateEnabled={!locked}
    >
      <Camera
        ref={cameraRef}
        maxBounds={constrainToCity ? bounds : undefined}
        minZoomLevel={constrainToCity ? activeCity.minZoom : 0}
        maxZoomLevel={activeCity.maxZoom}
        defaultSettings={{
          centerCoordinate: initialCenter ? toLngLat(initialCenter) : activeCity.center,
          zoomLevel: initialZoom ?? 12,
        }}
        animationMode="easeTo"
      />
      {showsUserLocation && <UserLocation visible androidRenderMode="normal" />}
      {children}
    </MapView>
  );
});

// Memoized: screens now pass stable onIdle/onPress callbacks (see the note on
// handleIdle above), so this guards against re-rendering the whole native map
// tree when an unrelated ancestor re-renders with the same props.
export default React.memo(GameMap);

// --- layer helpers (screens compose these; none import Mapbox) ------------

// A running/route trail. `glow` adds a soft wide underlayer (dark theme only);
// `glowColor` overrides its colour (defaults to the line colour).
export function Trail({ id = 'trail', points, color, width = 5, glow = false, glowColor }) {
  if (!MAPBOX_AVAILABLE) return null;
  if (!points || points.length < 2) return null;
  return (
    <ShapeSource id={`${id}-src`} shape={lineFeature(points)}>
      {glow && (
        <LineLayer
          id={`${id}-glow`}
          style={{ lineColor: glowColor || color, lineWidth: width * 3, lineOpacity: 0.35, lineCap: 'round', lineJoin: 'round', lineBlur: width * 2 }}
        />
      )}
      <LineLayer
        id={`${id}-line`}
        style={{ lineColor: color, lineWidth: width, lineCap: 'round', lineJoin: 'round' }}
      />
    </ShapeSource>
  );
}

// A single filled territory / live preview polygon.
//
// `animateIn` washes the polygon on instead of popping it: the fill and its
// outline start at zero and transition up. The interpolation is Mapbox's OWN
// style transition, not Reanimated — these are native map layers, so there is
// no React view to drive, and handing the tween to the map keeps it on the
// render thread with the rest of the map's work.
//
// For a polygon that appears COLD — no overlay, no sequence, just territory
// arriving on a map you are already looking at. NOT for the post-claim handoff
// on ResultScreen: there the reveal canvas is drawing the same polygon at the
// same opacity on top, and easing the real layer up makes the ground dip at
// the exact moment the overlay is pulled. See the note at that call site.
export function TerritoryFill({
  id = 'territory',
  points,
  fillColor,
  strokeColor,
  fillOpacity = 0.35,
  glow = false,
  animateIn = false,
  animateDelay = 0,
  animateDuration = 900,
  // Line weights, and how long a CHANGE to any of these styles takes to ease
  // across. The claim chooser raises them while the runner is moving the
  // shape and as each step opens, so the shape under the controls stands out
  // from the held land around it. Defaults are what every other caller had.
  strokeWidth = 2,
  glowWidth = 6,
  styleTransitionMs = 0,
}) {
  const reduced = useReduceMotion();
  // Hooks run before the early returns below — this component is routinely
  // mounted with no points yet.
  const animated = animateIn && !reduced;
  const [shown, setShown] = useState(!animated);

  useEffect(() => {
    if (!animated) {
      setShown(true);
      return undefined;
    }
    // One frame painted at zero, so the transition has a value to leave FROM.
    // Committing both states in the same frame would just be a jump.
    const t = setTimeout(() => setShown(true), Math.max(16, animateDelay));
    return () => clearTimeout(t);
  }, [animated, animateDelay]);

  if (!MAPBOX_AVAILABLE) return null;
  if (!points || points.length < 3) return null;

  const transition = { duration: animated ? animateDuration : (reduced ? 0 : styleTransitionMs), delay: 0 };
  const on = shown ? 1 : 0;

  return (
    <ShapeSource id={`${id}-src`} shape={polygonFeature(points)}>
      <FillLayer
        id={`${id}-fill`}
        style={{ fillColor, fillOpacity: fillOpacity * on, fillOpacityTransition: transition }}
      />
      {glow && (
        <LineLayer
          id={`${id}-glow`}
          style={{
            lineColor: strokeColor,
            lineWidth: glowWidth,
            lineOpacity: 0.4 * on,
            lineBlur: 4,
            lineOpacityTransition: transition,
            lineWidthTransition: transition,
          }}
        />
      )}
      <LineLayer
        id={`${id}-stroke`}
        style={{
          lineColor: strokeColor,
          lineWidth: strokeWidth,
          lineOpacity: on,
          lineOpacityTransition: transition,
          lineWidthTransition: transition,
        }}
      />
    </ShapeSource>
  );
}

// An arbitrary React view pinned to a map coordinate — used for the player's
// character-portrait location marker and territory-owner portraits.
// `MarkerView` has no press handler of its own (per @rnmapbox/maps docs, taps
// must be handled by a Pressable/TouchableOpacity among its children), so an
// `onPress` here wraps `children` in one rather than forwarding a prop down.
export function UserMarker({ point, children, anchor = { x: 0.5, y: 0.5 }, onPress }) {
  if (!MAPBOX_AVAILABLE) return null;
  if (!point) return null;
  return (
    <MarkerView coordinate={toLngLat(point)} anchor={anchor} allowOverlap>
      {onPress ? (
        <Pressable onPress={onPress} hitSlop={8}>
          {children}
        </Pressable>
      ) : (
        children
      )}
    </MarkerView>
  );
}

// A point marker (e.g. run start), rendered as a bordered dot.
export function MapPoint({ id = 'point', point, color, radius = 7 }) {
  if (!MAPBOX_AVAILABLE) return null;
  if (!point) return null;
  return (
    <ShapeSource id={`${id}-src`} shape={{ type: 'Feature', geometry: { type: 'Point', coordinates: toLngLat(point) }, properties: {} }}>
      <CircleLayer
        id={`${id}-dot`}
        style={{ circleRadius: radius, circleColor: color, circleStrokeColor: '#ffffff', circleStrokeWidth: 2 }}
      />
    </ShapeSource>
  );
}

// THE FILL LEADS, THE BORDER FOLLOWS IT IN.
//
// A territory is a route-shaped ribbon. Pull back to the whole city and that
// ribbon is a few pixels wide, so a flat 2.5px stroke — plus a 6px blurred
// glow either side of it — is wider than the land it is supposed to outline.
// The board stopped being coloured ground and became a tangle of pale wire:
// every plot read as an empty outline, and the fill, the thing that says WHO
// OWNS THIS, was buried under its own border.
//
// Club view already knew this: its overview drops strokes entirely and lets
// the fill carry the reading, which is the look the rest of the board wanted.
// Interpolating on zoom gives every board the same thing, and hands the whole
// decision to Mapbox — one style expression, evaluated on the render thread,
// no zoom state in React and no re-stringified GeoJSON on every pinch.
//
// The border is not deleted at city scale, it is DEMOTED: thin, and dropped to
// half opacity, so it reads as the edge of coloured land rather than as the
// land itself. Deleting it outright would be the opposite mistake — a ribbon
// that narrow needs an edge to be seen at all from that far out. Full weight
// returns around 13.25, the zoom that also brings in owner portraits and club
// detail: the scale at which one plot is a thing you can aim a finger at.
//
// The blurred glow IS switched off out there, because a halo is all bleed and
// no shape, and bleeding four pixels either side of a two pixel ribbon is
// precisely how a coloured board turns white.
const BORDER_BY_ZOOM = ['interpolate', ['linear'], ['zoom'], 11.5, 0.8, 13.25, 1.6, 15, 2.2];
const BORDER_FADE_BY_ZOOM = ['interpolate', ['linear'], ['zoom'], 11.5, 0.5, 13.25, 0.85, 15, 1];
const BORDER_GLOW_BY_ZOOM = ['interpolate', ['linear'], ['zoom'], 12.5, 0, 14, 4, 16, 6];

// Many territories from a prebuilt GeoJSON FeatureCollection (Phase 3 uses
// this for the whole board). Each feature carries `fillColor`/`strokeColor`
// properties so one source paints every clan.
export function TerritoryLayer({ id = 'board', featureCollection, onPress, dark = false, overview = false }) {
  if (!MAPBOX_AVAILABLE) return null;
  if (!featureCollection) return null;
  return (
    <ShapeSource id={`${id}-src`} shape={featureCollection} onPress={onPress}>
      <FillLayer
        id={`${id}-fill`}
        style={{
          fillColor: ['get', 'fillColor'],
          // A city-scale board — either board — is about ownership patterns,
          // not individual plots. Muting the raw fills keeps their combined
          // footprint readable without making a dense city look like a bundle
          // of marker strokes; the outline layers below stay off entirely.
          fillOpacity: overview
            ? ['*', ['get', 'fillOpacity'], 0.62]
            : ['get', 'fillOpacity'],
        }}
      />
      {dark && !overview && (
        <LineLayer
          id={`${id}-glow`}
          style={{
            lineColor: ['get', 'strokeColor'],
            lineWidth: BORDER_GLOW_BY_ZOOM,
            lineOpacity: 0.45,
            lineBlur: 3,
          }}
        />
      )}
      {!overview && (
        <LineLayer
          id={`${id}-attack-glow`}
          style={{
            lineColor: ['get', 'strokeColor'],
            lineWidth: ['case', ['==', ['get', 'attackGlow'], 1], 12, 0],
            lineOpacity: ['case', ['==', ['get', 'attackGlow'], 1], 0.95, 0],
            lineBlur: 7,
          }}
        />
      )}
      {!overview ? (
        <LineLayer
          id={`${id}-stroke`}
          style={{
            lineColor: ['get', 'strokeColor'],
            lineWidth: BORDER_BY_ZOOM,
            lineOpacity: BORDER_FADE_BY_ZOOM,
          }}
        />
      ) : null}
    </ShapeSource>
  );
}

// A contested outline is HEAVIER than a border, so it needs the same zoom ramp
// even more badly — land counts as contested for a week, which on a live board
// is most of it, so a flat 3.5px line at city scale redraws the whole board in
// wire on top of the border that just stood down. This one does go to nothing
// out there: the base border is already holding the edge, and two lines on the
// same ribbon is the tangle. See BORDER_BY_ZOOM.
const HEAT_BY_ZOOM = ['interpolate', ['linear'], ['zoom'], 12, 0, 13.25, 2.4, 15, 3.5];

// Contested-zone outline: a bright per-feature stroke whose opacity the
// screen pulses. Rendered above the base board for recently-claimed land.
// `transition` (ms) hands the opacity change to Mapbox rather than to us: the
// layer eases to each new value instead of cutting to it, which is what makes a
// stepped pulse read as breathing. 0 (the default) keeps the hard set, which is
// what a one off overlay wants.
//
// `scaleWithZoom` is for the whole board's contested land, which has to get out
// of the fill's way when you pull back. The intelligence overlays leave it off:
// they outline a HANDFUL of picked plots, and being visible across a city is
// the entire point of switching one on.
export function ContestedOutline({ id = 'contested', featureCollection, opacity = 0.8, transition = 0, scaleWithZoom = false }) {
  if (!MAPBOX_AVAILABLE) return null;
  if (!featureCollection?.features?.length) return null;
  return (
    <ShapeSource id={`${id}-src`} shape={featureCollection}>
      <LineLayer
        id={`${id}-line`}
        style={{
          lineColor: ['get', 'strokeColor'],
          lineWidth: scaleWithZoom ? HEAT_BY_ZOOM : 3.5,
          lineOpacity: opacity,
          ...(transition ? { lineOpacityTransition: { duration: transition, delay: 0 } } : null),
          lineCap: 'round',
          lineJoin: 'round',
        }}
      />
    </ShapeSource>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});

const makePlaceholderStyles = (colors, scheme, type) => StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
    padding: space.xl,
  },
  placeholderTitle: { ...type.title, color: colors.text, marginBottom: space.sm },
  placeholderBody: { ...type.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22, maxWidth: 300 },
});

// Placeholder shown where the map can't render yet (no token / Expo Go).
export function MapUnavailable({ children }) {
  return <View style={styles.map}>{children}</View>;
}
