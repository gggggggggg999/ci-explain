import { describe, expect, it } from 'vitest';
import { readVersion } from '../../src/version.js';

describe('readVersion', () => {
  it('returns a semver string', () => {
    expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
