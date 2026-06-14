import { runAudit } from '@underwoodinc/clad-audit/run';
import type { CladAuditResult, CladFinding } from '@underwoodinc/clad-audit/types';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  type AuditRoot,
  auditWithoutConfig,
  configFileName,
  copyableRemediation,
  discoverAuditRoots,
  findAuditRootFromPath,
  getConfiguredDepth,
  groupDiagnosticsByUri,
  isUnderRoot,
  lookupKey,
  normalizeFsPath,
} from './cladAuditHelpers.js';
import { findingToRange, remediationDocument } from './findingPresentation.js';
import { type StoredFinding, storeFinding } from './storedFinding.js';
import { offerInitWhenMissing, runInitConfig } from './initConfigCommand.js';

type RootAuditState = {
  lastResult?: CladAuditResult;
  lastError?: string;
};

export class CladAuditService implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('clad-audit');
  private readonly diagnosticsByUri = new Map<string, vscode.Diagnostic[]>();
  private readonly rootState = new Map<string, RootAuditState>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly auditingRoots = new Set<string>();
  private readonly storedFindings = new Map<string, StoredFinding>();
  private readonly storedByLookup = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly output = vscode.window.createOutputChannel('CLAD Audit', { log: true });
  private statusBarItem: vscode.StatusBarItem | undefined;
  private languageStatusItem: vscode.LanguageStatusItem | undefined;

  readonly onDidChange = this.changeEmitter.event;

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.collection.dispose();
    this.output.dispose();
    this.changeEmitter.dispose();
    this.statusBarItem?.dispose();
    this.languageStatusItem?.dispose();
  }

  bindStatusBar(item: vscode.StatusBarItem): void {
    this.statusBarItem = item;
  }

  bindLanguageStatus(item: vscode.LanguageStatusItem): void {
    this.languageStatusItem = item;
  }

  showOutput(): void {
    this.output.show(true);
  }

  getStoredFindings(): StoredFinding[] {
    return [...this.storedFindings.values()];
  }

  getStoredFinding(id: string): StoredFinding | undefined {
    return this.storedFindings.get(id);
  }

  getStoredFindingAt(absPath: string, line: number, rule: string, column = 1): StoredFinding | undefined {
    const key = `${normalizeFsPath(absPath)}|${rule}|${line}|${column}`;
    const id = this.storedByLookup.get(key);
    if (id) return this.storedFindings.get(id);

    const prefix = `${normalizeFsPath(absPath)}|${rule}|${line}|`;
    for (const [lookup, storedId] of this.storedByLookup) {
      if (lookup.startsWith(prefix)) return this.storedFindings.get(storedId);
    }
    return undefined;
  }

  getStoredFindingForDiagnostic(absPath: string, diagnostic: vscode.Diagnostic): StoredFinding | undefined {
    const rule = String(diagnostic.code ?? '');
    const line = diagnostic.range.start.line + 1;
    const column = diagnostic.range.start.character + 1;
    return this.getStoredFindingAt(absPath, line, rule, column);
  }

  async revealFinding(id: string): Promise<void> {
    const stored = this.storedFindings.get(id);
    if (!stored) return;

    const absPath = join(stored.rootDir, stored.finding.filePath);
    const uri = vscode.Uri.file(absPath);
    const range = findingToRange(stored.finding);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }

  async copyAdvice(id: string): Promise<void> {
    const stored = this.storedFindings.get(id);
    if (!stored) return;
    await vscode.env.clipboard.writeText(copyableRemediation(stored.finding));
    vscode.window.setStatusBarMessage('CLAD remediation copied to clipboard', 2500);
  }

  async copyConfigException(id: string): Promise<void> {
    const stored = this.storedFindings.get(id);
    const yaml = stored?.finding.remediation?.configExceptionYaml;
    if (!yaml) return;
    await vscode.env.clipboard.writeText(yaml);
    vscode.window.setStatusBarMessage('CLAD config exception YAML copied', 2500);
  }

  async showRemediation(id: string): Promise<void> {
    const stored = this.storedFindings.get(id);
    if (!stored?.finding.remediation) return;

    const doc = await vscode.workspace.openTextDocument({
      content: remediationDocument(stored.finding),
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  clearAll(): void {
    this.diagnosticsByUri.clear();
    this.rootState.clear();
    this.storedFindings.clear();
    this.storedByLookup.clear();
    this.collection.clear();
    this.setStatus('CLAD audit cleared', '$(check) CLAD');
    this.updateLanguageStatus(undefined);
    this.log('Diagnostics cleared.');
    this.changeEmitter.fire();
  }

  scheduleAuditForDocument(document: vscode.TextDocument, debounceMs: number): void {
    const root = findAuditRootFromPath(document.uri.fsPath, configFileName());
    if (!root) return;
    this.scheduleAuditRoot(root, debounceMs);
  }

  async auditFolder(uri: vscode.Uri): Promise<void> {
    const root = findAuditRootFromPath(uri.fsPath, configFileName());
    if (!root) {
      vscode.window.showInformationMessage(
        `No ${configFileName()} found at or above ${uri.fsPath}`,
      );
      return;
    }
    await this.runAudits([root], `CLAD audit (${root.rootDir})`);
  }

  scheduleAuditRoot(root: AuditRoot, debounceMs: number): void {
    const key = normalizeFsPath(root.rootDir);
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    if (debounceMs <= 0) {
      void this.runAudits([root], 'CLAD audit');
      return;
    }

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        void this.runAudits([root], 'CLAD audit');
      }, debounceMs),
    );
  }

  async auditWorkspace(): Promise<void> {
    const roots = await discoverAuditRoots(configFileName(), auditWithoutConfig());
    if (roots.length === 0) {
      if (await offerInitWhenMissing()) {
        await runInitConfig(this);
      }
      return;
    }
    await this.runAudits(roots, 'CLAD audit workspace');
  }

  private async runAudits(roots: AuditRoot[], title: string): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false,
      },
      async () => {
        this.setStatus('CLAD audit running…', '$(sync~spin) CLAD');
        await Promise.all(roots.map((root) => this.auditRoot(root)));
      },
    );
  }

  private async auditRoot(root: AuditRoot): Promise<void> {
    const key = normalizeFsPath(root.rootDir);
    if (this.auditingRoots.has(key)) return;

    this.auditingRoots.add(key);
    const started = Date.now();
    try {
      const depth = getConfiguredDepth();
      this.log(`Auditing ${root.rootDir} (depth: ${depth ?? 'config default'})…`);

      const { result } = await runAudit({
        rootDir: root.rootDir,
        configPath: root.configPath,
        strict: false,
        depth,
      });

      this.rootState.set(key, { lastResult: result });
      this.replaceRootDiagnostics(root.rootDir, result);
      this.publishCollection();
      this.updateSummaryStatus(result, root.rootDir);
      this.updateLanguageStatus(result);

      const errors = result.findings.filter((f) => f.severity === 'error').length;
      const warnings = result.findings.filter((f) => f.severity === 'warning').length;
      const infos = result.findings.filter((f) => f.severity === 'info').length;
      this.log(
        `Done in ${Date.now() - started}ms — ${result.filesScanned} files, ${result.findings.length} finding(s) (${errors} errors, ${warnings} warnings, ${infos} info).`,
      );
      this.changeEmitter.fire();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.rootState.set(key, { lastError: message });
      this.setStatus(`CLAD audit failed: ${message}`, '$(error) CLAD');
      this.log(`Failed: ${message}`);
      vscode.window.showErrorMessage(`CLAD audit failed for ${root.rootDir}: ${message}`);
      this.changeEmitter.fire();
    } finally {
      this.auditingRoots.delete(key);
    }
  }

  private replaceRootDiagnostics(rootDir: string, result: CladAuditResult): void {
    const rootKey = normalizeFsPath(rootDir);

    for (const uri of [...this.diagnosticsByUri.keys()]) {
      if (isUnderRoot(uri, rootDir)) {
        this.diagnosticsByUri.delete(uri);
      }
    }

    for (const [id, stored] of [...this.storedFindings.entries()]) {
      if (normalizeFsPath(stored.rootDir) !== rootKey) continue;
      const absPath = join(stored.rootDir, stored.finding.filePath);
      this.storedByLookup.delete(lookupKey(absPath, stored.finding));
      this.storedFindings.delete(id);
    }

    const grouped = groupDiagnosticsByUri(result.findings, rootDir);
    for (const [uri, diagnostics] of grouped) {
      this.diagnosticsByUri.set(uri, diagnostics);
    }

    for (const finding of result.findings) {
      const stored = storeFinding(rootDir, finding);
      this.storedFindings.set(stored.id, stored);
      const absPath = join(rootDir, finding.filePath);
      this.storedByLookup.set(lookupKey(absPath, finding), stored.id);
    }
  }

  private publishCollection(): void {
    this.collection.clear();
    for (const [uri, diagnostics] of this.diagnosticsByUri) {
      this.collection.set(vscode.Uri.file(uri), diagnostics);
    }
  }

  private updateSummaryStatus(result: CladAuditResult, rootDir: string): void {
    const errors = result.findings.filter((f) => f.severity === 'error').length;
    const warnings = result.findings.filter((f) => f.severity === 'warning').length;
    const label =
      result.findings.length === 0
        ? '$(check) CLAD'
        : errors > 0
          ? `$(error) CLAD ${errors}`
          : `$(warning) CLAD ${warnings}`;

    this.setStatus(
      `${result.findings.length} finding(s) · ${result.filesScanned} files · ${rootDir}\nClick to re-run audit · View sidebar for details`,
      label,
    );
  }

  private updateLanguageStatus(result: CladAuditResult | undefined): void {
    if (!this.languageStatusItem) return;
    if (!result || result.findings.length === 0) {
      this.languageStatusItem.text = 'CLAD OK';
      this.languageStatusItem.severity = vscode.LanguageStatusSeverity.Information;
      this.languageStatusItem.detail = 'No tier violations';
      this.languageStatusItem.command = {
        command: 'clad-audit.auditWorkspace',
        title: 'Run CLAD audit',
      };
      return;
    }

    const errors = result.findings.filter((f) => f.severity === 'error').length;
    const warnings = result.findings.filter((f) => f.severity === 'warning').length;
    this.languageStatusItem.text = errors > 0 ? `CLAD ${errors}E` : `CLAD ${warnings}W`;
    this.languageStatusItem.severity =
      errors > 0 ? vscode.LanguageStatusSeverity.Error : vscode.LanguageStatusSeverity.Warning;
    this.languageStatusItem.detail = `${result.findings.length} finding(s)`;
    this.languageStatusItem.command = {
      command: 'clad-audit.focusFindingsView',
      title: 'Show CLAD findings',
    };
  }

  private setStatus(tooltip: string, text: string): void {
    if (!this.statusBarItem) return;
    this.statusBarItem.text = text;
    this.statusBarItem.tooltip = tooltip;
  }

  private log(message: string): void {
    this.output.appendLine(message);
  }
}
