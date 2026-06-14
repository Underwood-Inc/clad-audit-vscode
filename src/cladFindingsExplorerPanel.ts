import * as vscode from 'vscode';
import type { CladAuditService } from './cladAuditService.js';
import { cladStatusMessage, focusCladView } from './cladUiFeedback.js';
import { buildFindingsExplorerSnapshot } from './findingsExplorerTree.js';
import type { FindingsViewState } from './findingsViewState.js';
import type { FindingsToolbarWebviewProvider } from './findingsToolbarWebview.js';
import {
  FINDINGS_GROUP_BY_LABEL,
  FINDINGS_NESTED_LABEL,
  FINDINGS_SORT_BY_LABEL,
  type FindingsGroupBy,
  type FindingsNestedGroupBy,
  type FindingsSortBy,
} from './findingsViewTypes.js';

const PANEL_VIEW_TYPE = 'clad-audit.findingsExplorer';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'filter'; value: string }
  | { type: 'groupBy'; value: FindingsGroupBy }
  | { type: 'sortBy'; value: FindingsSortBy }
  | { type: 'nestedGroupBy'; value: FindingsNestedGroupBy }
  | { type: 'reveal'; findingId: string }
  | { type: 'pickLayout' }
  | { type: 'filterHelp' }
  | { type: 'filterBuilder' }
  | { type: 'refresh' }
  | { type: 'openSidebar' };

export class CladFindingsExplorerPanel {
  private panel: vscode.WebviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly service: CladAuditService,
    private readonly viewState: FindingsViewState,
    private readonly toolbar: FindingsToolbarWebviewProvider,
  ) {
    const refresh = (): void => {
      void this.postState();
    };
    this.disposables.push(service.onDidChange(refresh), viewState.onDidChange(refresh));
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.panel?.dispose();
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, false);
      void this.postState();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      'CLAD Findings Explorer',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'clad.svg');
    this.panel.webview.html = renderFindingsExplorerHtml();

    this.panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'ready':
          await this.postState();
          break;
        case 'filter':
          await this.viewState.setFilterQuery(message.value);
          this.toolbar.syncFilterInput(message.value);
          await this.postState();
          break;
        case 'groupBy':
          await this.viewState.setGroupBy(message.value);
          await this.postState();
          break;
        case 'sortBy':
          await this.viewState.setSortBy(message.value);
          await this.postState();
          break;
        case 'nestedGroupBy':
          await this.viewState.setNestedGroupBy(message.value);
          await this.postState();
          break;
        case 'reveal':
          await this.service.revealFinding(message.findingId);
          break;
        case 'pickLayout':
          await vscode.commands.executeCommand('clad-audit.pickFindingsLayout');
          await this.postState();
          break;
        case 'filterHelp':
          await vscode.commands.executeCommand('clad-audit.filterSyntaxHelp');
          break;
        case 'filterBuilder':
          await vscode.commands.executeCommand('clad-audit.openFilterBuilder');
          break;
        case 'refresh':
          await vscode.commands.executeCommand('clad-audit.auditWorkspaceWithFeedback');
          break;
        case 'openSidebar':
          await focusCladView('clad-audit.findings');
          break;
        default:
          break;
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private async postState(): Promise<void> {
    if (!this.panel) return;
    const config = this.viewState.getConfig();
    const snapshot = buildFindingsExplorerSnapshot(this.service.getStoredFindings(), config);
    this.panel.webview.postMessage({
      type: 'state',
      config,
      snapshot,
      labels: {
        groupBy: FINDINGS_GROUP_BY_LABEL,
        sortBy: FINDINGS_SORT_BY_LABEL,
        nested: FINDINGS_NESTED_LABEL,
      },
    });
  }
}

export function registerCladFindingsExplorerPanel(
  context: vscode.ExtensionContext,
  service: CladAuditService,
  viewState: FindingsViewState,
  toolbar: FindingsToolbarWebviewProvider,
): CladFindingsExplorerPanel {
  const panel = new CladFindingsExplorerPanel(context, service, viewState, toolbar);
  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.openFindingsExplorer', () => {
      panel.show();
      cladStatusMessage('CLAD Findings Explorer');
    }),
    panel,
  );
  return panel;
}

