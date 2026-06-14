import type { CladSeverity, CladTierId } from '@underwoodinc/clad-audit/types';
import type { FilterClause, FilterField } from './findingsFilter.js';
import { parseFilterQuery } from './findingsFilter.js';
import type { StoredFinding } from './storedFinding.js';

export type FilterBuilderTerm = {
  id: string;
  kind: 'text' | 'field' | 'regex';
  field?: FilterField;
  value: string;
  exclude: boolean;
};

export type SavedFilterPreset = {
  id: string;
  name: string;
  query: string;
};

export type FilterBuilderSuggestions = {
  rules: SuggestionChip[];
  tiers: SuggestionChip[];
  severities: SuggestionChip[];
  files: SuggestionChip[];
  roots: SuggestionChip[];
};

export type SuggestionChip = {
  label: string;
  term: Omit<FilterBuilderTerm, 'id'>;
  count: number;
};

let termCounter = 0;

export function newFilterBuilderTermId(): string {
  termCounter += 1;
  return `term-${termCounter}`;
}

export function parseQueryToBuilderTerms(query: string): FilterBuilderTerm[] {
  return clausesToBuilderTerms(parseFilterQuery(query));
}

export function clausesToBuilderTerms(clauses: FilterClause[]): FilterBuilderTerm[] {
  return clauses.map((clause) => {
    if (clause.kind === 'regex') {
      return {
        id: newFilterBuilderTermId(),
        kind: 'regex',
        value: `/${clause.pattern.source}/${clause.pattern.flags}`,
        exclude: clause.exclude,
      };
    }
    if (clause.kind === 'field') {
      return {
        id: newFilterBuilderTermId(),
        kind: 'field',
        field: clause.field,
        value: clause.value,
        exclude: clause.exclude,
      };
    }
    return {
      id: newFilterBuilderTermId(),
      kind: 'text',
      value: clause.value,
      exclude: clause.exclude,
    };
  });
}

export function builderTermsToQuery(terms: readonly FilterBuilderTerm[]): string {
  return terms
    .map((term) => {
      const prefix = term.exclude ? '-' : '';
      if (term.kind === 'regex') return `${prefix}${term.value}`;
      if (term.kind === 'field' && term.field) return `${prefix}${term.field}:${term.value}`;
      return `${prefix}${term.value}`;
    })
    .join(' ')
    .trim();
}

export function describeBuilderTerm(term: FilterBuilderTerm): string {
  const prefix = term.exclude ? 'NOT ' : '';
  if (term.kind === 'field' && term.field) return `${prefix}${term.field}: ${term.value}`;
  if (term.kind === 'regex') return `${prefix}${term.value}`;
  return `${prefix}"${term.value}"`;
}

/** Stable key for duplicate detection (matches filter parser normalization). */
export function termKey(term: Omit<FilterBuilderTerm, 'id'>): string {
  const exclude = term.exclude ? '1' : '0';
  if (term.kind === 'field' && term.field) {
    return `field:${term.field}:${term.value.toLowerCase()}:${exclude}`;
  }
  if (term.kind === 'regex') return `regex:${term.value}:${exclude}`;
  return `text:${term.value.toLowerCase()}:${exclude}`;
}

export function hasEquivalentTerm(
  terms: readonly FilterBuilderTerm[],
  candidate: Omit<FilterBuilderTerm, 'id'>,
): boolean {
  const key = termKey(candidate);
  return terms.some((term) => termKey(term) === key);
}

export function chipTone(term: Omit<FilterBuilderTerm, 'id'>): string {
  if (term.kind === 'field' && term.field === 'severity') {
    const sev = term.value.toLowerCase();
    if (sev === 'error' || sev === 'warning' || sev === 'info') return `severity-${sev}`;
  }
  if (term.kind === 'field' && term.field === 'tier') {
    const tier = term.value.toLowerCase();
    if (TIER_CHIP_TONES.has(tier)) return `tier-${tier}`;
  }
  if (term.kind === 'field' && term.field) return term.field;
  return term.kind;
}

const TIER_CHIP_TONES = new Set([
  'apps',
  'views',
  'organisms',
  'molecules',
  'atoms',
  'sockets',
  'plugs',
  'recipes',
  'unknown',
]);

export function buildFilterSuggestions(findings: readonly StoredFinding[]): FilterBuilderSuggestions {
  const ruleCounts = countBy(findings, (s) => s.finding.rule);
  const tierCounts = countBy(findings, (s) => s.finding.tier ?? 'unknown');
  const sevCounts = countBy(findings, (s) => s.finding.severity);
  const fileCounts = countBy(findings, (s) => topPathSegment(s.finding.filePath));
  const rootCounts = countBy(findings, (s) => shortRoot(s.rootDir));

  return {
    rules: topChips(ruleCounts, (value) => ({
      label: value,
      term: { kind: 'field', field: 'rule', value, exclude: false },
    })),
    tiers: topChips(tierCounts, (value) => ({
      label: value,
      term: { kind: 'field', field: 'tier', value, exclude: false },
    })),
    severities: topChips(sevCounts, (value) => ({
      label: value,
      term: {
        kind: 'field',
        field: 'severity',
        value: value as CladSeverity,
        exclude: false,
      },
    })),
    files: topChips(fileCounts, (value) => ({
      label: value,
      term: { kind: 'field', field: 'file', value, exclude: false },
    })),
    roots: topChips(rootCounts, (value) => ({
      label: value,
      term: { kind: 'field', field: 'root', value: value.toLowerCase(), exclude: false },
    })),
  };
}

function countBy(items: readonly StoredFinding[], pick: (s: StoredFinding) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = pick(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function topChips(
  counts: Map<string, number>,
  toTerm: (value: string) => { label?: string; term: Omit<FilterBuilderTerm, 'id'> },
  limit = 12,
): SuggestionChip[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => {
      const base = toTerm(value);
      return { label: base.label ?? value, count, term: base.term };
    });
}

function topPathSegment(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}/`;
  return parts[0] ?? filePath;
}

function shortRoot(rootDir: string): string {
  const parts = rootDir.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || rootDir;
}

export const FILTER_BUILDER_FIELDS: { field: FilterField; label: string; placeholder: string }[] = [
  { field: 'rule', label: 'Rule', placeholder: 'import-boundary' },
  { field: 'tier', label: 'Tier', placeholder: 'apps, views, molecules…' },
  { field: 'severity', label: 'Severity', placeholder: 'error, warning, info' },
  { field: 'file', label: 'File path', placeholder: 'views/ or src/apps/' },
  { field: 'root', label: 'Audit root', placeholder: 'apps/mappy' },
  { field: 'message', label: 'Message', placeholder: 'must not import' },
  { field: 'import', label: 'Import', placeholder: '$organisms/…' },
  { field: 'advice', label: 'Advice', placeholder: 'move to molecules' },
];

export const TIER_QUICK_VALUES: CladTierId[] = [
  'apps',
  'views',
  'organisms',
  'molecules',
  'atoms',
  'sockets',
  'plugs',
  'unknown',
];

export const SEVERITY_QUICK_VALUES: CladSeverity[] = ['error', 'warning', 'info'];
