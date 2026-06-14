import * as vscode from 'vscode';
import { CladAuditCodeActionProvider } from './codeActionsProvider.js';
import { CladAuditService } from './cladAuditService.js';
import {
  debounceMs,
  isAuditTriggerDocument,
  isEnabled,
  shouldRunOnOpen,
  shouldRunOnSave,
} from './cladAuditHelpers.js';
import { offerInitWhenMissing, runInitConfig } from './initConfigCommand.js';
import { FindingsTreeProvider } from './findingsTreeProvider.js';
import { registerFindingsToolbarWebview } from './findingsToolbarWebview.js';
import { registerFindingsViewCommands } from './findingsViewCommands.js';
import { registerCladFilterHelpPanel } from './cladFilterHelpPanel.js';
import { registerCladFilterBuilderPanel } from './cladFilterBuilderPanel.js';
import { registerCladFindingsExplorerPanel } from './cladFindingsExplorerPanel.js';
import { configurationAffectsAuditEngine } from './auditSettingsQuickPick.js';
import { FindingsViewState } from './findingsViewState.js';

export function activate(context: vscode.ExtensionContext): void {
  try {
    activateCladAudit(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`CLAD Audit failed to activate: ${message}`);
    console.error('[clad-audit-vscode] activate failed', error);
  }
}

function activateCladAudit(context: vscode.ExtensionContext): void {
  const service = new CladAuditService();
  context.subscriptions.push(service);

  const viewState = new FindingsViewState(context, service);
  context.subscriptions.push(viewState);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'clad-audit.focusFindingsView';
  statusBarItem.text = '$(layers) CLAD';
  statusBarItem.tooltip = 'CLAD Audit — click to open findings';
  statusBarItem.show();
  service.bindStatusBar(statusBarItem);
  context.subscriptions.push(statusBarItem);

  const languageStatusItem = vscode.languages.createLanguageStatusItem('clad-audit.status', {
    pattern: '**/*.{ts,tsx,js,jsx,mts,cts,svelte,vue}',
  });
  languageStatusItem.name = 'CLAD Audit';
  languageStatusItem.text = 'CLAD';
  languageStatusItem.detail = 'Tier architecture';
  languageStatusItem.severity = vscode.LanguageStatusSeverity.Information;
  service.bindLanguageStatus(languageStatusItem);
  context.subscriptions.push(languageStatusItem);

  const treeProvider = new FindingsTreeProvider(service, viewState);
  const findingsView = vscode.window.createTreeView('clad-audit.findings', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  treeProvider.bindTreeView(findingsView);
  context.subscriptions.push(findingsView);

  const toolbar = registerFindingsToolbarWebview(context, viewState);
  toolbar.refreshHtml();
  registerCladFilterHelpPanel(context, viewState, toolbar);
  registerCladFilterBuilderPanel(context, service, viewState, toolbar);
  registerCladFindingsExplorerPanel(context, service, viewState, toolbar);
  registerFindingsViewCommands(context, viewState, treeProvider, toolbar, service);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ pattern: '**/*.{ts,tsx,js,jsx,mts,cts,svelte,vue}' }],
      new CladAuditCodeActionProvider(service),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.initConfig', async (uri?: vscode.Uri) => {
      await runInitConfig(service, uri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.auditWorkspace', async () => {
      if (!isEnabled()) {
        vscode.window.showInformationMessage('CLAD Audit is disabled (cladAudit.enable).');
        return;
      }
      await service.auditWorkspace();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.auditFolder', async (uri?: vscode.Uri) => {
      if (!isEnabled()) return;
      const target = uri ?? getExplorerUri();
      if (!target) {
        vscode.window.showInformationMessage('Select a folder in the explorer to audit.');
        return;
      }
      await service.auditFolder(target);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.clearDiagnostics', () => {
      service.clearAll();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.showOutput', () => {
      service.showOutput();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.focusFindingsView', async () => {
      await vscode.commands.executeCommand('clad-audit.findings.focus');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.revealFinding', async (id: string) => {
      await service.revealFinding(id);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.copyAdvice', async (id: string) => {
      await service.copyAdvice(id);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.showRemediation', async (id: string) => {
      await service.showRemediation(id);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.copyConfigException', async (id: string) => {
      await service.copyConfigException(id);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (!isEnabled() || !shouldRunOnSave() || !isAuditTriggerDocument(document)) return;
      service.scheduleAuditForDocument(document, debounceMs());
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!configurationAffectsAuditEngine(event)) return;
      if (!isEnabled() || !shouldRunOnOpen()) return;
      const delay = Math.max(debounceMs(), 800);
      setTimeout(() => {
        if (isEnabled() && shouldRunOnOpen()) void service.auditWorkspace();
      }, delay);
    }),
  );

  if (isEnabled() && shouldRunOnOpen()) {
    void service.auditWorkspace();
  }
}

function getExplorerUri(): vscode.Uri | undefined {
  return vscode.window.activeTextEditor?.document.uri;
}

export function deactivate(): void {}
