import { describe, expect, it } from 'vitest';
import { parseVersion, satisfies } from '../src/util/semver';
import { CORE_VERSION } from '../src/version';
import pkg from '../package.json?raw';

describe('satisfies', () => {
  const cases: [string, string, boolean][] = [
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '=1.2.3', false],
    ['1.2.3', '>=1.2.0 <1.3.0', true],
    ['1.3.0', '>=1.2.0 <1.3.0', false],
    ['1.9.0', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
    ['0.1.9', '^0.1.2', true],
    ['0.2.0', '^0.1.2', false],
    ['0.0.4', '^0.0.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.5.0', '1.x', true],
    ['2.0.0', '1.x', false],
    ['1.2.7', '1.2.*', true],
    ['3.4.5', '*', true],
    ['3.4.5', '', true],
    ['2.1.0', '^1.0.0 || ^2.0.0', true],
    ['1.3.0', '>1.2', true],
    ['1.2.9', '>1.2', false],
    ['1.2.9', '<=1.2', true],
    ['1.0.0-beta.1', '^1.0.0', true],
  ];
  it.each(cases)('%s in %s: %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });

  it('throws for a range or version it cannot read', () => {
    expect(() => satisfies('1.0.0', 'latest')).toThrow(/range/);
    expect(() => satisfies('one', '^1.0.0')).toThrow(/version/);
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
  });
});

describe('CORE_VERSION', () => {
  it('matches the package version', () => {
    expect(CORE_VERSION).toBe((JSON.parse(pkg) as { version: string }).version);
  });
});
