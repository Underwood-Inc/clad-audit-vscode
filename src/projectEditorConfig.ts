import { readFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ProjectFindingsEditorConfig } from './findingsViewTypes.js';

export type LoadedProjectEditorConfig = {
  configPath: string;
  findings?: ProjectFindingsEditorConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFindingsBlock(raw: unknown): ProjectFindingsEditorConfig | undefined {
  if (!isRecord(raw)) return undefined;
  const out: ProjectFindingsEditorConfig = {};
  if (typeof raw.groupBy === 'string') out.groupBy = raw.groupBy as ProjectFindingsEditorConfig['groupBy'];
  if (typeof raw.sortBy === 'string') out.sortBy = raw.sortBy as ProjectFindingsEditorConfig['sortBy'];
  if (typeof raw.nestedGroupBy === 'string') {
    out.nestedGroupBy = raw.nestedGroupBy as ProjectFindingsEditorConfig['nestedGroupBy'];
  }
  if (typeof raw.filter === 'string') out.filter = raw.filter;
  if (typeof raw.showInfo === 'boolean') out.showInfo = raw.showInfo;
  if (typeof raw.collapseSingleChild === 'boolean') out.collapseSingleChild = raw.collapseSingleChild;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Read optional `editor.findings` block from a `.clad-audit.yaml` (ignored by the auditor). */
export function loadProjectEditorConfig(configPath: string): LoadedProjectEditorConfig | null {
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = parseYaml(raw) as unknown;
    if (!isRecord(parsed)) return { configPath, findings: undefined };
    const editor = parsed.editor;
    if (!isRecord(editor)) return { configPath, findings: undefined };
    return { configPath, findings: parseFindingsBlock(editor.findings) };
  } catch {
    return null;
  }
}

/** Merge `editor.findings` into an existing `.clad-audit.yaml` (YAML round-trip may drop comments). */
export function mergeProjectEditorFindings(
  configPath: string,
  findings: ProjectFindingsEditorConfig,
): string {
  let doc: Record<string, unknown> = {};
  let existed = false;
  try {
    const raw = readFileSync(configPath, 'utf8');
    existed = true;
    const parsed = parseYaml(raw) as unknown;
    if (isRecord(parsed)) doc = parsed;
  } catch {
    // new file
  }

  const editor = isRecord(doc.editor) ? { ...doc.editor } : {};
  const block: Record<string, unknown> = {};
  if (findings.groupBy) block.groupBy = findings.groupBy;
  if (findings.sortBy) block.sortBy = findings.sortBy;
  if (findings.nestedGroupBy) block.nestedGroupBy = findings.nestedGroupBy;
  if (findings.filter?.trim()) block.filter = findings.filter.trim();
  if (findings.showInfo != null) block.showInfo = findings.showInfo;
  if (findings.collapseSingleChild != null) block.collapseSingleChild = findings.collapseSingleChild;

  editor.findings = block;
  doc.editor = editor;

  const body = `${stringifyYaml(doc, { lineWidth: 0 }).trimEnd()}\n`;
  if (existed) return body;
  return `# Extension-only sidebar defaults (ignored by clad-audit CLI)\n${body}`;
}

export function projectEditorConfigSnippet(): string {
  return `# Optional VS Code / Cursor sidebar defaults (extension-only; ignored by the auditor):
# editor:
#   findings:
#     groupBy: rule          # severity | rule | tier | file | root
#     sortBy: count-desc     # count-desc | count-asc | alpha | severity
#     nestedGroupBy: rule    # when groupBy is root: none | rule | tier | severity | file
#     filter: tier:apps      # see cladAudit.findings.filterSyntax setting
#     showInfo: true
#     collapseSingleChild: false
`;
}
