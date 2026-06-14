# CLAD Audit (VS Code / Cursor)

<img width="3840" height="2160" alt="image" src="https://github.com/user-attachments/assets/20f0ce43-f218-4e19-a74c-3a04871a33b5" />

Thin editor extension that runs the full [`@underwoodinc/clad-audit`](../clad-audit/) engine **in-process** and publishes findings as **Problems panel** entries and **inline squiggles** — same UX as ESLint or TypeScript diagnostics.

## Self-contained

The packaged **`.vsix` is fully self-contained** for anyone who installs it:

| Included in the VSIX | Not required on the machine |
|----------------------|-----------------------------|
| Bundled `clad-audit` engine (rules, import graph, ts-morph, fast-glob, yaml, …) in `dist/extension.js` | `clad-audit` CLI |
| All audit logic runs inside the extension host | `pnpm`, monorepo scripts, or `tools/clad-audit` |
| Zero runtime `node_modules` | Separate `@underwoodinc/clad-audit` npm install |

The extension does **not** shell out to scripts. It only reads **your project's** source tree and optional `.clad-audit.yaml`.

**In your repo:** add `.clad-audit.yaml` when you need aliases, tier paths, or allowlists. No config → generic CLAD defaults apply when `cladAudit.auditWithoutConfig` is enabled.

**To build the VSIX** (maintainers only): one command bundles extension + auditor source via esbuild — no separate `build:clad-audit` step.

## Initialize config (smart presets)

**CLAD: Initialize Config** analyzes the open workspace folder and drafts `.clad-audit.yaml`:

- Detects **Svelte / React / Vue / generic** from `package.json`
- Finds **srcRoot** by scoring `src/`, `lib/`, `app/` for CLAD tier folders
- Maps **import aliases** from `tsconfig.json` / `jsconfig.json` paths (falls back to `$tier/` from folder names)
- Suggests **extraViewPaths** when UI markup lives outside `views/`
- Adds stack-appropriate **ignoreGlobs** (`.svelte-kit`, `.next`, `.nuxt`, …)

You pick a preset (Recommended, Minimal, or stack-specific), preview the YAML, then confirm before anything is written.

**Security:** files are created only inside workspace folders you select, only via `workspace.fs` after explicit confirmation — no shell commands, no network, no overwrite without approval.

Explorer: right-click folder → **Initialize Config**. Sidebar toolbar: **Initialize Config** icon.

When audit runs with no config, the extension offers to initialize.

## Features

- **Activity bar sidebar** — **Explore** (filter + group/sort) and **Findings** tree
- **Findings Explorer** — optional full-page tab with collapsible tree; syncs filter/group/sort with the sidebar
- **Filter query language** — field prefixes (`rule:`, `tier:`, `file:`), exclusions (`-`), regex (`/pattern/i`)
- **Project config** — optional `editor.findings` block in `.clad-audit.yaml` (extension-only; auditor ignores it)
- **VS Code settings** — `cladAudit.findings.*` for defaults; workspace session persists active filter
- **Precise ranges** — squiggles anchor to imports, `$props()`, `<script>`, impurity tokens, and allowlist constants (not always line 1)
- **Rich remediation** — related info for suggested move paths; copy config-exception YAML from quick fixes
- **Problems panel + inline squiggles** — standard diagnostic UX
- **Language status item** — CLAD summary in the editor status area for TS/JS/Svelte/Vue files
- **Quick fixes** — copy remediation advice or open full remediation steps from a diagnostic
- **Output channel** — `CLAD Audit` log for each run (View → Output)
- **Progress notification** while auditing
- Discovers every `.clad-audit.yaml` under workspace folders (e.g. monorepo `apps/mappy/.clad-audit.yaml`)
- Runs audit on workspace open and on save (debounced)
- Explorer context menu: **Audit CLAD Root for Folder**
- Status bar shortcut → opens findings view

## Install

Extension branding uses two assets under `media/`:

| File | Used for |
|------|----------|
| `media/clad-audit.png` | **Extensions list** and **Marketplace** (`icon` in `package.json`) — PNG, ideally 128×128 or 256×256 |
| `media/clad.svg` | **Activity bar** sidebar button — must stay a **monochrome SVG** (`currentColor`); VS Code does not accept PNG here |

To swap the Marketplace icon, replace `media/clad-audit.png` and rebuild the VSIX.

From repo root:

```powershell
pnpm pack:clad-audit-vscode
code --install-extension tools/clad-audit-vscode/clad-audit-vscode.vsix
```

Cursor:

```powershell
cursor --install-extension tools/clad-audit-vscode/clad-audit-vscode.vsix
```

Or: **Extensions** → **⋯** → **Install from VSIX…** → pick `tools/clad-audit-vscode/clad-audit-vscode.vsix`.

Reload the window. Open a workspace that contains `.clad-audit.yaml` (or enable `cladAudit.auditWithoutConfig`).

**Dev without installing:** open `tools/clad-audit-vscode` and press **F5** (Extension Development Host).

## Development

```powershell
cd tools/clad-audit-vscode
pnpm install
pnpm build
```

