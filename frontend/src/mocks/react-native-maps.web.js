import React from 'react';
import { View, Text } from 'react-native';

const Placeholder = ({ style }) => (
  <View style={[{ backgroundColor: '#e0e0e0', alignItems: 'center', justifyContent: 'center' }, style]}>
    <Text style={{ color: '#888' }}>Map not available on web</Text>
  </View>
);

const MapView = ({ style, children, ...props }) => <Placeholder style={style} />;
const Marker = () => null;
const Polygon = () => null;
const Polyline = () => null;

MapView.Animated = MapView;

export default MapView;
export { Marker, Polygon, Polyline };
