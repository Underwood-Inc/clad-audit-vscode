import * as vscode from 'vscode';
import type { CladAuditService } from './cladAuditService.js';
import { cladStatusMessage, focusCladView } from './cladUiFeedback.js';
import { describeActiveFilter, filterStoredFindings } from './findingsFilter.js';
import {
  FILTER_BUILDER_FIELDS,
  SEVERITY_QUICK_VALUES,
  TIER_QUICK_VALUES,
  buildFilterSuggestions,
  builderTermsToQuery,
  chipTone,
  hasEquivalentTerm,
  newFilterBuilderTermId,
  parseQueryToBuilderTerms,
  termKey,
  type FilterBuilderTerm,
} from './findingsFilterBuilder.js';
import type { FindingsViewState } from './findingsViewState.js';
import type { FindingsToolbarWebviewProvider } from './findingsToolbarWebview.js';

const PANEL_VIEW_TYPE = 'clad-audit.filterBuilder';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'setTerms'; terms: FilterBuilderTerm[] }
  | { type: 'addSuggestion'; term: Omit<FilterBuilderTerm, 'id'> }
  | { type: 'removeTerm'; id: string }
  | { type: 'toggleExclude'; id: string }
  | { type: 'clearTerms' }
  | { type: 'applySession' }
  | { type: 'applyAndClose' }
  | { type: 'savePreset'; name: string }
  | { type: 'saveDefault' }
  | { type: 'loadPreset'; id: string }
  | { type: 'deletePreset'; id: string }
  | { type: 'loadCurrentFilter' }
  | { type: 'openFilterHelp' }
  | { type: 'openExplore' };

export class CladFilterBuilderPanel {
  private panel: vscode.WebviewPanel | undefined;
  private terms: FilterBuilderTerm[] = [];
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
      this.terms = parseQueryToBuilderTerms(this.viewState.getFilterQuery());
      this.panel.reveal(vscode.ViewColumn.Active, false);
      void this.postState();
      return;
    }

    this.terms = parseQueryToBuilderTerms(this.viewState.getFilterQuery());

    this.panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      'CLAD Filter Builder',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'clad.svg');
    this.panel.webview.html = renderFilterBuilderHtml();

    this.panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'ready':
          await this.postState();
          break;
        case 'setTerms':
          this.terms = message.terms;
          await this.postState();
          break;
        case 'addSuggestion':
          if (hasEquivalentTerm(this.terms, message.term)) {
            await this.postState();
            return;
          }
          this.terms = [...this.terms, { ...message.term, id: newFilterBuilderTermId() }];
          await this.postState();
          break;
        case 'removeTerm':
          this.terms = this.terms.filter((t) => t.id !== message.id);
          await this.postState();
          break;
        case 'toggleExclude':
          this.terms = this.terms.map((t) =>
            t.id === message.id ? { ...t, exclude: !t.exclude } : t,
          );
          await this.postState();
          break;
        case 'clearTerms':
          this.terms = [];
          await this.postState();
          break;
        case 'loadCurrentFilter':
          this.terms = parseQueryToBuilderTerms(this.viewState.getFilterQuery());
          await this.postState();
          break;
        case 'applySession':
          await this.applyQuery(false);
          break;
        case 'applyAndClose':
          await this.applyQuery(true);
          break;
        case 'savePreset': {
          const name = message.name.trim();
          if (!name) {
            cladStatusMessage('Enter a preset name');
            return;
          }
          const query = builderTermsToQuery(this.terms);
          await this.viewState.saveFilterPreset(name, query);
          cladStatusMessage(`Saved preset "${name}"`);
          await this.postState();
          break;
        }
        case 'saveDefault': {
          const query = builderTermsToQuery(this.terms);
          await this.viewState.setDefaultFilter(query);
          cladStatusMessage('Saved as workspace default filter');
          await this.postState();
          break;
        }
        case 'loadPreset': {
          const preset = this.viewState.getFilterPresets().find((p) => p.id === message.id);
          if (!preset) return;
          this.terms = parseQueryToBuilderTerms(preset.query);
          await this.postState();
          break;
        }
        case 'deletePreset':
          await this.viewState.deleteFilterPreset(message.id);
          cladStatusMessage('Preset deleted');
          await this.postState();
          break;
        case 'openFilterHelp':
          await vscode.commands.executeCommand('clad-audit.filterSyntaxHelp');
          break;
        case 'openExplore':
          await focusCladView('clad-audit.findingsToolbar');
          break;
        default:
          break;
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private async applyQuery(close: boolean): Promise<void> {
    const query = builderTermsToQuery(this.terms);
    await this.viewState.setFilterQuery(query);
    this.toolbar.syncFilterInput(query);
    cladStatusMessage(query ? `Filter applied: ${query}` : 'Filter cleared');
    if (close) {
      this.panel?.dispose();
      await focusCladView('clad-audit.findings');
    }
  }

  private async postState(): Promise<void> {
    if (!this.panel) return;
    const config = this.viewState.getConfig();
    const all = this.service.getStoredFindings();
    const query = builderTermsToQuery(this.terms);
    const matched = filterStoredFindings(all, query, { showInfo: config.showInfo });
    const suggestions = buildFilterSuggestions(all);

    this.panel.webview.postMessage({
      type: 'state',
      terms: this.terms.map((term) => ({ ...term, tone: chipTone(term), key: termKey(term) })),
      activeKeys: this.terms.map((t) => termKey(t)),
      query,
      preview: {
        total: all.length,
        matched: matched.length,
        summary: describeActiveFilter(query),
      },
      suggestions,
      presets: this.viewState.getFilterPresets(),
      fields: FILTER_BUILDER_FIELDS,
      tierQuick: TIER_QUICK_VALUES,
      severityQuick: SEVERITY_QUICK_VALUES,
      activeFilter: this.viewState.getFilterQuery(),
    });
  }
}

