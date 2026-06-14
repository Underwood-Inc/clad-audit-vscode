import { describe, expect, test, vi } from 'vitest';
import { resolveFindingsSetting } from './findingsConfigResolve.js';

function mockConfig(
  entries: Record<string, { workspace?: unknown; global?: unknown; default?: unknown }>,
): import('vscode').WorkspaceConfiguration {
  return {
    inspect: (key: string) => {
      const entry = entries[key];
      if (!entry) return undefined;
      return {
        key,
        workspaceValue: entry.workspace,
        workspaceFolderValue: undefined,
        globalValue: entry.global,
        defaultValue: entry.default,
      };
    },
    get: (key: string, defaultValue?: unknown) => {
      const entry = entries[key];
      if (entry?.workspace !== undefined) return entry.workspace;
      if (entry?.global !== undefined) return entry.global;
      return entry?.default ?? defaultValue;
    },
  } as import('vscode').WorkspaceConfiguration;
}

test('resolveFindingsSetting prefers explicit workspace over project YAML', () => {
  const cfg = mockConfig({
    groupBy: { workspace: 'severity', default: 'severity' },
  });
  const result = resolveFindingsSetting(cfg, 'groupBy', 'severity', 'rule', true);
  expect(result).toEqual({ value: 'severity', source: 'workspace' });
});

test('resolveFindingsSetting uses YAML when workspace is unset', () => {
  const cfg = mockConfig({
    groupBy: { default: 'severity' },
  });
  const result = resolveFindingsSetting(cfg, 'groupBy', 'severity', 'rule', true);
  expect(result).toEqual({ value: 'rule', source: 'yaml' });
});

test('resolveFindingsSetting ignores YAML when useProjectConfig is false', () => {
  const cfg = mockConfig({
    groupBy: { default: 'severity' },
  });
  const result = resolveFindingsSetting(cfg, 'groupBy', 'severity', 'rule', false);
  expect(result).toEqual({ value: 'severity', source: 'default' });
});
