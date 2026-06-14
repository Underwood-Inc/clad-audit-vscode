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
import { cladStatusMessage } from './cladUiFeedback.js';

type LayoutPick = vscode.QuickPickItem & {
  apply?: () => Promise<void>;
};

export async function pickFindingsLayout(viewState: FindingsViewState): Promise<void> {
  const config = viewState.getConfig();
  const items: LayoutPick[] = [
    { label: 'Group by', kind: vscode.QuickPickItemKind.Separator },
    ...groupItems(config.groupBy, viewState),
    { label: 'Sort groups', kind: vscode.QuickPickItemKind.Separator },
    ...sortItems(config.sortBy, viewState),
  ];

  if (config.groupBy === 'root') {
    items.push(
      { label: 'Nested under audit root', kind: vscode.QuickPickItemKind.Separator },
      ...nestedItems(config.nestedGroupBy, viewState),
    );
  }

  items.push(
    { label: 'Display', kind: vscode.QuickPickItemKind.Separator },
    {
      label: config.showInfo ? 'Hide info-severity findings' : 'Show info-severity findings',
      description: config.showInfo ? 'Currently shown' : 'Currently hidden',
      apply: async () => {
        await viewState.applyPatch({ showInfo: !config.showInfo });
        cladStatusMessage(config.showInfo ? 'Info findings hidden' : 'Info findings shown');
      },
    },
  );

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Findings layout',
    placeHolder: `${FINDINGS_GROUP_BY_LABEL[config.groupBy]} · ${FINDINGS_SORT_BY_LABEL[config.sortBy]}`,
    matchOnDescription: true,
    ignoreFocusOut: true,
  });

  await picked?.apply?.();
}

function groupItems(current: FindingsGroupBy, viewState: FindingsViewState): LayoutPick[] {
  return (Object.keys(FINDINGS_GROUP_BY_LABEL) as FindingsGroupBy[]).map((id) => ({
    label: FINDINGS_GROUP_BY_LABEL[id],
    description: id === current ? 'Current' : id,
    picked: id === current,
    apply: async () => {
      if (id === current) return;
      await viewState.setGroupBy(id);
      cladStatusMessage(`Grouped by ${FINDINGS_GROUP_BY_LABEL[id]}`);
    },
  }));
}

function sortItems(current: FindingsSortBy, viewState: FindingsViewState): LayoutPick[] {
  return (Object.keys(FINDINGS_SORT_BY_LABEL) as FindingsSortBy[]).map((id) => ({
    label: FINDINGS_SORT_BY_LABEL[id],
    description: id === current ? 'Current' : id,
    picked: id === current,
    apply: async () => {
      if (id === current) return;
      await viewState.setSortBy(id);
      cladStatusMessage(`Sort: ${FINDINGS_SORT_BY_LABEL[id]}`);
    },
  }));
}

function nestedItems(current: FindingsNestedGroupBy, viewState: FindingsViewState): LayoutPick[] {
  return (Object.keys(FINDINGS_NESTED_LABEL) as FindingsNestedGroupBy[]).map((id) => ({
    label: FINDINGS_NESTED_LABEL[id],
    description: id === current ? 'Current' : id,
    picked: id === current,
    apply: async () => {
      if (id === current) return;
      await viewState.setNestedGroupBy(id);
      cladStatusMessage(`Nested: ${FINDINGS_NESTED_LABEL[id]}`);
    },
  }));
}
