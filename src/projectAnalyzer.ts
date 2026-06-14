import { normalize } from 'node:path';
import * as vscode from 'vscode';
import {
  type ConfigDraft,
  type ConfigPresetId,
  type ProjectAnalysis,
  type ProjectStack,
  buildConfigDraft,
  EXTRA_VIEW_CANDIDATES,
  TIER_FOLDER_NAMES,
  VIEW_EXTENSION_GLOBS,
} from './configGenerator.js';
import { configFileName } from './cladAuditHelpers.js';

const TSCONFIG_CANDIDATES = [
  'tsconfig.json',
  'jsconfig.json',
  'tsconfig.app.json',
  'packages/app/tsconfig.json',
];

export type ProjectRoot = {
  rootUri: vscode.Uri;
  name: string;
  workspaceFolder: vscode.WorkspaceFolder;
};

export async function analyzeProjectRoot(project: ProjectRoot): Promise<ProjectAnalysis> {
  const rootPath = project.rootUri.fsPath;
  const signals: string[] = [];
  const readRoot = project.rootUri;

  const stack = await detectStack(readRoot);
  signals.push(`Detected ${stack} stack from package.json`);

  const srcRoot = await detectSrcRoot(readRoot);
  signals.push(`Using srcRoot "${srcRoot}" (${await countTierFolders(readRoot, srcRoot)} CLAD tier folders)`);

  const tiersFound = await listTierFolders(readRoot, srcRoot);
  if (tiersFound.length === 0) {
    signals.push('No standard tier folders found — config uses defaults; adjust srcRoot if needed');
  }

  const importAliases = await detectImportAliases(readRoot, srcRoot, signals);
  if (importAliases.size > 0) {
    signals.push(`Mapped ${importAliases.size} path alias(es) from tsconfig/jsconfig`);
  }

  const extraViewPaths = await detectExtraViewPaths(project.workspaceFolder, readRoot, srcRoot, signals);
  const ignoreGlobs = await detectProjectIgnoreGlobs(readRoot, stack);

  return {
    rootPath,
    stack,
    srcRoot,
    tiersFound,
    importAliases: Object.fromEntries(importAliases),
    extraViewPaths,
    ignoreGlobs,
    signals,
  };
}

async function detectStack(rootUri: vscode.Uri): Promise<ProjectStack> {
  const pkg = await readJsonUri(joinUri(rootUri, 'package.json'));
  if (!pkg || typeof pkg !== 'object') return 'generic';

  const deps = {
    ...(isRecord(pkg.dependencies) ? pkg.dependencies : {}),
    ...(isRecord(pkg.devDependencies) ? pkg.devDependencies : {}),
  };

  if (deps.svelte || deps['@sveltejs/kit'] || deps['@sveltejs/vite-plugin-svelte']) {
    return 'svelte';
  }
  if (deps.react || deps['react-dom'] || deps.next || deps['@next/eslint-plugin-next']) {
    return 'react';
  }
  if (deps.vue || deps['@vue/runtime-core'] || deps.nuxt || deps['@nuxt/kit']) {
    return 'vue';
  }
  return 'generic';
}

