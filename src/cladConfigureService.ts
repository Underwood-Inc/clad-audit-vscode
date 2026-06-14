import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { configFileName, discoverAuditRoots, auditWithoutConfig } from './cladAuditHelpers.js';
import type { CladAuditService } from './cladAuditService.js';
import { describeEffectiveConfig, type AuditSettingsSnapshot, type ConfigureFormState } from './cladConfigurePreview.js';
import type { FindingsViewState } from './findingsViewState.js';
import { mergeProjectEditorFindings, type LoadedProjectEditorConfig } from './projectEditorConfig.js';
import { type ProjectFindingsEditorConfig } from './findingsViewTypes.js';
import { cladStatusMessage } from './cladUiFeedback.js';
import { workspaceHasFindingsOverride } from './findingsConfigResolve.js';

export class CladConfigureService {
  constructor(
    private readonly viewState: FindingsViewState,
    private readonly service: CladAuditService,
  ) {}

  async buildFormState(): Promise<ConfigureFormState> {
    const findingsCfg = vscode.workspace.getConfiguration('cladAudit.findings');
    const effective = this.viewState.getConfig();
    const projectPaths = await this.listProjectConfigPaths();

    const yamlHint =
      effective.useProjectConfig &&
      effective.projectConfigSource &&
      !effective.projectConfigSource.includes(' project configs') &&
      !['groupBy', 'sortBy', 'nestedGroupBy', 'showInfo'].some((key) =>
        workspaceHasFindingsOverride(findingsCfg, key),
      )
        ? 'Findings tree uses editor.findings from project YAML until you change a control (then workspace wins).'
        : undefined;

    return {
      findings: {
        groupBy: effective.groupBy,
        sortBy: effective.sortBy,
        nestedGroupBy: effective.nestedGroupBy,
        showInfo: effective.showInfo,
        collapseSingleChild: effective.collapseSingleChild,
        useProjectConfig: effective.useProjectConfig,
        defaultFilter: findingsCfg.get<string>('defaultFilter', ''),
      },
      sessionFilter: this.viewState.getFilterQuery(),
      audit: this.readAuditSettings(),
      effectiveLines: describeEffectiveConfig(effective),
      projectConfigPaths: projectPaths,
      activeProjectConfig: effective.projectConfigSource?.includes(' project configs')
        ? undefined
        : effective.projectConfigSource,
      yamlHint,
    };
  }

  readAuditSettings(): AuditSettingsSnapshot {
    const auditCfg = vscode.workspace.getConfiguration('cladAudit');
    return {
      enable: auditCfg.get<boolean>('enable', true),
      depth: auditCfg.get<string>('depth', 'standard'),
      runOnSave: auditCfg.get<boolean>('runOnSave', true),
      runOnOpen: auditCfg.get<boolean>('runOnOpen', true),
      debounceMs: auditCfg.get<number>('debounceMs', 1500),
      auditWithoutConfig: auditCfg.get<boolean>('auditWithoutConfig', false),
    };
  }

  async applyFindingsWorkspace(
    form: ConfigureFormState['findings'],
    sessionFilter: string,
    quiet = false,
  ): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('cladAudit.findings');
    await Promise.all([
      cfg.update('groupBy', form.groupBy, vscode.ConfigurationTarget.Workspace),
      cfg.update('sortBy', form.sortBy, vscode.ConfigurationTarget.Workspace),
      cfg.update('nestedGroupBy', form.nestedGroupBy, vscode.ConfigurationTarget.Workspace),
      cfg.update('showInfo', form.showInfo, vscode.ConfigurationTarget.Workspace),
      cfg.update('collapseSingleChild', form.collapseSingleChild, vscode.ConfigurationTarget.Workspace),
      cfg.update('useProjectConfig', form.useProjectConfig, vscode.ConfigurationTarget.Workspace),
      cfg.update('defaultFilter', form.defaultFilter, vscode.ConfigurationTarget.Workspace),
      this.viewState.setFilterQuery(sessionFilter),
    ]);
    if (!quiet) cladStatusMessage('Findings configuration saved to workspace');
  }

  async applyAuditSettings(audit: AuditSettingsSnapshot): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('cladAudit');
    await Promise.all([
      cfg.update('enable', audit.enable, vscode.ConfigurationTarget.Workspace),
      cfg.update('depth', audit.depth, vscode.ConfigurationTarget.Workspace),
      cfg.update('runOnSave', audit.runOnSave, vscode.ConfigurationTarget.Workspace),
      cfg.update('runOnOpen', audit.runOnOpen, vscode.ConfigurationTarget.Workspace),
      cfg.update('debounceMs', audit.debounceMs, vscode.ConfigurationTarget.Workspace),
      cfg.update('auditWithoutConfig', audit.auditWithoutConfig, vscode.ConfigurationTarget.Workspace),
    ]);
    cladStatusMessage('Audit settings saved to workspace');
  }

  async resetFindingsDefaults(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('cladAudit.findings');
    await Promise.all([
      cfg.update('groupBy', undefined, vscode.ConfigurationTarget.Workspace),
      cfg.update('sortBy', undefined, vscode.ConfigurationTarget.Workspace),
      cfg.update('nestedGroupBy', undefined, vscode.ConfigurationTarget.Workspace),
      cfg.update('showInfo', undefined, vscode.ConfigurationTarget.Workspace),
      cfg.update('collapseSingleChild', undefined, vscode.ConfigurationTarget.Workspace),
      cfg.update('useProjectConfig', undefined, vscode.ConfigurationTarget.Workspace),
      cfg.update('defaultFilter', undefined, vscode.ConfigurationTarget.Workspace),
      this.viewState.clearFilterQuery(),
    ]);
    cladStatusMessage('Findings settings reset to defaults');
  }

  async saveFindingsToProjectYaml(
    configPath: string,
    findings: ProjectFindingsEditorConfig,
  ): Promise<void> {
    const merged = mergeProjectEditorFindings(configPath, findings);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(configPath), Buffer.from(merged, 'utf8'));
    cladStatusMessage(`Saved editor.findings to ${shortName(configPath)}`);
  }

  async pickProjectConfigPath(paths: string[]): Promise<string | undefined> {
    if (paths.length === 0) {
      vscode.window.showWarningMessage('No .clad-audit.yaml found — run an audit or Initialize Config first.');
      return undefined;
    }
    if (paths.length === 1) return paths[0];
    const picked = await vscode.window.showQuickPick(
      paths.map((p) => ({ label: shortName(p), description: dirname(p), path: p })),
      { title: 'Choose project config for editor.findings', placeHolder: 'Select audit root' },
    );
    return picked?.path;
  }

  private async listProjectConfigPaths(): Promise<string[]> {
    const fromAudit = new Set<string>();
    for (const stored of this.service.getStoredFindings()) {
      fromAudit.add(join(stored.rootDir, configFileName()));
    }
    const discovered = await discoverAuditRoots(configFileName(), auditWithoutConfig());
    for (const root of discovered) {
      fromAudit.add(root.configPath);
    }
    return [...fromAudit].sort();
  }
}

function shortName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts.slice(-2).join('/');
}

export type { LoadedProjectEditorConfig };
