// Maps a clan badge_icon key (server enum, 16) to a lucide icon.

import React from 'react';
import {
  Anchor, Compass, Crown, Flame, Gem, Leaf, Mountain, PawPrint, Rocket,
  Shield, Skull, Star, Sword, Target, Waves, Zap,
} from 'lucide-react-native';

const ICONS = {
  shield: Shield, flame: Flame, bolt: Zap, crown: Crown, wolf: PawPrint,
  anchor: Anchor, mountain: Mountain, rocket: Rocket, skull: Skull, leaf: Leaf,
  star: Star, sword: Sword, compass: Compass, diamond: Gem, wave: Waves, target: Target,
};

export const BADGE_KEYS = Object.keys(ICONS);

export default function ClanBadge({ icon, size = 24, color, strokeWidth = 2 }) {
  const Icon = ICONS[icon] || Shield;
  return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
}
