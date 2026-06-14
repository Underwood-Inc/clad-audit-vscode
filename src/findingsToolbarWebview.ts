import * as vscode from 'vscode';
import type { FindingsViewState } from './findingsViewState.js';
import {
  FINDINGS_GROUP_BY_LABEL,
  FINDINGS_NESTED_LABEL,
  FINDINGS_SORT_BY_LABEL,
  type FindingsGroupBy,
  type FindingsNestedGroupBy,
  type FindingsSortBy,
} from './findingsViewTypes.js';

export class FindingsToolbarWebviewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private pendingFocusFilter = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly viewState: FindingsViewState,
  ) {
    this.disposables.push(viewState.onDidChange(() => this.postState()));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  refreshHtml(): void {
    if (!this.view) return;
    this.view.webview.html = this.renderHtml();
    this.postState();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    webviewView.webview.html = this.renderHtml();

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; value?: unknown }) => {
      switch (message.type) {
        case 'ready':
          this.postState();
          if (this.pendingFocusFilter) {
            this.pendingFocusFilter = false;
            this.postFocusFilter();
          }
          break;
        case 'filter':
          await this.viewState.setFilterQuery(String(message.value ?? ''));
          break;
        case 'clearFilter':
          await this.viewState.clearFilterQuery();
          break;
        case 'groupBy':
          await this.viewState.setGroupBy(message.value as FindingsGroupBy);
          break;
        case 'sortBy':
          await this.viewState.setSortBy(message.value as FindingsSortBy);
          break;
        case 'nestedGroupBy':
          await this.viewState.setNestedGroupBy(message.value as FindingsNestedGroupBy);
          break;
        case 'pickLayout':
          await vscode.commands.executeCommand('clad-audit.pickFindingsLayout');
          break;
        case 'openExplorer':
          await vscode.commands.executeCommand('clad-audit.openFindingsExplorer');
          break;
        case 'openFilterHelp':
          await vscode.commands.executeCommand('clad-audit.filterSyntaxHelp');
          break;
        case 'openFilterBuilder':
          await vscode.commands.executeCommand('clad-audit.openFilterBuilder');
          break;
        default:
          break;
      }
    });
  }

  focusFilterInput(): boolean {
    if (!this.view) {
      this.pendingFocusFilter = true;
      return false;
    }
    this.postFocusFilter();
    return true;
  }

  syncFilterInput(value: string): void {
    this.view?.webview.postMessage({ type: 'setFilter', value });
  }

  private postFocusFilter(): void {
    this.view?.webview.postMessage({ type: 'focusFilter' });
  }

  private postState(): void {
    if (!this.view) return;
    const config = this.viewState.getConfig();
    this.view.webview.postMessage({
      type: 'state',
      config,
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
  body { margin: 0; padding: 8px 10px 10px; box-sizing: border-box; }
  .row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
  .row.wrap { flex-wrap: wrap; }
  label { font-size: 10px; opacity: 0.75; min-width: 2.4rem; }
  input[type="search"], select {
    flex: 1;
    min-width: 0;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 4px 8px;
    font: inherit;
    font-size: 11px;
  }
  input[type="search"]:focus, select:focus { outline: 1px solid var(--vscode-focusBorder); }
  select { cursor: pointer; }
  .btn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
    font-size: 11px;
  }
  .btn:hover { opacity: 0.9; }
  .btn-icon { padding: 4px 6px; min-width: 28px; }
  .action-row {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    gap: 4px;
    margin: 4px 0 6px;
  }
  .action-row .btn {
    flex: 1 1 33%;
    min-width: 0;
    min-height: 22px;
    padding: 4px 2px;
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
    border: 1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.45));
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
  }
  .action-row .btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
    border-color: var(--vscode-focusBorder, var(--vscode-widget-border));
  }
  .action-row .btn:active {
    opacity: 0.88;
  }
  #nestedRow { display: none; }
  #nestedRow.visible { display: flex; }
  .summary {
    font-size: 10px;
    opacity: 0.65;
    line-height: 1.35;
    margin-top: 4px;
  }
