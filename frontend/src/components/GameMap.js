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

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Mapbox, {
  Camera,
  CircleLayer,
  FillLayer,
  LineLayer,
  MapView,
  ShapeSource,
  UserLocation,
} from '@rnmapbox/maps';

import { activeCity, cityMaxBounds } from '../config/cities';
import { MAPBOX_PUBLIC_TOKEN, MAP_READY, styleForTheme } from '../config/map';

export { MAP_READY };

// Set the runtime public token once. Telemetry off — this is a fitness app.
if (MAPBOX_PUBLIC_TOKEN) {
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
  { theme = 'light', onPress, onIdle, showsUserLocation = false, children, style, initialCenter, initialZoom },
  ref
) {
  const cameraRef = useRef(null);

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
  }));

  const bounds = cityMaxBounds();

  return (
    <MapView
      style={[styles.map, style]}
      styleURL={styleForTheme(theme)}
      onPress={onPress}
      onMapIdle={handleIdle}
      scaleBarEnabled={false}
      logoEnabled={false}
      attributionEnabled
      attributionPosition={{ bottom: 8, right: 8 }}
      compassEnabled={false}
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

// A running/route trail. `glow` adds a soft wide underlayer (dark theme only).
export function Trail({ id = 'trail', points, color, width = 5, glow = false }) {
  if (!points || points.length < 2) return null;
  return (
    <ShapeSource id={`${id}-src`} shape={lineFeature(points)}>
      {glow && (
        <LineLayer
          id={`${id}-glow`}
          style={{ lineColor: color, lineWidth: width * 3, lineOpacity: 0.35, lineCap: 'round', lineJoin: 'round', lineBlur: width * 2 }}
        />
      )}
      <LineLayer
        id={`${id}-line`}
        style={{ lineColor: color, lineWidth: width, lineCap: 'round', lineJoin: 'round' }}
      />
    </ShapeSource>
  );
}

// The dashed "if you closed the loop now" line back to the start.
export function ClosingLine({ id = 'closing', from, to, color }) {
  if (!from || !to) return null;
  return (
    <ShapeSource id={`${id}-src`} shape={lineFeature([from, to])}>
      <LineLayer
        id={`${id}-line`}
        style={{ lineColor: color, lineWidth: 2.5, lineDasharray: [2, 2], lineCap: 'round' }}
      />
    </ShapeSource>
  );
}

// A single filled territory / live preview polygon.
export function TerritoryFill({ id = 'territory', points, fillColor, strokeColor, fillOpacity = 0.35, glow = false }) {
  if (!points || points.length < 3) return null;
  return (
    <ShapeSource id={`${id}-src`} shape={polygonFeature(points)}>
      <FillLayer id={`${id}-fill`} style={{ fillColor, fillOpacity }} />
      {glow && (
        <LineLayer
          id={`${id}-glow`}
          style={{ lineColor: strokeColor, lineWidth: 6, lineOpacity: 0.4, lineBlur: 4 }}
        />
      )}
      <LineLayer id={`${id}-stroke`} style={{ lineColor: strokeColor, lineWidth: 2 }} />
    </ShapeSource>
  );
}

// A point marker (e.g. run start), rendered as a bordered dot.
export function MapPoint({ id = 'point', point, color, radius = 7 }) {
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
});

// Placeholder shown where the map can't render yet (no token / Expo Go).
export function MapUnavailable({ children }) {
  return <View style={styles.map}>{children}</View>;
}
