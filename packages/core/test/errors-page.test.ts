import { describe, expect, it } from 'vitest';
import { CHART_ERROR_CODES } from '../src/errors';
import { DEV_WARNING_CODES } from '../src/util/dev';
import page from '../../../docs/guide/errors.md?raw';

/** The `### code` headings under a `## title` section. */
const codesIn = (title: string) => {
  const section = page.split(/^## /m).find((s) => s.startsWith(title)) ?? '';
  return [...section.matchAll(/^### (\S+)$/gm)].map((m) => m[1]);
};

describe('errors and warnings page', () => {
  it('explains every error code core exports, and no others', () => {
    expect(codesIn('Error codes').sort()).toEqual([...CHART_ERROR_CODES].sort());
  });

  it('explains every development warning code, and no others', () => {
    expect(codesIn('Development warnings').sort()).toEqual([...DEV_WARNING_CODES].sort());
  });
});
