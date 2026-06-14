import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import type { CladFinding, AnalysisDepth } from '@underwoodinc/clad-audit/types';
import * as vscode from 'vscode';
import {
  copyableRemediation,
  findingToRange,
  formatFindingLocation,
} from './findingPresentation.js';

export type AuditRoot = {
  rootDir: string;
  configPath: string;
};

export function normalizeFsPath(path: string): string {
  return normalize(path).replace(/\\/g, '/').toLowerCase();
}

export function isUnderRoot(filePath: string, rootDir: string): boolean {
  const file = normalizeFsPath(filePath);
  const root = normalizeFsPath(rootDir);
  return file === root || file.startsWith(`${root}/`);
}

/** Walk upward from startDir until config file or filesystem root. */
export function findAuditRootFromPath(startDir: string, configFileName: string): AuditRoot | null {
  let dir = startDir;
  while (true) {
    const configPath = join(dir, configFileName);
    if (existsSync(configPath)) {
      return { rootDir: dir, configPath };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function discoverAuditRoots(configFileName: string, auditWithoutConfig: boolean): Promise<AuditRoot[]> {
  const roots = new Map<string, AuditRoot>();
  const folders = vscode.workspace.workspaceFolders ?? [];

  for (const folder of folders) {
    const configMatches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, `**/${configFileName}`),
      new vscode.RelativePattern(folder, '**/node_modules/**'),
    );

    for (const uri of configMatches) {
      const configPath = uri.fsPath;
      const rootDir = dirname(configPath);
      roots.set(normalizeFsPath(rootDir), { rootDir, configPath });
    }

    if (auditWithoutConfig && configMatches.length === 0) {
      const fallbackConfig = join(folder.uri.fsPath, configFileName);
      roots.set(normalizeFsPath(folder.uri.fsPath), {
        rootDir: folder.uri.fsPath,
        configPath: fallbackConfig,
      });
    }
  }

  return [...roots.values()];
}

export function findingToDiagnostic(finding: CladFinding, rootDir: string): vscode.Diagnostic | null {
  const absPath = join(rootDir, finding.filePath);
  const range = findingToRange(finding);

  const severity =
    finding.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : finding.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;

  const parts = [finding.message, finding.advice].filter(Boolean);
  const diagnostic = new vscode.Diagnostic(range, parts.join('\n\n'), severity);
  diagnostic.source = 'clad-audit';
  diagnostic.code = finding.rule;

  const related: vscode.DiagnosticRelatedInformation[] = [];

  if (finding.expectedTier) {
    related.push(
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(vscode.Uri.file(absPath), range),
        `Expected tier: ${finding.expectedTier}`,
      ),
    );
  }

  if (finding.remediation?.summary) {
    related.push(
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(vscode.Uri.file(absPath), range),
        `Remediation: ${finding.remediation.summary}`,
      ),
    );
  }

  if (finding.remediation?.suggestedTargetPath) {
    const targetAbs = join(rootDir, finding.remediation.suggestedTargetPath);
    related.push(
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(vscode.Uri.file(targetAbs), new vscode.Position(0, 0)),
        `Suggested move: ${finding.remediation.suggestedTargetPath}`,
      ),
    );
  }

  if (finding.relatedPaths?.length) {
    for (const relatedPath of finding.relatedPaths.slice(0, 5)) {
      related.push(
        new vscode.DiagnosticRelatedInformation(
          new vscode.Location(vscode.Uri.file(join(rootDir, relatedPath)), new vscode.Position(0, 0)),
          `Related: ${relatedPath}`,
        ),
      );
    }
  }

  if (finding.reasoning?.length) {
    related.push(
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(vscode.Uri.file(absPath), range),
        finding.reasoning.join(' '),
      ),
    );
  }

  if (related.length > 0) {
    diagnostic.relatedInformation = related;
  }

  return diagnostic;
}

export function groupDiagnosticsByUri(
  findings: CladFinding[],
  rootDir: string,
): Map<string, vscode.Diagnostic[]> {
  const grouped = new Map<string, vscode.Diagnostic[]>();

  for (const finding of findings) {
    const absPath = normalize(join(rootDir, finding.filePath));
    const diagnostic = findingToDiagnostic(finding, rootDir);
    if (!diagnostic) continue;

    const existing = grouped.get(absPath) ?? [];
    existing.push(diagnostic);
    grouped.set(absPath, existing);
  }

  for (const [path, diagnostics] of grouped) {
    diagnostics.sort((a, b) => {
      const lineDiff = a.range.start.line - b.range.start.line;
      if (lineDiff !== 0) return lineDiff;
      return a.range.start.character - b.range.start.character;
    });
    grouped.set(path, diagnostics);
  }

  return grouped;
}

export function lookupKey(absPath: string, finding: CladFinding): string {
  const line = finding.line ?? 1;
  const column = finding.column ?? 1;
  return `${normalizeFsPath(absPath)}|${finding.rule}|${line}|${column}`;
}

export { formatFindingLocation };

export function getConfiguredDepth(): AnalysisDepth | undefined {
  const config = vscode.workspace.getConfiguration('cladAudit');
  const depth = config.get<string>('depth', 'standard');
  const allowed: AnalysisDepth[] = ['quick', 'standard', 'deep', 'exhaustive'];
  return allowed.includes(depth as AnalysisDepth) ? (depth as AnalysisDepth) : 'standard';
}

export function isEnabled(): boolean {
  return vscode.workspace.getConfiguration('cladAudit').get<boolean>('enable', true);
}

export function shouldRunOnSave(): boolean {
  return vscode.workspace.getConfiguration('cladAudit').get<boolean>('runOnSave', true);
}

export function shouldRunOnOpen(): boolean {
  return vscode.workspace.getConfiguration('cladAudit').get<boolean>('runOnOpen', true);
}

export function debounceMs(): number {
  return vscode.workspace.getConfiguration('cladAudit').get<number>('debounceMs', 1500);
}

export function configFileName(): string {
  return vscode.workspace.getConfiguration('cladAudit').get<string>('configFileName', '.clad-audit.yaml');
}

export function auditWithoutConfig(): boolean {
  return vscode.workspace.getConfiguration('cladAudit').get<boolean>('auditWithoutConfig', false);
}

/** Source-like paths that should trigger a debounced re-audit on save. */
export function isAuditTriggerDocument(document: vscode.TextDocument): boolean {
  if (document.uri.scheme !== 'file') return false;
  return /\.(ts|tsx|js|jsx|mts|cts|svelte|vue)$/i.test(document.fileName);
}

export { copyableRemediation };
