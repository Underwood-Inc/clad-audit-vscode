import { basename, join } from 'node:path';
import type { CladSeverity, CladTierId } from '@underwoodinc/clad-audit/types';
import type { StoredFinding } from './storedFinding.js';
import { normalizeFsPath } from './cladAuditHelpers.js';
import { severityRank, tierRank } from './findingsFilter.js';
import {
  FINDINGS_GROUP_BY_LABEL,
  SEVERITY_LABEL,
  TIER_LABEL,
  type FindingsGroupBy,
  type FindingsNestedGroupBy,
  type FindingsSortBy,
} from './findingsViewTypes.js';

export type GroupBucket = {
  key: string;
  label: string;
  description?: string;
  iconId: string;
  severityHint?: CladSeverity;
  items: StoredFinding[];
};

export type TreeSegment =
  | { kind: 'severity'; value: CladSeverity }
  | { kind: 'rule'; value: string }
  | { kind: 'tier'; value: CladTierId | 'unknown' }
  | { kind: 'file'; value: string }
  | { kind: 'root'; value: string };

export type TreePath = {
  segments: TreeSegment[];
};

export function encodeTreePath(path: TreePath): string {
  return path.segments.map((s) => `${s.kind}:${encodeURIComponent(s.value)}`).join('|');
}

export function decodeTreePath(id: string): TreePath {
  const segments: TreeSegment[] = [];
  for (const part of id.split('|')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const kind = part.slice(0, idx) as TreeSegment['kind'];
    const value = decodeURIComponent(part.slice(idx + 1));
    segments.push({ kind, value } as TreeSegment);
  }
  return { segments };
}

export function rootLabel(rootDir: string): string {
  const parts = rootDir.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.slice(-2).join('/') || basename(rootDir);
}

function groupKeyForFinding(stored: StoredFinding, dimension: TreeSegment['kind']): string {
  const f = stored.finding;
  switch (dimension) {
    case 'severity':
      return f.severity;
    case 'rule':
      return f.rule;
    case 'tier':
      return f.tier ?? 'unknown';
    case 'file':
      return f.filePath;
    case 'root':
      return normalizeFsPath(stored.rootDir);
    default:
      return 'unknown';
  }
}

function labelForKey(dimension: TreeSegment['kind'], key: string, sample?: StoredFinding): string {
  switch (dimension) {
    case 'severity':
      return SEVERITY_LABEL[key as CladSeverity] ?? key;
    case 'rule':
      return key;
    case 'tier':
      return TIER_LABEL[(key as CladTierId) ?? 'unknown'] ?? key;
    case 'file':
      return key;
    case 'root':
      return sample ? rootLabel(sample.rootDir) : rootLabel(key);
    default:
      return key;
  }
}

function iconForDimension(dimension: TreeSegment['kind'], key: string): string {
  switch (dimension) {
    case 'severity':
      return key === 'error' ? 'error' : key === 'warning' ? 'warning' : 'info';
    case 'rule':
      return 'law';
    case 'tier':
      return 'layers';
    case 'file':
      return 'file';
    case 'root':
      return 'root-folder';
    default:
      return 'circle-outline';
  }
}

function worstSeverity(items: StoredFinding[]): CladSeverity {
  let worst: CladSeverity = 'info';
  for (const item of items) {
    if (severityRank(item.finding.severity) < severityRank(worst)) {
      worst = item.finding.severity;
    }
  }
  return worst;
}

export function hierarchyForGroupBy(
  groupBy: FindingsGroupBy,
  nestedGroupBy: FindingsNestedGroupBy,
): TreeSegment['kind'][] {
  switch (groupBy) {
    case 'severity':
      return ['severity', 'file'];
    case 'rule':
      return ['rule', 'file'];
    case 'tier':
      return ['tier', 'file'];
    case 'file':
      return ['file'];
    case 'root':
      if (nestedGroupBy === 'none') return ['root', 'file'];
      if (nestedGroupBy === 'file') return ['root', 'file'];
      return ['root', nestedGroupBy, 'file'];
    default:
      return ['severity', 'file'];
  }
}

export function bucketFindings(
  items: readonly StoredFinding[],
  dimension: TreeSegment['kind'],
): GroupBucket[] {
  const map = new Map<string, StoredFinding[]>();
  for (const item of items) {
    const key = groupKeyForFinding(item, dimension);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }

  return [...map.entries()].map(([key, bucketItems]) => ({
    key,
    label: labelForKey(dimension, key, bucketItems[0]),
    description: String(bucketItems.length),
    iconId: iconForDimension(dimension, key),
    severityHint: dimension === 'severity' ? (key as CladSeverity) : worstSeverity(bucketItems),
    items: bucketItems,
  }));
}

export function sortBuckets(buckets: GroupBucket[], sortBy: FindingsSortBy): GroupBucket[] {
  const copy = [...buckets];
  copy.sort((a, b) => compareBuckets(a, b, sortBy));
  return copy;
}

function compareBuckets(a: GroupBucket, b: GroupBucket, sortBy: FindingsSortBy): number {
  const aCount = a.items.length;
  const bCount = b.items.length;

  switch (sortBy) {
    case 'count-desc':
      return bCount - aCount || a.label.localeCompare(b.label);
    case 'count-asc':
      return aCount - bCount || a.label.localeCompare(b.label);
    case 'alpha':
      return a.label.localeCompare(b.label);
    case 'severity': {
      const aSev = severityRank(a.severityHint ?? 'info');
      const bSev = severityRank(b.severityHint ?? 'info');
      if (aSev !== bSev) return aSev - bSev;
      return bCount - aCount || a.label.localeCompare(b.label);
    }
    default:
      return a.label.localeCompare(b.label);
  }
}

export function filterByPath(items: readonly StoredFinding[], path: TreePath): StoredFinding[] {
  return items.filter((item) =>
    path.segments.every((segment) => groupKeyForFinding(item, segment.kind) === segment.value),
  );
}

export function nextDimension(
  hierarchy: TreeSegment['kind'][],
  path: TreePath,
): TreeSegment['kind'] | 'finding' | null {
  const depth = path.segments.length;
  if (depth >= hierarchy.length) return 'finding';
  return hierarchy[depth] ?? null;
}

export function sortFindings(items: readonly StoredFinding[]): StoredFinding[] {
  return [...items].sort((a, b) => {
    const lineDiff = (a.finding.line ?? 0) - (b.finding.line ?? 0);
    if (lineDiff !== 0) return lineDiff;
    return a.finding.rule.localeCompare(b.finding.rule);
  });
}

export function summaryLine(
  groupBy: FindingsGroupBy,
  sortBy: FindingsSortBy,
  total: number,
  visible: number,
  filterActive: boolean,
  projectSource?: string,
): string {
  const parts = [
    `${visible} finding(s)`,
    `group: ${FINDINGS_GROUP_BY_LABEL[groupBy]}`,
    `sort: ${sortBy}`,
  ];
  if (filterActive && visible !== total) parts.push(`${total - visible} hidden`);
  if (projectSource) parts.push('project config');
  return parts.join(' · ');
}

export function absPathForStored(stored: StoredFinding): string {
  return join(stored.rootDir, stored.finding.filePath);
}

export function tierSortKey(tier: string): number {
  return tierRank(tier as CladTierId);
}