async function detectSrcRoot(rootUri: vscode.Uri): Promise<string> {
  const candidates = ['src', 'lib', 'app'];
  let best = 'src';
  let bestScore = -1;

  for (const candidate of candidates) {
    const score = await countTierFolders(rootUri, candidate);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (bestScore === 0 && (await pathExists(joinUri(rootUri, 'molecules')))) {
    return '.';
  }

  return best;
}

async function countTierFolders(rootUri: vscode.Uri, srcRoot: string): Promise<number> {
  return (await listTierFolders(rootUri, srcRoot)).length;
}

async function listTierFolders(rootUri: vscode.Uri, srcRoot: string): Promise<string[]> {
  const base = srcRoot === '.' ? rootUri : joinUri(rootUri, srcRoot);
  const found: string[] = [];

  for (const tier of TIER_FOLDER_NAMES) {
    if (await pathExists(joinUri(base, tier))) {
      found.push(tier);
    }
  }

  return found;
}

async function detectImportAliases(
  rootUri: vscode.Uri,
  srcRoot: string,
  signals: string[],
): Promise<Map<string, string>> {
  const aliases = new Map<string, string>();

  for (const candidate of TSCONFIG_CANDIDATES) {
    const uri = joinUri(rootUri, candidate);
    const config = await readJsonUri(uri);
    if (!config) continue;

    const paths = extractTsPaths(config);
    if (!paths) continue;

    for (const [aliasKey, targets] of Object.entries(paths)) {
      if (!aliasKey.endsWith('/*') || !Array.isArray(targets) || targets.length === 0) continue;
      const target = String(targets[0]);
      const tier = targetPathToTier(target, srcRoot);
      if (!tier) continue;

      const aliasPrefix = aliasKey.slice(0, -1);
      if (!aliasPrefix.endsWith('/')) continue;
      aliases.set(aliasPrefix, tier);
    }

    if (aliases.size > 0) {
      signals.push(`Read path aliases from ${candidate}`);
      break;
    }
  }

  if (aliases.size === 0) {
    for (const tier of await listTierFolders(rootUri, srcRoot)) {
      aliases.set(`$${tier}/`, tier);
    }
    if (aliases.size > 0) {
      signals.push('No tsconfig aliases — suggested $tier/ defaults from folder layout');
    }
  }

  return aliases;
}

function extractTsPaths(config: unknown): Record<string, string[]> | null {
  if (!isRecord(config)) return null;
  const compilerOptions = config.compilerOptions;
  if (!isRecord(compilerOptions)) return null;
  const paths = compilerOptions.paths;
  if (!isRecord(paths)) return null;

  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(paths)) {
    if (Array.isArray(value)) {
      out[key] = value.map(String);
    }
  }
  return out;
}

function targetPathToTier(target: string, srcRoot: string): string | null {
  const normalized = target.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/\*$/, '');
  const srcPrefix = srcRoot === '.' ? '' : `${srcRoot}/`;
  const relative = srcPrefix && normalized.startsWith(srcPrefix)
    ? normalized.slice(srcPrefix.length)
    : normalized.startsWith('src/')
      ? normalized.slice('src/'.length)
      : normalized;

  const tier = relative.split('/')[0];
  return TIER_FOLDER_NAMES.includes(tier as (typeof TIER_FOLDER_NAMES)[number]) ? tier : null;
}

async function detectExtraViewPaths(
  workspaceFolder: vscode.WorkspaceFolder,
  rootUri: vscode.Uri,
  srcRoot: string,
  signals: string[],
): Promise<string[]> {
  const base = srcRoot === '.' ? rootUri : joinUri(rootUri, srcRoot);
  const found: string[] = [];

  for (const candidate of EXTRA_VIEW_CANDIDATES) {
    if (candidate === 'views' || candidate.startsWith('views/')) continue;
    const dirUri = joinUri(base, candidate);
    if (!(await pathExists(dirUri))) continue;
    if (await hasViewLikeFiles(workspaceFolder, dirUri)) {
      found.push(candidate);
    }
  }

  if (found.length > 0) {
    signals.push(`Found UI markup outside views/: ${found.join(', ')}`);
  }

  return found;
}

async function hasViewLikeFiles(folder: vscode.WorkspaceFolder, dirUri: vscode.Uri): Promise<boolean> {
  for (const pattern of VIEW_EXTENSION_GLOBS) {
    const rel = vscode.workspace.asRelativePath(dirUri, false);
    const matches = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, `${rel}/${pattern}`),
      new vscode.RelativePattern(folder, '**/node_modules/**'),
      1,
    );
    if (matches.length > 0) return true;
  }
  return false;
}

async function detectProjectIgnoreGlobs(
  rootUri: vscode.Uri,
  stack: ProjectStack,
): Promise<string[]> {
  const extra: string[] = [];
  if (stack === 'svelte' && (await pathExists(joinUri(rootUri, 'src/i18n')))) {
    extra.push('**/i18n/i18n-types.ts', '**/i18n/i18n-util*.ts');
  }
  return extra;
}

export function configUriForProject(project: ProjectRoot, fileName: string): vscode.Uri {
  return vscode.Uri.joinPath(project.rootUri, fileName);
}

