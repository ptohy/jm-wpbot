import { describe, expect, it } from 'vitest';
import { assertTransition, TransitionError } from '../../apps/server/src/domain/state-machine.js';

describe('appointment state machine', () => {
  it.each([
    ['hold', 'confirmed', 'client'],
    ['hold', 'confirmed', 'admin'],
    ['hold', 'confirmed', 'professional'],
    ['hold', 'expired', 'system'],
    ['confirmed', 'cancelled', 'client'],
    ['confirmed', 'cancelled', 'admin'],
    ['confirmed', 'cancelled', 'professional'],
    ['confirmed', 'completed', 'admin'],
    ['confirmed', 'completed', 'professional'],
    ['confirmed', 'no_show', 'admin'],
    ['confirmed', 'no_show', 'professional'],
  ] as const)('allows %s -> %s for %s', (from, to, actor) => {
    expect(() => assertTransition(from, to, actor)).not.toThrow();
  });

  it.each([
    ['hold', 'completed', 'admin'],
    ['expired', 'confirmed', 'client'],
    ['cancelled', 'confirmed', 'professional'],
    ['confirmed', 'expired', 'system'],
    ['hold', 'confirmed', 'system'],
    ['confirmed', 'completed', 'client'],
  ] as const)('rejects %s -> %s for %s', (from, to, actor) => {
    expect(() => assertTransition(from, to, actor)).toThrow(TransitionError);
  });
});
