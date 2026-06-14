export type FilterHelpExample = {
  id: string;
  label: string;
  query: string;
  description: string;
};

export type FilterHelpField = {
  field: string;
  aliases: string[];
  description: string;
  example: string;
};

export const FILTER_HELP_INTRO =
  'Space-separated terms are combined with AND — a finding must match every term. Prefix with - to exclude.';

export const FILTER_HELP_EXAMPLES: FilterHelpExample[] = [
  {
    id: 'import-boundary',
    label: 'Import boundary only',
    query: 'rule:import-boundary',
    description: 'Show findings from the import-boundary rule.',
  },
  {
    id: 'apps-tier',
    label: 'Apps tier',
    query: 'tier:apps',
    description: 'Findings where the file or import targets the apps tier.',
  },
  {
    id: 'errors-in-views',
    label: 'Errors in views',
    query: 'severity:error file:views/',
    description: 'Errors under any views/ path.',
  },
  {
    id: 'mappy-root',
    label: 'One audit root',
    query: 'root:mappy',
    description: 'Limit to findings from an audit root whose path contains mappy.',
  },
  {
    id: 'hide-info',
    label: 'Hide info noise',
    query: '-severity:info',
    description: 'Exclude info-severity rows (errors and warnings stay).',
  },
  {
    id: 'regex-import',
    label: 'Regex on imports',
    query: '/import.*organisms/i',
    description: 'Case-insensitive regex across the full finding text.',
  },
];

export const FILTER_HELP_FIELDS: FilterHelpField[] = [
  {
    field: 'rule',
    aliases: ['r'],
    description: 'Rule id (e.g. import-boundary, unknown-tier-file).',
    example: 'rule:import-boundary',
  },
  {
    field: 'tier',
    aliases: ['t'],
    description: 'CLAD tier: apps, views, organisms, molecules, atoms, sockets, plugs, unknown.',
    example: 'tier:views',
  },
  {
    field: 'severity',
    aliases: ['s', 'sev'],
    description: 'error, warning, or info.',
    example: 'severity:error',
  },
  {
    field: 'file',
    aliases: ['f', 'path'],
    description: 'Relative file path substring.',
    example: 'file:popouts/',
  },
  {
    field: 'root',
    aliases: [],
    description: 'Audit root directory path substring.',
    example: 'root:apps/mappy',
  },
  {
    field: 'message',
    aliases: ['m', 'msg'],
    description: 'Diagnostic message text.',
    example: 'message:must not',
  },
  {
    field: 'import',
    aliases: ['i', 'imp'],
    description: 'Import specifier when the rule reports one.',
    example: 'import:$organisms',
  },
  {
    field: 'advice',
    aliases: ['a'],
    description: 'Remediation advice text.',
    example: 'advice:move',
  },
];

export const FILTER_HELP_TIPS = [
  'Free text (no prefix) searches all fields at once — import-boundary matches rule, message, file, etc.',
  'Use = instead of : — rule=import-boundary works the same as rule:import-boundary.',
  'Regex uses /pattern/flags — flags are optional (/foo/i).',
  'Explore panel filters live; Configure saves workspace defaults.',
];

export function formatFilterHelpFieldAliases(field: FilterHelpField): string {
  if (field.aliases.length === 0) return field.field;
  return `${field.field}, ${field.aliases.join(', ')}`;
}
