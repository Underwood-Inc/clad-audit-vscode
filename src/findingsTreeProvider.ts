import { join } from 'node:path';
import type { CladSeverity } from '@underwoodinc/clad-audit/types';
import * as vscode from 'vscode';
import { formatFindingLocation } from './cladAuditHelpers.js';
import type { CladAuditService } from './cladAuditService.js';
import { describeActiveFilter, filterStoredFindings } from './findingsFilter.js';
import {
  absPathForStored,
  bucketFindings,
  decodeTreePath,
  encodeTreePath,
  filterByPath,
  hierarchyForGroupBy,
  nextDimension,
  sortBuckets,
  sortFindings,
  type TreePath,
} from './findingsGrouping.js';
import type { FindingsViewState } from './findingsViewState.js';
import { FINDINGS_GROUP_BY_LABEL, FINDINGS_SORT_BY_LABEL, SEVERITY_ICON, type FindingsGroupBy } from './findingsViewTypes.js';
import type { StoredFinding } from './storedFinding.js';

export class FindingsTreeProvider implements vscode.TreeDataProvider<FindingTreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<FindingTreeItem | undefined>();

  readonly onDidChangeTreeData = this.changeEmitter.event;

  private treeView: vscode.TreeView<FindingTreeItem> | undefined;

  constructor(
    private readonly service: CladAuditService,
    private readonly viewState: FindingsViewState,
  ) {
    service.onDidChange(() => this.refresh());
    viewState.onDidChange(() => this.refresh());
  }

  bindTreeView(view: vscode.TreeView<FindingTreeItem>): void {
    this.treeView = view;
    this.syncViewChrome();
  }

  refresh(): void {
    this.syncViewChrome();
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: FindingTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(element: FindingTreeItem): FindingTreeItem | undefined {
    if (element instanceof FindingLeafTreeItem) {
      const path = element.parentPath;
      if (!path || path.segments.length === 0) return undefined;
      const parentSegments = path.segments.slice(0, -1);
      if (parentSegments.length === 0) return undefined;
      return this.buildGroupItem({ segments: parentSegments }, this.visibleFindings(this.viewState.getConfig()));
    }
    if (element instanceof GroupTreeItem && element.path.segments.length > 1) {
      return this.buildGroupItem(
        { segments: element.path.segments.slice(0, -1) },
        this.visibleFindings(this.viewState.getConfig()),
      );
    }
    return undefined;
  }

  getChildren(element?: FindingTreeItem): FindingTreeItem[] {
    const all = this.service.getStoredFindings();
    const config = this.viewState.getConfig();
    const visible = this.visibleFindings(config);

    if (all.length === 0) {
      if (!element) {
        return [new MessageTreeItem('No CLAD findings — run an audit to refresh.')];
      }
      return [];
    }

    if (visible.length === 0) {
      if (!element) {
        return [
          new MessageTreeItem(
            describeActiveFilter(config.filterQuery, all.length, 0) +
              '\nAdjust filter or run “CLAD: Clear Findings Filter”.',
          ),
        ];
      }
      return [];
    }

    const hierarchy = hierarchyForGroupBy(config.groupBy, config.nestedGroupBy);

    if (!element) {
      const dimension = hierarchy[0];
      if (!dimension) return [];
      const buckets = sortBuckets(bucketFindings(visible, dimension), config.sortBy);
      return buckets.map((bucket) =>
        this.buildGroupItem(
          { segments: [{ kind: dimension, value: bucket.key }] },
          visible,
          bucket.label,
          bucket.iconId,
          bucket.severityHint,
        ),
      );
    }

    if (element instanceof GroupTreeItem) {
      const next = nextDimension(hierarchy, element.path);
      if (next === 'finding') {
        const leaves = sortFindings(filterByPath(visible, element.path));
        return leaves.map(
          (stored) => new FindingLeafTreeItem(stored, element.path, config.groupBy),
        );
      }
      if (next == null) return [];
      const scoped = filterByPath(visible, element.path);
      const buckets = sortBuckets(bucketFindings(scoped, next), config.sortBy);
      return buckets.map((bucket) =>
        this.buildGroupItem(
          {
            segments: [...element.path.segments, { kind: next, value: bucket.key } as TreePath['segments'][0]],
          },
          visible,
          bucket.label,
          bucket.iconId,
          bucket.severityHint,
        ),
      );
    }

    return [];
  }

  private visibleFindings(config: ReturnType<FindingsViewState['getConfig']>): StoredFinding[] {
    return filterStoredFindings(this.service.getStoredFindings(), config.filterQuery, {
      showInfo: config.showInfo,
    });
  }

  private buildGroupItem(
    path: TreePath,
    visible: StoredFinding[],
    labelOverride?: string,
    iconId?: string,
    severityHint?: CladSeverity,
  ): GroupTreeItem {
    const scoped = filterByPath(visible, path);
    const segment = path.segments[path.segments.length - 1]!;
    const label = labelOverride ?? segment.value;
    const hierarchy = hierarchyForGroupBy(
      this.viewState.getConfig().groupBy,
      this.viewState.getConfig().nestedGroupBy,
    );
    const isLeafGroup = path.segments.length >= hierarchy.length;
    return new GroupTreeItem(
      encodeTreePath(path),
      path,
      label,
      scoped.length,
      iconId ?? 'folder',
      isLeafGroup ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
      severityHint,
    );
  }

  private syncViewChrome(): void {
    if (!this.treeView) return;
    const config = this.viewState.getConfig();
    const all = this.service.getStoredFindings();
    const visible = this.visibleFindings(config);
    const filterActive = Boolean(config.filterQuery.trim());

    this.treeView.message = describeActiveFilter(config.filterQuery, all.length, visible.length);
    this.treeView.description = filterActive
      ? `Filter · ${FINDINGS_GROUP_BY_LABEL[config.groupBy]} · ${FINDINGS_SORT_BY_LABEL[config.sortBy]}`
      : `${FINDINGS_GROUP_BY_LABEL[config.groupBy]} · ${FINDINGS_SORT_BY_LABEL[config.sortBy]}`;

    if (config.projectConfigSource && config.useProjectConfig) {
      const hasWorkspaceOverride = vscode.workspace
        .getConfiguration('cladAudit.findings')
        .inspect('groupBy')?.workspaceValue !== undefined;
      if (!hasWorkspaceOverride) {
        this.treeView.message = `${this.treeView.message} · YAML defaults`;
      } else {
        this.treeView.message = `${this.treeView.message} · workspace override`;
      }
    }

    void vscode.commands.executeCommand(
      'setContext',
      'cladAudit.findingsFilterActive',
      filterActive,
    );
  }
}

