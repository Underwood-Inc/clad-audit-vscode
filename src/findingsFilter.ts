import type { CladFinding, CladSeverity, CladTierId } from '@underwoodinc/clad-audit/types';
import type { StoredFinding } from './storedFinding.js';

function normalizeFsPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

export type FilterClause =
  | { kind: 'text'; value: string; exclude: boolean }
  | { kind: 'field'; field: FilterField; value: string; exclude: boolean }
  | { kind: 'regex'; pattern: RegExp; exclude: boolean };

export type FilterField =
  | 'rule'
  | 'tier'
  | 'severity'
  | 'file'
  | 'root'
  | 'message'
  | 'import'
  | 'advice';

const FIELD_ALIASES: Record<string, FilterField> = {
  rule: 'rule',
  r: 'rule',
  tier: 'tier',
  t: 'tier',
  severity: 'severity',
  sev: 'severity',
  s: 'severity',
  file: 'file',
  f: 'file',
  path: 'file',
  root: 'root',
  message: 'message',
  msg: 'message',
  m: 'message',
  import: 'import',
  imp: 'import',
  i: 'import',
  advice: 'advice',
  a: 'advice',
};

/**
 * Parse a filter query into clauses.
 *
 * Syntax (space-separated AND):
 * - `import-boundary` — free text (any field)
 * - `rule:import-boundary` or `rule=import-boundary`
 * - `-tier:apps` — exclude
 * - `/import.*apps/` — regex
 */
export function parseFilterQuery(query: string): FilterClause[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const clauses: FilterClause[] = [];
  const tokens = tokenizeFilterQuery(trimmed);

  for (let token of tokens) {
    let exclude = false;
    if (token.startsWith('-')) {
      exclude = true;
      token = token.slice(1);
    }

    if (token.startsWith('/') && token.lastIndexOf('/') > 0) {
      const last = token.lastIndexOf('/');
      const body = token.slice(1, last);
      const flags = token.slice(last + 1);
      try {
        clauses.push({ kind: 'regex', pattern: new RegExp(body, flags), exclude });
      } catch {
        clauses.push({ kind: 'text', value: token.toLowerCase(), exclude });
      }
      continue;
    }

    const sep = token.includes('=') ? '=' : token.includes(':') ? ':' : null;
    if (sep) {
      const idx = token.indexOf(sep);
      const fieldRaw = token.slice(0, idx).toLowerCase();
      const value = token.slice(idx + 1).trim().toLowerCase();
      const field = FIELD_ALIASES[fieldRaw];
      if (field && value) {
        clauses.push({ kind: 'field', field, value, exclude });
        continue;
      }
    }

    clauses.push({ kind: 'text', value: token.toLowerCase(), exclude });
  }

  return clauses;
}

function tokenizeFilterQuery(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inRegex = false;

  for (let i = 0; i < query.length; i += 1) {
    const ch = query[i];
    if (ch === '/' && (i === 0 || query[i - 1] !== '\\')) {
      inRegex = !inRegex;
      current += ch;
      continue;
    }
    if (!inRegex && /\s/.test(ch)) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function haystackForFinding(stored: StoredFinding): string {
  const f = stored.finding;
  return [
    f.rule,
    f.severity,
    f.tier ?? '',
    f.expectedTier ?? '',
    f.filePath,
    f.message,
    f.advice,
    f.importSpecifier ?? '',
    stored.rootDir,
    f.remediation?.suggestedTargetPath ?? '',
    ...(f.reasoning ?? []),
  ]
    .join('\n')
    .toLowerCase();
}

function fieldValue(stored: StoredFinding, field: FilterField): string {
  const f = stored.finding;
  switch (field) {
    case 'rule':
      return f.rule.toLowerCase();
    case 'tier':
      return (f.tier ?? 'unknown').toLowerCase();
    case 'severity':
      return f.severity.toLowerCase();
    case 'file':
      return f.filePath.toLowerCase();
    case 'root':
      return normalizeFsPath(stored.rootDir);
    case 'message':
      return f.message.toLowerCase();
    case 'import':
      return (f.importSpecifier ?? '').toLowerCase();
    case 'advice':
      return f.advice.toLowerCase();
    default:
      return '';
  }
}

function clauseMatches(clause: FilterClause, stored: StoredFinding): boolean {
  const haystack = haystackForFinding(stored);
  switch (clause.kind) {
    case 'text':
      return haystack.includes(clause.value);
    case 'field':
      return fieldValue(stored, clause.field).includes(clause.value);
    case 'regex':
      return clause.pattern.test(haystack);
    default:
      return false;
  }
}

export function filterStoredFindings(
  findings: readonly StoredFinding[],
  query: string,
  options?: { showInfo?: boolean },
): StoredFinding[] {
  let list = [...findings];
  if (options?.showInfo === false) {
    list = list.filter((s) => s.finding.severity !== 'info');
  }

  const clauses = parseFilterQuery(query);
  if (clauses.length === 0) return list;

  return list.filter((stored) => {
    for (const clause of clauses) {
      const hit = clauseMatches(clause, stored);
      if (clause.exclude && hit) return false;
      if (!clause.exclude && !hit) return false;
    }
    return true;
  });
}

export function describeActiveFilter(query: string, total: number, matched: number): string {
  if (!query.trim()) {
    return total === 0 ? 'No CLAD findings — run an audit to refresh.' : `${total} finding(s)`;
  }
  if (matched === 0) return `No findings match filter (${total} hidden)`;
  if (matched === total) return `Filter: ${query} · ${matched} finding(s)`;
  return `Filter: ${query} · ${matched} of ${total} finding(s)`;
}

export function severityRank(severity: CladSeverity): number {
  if (severity === 'error') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

export function tierRank(tier: CladTierId | undefined): number {
  const order: CladTierId[] = [
    'apps',
    'views',
    'organisms',
    'recipes',
    'molecules',
    'atoms',
    'sockets',
    'plugs',
    'unknown',
  ];
  const idx = order.indexOf(tier ?? 'unknown');
  return idx >= 0 ? idx : order.length;
}