export async function configExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export function isUriInsideFolder(uri: vscode.Uri, folder: vscode.WorkspaceFolder): boolean {
  const folderPath = normalize(folder.uri.fsPath).replace(/\\/g, '/').toLowerCase();
  const targetPath = normalize(uri.fsPath).replace(/\\/g, '/').toLowerCase();
  return targetPath === folderPath || targetPath.startsWith(`${folderPath}/`);
}

export async function pickPreset(analysis: ProjectAnalysis): Promise<ConfigPresetId | undefined> {
  const items: Array<{ label: string; description: string; preset: ConfigPresetId }> = [
    {
      label: 'Recommended (detected layout)',
      description: `${analysis.stack} · ${analysis.tiersFound.length} tiers · ${Object.keys(analysis.importAliases).length} aliases`,
      preset: 'detected',
    },
    {
      label: 'Minimal',
      description: 'srcRoot + ignoreGlobs only — add aliases later',
      preset: 'minimal',
    },
  ];

  if (analysis.stack !== 'svelte') {
    items.push({
      label: 'Svelte preset',
      description: 'Enable svelteProps and Svelte ignore globs',
      preset: 'svelte',
    });
  }
  if (analysis.stack !== 'react') {
    items.push({
      label: 'React / TSX preset',
      description: 'TSX view extensions and Next.js ignores',
      preset: 'react',
    });
  }
  if (analysis.stack !== 'vue') {
    items.push({
      label: 'Vue preset',
      description: 'Vue view extensions and Nuxt ignores',
      preset: 'vue',
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'CLAD config preset',
    placeHolder: 'Choose a starting template',
  });
  return picked?.preset;
}

export async function previewDraft(draft: ConfigDraft): Promise<boolean> {
  const doc = await vscode.workspace.openTextDocument({
    content: `# Preview — not saved yet\n\n${draft.summary}\n\n---\n\n${draft.yaml}`,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });

  const action = await vscode.window.showInformationMessage(
    `Create ${configFileName()} with the "${draft.preset}" preset?`,
    { modal: true },
    'Create',
    'Cancel',
  );
  return action === 'Create';
}

export function buildDraftForPreset(analysis: ProjectAnalysis, preset: ConfigPresetId): ConfigDraft {
  return buildConfigDraft(analysis, preset);
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type === vscode.FileType.Directory || stat.type === vscode.FileType.File;
  } catch {
    return false;
  }
}

function joinUri(base: vscode.Uri, segment: string): vscode.Uri {
  return vscode.Uri.joinPath(base, ...segment.split('/'));
}

async function readJsonUri(uri: vscode.Uri): Promise<unknown | null> {
  try {
    return JSON.parse(await readText(uri));
  } catch {
    return null;
  }
}

async function readText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function resolveProjectRoot(resourceUri?: vscode.Uri): Promise<ProjectRoot | undefined> {
  if (resourceUri) {
    try {
      const stat = await vscode.workspace.fs.stat(resourceUri);
      if (stat.type === vscode.FileType.Directory) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(resourceUri);
        if (workspaceFolder && isUriInsideFolder(resourceUri, workspaceFolder)) {
          return {
            rootUri: resourceUri,
            name: vscode.workspace.asRelativePath(resourceUri, false) || workspaceFolder.name,
            workspaceFolder,
          };
        }
      }
    } catch {
      // fall through to workspace picker
    }
  }

  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;

  if (folders.length === 1 && !resourceUri) {
    const folder = folders[0];
    return { rootUri: folder.uri, name: folder.name, workspaceFolder: folder };
  }

  const picked = await vscode.window.showWorkspaceFolderPick({
    placeHolder: 'Select the project root for .clad-audit.yaml',
  });
  if (!picked) return undefined;
  return { rootUri: picked.uri, name: picked.name, workspaceFolder: picked };
}

export async function writeConfigFile(
  project: ProjectRoot,
  yaml: string,
): Promise<vscode.Uri | undefined> {
  const target = configUriForProject(project, configFileName());
  if (!isUriInsideFolder(target, project.workspaceFolder)) {
    vscode.window.showErrorMessage('CLAD Audit: config path must stay inside the workspace folder.');
    return undefined;
  }

  try {
    await vscode.workspace.fs.writeFile(target, Buffer.from(yaml, 'utf8'));
    return target;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`CLAD Audit: could not write config file — ${message}`);
    return undefined;
  }
}
