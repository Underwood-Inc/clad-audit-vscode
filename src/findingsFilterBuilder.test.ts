import { expect, test } from 'vitest';
import {
  builderTermsToQuery,
  clausesToBuilderTerms,
  hasEquivalentTerm,
  parseQueryToBuilderTerms,
  termKey,
} from './findingsFilterBuilder.js';
import { parseFilterQuery } from './findingsFilter.js';

test('builderTermsToQuery serializes field and exclude terms', () => {
  const query = builderTermsToQuery([
    { id: '1', kind: 'field', field: 'rule', value: 'import-boundary', exclude: false },
    { id: '2', kind: 'field', field: 'severity', value: 'info', exclude: true },
  ]);
  expect(query).toBe('rule:import-boundary -severity:info');
});

test('parseQueryToBuilderTerms round-trips common queries', () => {
  const original = 'rule:import-boundary tier:apps -severity:info';
  const terms = parseQueryToBuilderTerms(original);
  expect(builderTermsToQuery(terms)).toBe(original);
});

test('clausesToBuilderTerms preserves regex', () => {
  const clauses = parseFilterQuery('/import.*apps/i');
  const terms = clausesToBuilderTerms(clauses);
  expect(terms[0]?.kind).toBe('regex');
  expect(builderTermsToQuery(terms)).toContain('/import.*apps/i');
});

test('termKey normalizes field values for duplicate detection', () => {
  const a = { kind: 'field' as const, field: 'severity' as const, value: 'Warning', exclude: false };
  const b = { kind: 'field' as const, field: 'severity' as const, value: 'warning', exclude: false };
  expect(termKey(a)).toBe(termKey(b));
});

test('hasEquivalentTerm treats exclude as part of identity', () => {
  const terms = [
    { id: '1', kind: 'field' as const, field: 'severity' as const, value: 'info', exclude: true },
  ];
  expect(hasEquivalentTerm(terms, { kind: 'field', field: 'severity', value: 'info', exclude: true })).toBe(
    true,
  );
  expect(hasEquivalentTerm(terms, { kind: 'field', field: 'severity', value: 'info', exclude: false })).toBe(
    false,
  );
});
