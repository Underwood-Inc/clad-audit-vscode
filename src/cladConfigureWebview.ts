import * as vscode from 'vscode';
import { CladConfigureService } from './cladConfigureService.js';
import type { FindingsViewState } from './findingsViewState.js';
import {
  FINDINGS_GROUP_BY_LABEL,
  FINDINGS_NESTED_LABEL,
  FINDINGS_SORT_BY_LABEL,
  type ProjectFindingsEditorConfig,
} from './findingsViewTypes.js';
import type { ConfigureFormState } from './cladConfigurePreview.js';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'applyWorkspace'; findings: ConfigureFormState['findings']; sessionFilter: string; quiet?: boolean }
  | { type: 'applyAudit'; audit: ConfigureFormState['audit'] }
  | { type: 'applyAll'; findings: ConfigureFormState['findings']; sessionFilter: string; audit: ConfigureFormState['audit'] }
  | { type: 'resetFindings' }
  | { type: 'saveToYaml'; findings: ConfigureFormState['findings']; configPath?: string }
  | { type: 'openYaml'; configPath?: string }
  | { type: 'openVscodeSettings' };

export class CladConfigureWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly configureService: CladConfigureService;

  constructor(
    context: vscode.ExtensionContext,
    viewState: FindingsViewState,
    service: import('./cladAuditService.js').CladAuditService,
  ) {
    this.configureService = new CladConfigureService(viewState, service);
    this.disposables.push(
      viewState.onDidChange(() => void this.postState()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('cladAudit')) void this.postState();
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    webviewView.webview.html = this.renderHtml();

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'ready':
          await this.postState();
          break;
        case 'applyWorkspace':
          await this.configureService.applyFindingsWorkspace(
            message.findings,
            message.sessionFilter,
            message.quiet,
          );
          await this.postState();
          break;
        case 'applyAudit':
          await this.configureService.applyAuditSettings(message.audit);
          await this.postState();
          break;
        case 'applyAll':
          await this.configureService.applyFindingsWorkspace(message.findings, message.sessionFilter);
          await this.configureService.applyAuditSettings(message.audit);
          await this.postState();
          break;
        case 'resetFindings':
          await this.configureService.resetFindingsDefaults();
          await this.postState();
          break;
        case 'saveToYaml': {
          const paths = (await this.configureService.buildFormState()).projectConfigPaths;
          const configPath =
            message.configPath ?? (await this.configureService.pickProjectConfigPath(paths));
          if (!configPath) break;
          const yamlFindings = formFindingsToProject(message.findings);
          await this.configureService.saveFindingsToProjectYaml(configPath, yamlFindings);
          await this.postState();
          break;
        }
        case 'openYaml': {
          const state = await this.configureService.buildFormState();
          const path =
            message.configPath ??
            state.activeProjectConfig ??
            (await this.configureService.pickProjectConfigPath(state.projectConfigPaths));
          if (path) {
            await vscode.window.showTextDocument(vscode.Uri.file(path));
          }
          break;
        }
        case 'openVscodeSettings':
          await vscode.commands.executeCommand('workbench.action.openSettings', 'cladAudit');
          break;
        default:
          break;
      }
    });
  }

  async refresh(): Promise<void> {
    await this.postState();
  }

  private async postState(): Promise<void> {
    if (!this.view) return;
    const state = await this.configureService.buildFormState();
    this.view.webview.postMessage({
      type: 'state',
      state,
      labels: {
        groupBy: FINDINGS_GROUP_BY_LABEL,
        sortBy: FINDINGS_SORT_BY_LABEL,
        nested: FINDINGS_NESTED_LABEL,
      },
    });
  }

  private renderHtml(): string {
    const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';";
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  :root {
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  body { margin: 0; padding: 8px 10px 14px; box-sizing: border-box; }
  h2 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.75;
    margin: 14px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35));
  }
  h2:first-child { margin-top: 0; }
  .field { margin-bottom: 8px; }
  .field label {
    display: block;
    font-size: 11px;
    opacity: 0.85;
    margin-bottom: 3px;
  }
  .field .help {
    font-size: 10px;
    opacity: 0.6;
    margin-top: 2px;
    line-height: 1.35;
  }
  select, input[type="search"], input[type="number"], input[type="text"] {
    width: 100%;
    box-sizing: border-box;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 4px 8px;
    font: inherit;
  }
  select:focus, input:focus { outline: 1px solid var(--vscode-focusBorder); }
  .checks { display: flex; flex-direction: column; gap: 6px; font-size: 11px; }
  .checks label {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    cursor: pointer;
    opacity: 0.95;
  }
  .checks input { margin-top: 2px; flex-shrink: 0; }
  .preview {
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1));
    border-left: 3px solid var(--vscode-textLink-foreground);
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.45;
    border-radius: 0 4px 4px 0;
    margin: 8px 0;
  }
  .preview strong { display: block; margin-bottom: 4px; font-size: 10px; text-transform: uppercase; opacity: 0.7; }
  .preview .tree { font-family: var(--vscode-editor-font-family); }
  .preview ul { margin: 4px 0 0; padding-left: 16px; opacity: 0.85; }
  #nestedField { display: none; }
  #nestedField.visible { display: block; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font: inherit;
    cursor: pointer;
    font-size: 11px;
  }
  .btn.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn:hover { opacity: 0.92; }
  .warn {
    font-size: 10px;
    opacity: 0.65;
    margin-top: 6px;
    line-height: 1.35;
  }
  .yaml-hint {
    margin: 0 0 12px;
    padding: 0.55rem 0.7rem;
    border-radius: 6px;
    font-size: 0.78rem;
    line-height: 1.4;
    background: var(--vscode-inputValidation-infoBackground, rgba(80, 120, 180, 0.15));
    border: 1px solid var(--vscode-inputValidation-infoBorder, rgba(80, 120, 180, 0.35));
    color: var(--vscode-foreground);
  }
  .yaml-hint[hidden] { display: none; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (max-width: 260px) { .grid2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
  <h2>Findings tree</h2>
  <p class="yaml-hint" id="yamlHint" hidden></p>
  <div class="preview" id="preview">
    <strong>Tree layout</strong>
    <div class="tree" id="treePreview">—</div>
    <ul id="effectiveList"></ul>
  </div>
  <div class="field">
    <label for="groupBy">Primary grouping</label>
    <select id="groupBy"></select>
    <div class="help">Top-level buckets in the Findings sidebar.</div>
  </div>
  <div class="field" id="nestedField">
    <label for="nestedGroupBy">Nested under audit root</label>
    <select id="nestedGroupBy"></select>
    <div class="help">Only applies when primary grouping is <em>Audit root</em>.</div>
  </div>
  <div class="field">
    <label for="sortBy">Sort groups by</label>
    <select id="sortBy"></select>
  </div>
  <div class="checks">
    <label><input type="checkbox" id="showInfo" /> Show info-severity findings</label>
    <label><input type="checkbox" id="collapseSingleChild" /> Collapse single-child groups</label>
    <div class="help" style="margin-left:1.35rem;margin-top:-0.25rem">Not applied to the tree yet — reserved for a future release.</div>
    <label><input type="checkbox" id="useProjectConfig" /> Merge <code>editor.findings</code> from project YAML</label>
  </div>

  <h2>Filter</h2>
  <div class="field">
    <label for="sessionFilter">Session filter (this workspace)</label>
    <input type="search" id="sessionFilter" placeholder="rule:import-boundary  -tier:apps" spellcheck="false" />
    <div class="help">Live filter for the current session — cleared separately from defaults.</div>
  </div>
  <div class="field">
    <label for="defaultFilter">Default filter (saved to workspace)</label>
    <input type="search" id="defaultFilter" placeholder="Optional default when session filter is empty" spellcheck="false" />
  </div>

  <h2>Audit engine</h2>
  <div class="checks">
    <label><input type="checkbox" id="auditEnable" /> Enable CLAD audit</label>
    <label><input type="checkbox" id="runOnSave" /> Re-run on save</label>
    <label><input type="checkbox" id="runOnOpen" /> Run when workspace opens</label>
    <label><input type="checkbox" id="auditWithoutConfig" /> Audit without config file</label>
  </div>
  <div class="grid2">
    <div class="field">
      <label for="depth">Analysis depth</label>
      <select id="depth">
        <option value="quick">Quick</option>
        <option value="standard">Standard</option>
        <option value="deep">Deep</option>
        <option value="exhaustive">Exhaustive</option>
      </select>
    </div>
    <div class="field">
      <label for="debounceMs">Save debounce (ms)</label>
      <input type="number" id="debounceMs" min="0" step="100" />
    </div>
  </div>

  <h2>Project YAML</h2>
  <div class="field">
    <label for="yamlPath">Config file</label>
    <select id="yamlPath"></select>
    <div class="help">Save sidebar defaults to <code>editor.findings</code> (extension-only; auditor ignores this block).</div>
  </div>
  <div class="warn">Saving to YAML rewrites the file — inline comments may be lost. Open the file first to review.</div>

  <div class="actions">
    <button class="btn" id="applyAll">Apply all</button>
    <button class="btn secondary" id="applyFindings">Apply findings</button>
    <button class="btn secondary" id="saveYaml">Save to YAML</button>
    <button class="btn secondary" id="openYaml">Open YAML</button>
    <button class="btn secondary" id="reset">Reset findings</button>
    <button class="btn secondary" id="vscodeSettings">VS Code settings</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const labels = { groupBy: {}, sortBy: {}, nested: {} };

    const els = {
      groupBy: document.getElementById('groupBy'),
      nestedGroupBy: document.getElementById('nestedGroupBy'),
      nestedField: document.getElementById('nestedField'),
      sortBy: document.getElementById('sortBy'),
      showInfo: document.getElementById('showInfo'),
      collapseSingleChild: document.getElementById('collapseSingleChild'),
      useProjectConfig: document.getElementById('useProjectConfig'),
      sessionFilter: document.getElementById('sessionFilter'),
      defaultFilter: document.getElementById('defaultFilter'),
      auditEnable: document.getElementById('auditEnable'),
      runOnSave: document.getElementById('runOnSave'),
      runOnOpen: document.getElementById('runOnOpen'),
      auditWithoutConfig: document.getElementById('auditWithoutConfig'),
      depth: document.getElementById('depth'),
      debounceMs: document.getElementById('debounceMs'),
      yamlPath: document.getElementById('yamlPath'),
      treePreview: document.getElementById('treePreview'),
      effectiveList: document.getElementById('effectiveList'),
      yamlHint: document.getElementById('yamlHint'),
      applyAll: document.getElementById('applyAll'),
      applyFindings: document.getElementById('applyFindings'),
      saveYaml: document.getElementById('saveYaml'),
      openYaml: document.getElementById('openYaml'),
      reset: document.getElementById('reset'),
      vscodeSettings: document.getElementById('vscodeSettings'),
    };

    function fillSelect(select, map, value) {
      select.innerHTML = '';
      for (const [k, label] of Object.entries(map)) {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = label;
        if (k === value) opt.selected = true;
        select.appendChild(opt);
      }
    }

    function nestedTreeLabel(groupBy, nestedGroupBy) {
      const g = labels.groupBy[groupBy] || groupBy;
      if (groupBy === 'file') return g + ' → Finding';
      if (groupBy !== 'root') return g + ' → File → Finding';
      const n = labels.nested[nestedGroupBy] || nestedGroupBy;
      if (nestedGroupBy === 'none' || nestedGroupBy === 'file') return g + ' → File → Finding';
      return g + ' → ' + n + ' → File → Finding';
    }

    function readFindings() {
      return {
        groupBy: els.groupBy.value,
        sortBy: els.sortBy.value,
        nestedGroupBy: els.nestedGroupBy.value,
        showInfo: els.showInfo.checked,
        collapseSingleChild: els.collapseSingleChild.checked,
        useProjectConfig: els.useProjectConfig.checked,
        defaultFilter: els.defaultFilter.value,
      };
    }

    function readAudit() {
      return {
        enable: els.auditEnable.checked,
        depth: els.depth.value,
        runOnSave: els.runOnSave.checked,
        runOnOpen: els.runOnOpen.checked,
        debounceMs: Number(els.debounceMs.value) || 0,
        auditWithoutConfig: els.auditWithoutConfig.checked,
      };
    }

    function updatePreview() {
      els.nestedField.classList.toggle('visible', els.groupBy.value === 'root');
      els.treePreview.textContent = nestedTreeLabel(els.groupBy.value, els.nestedGroupBy.value);
    }

    function scheduleLiveFindingsApply() {
      clearTimeout(applyTimer);
      applyTimer = setTimeout(() => {
        vscode.postMessage({
          type: 'applyWorkspace',
          findings: readFindings(),
          sessionFilter: els.sessionFilter.value,
          quiet: true,
        });
      }, 320);
    }

    let applyTimer = null;

    ['change'].forEach((ev) => {
      els.groupBy.addEventListener(ev, () => { updatePreview(); scheduleLiveFindingsApply(); });
      els.nestedGroupBy.addEventListener(ev, () => { updatePreview(); scheduleLiveFindingsApply(); });
      els.sortBy.addEventListener(ev, scheduleLiveFindingsApply);
      els.showInfo.addEventListener(ev, scheduleLiveFindingsApply);
      els.collapseSingleChild.addEventListener(ev, scheduleLiveFindingsApply);
      els.useProjectConfig.addEventListener(ev, scheduleLiveFindingsApply);
    });
    els.sessionFilter.addEventListener('input', scheduleLiveFindingsApply);
    els.defaultFilter.addEventListener('input', scheduleLiveFindingsApply);

    ['change', 'input'].forEach((ev) => {
      if (ev === 'change') return;
      els.groupBy.addEventListener(ev, updatePreview);
      els.nestedGroupBy.addEventListener(ev, updatePreview);
    });

    els.applyAll.addEventListener('click', () => {
      vscode.postMessage({ type: 'applyAll', findings: readFindings(), sessionFilter: els.sessionFilter.value, audit: readAudit() });
    });
    els.applyFindings.addEventListener('click', () => {
      vscode.postMessage({ type: 'applyWorkspace', findings: readFindings(), sessionFilter: els.sessionFilter.value });
    });
    els.saveYaml.addEventListener('click', () => {
      const configPath = els.yamlPath.value || undefined;
      vscode.postMessage({ type: 'saveToYaml', findings: readFindings(), configPath });
    });
    els.openYaml.addEventListener('click', () => {
      vscode.postMessage({ type: 'openYaml', configPath: els.yamlPath.value || undefined });
    });
    els.reset.addEventListener('click', () => vscode.postMessage({ type: 'resetFindings' }));
    els.vscodeSettings.addEventListener('click', () => vscode.postMessage({ type: 'openVscodeSettings' }));

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type !== 'state') return;
      const { state } = msg;
      Object.assign(labels, msg.labels);
      const f = state.findings;
      fillSelect(els.groupBy, msg.labels.groupBy, f.groupBy);
      fillSelect(els.nestedGroupBy, msg.labels.nested, f.nestedGroupBy);
      fillSelect(els.sortBy, msg.labels.sortBy, f.sortBy);
      els.showInfo.checked = f.showInfo;
      els.collapseSingleChild.checked = f.collapseSingleChild;
      els.useProjectConfig.checked = f.useProjectConfig;
      if (document.activeElement !== els.sessionFilter) els.sessionFilter.value = state.sessionFilter || '';
      if (document.activeElement !== els.defaultFilter) els.defaultFilter.value = f.defaultFilter || '';
      const a = state.audit;
      els.auditEnable.checked = a.enable;
      els.runOnSave.checked = a.runOnSave;
      els.runOnOpen.checked = a.runOnOpen;
      els.auditWithoutConfig.checked = a.auditWithoutConfig;
      els.depth.value = a.depth;
      els.debounceMs.value = String(a.debounceMs);
      els.yamlPath.innerHTML = '';
      const paths = state.projectConfigPaths || [];
      if (paths.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '(no .clad-audit.yaml found — run audit or Initialize Config)';
        els.yamlPath.appendChild(opt);
      } else {
        for (const p of paths) {
          const opt = document.createElement('option');
          opt.value = p;
          const parts = p.replace(/\\\\/g, '/').split('/');
          opt.textContent = parts.slice(-2).join('/');
          if (p === state.activeProjectConfig) opt.selected = true;
          els.yamlPath.appendChild(opt);
        }
      }
      els.effectiveList.innerHTML = '';
      for (const line of state.effectiveLines || []) {
        const li = document.createElement('li');
        li.textContent = line;
        els.effectiveList.appendChild(li);
      }
      if (state.yamlHint) {
        els.yamlHint.hidden = false;
        els.yamlHint.textContent = state.yamlHint;
      } else {
        els.yamlHint.hidden = true;
        els.yamlHint.textContent = '';
      }
      updatePreview();
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function formFindingsToProject(findings: ConfigureFormState['findings']): ProjectFindingsEditorConfig {
  return {
    groupBy: findings.groupBy,
    sortBy: findings.sortBy,
    nestedGroupBy: findings.nestedGroupBy,
    filter: findings.defaultFilter.trim() || undefined,
    showInfo: findings.showInfo,
    collapseSingleChild: findings.collapseSingleChild,
  };
}

export function registerCladConfigureWebview(
  context: vscode.ExtensionContext,
  viewState: FindingsViewState,
  service: import('./cladAuditService.js').CladAuditService,
): CladConfigureWebviewProvider {
  const provider = new CladConfigureWebviewProvider(context, viewState, service);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('clad-audit.configure', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    provider,
  );
  return provider;
}