</style>
</head>
<body>
  <div class="row">
    <input type="search" id="filter" placeholder="Filter… (Ctrl+Alt+L)" autocomplete="off" spellcheck="false" />
    <button class="btn btn-icon" id="clearFilter" title="Clear filter">✕</button>
    <button class="btn btn-icon" id="help" title="Filter syntax help">?</button>
    <button class="btn btn-icon" id="builder" title="Filter builder">+</button>
  </div>
  <div class="row wrap">
    <label for="groupBy">Group</label>
    <select id="groupBy" title="Primary grouping"></select>
    <label for="sortBy">Sort</label>
    <select id="sortBy" title="Sort groups"></select>
  </div>
  <div class="row wrap" id="nestedRow">
    <label for="nestedGroupBy">Nest</label>
    <select id="nestedGroupBy" title="Nested under audit root"></select>
  </div>
  <div class="action-row">
    <button class="btn" id="pickLayout" title="All layout options (Ctrl+Alt+G)">Layout…</button>
    <button class="btn" id="openExplorer" title="Open full-page findings explorer">Explorer</button>
    <button class="btn" id="openBuilder" title="Open visual filter builder">Builder</button>
  </div>
  <div class="summary" id="summary"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const els = {
      filter: document.getElementById('filter'),
      clearFilter: document.getElementById('clearFilter'),
      help: document.getElementById('help'),
      builder: document.getElementById('builder'),
      groupBy: document.getElementById('groupBy'),
      sortBy: document.getElementById('sortBy'),
      nestedGroupBy: document.getElementById('nestedGroupBy'),
      nestedRow: document.getElementById('nestedRow'),
      pickLayout: document.getElementById('pickLayout'),
      openExplorer: document.getElementById('openExplorer'),
      openBuilder: document.getElementById('openBuilder'),
      summary: document.getElementById('summary'),
    };

    let debounce = null;
    els.filter.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => vscode.postMessage({ type: 'filter', value: els.filter.value }), 220);
    });
    els.clearFilter.addEventListener('click', () => vscode.postMessage({ type: 'clearFilter' }));
    els.help.addEventListener('click', () => vscode.postMessage({ type: 'openFilterHelp' }));
    els.builder.addEventListener('click', () => vscode.postMessage({ type: 'openFilterBuilder' }));
    els.pickLayout.addEventListener('click', () => vscode.postMessage({ type: 'pickLayout' }));
    els.openExplorer.addEventListener('click', () => vscode.postMessage({ type: 'openExplorer' }));
    els.openBuilder.addEventListener('click', () => vscode.postMessage({ type: 'openFilterBuilder' }));
    els.groupBy.addEventListener('change', () => vscode.postMessage({ type: 'groupBy', value: els.groupBy.value }));
    els.sortBy.addEventListener('change', () => vscode.postMessage({ type: 'sortBy', value: els.sortBy.value }));
    els.nestedGroupBy.addEventListener('change', () => vscode.postMessage({ type: 'nestedGroupBy', value: els.nestedGroupBy.value }));

    function fillSelect(select, labels, value) {
      select.innerHTML = '';
      for (const [k, label] of Object.entries(labels)) {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = label;
        if (k === value) opt.selected = true;
        select.appendChild(opt);
      }
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'focusFilter') {
        els.filter.focus();
        els.filter.select();
        return;
      }
      if (msg.type === 'setFilter') {
        if (document.activeElement !== els.filter) els.filter.value = msg.value || '';
        return;
      }
      if (msg.type !== 'state') return;
      const { config, labels } = msg;
      if (document.activeElement !== els.filter) els.filter.value = config.filterQuery || '';
      fillSelect(els.groupBy, labels.groupBy, config.groupBy);
      fillSelect(els.sortBy, labels.sortBy, config.sortBy);
      fillSelect(els.nestedGroupBy, labels.nested, config.nestedGroupBy);
      els.nestedRow.classList.toggle('visible', config.groupBy === 'root');
      const bits = [labels.groupBy[config.groupBy], labels.sortBy[config.sortBy]];
      if (config.projectConfigSource) bits.push('YAML defaults until you change a control');
      els.summary.textContent = bits.join(' · ');
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

export function registerFindingsToolbarWebview(
  context: vscode.ExtensionContext,
  viewState: FindingsViewState,
): FindingsToolbarWebviewProvider {
  const provider = new FindingsToolbarWebviewProvider(context, viewState);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('clad-audit.findingsToolbar', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    provider,
  );
  return provider;
}
