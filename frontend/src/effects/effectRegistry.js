import { LOTTIE_ANIMATIONS } from '../config/lottieAnimations';
import { GENERATED_EFFECTS } from './generatedEffectRegistry';

const BUILTIN_LOTTIES = {
  capture_impact_lottie: {
    id: 'capture_impact_lottie',
    name: 'Capture Impact (Lottie)',
    type: 'lottie',
    source: LOTTIE_ANIMATIONS.captureImpact.source,
    duration: LOTTIE_ANIMATIONS.captureImpact.duration,
    category: 'impact',
    tags: ['capture', 'impact', 'lottie', 'builtin'],
    releaseApproved: true,
    loop: false,
  },
  bomb_blast_lottie: {
    id: 'bomb_blast_lottie',
    name: 'Bomb Blast (Lottie)',
    type: 'lottie',
    source: LOTTIE_ANIMATIONS.bombBlast.source,
    duration: LOTTIE_ANIMATIONS.bombBlast.duration,
    category: 'explosion',
    tags: ['capture', 'bomb', 'explosion', 'lottie', 'builtin'],
    releaseApproved: true,
    loop: false,
  },
};

export const EFFECTS = Object.freeze({ ...GENERATED_EFFECTS, ...BUILTIN_LOTTIES });

export function getEffect(id) {
  return EFFECTS[id] || null;
}

export function getAllEffects() {
  return Object.values(EFFECTS);
}

export function getEffectsByCategory(category) {
  if (!category || category === 'all') return getAllEffects();
  if (category === 'capture') return getEffectsByTag('capture');
  return getAllEffects().filter((effect) => effect.category === category);
}

export function getEffectsByTag(tag) {
  return getAllEffects().filter((effect) => effect.tags?.includes(tag));
}

export function getEffectsByTags(tags, { match = 'all' } = {}) {
  const wanted = [...new Set(tags || [])];
  if (!wanted.length) return getAllEffects();
  return getAllEffects().filter((effect) => {
    const has = (tag) => effect.tags?.includes(tag);
    return match === 'any' ? wanted.some(has) : wanted.every(has);
  });
}

function randomFrom(list, random = Math.random) {
  return list.length ? list[Math.floor(random() * list.length)] : null;
}

export function getRandomEffect(category, random) {
  return randomFrom(getEffectsByCategory(category), random);
}

export function getRandomEffectByTags(tags, random) {
  return randomFrom(getEffectsByTags(tags), random);
}
