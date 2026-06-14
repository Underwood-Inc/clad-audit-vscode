import * as vscode from 'vscode';
import type { CladAuditService } from './cladAuditService.js';
import { findingToRange } from './findingPresentation.js';

export class CladAuditCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly service: CladAuditService) {}

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const cladDiagnostics = context.diagnostics.filter((d) => d.source === 'clad-audit');
    if (cladDiagnostics.length === 0) return [];

    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of cladDiagnostics) {
      const stored = this.service.getStoredFindingForDiagnostic(document.uri.fsPath, diagnostic);
      if (!stored) continue;

      const copyAdvice = new vscode.CodeAction(
        'CLAD: Copy remediation advice',
        vscode.CodeActionKind.QuickFix,
      );
      copyAdvice.diagnostics = [diagnostic];
      copyAdvice.command = {
        command: 'clad-audit.copyAdvice',
        title: 'Copy remediation advice',
        arguments: [stored.id],
      };
      actions.push(copyAdvice);

      if (stored.finding.remediation?.steps?.length) {
        const showSteps = new vscode.CodeAction(
          'CLAD: Show remediation steps',
          vscode.CodeActionKind.QuickFix,
        );
        showSteps.diagnostics = [diagnostic];
        showSteps.command = {
          command: 'clad-audit.showRemediation',
          title: 'Show remediation steps',
          arguments: [stored.id],
        };
        actions.push(showSteps);
      }

      if (stored.finding.remediation?.configExceptionYaml) {
        const copyYaml = new vscode.CodeAction(
          'CLAD: Copy config exception YAML',
          vscode.CodeActionKind.QuickFix,
        );
        copyYaml.diagnostics = [diagnostic];
        copyYaml.command = {
          command: 'clad-audit.copyConfigException',
          title: 'Copy config exception YAML',
          arguments: [stored.id],
        };
        actions.push(copyYaml);
      }
    }

    return actions;
  }
}

export { findingToRange };
