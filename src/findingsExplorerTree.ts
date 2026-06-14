import type { CladSeverity } from '@underwoodinc/clad-audit/types';
import { describeActiveFilter, filterStoredFindings } from './findingsFilter.js';
import {
  bucketFindings,
  filterByPath,
  hierarchyForGroupBy,
  nextDimension,
  sortBuckets,
  sortFindings,
  type TreePath,
} from './findingsGrouping.js';
import type { StoredFinding } from './storedFinding.js';
import type { FindingsSortBy, ResolvedFindingsViewConfig } from './findingsViewTypes.js';

export type ExplorerTreeNode = {
  id: string;
  kind: 'group' | 'finding';
  label: string;
  detail?: string;
  severity?: CladSeverity;
  count?: number;
  findingId?: string;
  children?: ExplorerTreeNode[];
};

export type FindingsExplorerSnapshot = {
  summary: string;
  total: number;
  visible: number;
  nodes: ExplorerTreeNode[];
};

export function buildFindingsExplorerSnapshot(
  all: readonly StoredFinding[],
  config: ResolvedFindingsViewConfig,
): FindingsExplorerSnapshot {
  const visible = filterStoredFindings(all, config.filterQuery, { showInfo: config.showInfo });
  const hierarchy = hierarchyForGroupBy(config.groupBy, config.nestedGroupBy);

  if (all.length === 0) {
    return {
      summary: 'No CLAD findings — run an audit to refresh.',
      total: 0,
      visible: 0,
      nodes: [],
    };
  }

  if (visible.length === 0) {
    return {
      summary: describeActiveFilter(config.filterQuery, all.length, 0),
      total: all.length,
      visible: 0,
      nodes: [],
    };
  }

  const nodes = buildLevel(visible, { segments: [] }, hierarchy, config.sortBy);
  return {
    summary: describeActiveFilter(config.filterQuery, all.length, visible.length),
    total: all.length,
    visible: visible.length,
    nodes,
  };
}

function buildLevel(
  visible: readonly StoredFinding[],
  path: TreePath,
  hierarchy: ReturnType<typeof hierarchyForGroupBy>,
  sortBy: FindingsSortBy,
): ExplorerTreeNode[] {
  const next = nextDimension(hierarchy, path);
  if (next === 'finding') {
    return sortFindings(filterByPath(visible, path)).map((stored) => findingNode(stored));
  }
  if (next == null) return [];

  const buckets = sortBuckets(bucketFindings(filterByPath(visible, path), next), sortBy);
  return buckets.map((bucket) => {
    const childPath: TreePath = {
      segments: [...path.segments, { kind: next, value: bucket.key } as TreePath['segments'][0]],
    };
    const childNext = nextDimension(hierarchy, childPath);
    const children =
      childNext === 'finding'
        ? sortFindings(bucket.items).map((stored) => findingNode(stored))
        : buildLevel(visible, childPath, hierarchy, sortBy);

    return {
      id: childPath.segments.map((s) => `${s.kind}:${encodeURIComponent(s.value)}`).join('|'),
      kind: 'group' as const,
      label: bucket.label,
      count: bucket.items.length,
      severity: bucket.severityHint,
      children,
    };
  });
}

function findingNode(stored: StoredFinding): ExplorerTreeNode {
  const f = stored.finding;
  const where =
    f.line != null ? `${f.line}${f.column != null ? `:${f.column}` : ''}` : f.filePath;
  return {
    id: stored.id,
    kind: 'finding',
    label: f.rule,
    detail: `${where} · ${truncate(f.message, 140)}`,
    severity: f.severity,
    findingId: stored.id,
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
