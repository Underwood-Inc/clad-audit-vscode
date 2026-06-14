import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'src/test/vscode.mock.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
