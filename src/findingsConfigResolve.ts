import * as vscode from 'vscode';

export type FindingsSettingSource = 'workspace' | 'yaml' | 'global' | 'default';

/** Workspace settings win; project YAML fills gaps when useProjectConfig is true. */
export function resolveFindingsSetting<T>(
  cfg: vscode.WorkspaceConfiguration,
  key: string,
  defaultValue: T,
  yamlValue: T | undefined,
  useProjectConfig: boolean,
): { value: T; source: FindingsSettingSource } {
  const inspected = cfg.inspect<T>(key);
  if (inspected?.workspaceValue !== undefined) {
    return { value: inspected.workspaceValue, source: 'workspace' };
  }
  if (useProjectConfig && yamlValue !== undefined) {
    return { value: yamlValue, source: 'yaml' };
  }
  if (inspected?.globalValue !== undefined) {
    return { value: inspected.globalValue, source: 'global' };
  }
  return { value: defaultValue, source: 'default' };
}

export function workspaceHasFindingsOverride(
  cfg: vscode.WorkspaceConfiguration,
  key: string,
): boolean {
  return cfg.inspect(key)?.workspaceValue !== undefined;
}
