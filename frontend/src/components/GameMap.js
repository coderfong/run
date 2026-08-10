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

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';

import { activeCity, cityMaxBounds } from '../config/cities';
import { MAPBOX_PUBLIC_TOKEN, MAP_READY as MAP_CONFIGURED, styleForTheme } from '../config/map';
import { colors, space, type } from '../theme';
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

const GameMap = forwardRef(function GameMap(
  { theme = 'light', onPress, onIdle, showsUserLocation = false, children, style, initialCenter, initialZoom, locked = false },
  ref
) {
  const cameraRef = useRef(null);
  const mapRef = useRef(null);

  // Map settled → hand the viewport (bounds + zoom) up so screens can query
  // /map-polygons for what's visible. Fires only when movement stops.
  const handleIdle = (state) => {
    if (!onIdle) return;
    const p = state?.properties || {};
    if (!p.bounds) return;
    onIdle({ bounds: p.bounds, zoom: p.zoom, center: p.center });
  };

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
  }));

  // Expo Go / no native module — show a graceful placeholder instead of the
  // native map (which would crash). Hooks above already ran, so this early
  // return is safe.
  if (!MAPBOX_AVAILABLE) {
    return (
      <View style={[styles.map, styles.placeholder, style]}>
        <Text style={styles.placeholderTitle}>Map preview</Text>
        <Text style={styles.placeholderBody}>
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
      styleURL={styleForTheme(theme)}
      onPress={locked ? undefined : onPress}
      onMapIdle={handleIdle}
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
        maxBounds={bounds}
        minZoomLevel={activeCity.minZoom}
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

export default GameMap;

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

  const transition = { duration: animated ? animateDuration : 0, delay: 0 };
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
            lineWidth: 6,
            lineOpacity: 0.4 * on,
            lineBlur: 4,
            lineOpacityTransition: transition,
          }}
        />
      )}
      <LineLayer
        id={`${id}-stroke`}
        style={{
          lineColor: strokeColor,
          lineWidth: 2,
          lineOpacity: on,
          lineOpacityTransition: transition,
        }}
      />
    </ShapeSource>
  );
}

// An arbitrary React view pinned to a map coordinate — used for the player's
// character-portrait location marker and territory-owner portraits.
export function UserMarker({ point, children, anchor = { x: 0.5, y: 0.5 } }) {
  if (!MAPBOX_AVAILABLE) return null;
  if (!point) return null;
  return (
    <MarkerView coordinate={toLngLat(point)} anchor={anchor} allowOverlap>
      {children}
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

// Many territories from a prebuilt GeoJSON FeatureCollection (Phase 3 uses
// this for the whole board). Each feature carries `fillColor`/`strokeColor`
// properties so one source paints every clan.
export function TerritoryLayer({ id = 'board', featureCollection, onPress, dark = false }) {
  if (!MAPBOX_AVAILABLE) return null;
  if (!featureCollection) return null;
  return (
    <ShapeSource id={`${id}-src`} shape={featureCollection} onPress={onPress}>
      <FillLayer id={`${id}-fill`} style={{ fillColor: ['get', 'fillColor'], fillOpacity: ['get', 'fillOpacity'] }} />
      {dark && (
        <LineLayer id={`${id}-glow`} style={{ lineColor: ['get', 'strokeColor'], lineWidth: 5, lineOpacity: 0.35, lineBlur: 3 }} />
      )}
      <LineLayer id={`${id}-stroke`} style={{ lineColor: ['get', 'strokeColor'], lineWidth: 2 }} />
    </ShapeSource>
  );
}

// Contested-zone outline: a bright per-feature stroke whose opacity the
// screen pulses. Rendered above the base board for recently-claimed land.
export function ContestedOutline({ id = 'contested', featureCollection, opacity = 0.8 }) {
  if (!MAPBOX_AVAILABLE) return null;
  if (!featureCollection?.features?.length) return null;
  return (
    <ShapeSource id={`${id}-src`} shape={featureCollection}>
      <LineLayer
        id={`${id}-line`}
        style={{ lineColor: ['get', 'strokeColor'], lineWidth: 3.5, lineOpacity: opacity, lineCap: 'round', lineJoin: 'round' }}
      />
    </ShapeSource>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
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
