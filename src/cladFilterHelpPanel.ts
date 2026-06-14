import * as vscode from 'vscode';
import {
  FILTER_HELP_EXAMPLES,
  FILTER_HELP_FIELDS,
  FILTER_HELP_INTRO,
  FILTER_HELP_TIPS,
  formatFilterHelpFieldAliases,
} from './findingsFilterHelpContent.js';
import { cladStatusMessage, focusCladView } from './cladUiFeedback.js';
import type { FindingsViewState } from './findingsViewState.js';
import type { FindingsToolbarWebviewProvider } from './findingsToolbarWebview.js';

const PANEL_VIEW_TYPE = 'clad-audit.filterHelp';

type WebviewMessage =
  | { type: 'copy'; text: string }
  | { type: 'tryFilter'; text: string }
  | { type: 'openExplore' }
  | { type: 'openBuilder' };

export class CladFilterHelpPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly viewState: FindingsViewState,
    private readonly toolbar: FindingsToolbarWebviewProvider,
  ) {}

  show(): void {
    const custom = vscode.workspace
      .getConfiguration('cladAudit.findings')
      .get<string>('filterSyntax')
      ?.trim();

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active, false);
      this.panel.webview.html = renderFilterHelpHtml(custom);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      'CLAD Filter Syntax',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'clad.svg');
    this.panel.webview.html = renderFilterHelpHtml(custom);

    this.panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'copy':
          await vscode.env.clipboard.writeText(message.text);
          cladStatusMessage(`Copied: ${message.text}`);
          break;
        case 'tryFilter':
          await this.viewState.setFilterQuery(message.text);
          this.toolbar.syncFilterInput(message.text);
          await focusCladView('clad-audit.findingsToolbar');
          cladStatusMessage(`Filter applied: ${message.text}`);
          break;
        case 'openExplore':
          await focusCladView('clad-audit.findingsToolbar');
          break;
        case 'openBuilder':
          await vscode.commands.executeCommand('clad-audit.openFilterBuilder');
          break;
        default:
          break;
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }
}

export function registerCladFilterHelpPanel(
  context: vscode.ExtensionContext,
  viewState: FindingsViewState,
  toolbar: FindingsToolbarWebviewProvider,
): CladFilterHelpPanel {
  const panel = new CladFilterHelpPanel(context, viewState, toolbar);
  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.filterSyntaxHelp', () => {
      panel.show();
    }),
  );
  return panel;
}

