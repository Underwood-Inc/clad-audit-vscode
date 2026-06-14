import { join } from 'node:path';
import * as vscode from 'vscode';
import { normalizeFsPath } from './cladAuditHelpers.js';
import type { CladAuditService } from './cladAuditService.js';
import {
  DEFAULT_FINDINGS_VIEW_CONFIG,
  type FindingsGroupBy,
  type FindingsNestedGroupBy,
  type FindingsSortBy,
  type ProjectFindingsEditorConfig,
  type ResolvedFindingsViewConfig,
} from './findingsViewTypes.js';
import { resolveFindingsSetting } from './findingsConfigResolve.js';
import type { SavedFilterPreset } from './findingsFilterBuilder.js';
import { loadProjectEditorConfig } from './projectEditorConfig.js';

const WORKSPACE_FILTER_KEY = 'cladAudit.findings.filterQuery';
const WORKSPACE_PRESETS_KEY = 'cladAudit.findings.savedFilterPresets';

export class FindingsViewState implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly configListener: vscode.Disposable;
  private readonly yamlWatcher: vscode.FileSystemWatcher | undefined;
  private projectOverrides = new Map<string, ReturnType<typeof loadProjectEditorConfig>>();

  readonly onDidChange = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: CladAuditService,
  ) {
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('cladAudit.findings') ||
        event.affectsConfiguration('cladAudit.configFileName')
      ) {
        this.refreshProjectOverrides();
        this.changeEmitter.fire();
      }
    });

    const pattern = `**/${this.configFileName()}`;
    this.yamlWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.yamlWatcher.onDidChange(() => this.onYamlChanged());
    this.yamlWatcher.onDidCreate(() => this.onYamlChanged());
    this.yamlWatcher.onDidDelete(() => this.onYamlChanged());

    this.service.onDidChange(() => this.refreshProjectOverrides());
    this.refreshProjectOverrides();
  }

  dispose(): void {
    this.configListener.dispose();
    this.yamlWatcher?.dispose();
    this.changeEmitter.dispose();
  }

  getConfig(): ResolvedFindingsViewConfig {
    const cfg = vscode.workspace.getConfiguration('cladAudit.findings');
    const useProjectConfig = cfg.get<boolean>('useProjectConfig', true);
    const workspaceFilter = this.context.workspaceState.get<string>(WORKSPACE_FILTER_KEY);
    const yaml = this.singleProjectFindings();

    const groupBy = resolveFindingsSetting(
      cfg,
      'groupBy',
      DEFAULT_FINDINGS_VIEW_CONFIG.groupBy,
      yaml?.groupBy,
      useProjectConfig,
    ).value;
    const sortBy = resolveFindingsSetting(
      cfg,
      'sortBy',
      DEFAULT_FINDINGS_VIEW_CONFIG.sortBy,
      yaml?.sortBy,
      useProjectConfig,
    ).value;
    const nestedGroupBy = resolveFindingsSetting(
      cfg,
      'nestedGroupBy',
      DEFAULT_FINDINGS_VIEW_CONFIG.nestedGroupBy,
      yaml?.nestedGroupBy,
      useProjectConfig,
    ).value;
    const showInfo = resolveFindingsSetting(
      cfg,
      'showInfo',
      DEFAULT_FINDINGS_VIEW_CONFIG.showInfo,
      yaml?.showInfo,
      useProjectConfig,
    ).value;
    const collapseSingleChild = resolveFindingsSetting(
      cfg,
      'collapseSingleChild',
      DEFAULT_FINDINGS_VIEW_CONFIG.collapseSingleChild,
      yaml?.collapseSingleChild,
      useProjectConfig,
    ).value;

    const defaultFilter = resolveFindingsSetting(
      cfg,
      'defaultFilter',
      DEFAULT_FINDINGS_VIEW_CONFIG.filterQuery,
      yaml?.filter,
      useProjectConfig,
    ).value;

    const filterQuery =
      workspaceFilter ??
      (defaultFilter.trim() ? defaultFilter : DEFAULT_FINDINGS_VIEW_CONFIG.filterQuery);

    const projectMeta = this.projectConfigMeta(useProjectConfig, yaml);

    return {
      groupBy,
      sortBy,
      nestedGroupBy,
      filterQuery,
      showInfo,
      collapseSingleChild,
      useProjectConfig,
      projectConfigSource: projectMeta.source,
    };
  }

  getFilterQuery(): string {
    return this.getConfig().filterQuery;
  }

  async setFilterQuery(query: string, persist = true): Promise<void> {
    if (persist) {
      await this.context.workspaceState.update(WORKSPACE_FILTER_KEY, query);
    }
    this.changeEmitter.fire();
  }

  async clearFilterQuery(): Promise<void> {
    await this.context.workspaceState.update(WORKSPACE_FILTER_KEY, undefined);
    this.changeEmitter.fire();
  }

  getFilterPresets(): SavedFilterPreset[] {
    return this.context.workspaceState.get<SavedFilterPreset[]>(WORKSPACE_PRESETS_KEY) ?? [];
  }

  async saveFilterPreset(name: string, query: string): Promise<SavedFilterPreset> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Preset name is required');
    const preset: SavedFilterPreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      query: query.trim(),
    };
    const next = [...this.getFilterPresets().filter((p) => p.name !== trimmed), preset];
    await this.context.workspaceState.update(WORKSPACE_PRESETS_KEY, next);
    this.changeEmitter.fire();
    return preset;
  }

  async deleteFilterPreset(id: string): Promise<void> {
    const next = this.getFilterPresets().filter((p) => p.id !== id);
    await this.context.workspaceState.update(WORKSPACE_PRESETS_KEY, next);
    this.changeEmitter.fire();
  }

  async setDefaultFilter(query: string): Promise<void> {
    await vscode.workspace
      .getConfiguration('cladAudit.findings')
      .update('defaultFilter', query.trim(), vscode.ConfigurationTarget.Workspace);
    this.changeEmitter.fire();
  }

  async setGroupBy(groupBy: FindingsGroupBy): Promise<void> {
    await vscode.workspace
      .getConfiguration('cladAudit.findings')
      .update('groupBy', groupBy, vscode.ConfigurationTarget.Workspace);
  }

  async setSortBy(sortBy: FindingsSortBy): Promise<void> {
    await vscode.workspace
      .getConfiguration('cladAudit.findings')
      .update('sortBy', sortBy, vscode.ConfigurationTarget.Workspace);
  }

  async setNestedGroupBy(nested: FindingsNestedGroupBy): Promise<void> {
    await vscode.workspace
      .getConfiguration('cladAudit.findings')
      .update('nestedGroupBy', nested, vscode.ConfigurationTarget.Workspace);
  }

  async setShowInfo(showInfo: boolean): Promise<void> {
    await vscode.workspace
      .getConfiguration('cladAudit.findings')
      .update('showInfo', showInfo, vscode.ConfigurationTarget.Workspace);
  }

  async applyPatch(
    patch: Partial<
      Pick<
        ResolvedFindingsViewConfig,
        'groupBy' | 'sortBy' | 'nestedGroupBy' | 'showInfo' | 'collapseSingleChild'
      >
    > & { filterQuery?: string },
  ): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('cladAudit.findings');
    const updates: Promise<void>[] = [];

    if (patch.groupBy != null) {
      updates.push(cfg.update('groupBy', patch.groupBy, vscode.ConfigurationTarget.Workspace));
    }
    if (patch.sortBy != null) {
      updates.push(cfg.update('sortBy', patch.sortBy, vscode.ConfigurationTarget.Workspace));
    }
    if (patch.nestedGroupBy != null) {
      updates.push(cfg.update('nestedGroupBy', patch.nestedGroupBy, vscode.ConfigurationTarget.Workspace));
    }
    if (patch.showInfo != null) {
      updates.push(cfg.update('showInfo', patch.showInfo, vscode.ConfigurationTarget.Workspace));
    }
    if (patch.collapseSingleChild != null) {
      updates.push(
        cfg.update('collapseSingleChild', patch.collapseSingleChild, vscode.ConfigurationTarget.Workspace),
      );
    }
    if (patch.filterQuery != null) {
      updates.push(this.setFilterQuery(patch.filterQuery));
    }

    await Promise.all(updates);
    this.changeEmitter.fire();
  }

  private configFileName(): string {
    return vscode.workspace.getConfiguration('cladAudit').get<string>('configFileName', '.clad-audit.yaml');
  }

  private refreshProjectOverrides(): void {
    this.projectOverrides.clear();
    const roots = new Set<string>();
    for (const stored of this.service.getStoredFindings()) {
      roots.add(normalizeFsPath(stored.rootDir));
    }
    for (const root of roots) {
      const configPath = join(root, this.configFileName());
      const loaded = loadProjectEditorConfig(configPath);
      if (loaded) this.projectOverrides.set(normalizeFsPath(root), loaded);
    }
  }

  private onYamlChanged(): void {
    this.refreshProjectOverrides();
    this.changeEmitter.fire();
  }

  private singleProjectFindings(): ProjectFindingsEditorConfig | undefined {
    const roots = [...this.projectOverrides.values()].filter((entry) => entry.findings);
    if (roots.length !== 1) return undefined;
    return roots[0]!.findings;
  }

  private projectConfigMeta(
    useProjectConfig: boolean,
    yaml: ProjectFindingsEditorConfig | undefined,
  ): { source?: string } {
    if (!useProjectConfig || !yaml) return {};
    const loaded = [...this.projectOverrides.values()].filter((entry) => entry.findings);
    if (loaded.length === 0) return {};
    if (loaded.length > 1) {
      return {
        source: `${loaded.length} project configs (workspace overrides win when set)`,
      };
    }
    return { source: loaded[0]!.configPath };
  }
}
