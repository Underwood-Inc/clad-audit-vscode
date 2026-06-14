import * as vscode from 'vscode';
import { cladStatusMessage } from './cladUiFeedback.js';

type AuditPick = vscode.QuickPickItem & { run?: () => Promise<void> };

const DEPTH_OPTIONS = ['quick', 'standard', 'deep', 'exhaustive'] as const;

export async function pickAuditSettings(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('cladAudit');
  const enable = cfg.get<boolean>('enable', true);
  const depth = cfg.get<string>('depth', 'standard');
  const runOnSave = cfg.get<boolean>('runOnSave', true);
  const runOnOpen = cfg.get<boolean>('runOnOpen', true);
  const auditWithoutConfig = cfg.get<boolean>('auditWithoutConfig', false);
  const debounceMs = cfg.get<number>('debounceMs', 1500);

  const items: AuditPick[] = [
    {
      label: enable ? '$(check) CLAD audit enabled' : 'CLAD audit disabled',
      description: 'Toggle diagnostics on/off',
      run: async () => {
        await cfg.update('enable', !enable, vscode.ConfigurationTarget.Workspace);
        cladStatusMessage(!enable ? 'CLAD audit enabled' : 'CLAD audit disabled');
      },
    },
    {
      label: `Analysis depth: ${depth}`,
      description: 'quick · standard · deep · exhaustive',
      run: async () => {
        const picked = await vscode.window.showQuickPick(
          DEPTH_OPTIONS.map((d) => ({
            label: d,
            picked: d === depth,
          })),
          { title: 'CLAD analysis depth', placeHolder: depth },
        );
        if (!picked) return;
        await cfg.update('depth', picked.label, vscode.ConfigurationTarget.Workspace);
        cladStatusMessage(`Depth: ${picked.label}`);
      },
    },
    {
      label: runOnSave ? '$(check) Re-run on save' : 'Re-run on save',
      description: 'Debounced audit after saving source files',
      run: async () => {
        await cfg.update('runOnSave', !runOnSave, vscode.ConfigurationTarget.Workspace);
        cladStatusMessage(runOnSave ? 'Run on save off' : 'Run on save on');
      },
    },
    {
      label: runOnOpen ? '$(check) Run when workspace opens' : 'Run when workspace opens',
      run: async () => {
        await cfg.update('runOnOpen', !runOnOpen, vscode.ConfigurationTarget.Workspace);
        cladStatusMessage(runOnOpen ? 'Run on open off' : 'Run on open on');
      },
    },
    {
      label: auditWithoutConfig
        ? '$(check) Audit without config file'
        : 'Audit without config file',
      description: 'Use generic CLAD defaults when no .clad-audit.yaml',
      run: async () => {
        await cfg.update('auditWithoutConfig', !auditWithoutConfig, vscode.ConfigurationTarget.Workspace);
        cladStatusMessage(auditWithoutConfig ? 'Requires config file' : 'Audits without config');
      },
    },
    {
      label: `Save debounce: ${debounceMs} ms`,
      run: async () => {
        const next = await vscode.window.showInputBox({
          title: 'CLAD save debounce (milliseconds)',
          value: String(debounceMs),
          validateInput: (v) => (/^\d+$/.test(v.trim()) ? null : 'Enter a number'),
        });
        if (next == null) return;
        await cfg.update('debounceMs', Number(next), vscode.ConfigurationTarget.Workspace);
        cladStatusMessage(`Debounce: ${next} ms`);
      },
    },
    { label: 'Audit engine', kind: vscode.QuickPickItemKind.Separator },
    {
      label: 'Re-run audit now',
      description: 'CLAD: Audit Workspace',
      run: async () => {
        await vscode.commands.executeCommand('clad-audit.auditWorkspaceWithFeedback');
      },
    },
    {
      label: 'Show output log',
      run: async () => {
        await vscode.commands.executeCommand('clad-audit.showOutput');
      },
    },
    { label: 'Advanced', kind: vscode.QuickPickItemKind.Separator },
    {
      label: 'Open workspace settings (JSON)…',
      description: 'Edit cladAudit.* directly — avoids the Settings UI',
      run: async () => {
        await vscode.commands.executeCommand('workbench.action.openWorkspaceSettingsFile');
      },
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'CLAD Audit settings',
    placeHolder: enable ? 'Audit enabled' : 'Audit disabled',
    matchOnDescription: true,
    ignoreFocusOut: true,
  });

  await picked?.run?.();
}

/** Settings that should trigger a full re-audit — not findings sidebar display prefs. */
export const CLAD_AUDIT_RERUN_PREFIXES = [
  'cladAudit.enable',
  'cladAudit.depth',
  'cladAudit.auditWithoutConfig',
  'cladAudit.configFileName',
  'cladAudit.runOnSave',
  'cladAudit.runOnOpen',
] as const;

export function configurationAffectsAuditEngine(event: vscode.ConfigurationChangeEvent): boolean {
  return CLAD_AUDIT_RERUN_PREFIXES.some((key) => event.affectsConfiguration(key));
}
