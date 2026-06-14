import { describe, expect, test } from 'vitest';
import { buildFindingsExplorerSnapshot } from './findingsExplorerTree.js';
import type { StoredFinding } from './storedFinding.js';
import { DEFAULT_FINDINGS_VIEW_CONFIG } from './findingsViewTypes.js';

function mockFinding(partial: Partial<StoredFinding['finding']> & { rule: string }): StoredFinding {
  return {
    id: 'clad-1',
    rootDir: '/repo/apps/mappy',
    finding: {
      severity: 'error',
      message: 'must not import',
      filePath: 'src/apps/foo.ts',
      line: 3,
      column: 1,
      advice: '',
      tier: 'apps',
      ...partial,
    },
  };
}

test('buildFindingsExplorerSnapshot groups by tier', () => {
  const all = [
    mockFinding({ rule: 'import-boundary', tier: 'apps' }),
    { ...mockFinding({ rule: 'unknown-tier-file', tier: 'unknown' }), id: 'clad-2' },
  ];
  const snap = buildFindingsExplorerSnapshot(all, {
    ...DEFAULT_FINDINGS_VIEW_CONFIG,
    groupBy: 'tier',
    sortBy: 'alpha',
  });
  expect(snap.visible).toBe(2);
  expect(snap.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(['Apps', 'Unknown tier']));
});

test('buildFindingsExplorerSnapshot respects filter', () => {
  const all = [mockFinding({ rule: 'import-boundary' })];
  const snap = buildFindingsExplorerSnapshot(all, {
    ...DEFAULT_FINDINGS_VIEW_CONFIG,
    filterQuery: 'rule:missing',
  });
  expect(snap.visible).toBe(0);
  expect(snap.nodes).toEqual([]);
});