export function registerCladFilterBuilderPanel(
  context: vscode.ExtensionContext,
  service: CladAuditService,
  viewState: FindingsViewState,
  toolbar: FindingsToolbarWebviewProvider,
): CladFilterBuilderPanel {
  const panel = new CladFilterBuilderPanel(context, service, viewState, toolbar);
  context.subscriptions.push(
    vscode.commands.registerCommand('clad-audit.openFilterBuilder', () => {
      panel.show();
      cladStatusMessage('CLAD Filter Builder');
    }),
    panel,
  );
  return panel;
}

function renderFilterBuilderHtml(): string {
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
    line-height: 1.4;
  }
  body { margin: 0; padding: 18px 22px 28px; max-width: 960px; }
  header { margin-bottom: 1rem; padding-bottom: 0.85rem; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35)); }
  h1 { margin: 0 0 0.35rem; font-size: 1.3rem; font-weight: 600; }
  .lead { margin: 0; opacity: 0.82; font-size: 0.88rem; max-width: 44rem; }
  h2 {
    font-size: 0.68rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.06em; opacity: 0.68; margin: 1.35rem 0 0.5rem;
  }
  .query-box {
    font-family: var(--vscode-editor-font-family);
    font-size: 0.88rem;
    padding: 0.55rem 0.7rem;
    border-radius: 6px;
    background: var(--vscode-textBlockQuote-background, rgba(127,127,127,0.12));
    border-left: 3px solid var(--vscode-textLink-foreground);
    word-break: break-word;
    min-height: 1.2rem;
  }
  .query-box.empty { opacity: 0.55; font-style: italic; }
  .preview { font-size: 0.82rem; opacity: 0.78; margin-top: 0.35rem; }
  .preview strong { color: var(--vscode-textLink-foreground); font-weight: 600; }
  .terms {
    display: flex; flex-wrap: wrap; gap: 0.4rem; min-height: 2rem;
    padding: 0.55rem; border-radius: 8px;
    border: 1px dashed var(--vscode-widget-border, rgba(128,128,128,0.4));
    background: var(--vscode-editor-background);
  }
  .terms.empty::after { content: 'Click suggestions below or add a term'; opacity: 0.5; font-size: 0.8rem; }
  .chip {
    display: inline-flex; align-items: center; gap: 0.25rem;
    padding: 0.22rem 0.5rem; border-radius: 999px; font-size: 0.78rem;
    border: 1px solid transparent;
    background: color-mix(in srgb, var(--tone) 18%, var(--vscode-editor-background));
    color: var(--vscode-foreground);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 35%, transparent);
  }
  .chip .chip-label { color: color-mix(in srgb, var(--tone) 72%, var(--vscode-foreground)); font-weight: 500; }
  .chip.exclude {
    background: color-mix(in srgb, var(--vscode-errorForeground) 10%, transparent);
    border-color: color-mix(in srgb, var(--vscode-errorForeground) 55%, transparent);
    box-shadow: none;
  }
  .chip.exclude .chip-label { color: var(--vscode-errorForeground); text-decoration: line-through; text-decoration-thickness: 1px; }
  .chip.tone-rule { --tone: var(--vscode-charts-red, #f14c4c); }
  .chip.tone-file { --tone: var(--vscode-charts-blue, #3794ff); }
  .chip.tone-root { --tone: var(--vscode-charts-green, #89d185); }
  .chip.tone-message { --tone: var(--vscode-charts-purple, #b180d7); }
  .chip.tone-import { --tone: var(--vscode-charts-orange, #d18616); }
  .chip.tone-advice { --tone: var(--vscode-charts-yellow, #cca700); }
  .chip.tone-text { --tone: var(--vscode-textLink-foreground, #3794ff); }
  .chip.tone-regex { --tone: var(--vscode-symbolIcon-functionForeground, #b180d7); }
  .chip.tone-severity-error { --tone: var(--vscode-errorForeground, #f14c4c); }
  .chip.tone-severity-warning { --tone: var(--vscode-editorWarning-foreground, #cca700); }
  .chip.tone-severity-info { --tone: var(--vscode-descriptionForeground, #9cdcfe); }
  .chip.tone-tier-apps { --tone: #c586c0; }
  .chip.tone-tier-views { --tone: #4fc1ff; }
  .chip.tone-tier-organisms { --tone: #ce9178; }
  .chip.tone-tier-molecules { --tone: #4ec9b0; }
  .chip.tone-tier-atoms { --tone: #9cdcfe; }
  .chip.tone-tier-sockets { --tone: #dcdcaa; }
  .chip.tone-tier-plugs { --tone: #d7ba7d; }
  .chip.tone-tier-recipes { --tone: #c8a2c8; }
  .chip.tone-tier-unknown { --tone: #808080; }
  .chip.tone-tier { --tone: var(--vscode-charts-blue, #3794ff); }
  .chip.tone-severity { --tone: var(--vscode-charts-orange, #d18616); }
  .chip button {
    background: none; border: none; color: inherit; cursor: pointer;
    padding: 0 0.15rem; font: inherit; opacity: 0.75; line-height: 1;
  }
  .chip button:hover { opacity: 1; }
  .chip .toggle { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.85; }
  .section-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem; }
  .suggest-group { margin-bottom: 0.25rem; }
  .suggest-label { font-size: 0.72rem; opacity: 0.65; margin-bottom: 0.3rem; }
  .suggest-label.cat-rule { color: var(--vscode-charts-red, #f14c4c); opacity: 0.85; }
  .suggest-label.cat-tier { color: var(--vscode-charts-blue, #3794ff); opacity: 0.85; }
  .suggest-label.cat-severity { color: var(--vscode-charts-orange, #d18616); opacity: 0.85; }
  .suggest-label.cat-file { color: var(--vscode-charts-blue, #3794ff); opacity: 0.85; }
  .suggest-label.cat-root { color: var(--vscode-charts-green, #89d185); opacity: 0.85; }
  .chips-row { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .suggest-chip {
    font-size: 0.75rem; padding: 0.2rem 0.55rem; border-radius: 999px; cursor: pointer;
    border: 1px solid color-mix(in srgb, var(--tone) 40%, transparent);
    background: color-mix(in srgb, var(--tone) 14%, var(--vscode-editor-background));
    color: color-mix(in srgb, var(--tone) 80%, var(--vscode-foreground));
    font: inherit;
    transition: opacity 0.12s ease, transform 0.12s ease;
  }
  .suggest-chip:hover:not(:disabled) {
    background: color-mix(in srgb, var(--tone) 24%, var(--vscode-editor-background));
    transform: translateY(-1px);
  }
  .suggest-chip.added {
    cursor: default;
    opacity: 0.52;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-color: transparent;
    box-shadow: inset 0 0 0 1px var(--vscode-widget-border, rgba(128,128,128,0.35));
  }
  .suggest-chip.added::after { content: ' ✓'; opacity: 0.85; }
  .suggest-chip:disabled { pointer-events: none; }
  .suggest-chip .count {
    opacity: 0.72; margin-left: 0.25rem;
    font-size: 0.68rem;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--tone) 20%, transparent);
  }
  .suggest-chip.tone-rule { --tone: var(--vscode-charts-red, #f14c4c); }
  .suggest-chip.tone-file { --tone: var(--vscode-charts-blue, #3794ff); }
  .suggest-chip.tone-root { --tone: var(--vscode-charts-green, #89d185); }
  .suggest-chip.tone-tier { --tone: var(--vscode-charts-blue, #3794ff); }
  .suggest-chip.tone-severity { --tone: var(--vscode-charts-orange, #d18616); }
  .suggest-chip.tone-severity-error { --tone: var(--vscode-errorForeground, #f14c4c); }
  .suggest-chip.tone-severity-warning { --tone: var(--vscode-editorWarning-foreground, #cca700); }
  .suggest-chip.tone-severity-info { --tone: var(--vscode-descriptionForeground, #9cdcfe); }
  .suggest-chip.tone-tier-apps { --tone: #c586c0; }
  .suggest-chip.tone-tier-views { --tone: #4fc1ff; }
  .suggest-chip.tone-tier-organisms { --tone: #ce9178; }
  .suggest-chip.tone-tier-molecules { --tone: #4ec9b0; }
  .suggest-chip.tone-tier-atoms { --tone: #9cdcfe; }
  .suggest-chip.tone-tier-sockets { --tone: #dcdcaa; }
  .suggest-chip.tone-tier-plugs { --tone: #d7ba7d; }
  .suggest-chip.tone-tier-recipes { --tone: #c8a2c8; }
  .suggest-chip.tone-tier-unknown { --tone: #808080; }
  .add-row { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: center; margin-top: 0.35rem; }
  input, select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px; padding: 0.35rem 0.5rem; font: inherit; font-size: 0.82rem;
  }
  input { flex: 1; min-width: 140px; }
  .btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; padding: 0.35rem 0.65rem;
    font: inherit; font-size: 0.78rem; cursor: pointer;
  }
  .btn.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn:hover { opacity: 0.92; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 1rem; }
  .presets { list-style: none; margin: 0; padding: 0; }
  .presets li {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    padding: 0.45rem 0.55rem; border-radius: 6px; margin-bottom: 0.35rem;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
    font-size: 0.82rem;
  }
  .presets code { font-family: var(--vscode-editor-font-family); font-size: 0.78rem; opacity: 0.85; }
  .preset-actions { display: flex; gap: 0.35rem; flex-shrink: 0; }
  .quick-picks { display: flex; flex-wrap: wrap; gap: 0.35rem; }
</style>
</head>
<body>
  <header>
    <h1>Filter builder</h1>
    <p class="lead">Click chips to build an AND filter. Toggle exclude on any term. Apply to the session or save a preset for this workspace.</p>
  </header>

  <section>
    <h2>Active query</h2>
    <div class="query-box empty" id="queryPreview">(empty — all findings)</div>
    <div class="preview" id="matchPreview"></div>
  </section>

  <section>
    <h2>Terms</h2>
    <div class="terms empty" id="terms"></div>
    <div class="add-row">
      <select id="fieldSelect" title="Field"></select>
      <input id="fieldValue" placeholder="Value…" spellcheck="false" />
      <label><input type="checkbox" id="fieldExclude" /> Exclude</label>
      <button type="button" class="btn secondary" id="addField">Add field</button>
      <input id="textValue" placeholder="Free text…" spellcheck="false" />
      <button type="button" class="btn secondary" id="addText">Add text</button>
    </div>
    <div class="actions">
      <button type="button" class="btn secondary" id="clearTerms">Clear all</button>
      <button type="button" class="btn secondary" id="loadCurrent">Load session filter</button>
    </div>
  </section>

  <section>
    <h2>Quick picks</h2>
    <div class="quick-picks" id="tierQuick"></div>
    <div class="quick-picks" id="severityQuick" style="margin-top:0.35rem"></div>
  </section>

  <section>
    <h2>From current findings</h2>
    <div class="section-grid" id="suggestions"></div>
  </section>

  <section>
    <h2>Saved presets</h2>
    <ul class="presets" id="presets"></ul>
    <div class="add-row">
      <input id="presetName" placeholder="Preset name…" spellcheck="false" />
      <button type="button" class="btn secondary" id="savePreset">Save preset</button>
      <button type="button" class="btn secondary" id="saveDefault">Save as workspace default</button>
    </div>
  </section>

  <div class="actions">
    <button type="button" class="btn" id="apply">Apply to session</button>
    <button type="button" class="btn" id="applyClose">Apply &amp; close</button>
    <button type="button" class="btn secondary" id="filterHelp">Filter syntax help</button>
    <button type="button" class="btn secondary" id="openExplore">Open Explore</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let terms = [];
    let activeKeys = new Set();

    const els = {
      queryPreview: document.getElementById('queryPreview'),
      matchPreview: document.getElementById('matchPreview'),
      terms: document.getElementById('terms'),
      fieldSelect: document.getElementById('fieldSelect'),
      fieldValue: document.getElementById('fieldValue'),
      fieldExclude: document.getElementById('fieldExclude'),
      textValue: document.getElementById('textValue'),
      suggestions: document.getElementById('suggestions'),
      presets: document.getElementById('presets'),
      presetName: document.getElementById('presetName'),
      tierQuick: document.getElementById('tierQuick'),
      severityQuick: document.getElementById('severityQuick'),
    };

    function termKey(term) {
      const ex = term.exclude ? '1' : '0';
      if (term.kind === 'field' && term.field) {
        return 'field:' + term.field + ':' + term.value.toLowerCase() + ':' + ex;
      }
      if (term.kind === 'regex') return 'regex:' + term.value + ':' + ex;
      return 'text:' + term.value.toLowerCase() + ':' + ex;
    }

    function chipTone(term) {
      if (term.kind === 'field' && term.field === 'severity') {
        const sev = term.value.toLowerCase();
        if (sev === 'error' || sev === 'warning' || sev === 'info') return 'severity-' + sev;
      }
      if (term.kind === 'field' && term.field === 'tier') {
        const tier = term.value.toLowerCase();
        if (['apps','views','organisms','molecules','atoms','sockets','plugs','recipes','unknown'].includes(tier)) {
          return 'tier-' + tier;
        }
        return 'tier';
      }
      if (term.kind === 'field' && term.field) return term.field;
      return term.kind;
    }

    function renderTermChip(term) {
      const chip = document.createElement('span');
      const tone = term.tone || chipTone(term);
      chip.className = 'chip tone-' + tone + (term.exclude ? ' exclude' : '');
      const label = term.kind === 'field' && term.field
        ? (term.exclude ? 'NOT ' : '') + term.field + ': ' + term.value
        : (term.exclude ? 'NOT ' : '') + term.value;
      chip.innerHTML = '<span class="chip-label">' + escapeHtml(label) + '</span>' +
        '<button type="button" class="toggle" title="Toggle exclude">±</button>' +
        '<button type="button" class="remove" title="Remove">×</button>';
      chip.querySelector('.toggle').addEventListener('click', () => {
        vscode.postMessage({ type: 'toggleExclude', id: term.id });
      });
      chip.querySelector('.remove').addEventListener('click', () => {
        vscode.postMessage({ type: 'removeTerm', id: term.id });
      });
      return chip;
    }

    function renderSuggestChip(chip, groupTone) {
      const key = termKey(chip.term);
      const added = activeKeys.has(key);
      const tone = chipTone(chip.term);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'suggest-chip tone-' + (tone.startsWith('tier-') || tone.startsWith('severity-') ? tone : groupTone);
      if (added) {
        btn.classList.add('added');
        btn.disabled = true;
        btn.title = 'Already in filter';
      }
      btn.innerHTML = escapeHtml(chip.label) + '<span class="count">' + chip.count + '</span>';
      if (!added) {
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'addSuggestion', term: chip.term });
        });
      }
      return btn;
    }

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function renderSuggestions(groups) {
      els.suggestions.innerHTML = '';
      const sections = [
        ['Rules', 'rule', groups.rules],
        ['Tiers', 'tier', groups.tiers],
        ['Severity', 'severity', groups.severities],
        ['File paths', 'file', groups.files],
        ['Audit roots', 'root', groups.roots],
      ];
      for (const [label, cat, chips] of sections) {
        if (!chips || chips.length === 0) continue;
        const block = document.createElement('div');
        block.className = 'suggest-group';
        block.innerHTML = '<div class="suggest-label cat-' + cat + '">' + escapeHtml(label) + '</div>';
        const row = document.createElement('div');
        row.className = 'chips-row';
        for (const chip of chips) {
          row.appendChild(renderSuggestChip(chip, cat));
        }
        block.appendChild(row);
        els.suggestions.appendChild(block);
      }
    }

    function renderPresets(presets) {
      els.presets.innerHTML = '';
      if (!presets.length) {
        const li = document.createElement('li');
        li.style.opacity = '0.6';
        li.textContent = 'No saved presets yet.';
        els.presets.appendChild(li);
        return;
      }
      for (const preset of presets) {
        const li = document.createElement('li');
        li.innerHTML = '<div><strong>' + escapeHtml(preset.name) + '</strong><br><code>' + escapeHtml(preset.query || '(empty)') + '</code></div>';
        const actions = document.createElement('div');
        actions.className = 'preset-actions';
        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'btn secondary';
        load.textContent = 'Load';
        load.addEventListener('click', () => vscode.postMessage({ type: 'loadPreset', id: preset.id }));
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn secondary';
        del.textContent = 'Delete';
        del.addEventListener('click', () => vscode.postMessage({ type: 'deletePreset', id: preset.id }));
        actions.appendChild(load);
        actions.appendChild(del);
        li.appendChild(actions);
        els.presets.appendChild(li);
      }
    }

    function renderQuick(container, values, field, groupTone) {
      container.innerHTML = '';
      for (const value of values) {
        const term = { kind: 'field', field, value, exclude: false };
        const key = termKey(term);
        const added = activeKeys.has(key);
        const tone = chipTone(term);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'suggest-chip tone-' + (tone.startsWith('tier-') || tone.startsWith('severity-') ? tone : groupTone);
        btn.textContent = value;
        if (added) {
          btn.classList.add('added');
          btn.disabled = true;
          btn.title = 'Already in filter';
        } else {
          btn.addEventListener('click', () => {
            vscode.postMessage({ type: 'addSuggestion', term });
          });
        }
        container.appendChild(btn);
      }
    }

    document.getElementById('addField').addEventListener('click', () => {
      const value = els.fieldValue.value.trim();
      if (!value) return;
      vscode.postMessage({
        type: 'addSuggestion',
        term: {
          kind: 'field',
          field: els.fieldSelect.value,
          value,
          exclude: els.fieldExclude.checked,
        },
      });
      els.fieldValue.value = '';
      els.fieldExclude.checked = false;
    });

    document.getElementById('addText').addEventListener('click', () => {
      const value = els.textValue.value.trim();
      if (!value) return;
      vscode.postMessage({
        type: 'addSuggestion',
        term: { kind: 'text', value, exclude: false },
      });
      els.textValue.value = '';
    });

    document.getElementById('clearTerms').addEventListener('click', () => vscode.postMessage({ type: 'clearTerms' }));
    document.getElementById('loadCurrent').addEventListener('click', () => vscode.postMessage({ type: 'loadCurrentFilter' }));
    document.getElementById('apply').addEventListener('click', () => vscode.postMessage({ type: 'applySession' }));
    document.getElementById('applyClose').addEventListener('click', () => vscode.postMessage({ type: 'applyAndClose' }));
    document.getElementById('savePreset').addEventListener('click', () => {
      vscode.postMessage({ type: 'savePreset', name: els.presetName.value });
    });
    document.getElementById('saveDefault').addEventListener('click', () => vscode.postMessage({ type: 'saveDefault' }));
    document.getElementById('filterHelp').addEventListener('click', () => vscode.postMessage({ type: 'openFilterHelp' }));
    document.getElementById('openExplore').addEventListener('click', () => vscode.postMessage({ type: 'openExplore' }));

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type !== 'state') return;
      terms = msg.terms || [];
      activeKeys = new Set(msg.activeKeys || terms.map((t) => t.key || termKey(t)));
      els.terms.innerHTML = '';
      els.terms.classList.toggle('empty', terms.length === 0);
      for (const term of terms) els.terms.appendChild(renderTermChip(term));

      const q = msg.query || '';
      els.queryPreview.textContent = q || '(empty — all findings)';
      els.queryPreview.classList.toggle('empty', !q);
      const p = msg.preview || {};
      els.matchPreview.innerHTML = '<strong>' + (p.matched ?? 0) + '</strong> of <strong>' + (p.total ?? 0) +
        '</strong> findings match' + (p.summary ? ' · ' + escapeHtml(p.summary) : '');

      if (msg.fields && els.fieldSelect.options.length === 0) {
        for (const f of msg.fields) {
          const opt = document.createElement('option');
          opt.value = f.field;
          opt.textContent = f.label;
          els.fieldSelect.appendChild(opt);
        }
      }
      renderSuggestions(msg.suggestions || {});
      renderPresets(msg.presets || []);
      renderQuick(els.tierQuick, msg.tierQuick || [], 'tier', 'tier');
      renderQuick(els.severityQuick, msg.severityQuick || [], 'severity', 'severity');
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