function renderFindingsExplorerHtml(): string {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root {
    color: var(--vscode-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  body { margin: 0; display: flex; flex-direction: column; height: 100vh; }
  header {
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35));
    flex-shrink: 0;
  }
  h1 { margin: 0 0 4px; font-size: 1.35rem; font-weight: 600; }
  .lead { margin: 0 0 12px; opacity: 0.8; font-size: 0.88rem; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  input[type="search"], select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px;
    padding: 5px 8px;
    font: inherit;
    font-size: 12px;
  }
  #filter { flex: 1; min-width: 200px; }
  select { cursor: pointer; }
  .summary {
    margin-top: 10px;
    font-size: 0.78rem;
    opacity: 0.75;
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1));
  }
  main {
    flex: 1;
    overflow: auto;
    padding: 12px 16px 20px;
  }
  .empty {
    opacity: 0.65;
    padding: 2rem;
    text-align: center;
    font-size: 0.9rem;
  }
  .tree { list-style: none; margin: 0; padding: 0; }
  .tree ul { list-style: none; margin: 0; padding-left: 1.1rem; border-left: 1px solid rgba(128,128,128,0.2); }
  .tree li { margin: 2px 0; }
  .group-row, .finding-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 0.84rem;
  }
  .finding-row { cursor: pointer; }
  .finding-row:hover, .group-row:hover { background: var(--vscode-list-hoverBackground); }
  .toggle {
    background: none; border: none; color: inherit; cursor: pointer;
    width: 18px; padding: 0; font-size: 10px; opacity: 0.7;
  }
  .label { font-weight: 500; }
  .count {
    font-size: 0.72rem; opacity: 0.65;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    padding: 1px 6px; border-radius: 999px;
  }
  .detail { font-size: 0.75rem; opacity: 0.72; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sev-error { color: var(--vscode-errorForeground, #f48771); }
  .sev-warning { color: var(--vscode-editorWarning-foreground, #cca700); }
  .sev-info { color: var(--vscode-descriptionForeground); }
  footer {
    flex-shrink: 0;
    padding: 10px 20px;
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35));
    display: flex; flex-wrap: wrap; gap: 8px;
  }
  .btn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none; border-radius: 4px; padding: 5px 10px; font: inherit; font-size: 11px; cursor: pointer;
  }
  .btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn:hover { opacity: 0.92; }
  #nestedWrap { display: none; }
  #nestedWrap.visible { display: inline-flex; align-items: center; gap: 6px; }
  #nestedWrap label { font-size: 11px; opacity: 0.75; }
</style>
</head>
<body>
  <header>
    <h1>CLAD Findings Explorer</h1>
    <p class="lead">Full-page tree — syncs with the sidebar. Click a finding to jump to source.</p>
    <div class="toolbar">
      <input type="search" id="filter" placeholder="Filter findings…" spellcheck="false" />
      <label for="groupBy" style="font-size:11px;opacity:.75">Group</label>
      <select id="groupBy"></select>
      <label for="sortBy" style="font-size:11px;opacity:.75">Sort</label>
      <select id="sortBy"></select>
      <span id="nestedWrap"><label for="nestedGroupBy">Nest</label><select id="nestedGroupBy"></select></span>
      <button class="btn" id="pickLayout" title="All layout options">Layout…</button>
    </div>
    <div class="summary" id="summary"></div>
  </header>
  <main><div id="treeHost"></div></main>
  <footer>
    <button class="btn primary" id="refresh">Re-run audit</button>
    <button class="btn" id="filterHelp">Filter syntax help</button>
    <button class="btn" id="filterBuilder">Filter builder</button>
    <button class="btn" id="openSidebar">Open sidebar Findings</button>
  </footer>
  <script>
    const vscode = acquireVsCodeApi();
    const els = {
      filter: document.getElementById('filter'),
      groupBy: document.getElementById('groupBy'),
      sortBy: document.getElementById('sortBy'),
      nestedGroupBy: document.getElementById('nestedGroupBy'),
      nestedWrap: document.getElementById('nestedWrap'),
      summary: document.getElementById('summary'),
      treeHost: document.getElementById('treeHost'),
      pickLayout: document.getElementById('pickLayout'),
      refresh: document.getElementById('refresh'),
      filterHelp: document.getElementById('filterHelp'),
      filterBuilder: document.getElementById('filterBuilder'),
      openSidebar: document.getElementById('openSidebar'),
    };

    let debounce = null;
    els.filter.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => vscode.postMessage({ type: 'filter', value: els.filter.value }), 220);
    });
    els.groupBy.addEventListener('change', () => vscode.postMessage({ type: 'groupBy', value: els.groupBy.value }));
    els.sortBy.addEventListener('change', () => vscode.postMessage({ type: 'sortBy', value: els.sortBy.value }));
    els.nestedGroupBy.addEventListener('change', () => vscode.postMessage({ type: 'nestedGroupBy', value: els.nestedGroupBy.value }));
    els.pickLayout.addEventListener('click', () => vscode.postMessage({ type: 'pickLayout' }));
    els.refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    els.filterHelp.addEventListener('click', () => vscode.postMessage({ type: 'filterHelp' }));
    els.filterBuilder.addEventListener('click', () => vscode.postMessage({ type: 'filterBuilder' }));
    els.openSidebar.addEventListener('click', () => vscode.postMessage({ type: 'openSidebar' }));

    function fillSelect(select, map, value) {
      select.innerHTML = '';
      for (const [k, label] of Object.entries(map)) {
        const opt = document.createElement('option');
        opt.value = k; opt.textContent = label;
        if (k === value) opt.selected = true;
        select.appendChild(opt);
      }
    }

    function renderNodes(nodes, depth) {
      if (!nodes || nodes.length === 0) return null;
      const ul = document.createElement('ul');
      ul.className = depth === 0 ? 'tree' : '';
      for (const node of nodes) {
        const li = document.createElement('li');
        if (node.kind === 'group') {
          const row = document.createElement('div');
          row.className = 'group-row';
          const toggle = document.createElement('button');
          toggle.className = 'toggle';
          toggle.textContent = '▼';
          toggle.type = 'button';
          const label = document.createElement('span');
          label.className = 'label' + (node.severity ? ' sev-' + node.severity : '');
          label.textContent = node.label;
          const count = document.createElement('span');
          count.className = 'count';
          count.textContent = String(node.count ?? 0);
          row.appendChild(toggle);
          row.appendChild(label);
          row.appendChild(count);
          li.appendChild(row);
          const childUl = renderNodes(node.children || [], depth + 1);
          if (childUl) {
            li.appendChild(childUl);
            toggle.addEventListener('click', () => {
              const open = childUl.style.display !== 'none';
              childUl.style.display = open ? 'none' : '';
              toggle.textContent = open ? '▶' : '▼';
            });
          } else {
            toggle.textContent = '·';
            toggle.disabled = true;
          }
        } else {
          const row = document.createElement('div');
          row.className = 'finding-row sev-' + (node.severity || 'info');
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = node.label;
          const detail = document.createElement('span');
          detail.className = 'detail';
          detail.textContent = node.detail || '';
          row.appendChild(label);
          row.appendChild(detail);
          row.title = node.detail || node.label;
          row.addEventListener('click', () => vscode.postMessage({ type: 'reveal', findingId: node.findingId }));
          li.appendChild(row);
        }
        ul.appendChild(li);
      }
      return ul;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type !== 'state') return;
      const { config, snapshot, labels } = msg;
      if (document.activeElement !== els.filter) els.filter.value = config.filterQuery || '';
      fillSelect(els.groupBy, labels.groupBy, config.groupBy);
      fillSelect(els.sortBy, labels.sortBy, config.sortBy);
      fillSelect(els.nestedGroupBy, labels.nested, config.nestedGroupBy);
      els.nestedWrap.classList.toggle('visible', config.groupBy === 'root');
      els.summary.textContent = snapshot.summary + (snapshot.visible ? ' · click a row to reveal in editor' : '');
      els.treeHost.innerHTML = '';
      if (snapshot.nodes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = snapshot.total === 0 ? 'Run CLAD audit to populate findings.' : 'No findings match the current filter.';
        els.treeHost.appendChild(empty);
      } else {
        els.treeHost.appendChild(renderNodes(snapshot.nodes, 0));
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