function renderFilterHelpHtml(customOverride?: string): string {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';";

  const exampleCards = FILTER_HELP_EXAMPLES.map(
    (ex) => `
    <article class="card">
      <div class="card-head">
        <h3>${escapeHtml(ex.label)}</h3>
        <div class="card-actions">
          <button type="button" class="btn secondary copy-btn" data-copy="${escapeAttr(ex.query)}">Copy</button>
          <button type="button" class="btn try-btn" data-try="${escapeAttr(ex.query)}">Try</button>
        </div>
      </div>
      <code class="query">${escapeHtml(ex.query)}</code>
      <p class="desc">${escapeHtml(ex.description)}</p>
    </article>`,
  ).join('');

  const fieldRows = FILTER_HELP_FIELDS.map(
    (f) => `
    <tr>
      <td><code>${escapeHtml(formatFilterHelpFieldAliases(f))}</code></td>
      <td>${escapeHtml(f.description)}</td>
      <td><code class="example">${escapeHtml(f.example)}</code></td>
    </tr>`,
  ).join('');

  const tips = FILTER_HELP_TIPS.map((t) => `<li>${escapeHtml(t)}</li>`).join('');

  const customBlock = customOverride
    ? `<section class="section custom">
        <h2>Project override</h2>
        <p class="lead">Your workspace replaces the built-in help via <code>cladAudit.findings.filterSyntax</code>.</p>
        <pre class="custom-body">${escapeHtml(customOverride)}</pre>
      </section>`
    : '';

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
    line-height: 1.45;
  }
  body {
    margin: 0;
    padding: 20px 24px 32px;
    max-width: 920px;
  }
  header {
    margin-bottom: 1.25rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35));
  }
  h1 {
    font-size: 1.35rem;
    font-weight: 600;
    margin: 0 0 0.35rem;
    letter-spacing: -0.01em;
  }
  .lead { margin: 0; opacity: 0.85; max-width: 52rem; }
  .pill-row { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.85rem; }
  .pill {
    font-size: 0.75rem;
    padding: 0.15rem 0.55rem;
    border-radius: 999px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  h2 {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.72;
    margin: 1.75rem 0 0.65rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 0.75rem;
  }
  .card {
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35));
    border-radius: 8px;
    padding: 0.75rem 0.85rem;
    background: var(--vscode-editor-background);
  }
  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.45rem;
  }
  .card h3 {
    margin: 0;
    font-size: 0.88rem;
    font-weight: 600;
  }
  .card-actions { display: flex; gap: 0.35rem; flex-shrink: 0; }
  .query {
    display: block;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.82rem;
    padding: 0.35rem 0.5rem;
    border-radius: 4px;
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.12));
    border-left: 3px solid var(--vscode-textLink-foreground);
    margin-bottom: 0.45rem;
    word-break: break-word;
  }
  .desc { margin: 0; font-size: 0.78rem; opacity: 0.78; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }
  th, td {
    text-align: left;
    vertical-align: top;
    padding: 0.45rem 0.55rem;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
  }
  th {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.65;
    font-weight: 600;
  }
  td code.example { opacity: 0.9; white-space: nowrap; }
  code {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.92em;
  }
  .syntax-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.65rem;
    margin-top: 0.35rem;
  }
  .syntax-item {
    padding: 0.55rem 0.65rem;
    border-radius: 6px;
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.1));
    font-size: 0.8rem;
  }
  .syntax-item strong {
    display: block;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.65;
    margin-bottom: 0.25rem;
  }
  .syntax-item .hint {
    opacity: 0.7;
    margin-top: 0.2rem;
    font-size: 0.75rem;
  }
  ul.tips {
    margin: 0.35rem 0 0;
    padding-left: 1.1rem;
    font-size: 0.82rem;
    opacity: 0.88;
  }
  ul.tips li { margin-bottom: 0.35rem; }
  .btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 0.25rem 0.55rem;
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
  }
  .btn.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn:hover { opacity: 0.92; }
  .footer-actions { margin-top: 1.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .custom-body {
    white-space: pre-wrap;
    font-family: var(--vscode-editor-font-family);
    font-size: 0.82rem;
    padding: 0.75rem;
    border-radius: 6px;
    background: var(--vscode-textBlockQuote-background);
    margin: 0;
  }
</style>
</head>
<body>
  <header>
    <h1>Filter CLAD findings</h1>
    <p class="lead">${escapeHtml(FILTER_HELP_INTRO)}</p>
    <div class="pill-row">
      <span class="pill">AND logic</span>
      <span class="pill">field:value</span>
      <span class="pill">-exclude</span>
      <span class="pill">/regex/i</span>
      <span class="pill">Ctrl+Alt+L</span>
    </div>
  </header>

  ${customBlock}

  <section class="section">
    <h2>Quick recipes</h2>
    <div class="grid">${exampleCards}</div>
  </section>

  <section class="section">
    <h2>Syntax at a glance</h2>
    <div class="syntax-grid">
      <div class="syntax-item">
        <strong>Free text</strong>
        <code>import-boundary</code>
        <div class="hint">Matches any field</div>
      </div>
      <div class="syntax-item">
        <strong>Field filter</strong>
        <code>rule:import-boundary</code>
      </div>
      <div class="syntax-item">
        <strong>Exclude</strong>
        <code>-tier:apps</code>
      </div>
      <div class="syntax-item">
        <strong>Regex</strong>
        <code>/import.*boundary/i</code>
      </div>
    </div>
  </section>

  <section class="section">
    <h2>Fields reference</h2>
    <table>
      <thead>
        <tr><th>Field</th><th>Matches</th><th>Example</th></tr>
      </thead>
      <tbody>${fieldRows}</tbody>
    </table>
  </section>

  <section class="section">
    <h2>Tips</h2>
    <ul class="tips">${tips}</ul>
  </section>

  <div class="footer-actions">
    <button type="button" class="btn" id="openBuilder">Open filter builder</button>
    <button type="button" class="btn secondary" id="openExplore">Open Explore filter</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'copy', text: btn.dataset.copy || '' });
      });
    });
    document.querySelectorAll('.try-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ type: 'tryFilter', text: btn.dataset.try || '' });
      });
    });
    document.getElementById('openExplore')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openExplore' });
    });
    document.getElementById('openBuilder')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'openBuilder' });
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, '&#39;');
}
