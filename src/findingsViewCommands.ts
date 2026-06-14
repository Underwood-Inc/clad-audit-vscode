import * as vscode from 'vscode';
import type { CladAuditService } from './cladAuditService.js';
import { cladStatusMessage, focusCladView } from './cladUiFeedback.js';
import type { FindingsToolbarWebviewProvider } from './findingsToolbarWebview.js';
import type { FindingsTreeProvider } from './findingsTreeProvider.js';
import type { FindingsViewState } from './findingsViewState.js';
import { pickAuditSettings } from './auditSettingsQuickPick.js';
import { pickFindingsLayout } from './pickFindingsLayout.js';
import {
  FINDINGS_NESTED_LABEL,
  FINDINGS_SORT_BY_LABEL,
  type FindingsNestedGroupBy,
  type FindingsSortBy,
} from './findingsViewTypes.js';

export function registerFindingsViewCommands(
  context: vscode.ExtensionContext,
  viewState: FindingsViewState,
  treeProvider: FindingsTreeProvider,
  toolbar: FindingsToolbarWebviewProvider,
  service: CladAuditService,
): void {
  const syncFilterContext = (): void => {
    const active = Boolean(viewState.getFilterQuery().trim());
    void vscode.commands.executeCommand('setContext', 'cladAudit.findingsFilterActive', active);
  };

  viewState.onDidChange(syncFilterContext);
  syncFilterContext();

  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.filterFindings', async () => {
      await focusCladView('clad-audit.findingsToolbar');
      const focused = toolbar.focusFilterInput();
      if (!focused) {
        const current = viewState.getFilterQuery();
        const next = await vscode.window.showInputBox({
          title: 'Filter CLAD findings',
          value: current,
          placeHolder: 'rule:import-boundary  tier:apps  -severity:info',
          prompt: 'Filter syntax: CLAD → Filter Syntax Help',
          ignoreFocusOut: true,
        });
        if (next === undefined) return;
        await viewState.setFilterQuery(next);
      }
      cladStatusMessage(
        viewState.getFilterQuery().trim()
          ? `Filter active: ${viewState.getFilterQuery()}`
          : 'Type in Explore to filter findings',
      );
    }),

    vscode.commands.registerCommand('clad-audit.clearFindingsFilter', async () => {
      await viewState.clearFilterQuery();
      toolbar.syncFilterInput('');
      cladStatusMessage('Filter cleared');
    }),

    vscode.commands.registerCommand('clad-audit.pickFindingsLayout', async () => {
      await pickFindingsLayout(viewState);
    }),

    vscode.commands.registerCommand('clad-audit.setFindingsGroupBy', async () => {
      await pickFindingsLayout(viewState);
    }),

    vscode.commands.registerCommand('clad-audit.setFindingsSortBy', async () => {
      const current = viewState.getConfig().sortBy;
      const picked = await vscode.window.showQuickPick(
        (Object.keys(FINDINGS_SORT_BY_LABEL) as FindingsSortBy[]).map((id) => ({
          label: FINDINGS_SORT_BY_LABEL[id],
          id,
          picked: id === current,
        })),
        {
          title: 'Sort CLAD finding groups',
          placeHolder: FINDINGS_SORT_BY_LABEL[current],
          ignoreFocusOut: true,
        },
      );
      if (!picked) return;
      await viewState.setSortBy(picked.id);
      cladStatusMessage(`Sort: ${FINDINGS_SORT_BY_LABEL[picked.id]}`);
    }),

    vscode.commands.registerCommand('clad-audit.setFindingsNestedGroupBy', async () => {
      const current = viewState.getConfig().nestedGroupBy;
      const picked = await vscode.window.showQuickPick(
        (Object.keys(FINDINGS_NESTED_LABEL) as FindingsNestedGroupBy[]).map((id) => ({
          label: FINDINGS_NESTED_LABEL[id],
          id,
          picked: id === current,
        })),
        {
          title: 'Nested grouping under audit root',
          placeHolder: FINDINGS_NESTED_LABEL[current],
          ignoreFocusOut: true,
        },
      );
      if (!picked) return;
      await viewState.setNestedGroupBy(picked.id);
      cladStatusMessage(`Nested: ${FINDINGS_NESTED_LABEL[picked.id]}`);
    }),

    vscode.commands.registerCommand('clad-audit.cycleFindingsGroupBy', async () => {
      await pickFindingsLayout(viewState);
    }),

    vscode.commands.registerCommand('clad-audit.openConfigure', async () => {
      await pickFindingsLayout(viewState);
    }),

    vscode.commands.registerCommand('clad-audit.openAuditSettings', async () => {
      await pickAuditSettings();
    }),

    vscode.commands.registerCommand('clad-audit.openFindingsSettings', async () => {
      await pickAuditSettings();
    }),

    vscode.commands.registerCommand('clad-audit.refreshFindingsView', async () => {
      treeProvider.refresh();
      cladStatusMessage('Findings tree refreshed');
    }),

    vscode.commands.registerCommand('clad-audit.auditWorkspaceWithFeedback', async () => {
      cladStatusMessage('Running CLAD audit…', 4000);
      await vscode.commands.executeCommand('clad-audit.auditWorkspace');
    }),

    vscode.commands.registerCommand('clad-audit.clearDiagnosticsWithFeedback', () => {
      const count = service.getStoredFindings().length;
      service.clearAll();
      cladStatusMessage(count > 0 ? `Cleared ${count} finding(s)` : 'No findings to clear');
    }),
  );
}
