import { describe, expect, test } from 'vitest';
import { filterStoredFindings, parseFilterQuery } from './findingsFilter.js';
import type { StoredFinding } from './storedFinding.js';

function stub(rule: string, overrides: Partial<StoredFinding['finding']> = {}): StoredFinding {
  return {
    id: `clad-${rule}`,
    rootDir: 'C:/repo/apps/mappy',
    finding: {
      rule,
      severity: 'error',
      message: `message for ${rule}`,
      advice: 'fix it',
      filePath: `src/views/Foo.svelte`,
      tier: 'views',
      ...overrides,
    },
  };
}

describe('parseFilterQuery', () => {
  test('parses field clauses and free text', () => {
    const clauses = parseFilterQuery('rule:import-boundary tier:apps');
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toMatchObject({ kind: 'field', field: 'rule', value: 'import-boundary' });
    expect(clauses[1]).toMatchObject({ kind: 'field', field: 'tier', value: 'apps' });
  });

  test('parses exclude prefix', () => {
    const clauses = parseFilterQuery('-severity:info');
    expect(clauses[0]).toMatchObject({ exclude: true, field: 'severity', value: 'info' });
  });
});

describe('filterStoredFindings', () => {
  const items = [
    stub('import-boundary', { tier: 'views', filePath: 'src/views/A.svelte' }),
    stub('app-tier-allowlist', { tier: 'apps', filePath: 'src/apps/B.ts' }),
    stub('misplaced-tier-shape', { severity: 'warning', tier: 'atoms' }),
  ];

  test('filters by rule field', () => {
    const out = filterStoredFindings(items, 'rule:import');
    expect(out).toHaveLength(1);
    expect(out[0]?.finding.rule).toBe('import-boundary');
  });

  test('excludes by severity', () => {
    const out = filterStoredFindings(items, '-severity:warning');
    expect(out.every((s) => s.finding.severity !== 'warning')).toBe(true);
  });

  test('hides info when showInfo false', () => {
    const withInfo = [...items, stub('info-rule', { severity: 'info' })];
    const out = filterStoredFindings(withInfo, '', { showInfo: false });
    expect(out.every((s) => s.finding.severity !== 'info')).toBe(true);
  });
});