abstract class FindingTreeItem extends vscode.TreeItem {}

class MessageTreeItem extends FindingTreeItem {
  constructor(message: string) {
    super(message.split('\n')[0] ?? message, vscode.TreeItemCollapsibleState.None);
    this.description = message.includes('\n') ? message.split('\n').slice(1).join(' ') : undefined;
    this.tooltip = message;
    this.iconPath = new vscode.ThemeIcon('info');
  }
}

class GroupTreeItem extends FindingTreeItem {
  constructor(
    readonly pathId: string,
    readonly path: TreePath,
    label: string,
    count: number,
    iconId: string,
    collapsible: vscode.TreeItemCollapsibleState,
    severityHint?: CladSeverity,
  ) {
    super(label, collapsible);
    this.id = pathId;
    this.description = String(count);
    this.iconPath = new vscode.ThemeIcon(
      severityHint ? SEVERITY_ICON[severityHint] : iconId,
    );
    this.contextValue = 'cladGroup';
    const first = path.segments[0];
    if (first?.kind === 'file') {
      const samplePath = first.value;
      this.resourceUri = vscode.Uri.file(samplePath);
    }
  }
}

class FindingLeafTreeItem extends FindingTreeItem {
  constructor(
    readonly stored: StoredFinding,
    readonly parentPath: TreePath,
    groupBy: FindingsGroupBy,
  ) {
    const f = stored.finding;
    const where = f.line != null ? formatFindingLocation(f) : '';
    const label =
      groupBy === 'rule'
        ? (where ? `${where}` : f.filePath)
        : `[${f.rule}]${where ? ` ${where}` : ''}`;
    super(label.trim() || f.rule, vscode.TreeItemCollapsibleState.None);
    this.description = truncate(f.message, 56);
    this.tooltip = new vscode.MarkdownString(
      [
        `**${f.rule}** (${f.severity})`,
        f.tier ? `Tier: \`${f.tier}\`` : '',
        '',
        f.message,
        '',
        f.advice,
        f.remediation?.summary,
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
    this.iconPath = new vscode.ThemeIcon(SEVERITY_ICON[f.severity]);
    this.command = {
      command: 'clad-audit.revealFinding',
      title: 'Reveal finding',
      arguments: [stored.id],
    };
    this.contextValue = 'cladFinding';
    this.resourceUri = vscode.Uri.file(absPathForStored(stored));
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function decodeGroupPath(pathId: string): TreePath {
  return decodeTreePath(pathId);
}