Press **F5** in VS Code/Cursor with `tools/clad-audit-vscode` as the opened folder to launch an Extension Development Host.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cladAudit.enable` | `true` | Master switch for diagnostics |
| `cladAudit.runOnSave` | `true` | Re-audit after saving source files |
| `cladAudit.runOnOpen` | `true` | Audit when workspace loads |
| `cladAudit.debounceMs` | `1500` | Save debounce (ms) |
| `cladAudit.depth` | `standard` | `quick` · `standard` · `deep` · `exhaustive` |
| `cladAudit.configFileName` | `.clad-audit.yaml` | Config file name |
| `cladAudit.auditWithoutConfig` | `false` | Audit workspace roots with generic defaults when no config exists |

### Findings sidebar (`cladAudit.findings.*`)

| Setting | Default | Description |
|---------|---------|-------------|
| `groupBy` | `severity` | `severity` · `rule` · `tier` · `file` · `root` |
| `sortBy` | `count-desc` | `count-desc` · `count-asc` · `alpha` · `severity` |
| `nestedGroupBy` | `rule` | Under `root`: `none` · `rule` · `tier` · `severity` · `file` |
| `defaultFilter` | `""` | Initial filter (session filter in toolbar overrides) |
| `showInfo` | `true` | Include info-severity rows in the sidebar |
| `useProjectConfig` | `true` | Merge `editor.findings` from `.clad-audit.yaml` |

### Project YAML (`editor.findings`)

Optional block in `.clad-audit.yaml` — **ignored by the CLI auditor**, read by the extension when `useProjectConfig` is true:

```yaml
editor:
  findings:
    groupBy: rule
    sortBy: count-desc
    filter: tier:apps
    showInfo: true
```

When multiple audit roots exist in one workspace, per-project overrides apply only when a single root is active; otherwise workspace settings win.

### Filter syntax

| Form | Example |
|------|---------|
| Free text | `import-boundary` |
| Field | `rule:import-boundary` · `tier:apps` · `file:views/` |
| Exclude | `-severity:info` |
| Regex | `/import.*apps/i` |

Terms are AND-ed. Command palette: **CLAD: Filter Syntax Help**. With Explore or Findings focused: **Ctrl+Alt+L** filter, **Ctrl+Alt+G** cycle group-by. Use the **Configure** panel for grouping, nested root buckets, and audit settings.

## Notes

- Findings include **line + column** ranges when the rule can locate the violation (imports, impurity matches, Svelte props, file anchors).
- File-tier placement rules anchor to the first import, `<script>` block, or first code line — not blindly line 1.
- Import-boundary diagnostics highlight the **specifier token**, not the whole line.
- Full-repo scan runs per audit root; large repos may prefer longer debounce or `runOnSave: false` with manual **CLAD: Audit Workspace**.

## Changelog

### 0.5.7

- **Findings Explorer** — full-page tab (like Filter Syntax help): searchable tree, group/sort controls, click-to-reveal
- Open via **Open full explorer…** in Explore, the preview icon in Findings/Explore toolbars, or **CLAD: Open Findings Explorer**

### 0.5.6

- **Fix settings lockup** — gear opens a lightweight quick pick instead of the native Settings UI (which could freeze Cursor)
- **Smarter re-audit** — changing group/sort/filter no longer triggers a full workspace audit; only audit-engine settings do (debounced)

### 0.5.5

- **Layout picker** replaces cycle — `Ctrl+Alt+G` and the tree toolbar button open a quick pick (group, sort, nested, show info)
- **Configure panel removed** — Explore has compact Group/Sort dropdowns; gear opens VS Code settings
- **Simpler sidebar** — two panels: Explore + Findings

### 0.5.4

- **Fix Configure → Findings wiring** — workspace settings now override `editor.findings` in project YAML (YAML was silently winning before)
- **Live apply** — grouping/sort/filter controls update the Findings tree immediately
- **Clearer chrome** — tree subtitle shows sort mode; banner when YAML defaults are active

### 0.5.3

- **Filter syntax help** — structured editor tab with quick recipes, field reference, Copy/Try actions (replaces plain modal dialog)

### 0.5.2

- **Configure panel** — dedicated sidebar webview for findings tree layout (including nested root grouping), filters, audit engine, and saving `editor.findings` to `.clad-audit.yaml`
- **Explore simplified** — live filter only; **Configure grouping & audit…** button opens the new panel
- **Findings toolbar** — gear opens Configure instead of raw VS Code settings JSON

### 0.5.1

- **Toolbar fixes** — re-run audit, filter, group, sort, and clear actions show status-bar feedback
- **Filter shortcut** — `Ctrl+Alt+L` / `Cmd+Alt+L` (no longer steals Ctrl+Shift+F from Find in Files)
- **Filter button** — focuses the Explore search box instead of a detached input
- **Streamlined Findings header** — primary actions first; init config moved to overflow menu
- **`private: true`** + npm auto-detect off for the extension folder (fixes spurious npm parse errors)

### 0.5.0

- **Explore toolbar** webview — live filter input, group/sort/nested controls, show-info toggle
- **Findings grouping** — severity, rule, tier, file, audit root (+ nested under root)
- **Filter query language** — field prefixes, exclusions, regex; workspace-persisted filter
- **`editor.findings`** in `.clad-audit.yaml` — project defaults (extension-only)
- Settings under `cladAudit.findings.*`; keybindings when Findings view focused
- Mappy ships `editor.findings.groupBy: rule` as a starter preset

### 0.4.2

- Bundles `@underwoodinc/clad-audit` **0.5.2** — fixes config resolution when `--root` and `--config` are not nested (e.g. `pnpm clad:audit --root apps/mappy --config apps/mappy/.clad-audit.yaml` no longer silently falls back to generic defaults)

### 0.4.1

- Marketplace / Extensions list icon (`media/clad-audit.png`)

### 0.4.0

- Precise diagnostic ranges (`column`, `endLine`, `endColumn`) from auditor 0.5.0
- Related locations for suggested move targets and cycle paths
- **CLAD: Copy config exception YAML** quick fix
- Expanded remediation markdown (reasoning, config snippets, suggested paths)
