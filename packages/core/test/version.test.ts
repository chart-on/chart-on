import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../src/version';

const pkg = import.meta.glob<string>('../package.json', { query: '?raw', import: 'default', eager: true });

describe('CORE_VERSION', () => {
  it('matches the package version', () => {
    const { version } = JSON.parse(Object.values(pkg)[0]!) as { version: string };
    expect(CORE_VERSION).toBe(version);
  });
});
