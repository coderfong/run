import { getEffect } from './effectRegistry';
import {
  ACTION,
  CAMERA_ACTION,
  ROLE,
  TARGET,
  actor,
  camera,
  effect,
  haptic,
  shake,
  victory,
} from './choreography';

export const DEV_DEFENSE_STYLES = Object.freeze([
  Object.freeze({
    id: 'seedance_shield_counter',
    name: 'Shield Counter',
    description: 'The defender absorbs the hit, reflects it, and sends the attacker flying.',
    duration: 2700,
    sequence: Object.freeze([
      actor({ role: ROLE.ATTACKER, start: 0, action: ACTION.MOVE_TO, toward: 'defenderGroupCenter', duration: 520 }),
      actor({ role: ROLE.DEFENDER, target: TARGET.ALL, start: 280, action: ACTION.NOTICE, lookAt: 'characterCenter', duration: 300 }),
      actor({ role: ROLE.DEFENDER, target: TARGET.ALL, start: 520, action: ACTION.BRACE, duration: 820 }),
      effect(0, 'seedance_defense_shield_counter', { anchor: 'defenderGroupCenter', size: 300, hold: 2350 }),
      actor({ role: ROLE.ATTACKER, start: 650, action: ACTION.CAST, toward: 'defenderGroupCenter', duration: 470 }),
      camera(1060, CAMERA_ACTION.FREEZE, { duration: 90 }),
      haptic(1100, 'heavy'),
      shake(1100, { intensity: 1.35, duration: 230 }),
      camera(1110, CAMERA_ACTION.PUNCH_IN, { amount: 1.08, duration: 240 }),
      actor({ role: ROLE.ATTACKER, start: 1120, action: ACTION.RECOIL, duration: 180 }),
      actor({ role: ROLE.ATTACKER, start: 1280, action: ACTION.KNOCKBACK, from: 'defenderGroupCenter', duration: 700 }),
      actor({ role: ROLE.DEFENDER, target: TARGET.ALL, start: 1940, action: ACTION.CELEBRATE, duration: 620 }),
      victory(1980, { role: ROLE.DEFENDER }),
    ]),
  }),
]);

export function getDefenseStyle(id) {
  return DEV_DEFENSE_STYLES.find((style) => style.id === id) || null;
}

export function resolveDefenseStyle(id) {
  return getDefenseStyle(id) || DEV_DEFENSE_STYLES[0];
}

export function validateDefenseStyle(style) {
  if (!style || !Array.isArray(style.sequence)) return ['missing defense style sequence'];
  const errors = [];
  const reveals = style.sequence.filter((step) => step.action === 'territoryReveal');
  if (reveals.length) errors.push('defense styles must not reveal or mutate territory ownership');
  if (!style.sequence.some((step) => step.action === 'actor' && step.role === ROLE.ATTACKER)) {
    errors.push('missing attacker choreography');
  }
  if (!style.sequence.some((step) => step.action === 'actor' && step.role === ROLE.DEFENDER)) {
    errors.push('missing defender choreography');
  }
  style.sequence.forEach((step, index) => {
    if (step.track === 'effect' && step.effect && !getEffect(step.effect)) {
      errors.push(`step ${index} references missing effect ${step.effect}`);
    }
    if (!Number.isFinite(step.start) || step.start < 0 || step.start > style.duration) {
      errors.push(`step ${index} has invalid start`);
    }
  });
  return errors;
}

export function buildDefensePlan(style, reducedMotion = false) {
  if (!reducedMotion) return { duration: style.duration, sequence: style.sequence };
  return {
    duration: 900,
    sequence: style.sequence
      .filter((step) => ['actor', 'haptic', 'victory'].includes(step.action))
      .map((step, index) => ({ ...step, start: Math.min(760, index * 120) })),
  };
}
