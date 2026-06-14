import * as vscode from 'vscode';

/** Brief status-bar confirmation so toolbar actions feel responsive. */
export function cladStatusMessage(message: string, ms = 2500): void {
  void vscode.window.setStatusBarMessage(`CLAD: ${message}`, ms);
}

export async function focusCladView(
  viewId: 'clad-audit.findings' | 'clad-audit.findingsToolbar',
): Promise<void> {
  await vscode.commands.executeCommand(`${viewId}.focus`);
}
