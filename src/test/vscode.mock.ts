export const workspace = {
  getConfiguration: () => ({
    get: () => undefined,
    inspect: () => undefined,
  }),
  workspaceFolders: [],
  findFiles: async () => [],
};

export const Uri = { file: (p: string) => ({ fsPath: p }) };
export const window = {};
export const commands = { executeCommand: async () => undefined };
export const ConfigurationTarget = { Workspace: 1, Global: 2 };
