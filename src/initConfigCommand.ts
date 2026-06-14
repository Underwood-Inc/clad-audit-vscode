import * as vscode from 'vscode';
import type { CladAuditService } from './cladAuditService.js';
import { configFileName } from './cladAuditHelpers.js';
import {
  analyzeProjectRoot,
  buildDraftForPreset,
  configExists,
  configUriForProject,
  pickPreset,
  previewDraft,
  resolveProjectRoot,
  writeConfigFile,
} from './projectAnalyzer.js';

export async function runInitConfig(
  service: CladAuditService,
  resourceUri?: vscode.Uri,
): Promise<void> {
  const project = await resolveProjectRoot(resourceUri);
  if (!project) {
    vscode.window.showInformationMessage('Open a workspace folder before initializing CLAD config.');
    return;
  }

  const target = configUriForProject(project, configFileName());
  if (await configExists(target)) {
    const action = await vscode.window.showWarningMessage(
      `${configFileName()} already exists in ${project.name}.`,
      'Replace',
      'Open Existing',
      'Cancel',
    );
    if (action === 'Open Existing') {
      const doc = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(doc);
      return;
    }
    if (action !== 'Replace') return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Analyzing ${project.name} for CLAD config…`,
      cancellable: false,
    },
    async () => {
      const analysis = await analyzeProjectRoot(project);
      const preset = await pickPreset(analysis);
      if (!preset) return;

      const draft = buildDraftForPreset(analysis, preset);
      const confirmed = await previewDraft(draft);
      if (!confirmed) return;

      const written = await writeConfigFile(project, draft.yaml);
      if (!written) return;

      const doc = await vscode.workspace.openTextDocument(written);
      await vscode.window.showTextDocument(doc);

      const runNow = await vscode.window.showInformationMessage(
        `${configFileName()} created. Run CLAD audit now?`,
        'Audit Now',
        'Later',
      );
      if (runNow === 'Audit Now') {
        await service.auditFolder(project.rootUri);
      }
    },
  );
}

export async function offerInitWhenMissing(): Promise<boolean> {
  const action = await vscode.window.showInformationMessage(
    `No ${configFileName()} found in this workspace.`,
    'Initialize Config',
    'Not Now',
  );
  return action === 'Initialize Config';
}
