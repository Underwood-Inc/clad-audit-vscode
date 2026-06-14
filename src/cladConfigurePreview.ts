import {
  FINDINGS_GROUP_BY_LABEL,
  FINDINGS_NESTED_LABEL,
  FINDINGS_SORT_BY_LABEL,
  type FindingsGroupBy,
  type FindingsNestedGroupBy,
  type FindingsSortBy,
  type ResolvedFindingsViewConfig,
} from './findingsViewTypes.js';

export function describeFindingsTreeLayout(config: {
  groupBy: FindingsGroupBy;
  nestedGroupBy: FindingsNestedGroupBy;
}): string {
  const g = FINDINGS_GROUP_BY_LABEL[config.groupBy];
  switch (config.groupBy) {
    case 'severity':
      return `${g} → File → Finding`;
    case 'rule':
      return `${g} → File → Finding`;
    case 'tier':
      return `${g} → File → Finding`;
    case 'file':
      return `${g} → Finding`;
    case 'root': {
      const nested = FINDINGS_NESTED_LABEL[config.nestedGroupBy];
      if (config.nestedGroupBy === 'none' || config.nestedGroupBy === 'file') {
        return `${g} → File → Finding`;
      }
      return `${g} → ${nested} → File → Finding`;
    }
    default:
      return `${g} → Finding`;
  }
}

export function describeEffectiveConfig(config: ResolvedFindingsViewConfig): string[] {
  const lines = [
    `Tree: ${describeFindingsTreeLayout(config)}`,
    `Sort: ${FINDINGS_SORT_BY_LABEL[config.sortBy]}`,
    config.filterQuery.trim() ? `Filter: ${config.filterQuery}` : 'Filter: (none)',
    config.showInfo ? 'Info findings: shown' : 'Info findings: hidden',
  ];
  if (config.useProjectConfig && config.projectConfigSource) {
    lines.push(`YAML defaults: ${shortPath(config.projectConfigSource)} (workspace overrides win)`);
  } else if (config.useProjectConfig) {
    lines.push('Project YAML: enabled (no editor.findings block yet)');
  } else {
    lines.push('Project YAML: ignored');
  }
  return lines;
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts.slice(-3).join('/');
}

export type AuditSettingsSnapshot = {
  enable: boolean;
  depth: string;
  runOnSave: boolean;
  runOnOpen: boolean;
  debounceMs: number;
  auditWithoutConfig: boolean;
};

export type ConfigureFormState = {
  findings: {
    groupBy: FindingsGroupBy;
    sortBy: FindingsSortBy;
    nestedGroupBy: FindingsNestedGroupBy;
    showInfo: boolean;
    collapseSingleChild: boolean;
    useProjectConfig: boolean;
    defaultFilter: string;
  };
  sessionFilter: string;
  audit: AuditSettingsSnapshot;
  effectiveLines: string[];
  projectConfigPaths: string[];
  activeProjectConfig?: string;
  yamlHint?: string;
};
