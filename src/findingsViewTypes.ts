import type { CladSeverity, CladTierId } from '@underwoodinc/clad-audit/types';

/** Primary tree grouping strategy for the Findings sidebar. */
export type FindingsGroupBy = 'severity' | 'rule' | 'tier' | 'file' | 'root';

/** Sort order for group nodes at each tree level. */
export type FindingsSortBy = 'count-desc' | 'count-asc' | 'alpha' | 'severity';

/** Optional nested grouping under `root` mode (e.g. root → rule → file). */
export type FindingsNestedGroupBy = 'none' | 'rule' | 'tier' | 'severity' | 'file';

export type ProjectFindingsEditorConfig = {
  groupBy?: FindingsGroupBy;
  sortBy?: FindingsSortBy;
  nestedGroupBy?: FindingsNestedGroupBy;
  filter?: string;
  showInfo?: boolean;
  collapseSingleChild?: boolean;
};

export type ResolvedFindingsViewConfig = {
  groupBy: FindingsGroupBy;
  sortBy: FindingsSortBy;
  nestedGroupBy: FindingsNestedGroupBy;
  filterQuery: string;
  showInfo: boolean;
  collapseSingleChild: boolean;
  useProjectConfig: boolean;
  /** When set, project `.clad-audit.yaml` supplied part of this config. */
  projectConfigSource?: string;
};

export const FINDINGS_GROUP_BY_LABEL: Record<FindingsGroupBy, string> = {
  severity: 'Severity',
  rule: 'Rule',
  tier: 'Tier',
  file: 'File',
  root: 'Audit root',
};

export const FINDINGS_SORT_BY_LABEL: Record<FindingsSortBy, string> = {
  'count-desc': 'Count (high → low)',
  'count-asc': 'Count (low → high)',
  alpha: 'Alphabetical',
  severity: 'Severity first',
};

export const FINDINGS_NESTED_LABEL: Record<FindingsNestedGroupBy, string> = {
  none: 'Flat (files only)',
  rule: 'By rule',
  tier: 'By tier',
  severity: 'By severity',
  file: 'By file',
};

export const SEVERITY_ORDER: CladSeverity[] = ['error', 'warning', 'info'];

export const SEVERITY_LABEL: Record<CladSeverity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  info: 'Info',
};

export const SEVERITY_ICON: Record<CladSeverity, string> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

export const TIER_LABEL: Record<CladTierId, string> = {
  atoms: 'Atoms',
  molecules: 'Molecules',
  organisms: 'Organisms',
  recipes: 'Recipes',
  views: 'Views',
  apps: 'Apps',
  sockets: 'Sockets',
  plugs: 'Plugs',
  unknown: 'Unknown tier',
};

export const DEFAULT_FINDINGS_VIEW_CONFIG: ResolvedFindingsViewConfig = {
  groupBy: 'severity',
  sortBy: 'count-desc',
  nestedGroupBy: 'rule',
  filterQuery: '',
  showInfo: true,
  collapseSingleChild: false,
  useProjectConfig: true,
};
