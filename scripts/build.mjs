import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, '..');

/** Monorepo sibling src when present; otherwise npm package dist (standalone clone / CI). */
function cladAuditAliases(root) {
  const siblingSrc = path.resolve(root, '../clad-audit/src');
  if (fs.existsSync(path.join(siblingSrc, 'frames/runAudit.ts'))) {
    return {
      '@underwoodinc/clad-audit/run': path.join(siblingSrc, 'frames/runAudit.ts'),
      '@underwoodinc/clad-audit/types': path.join(siblingSrc, 'motes/types.ts'),
      '@underwoodinc/clad-audit/audit': path.join(siblingSrc, 'engines/auditEngine.ts'),
      '@underwoodinc/clad-audit/config': path.join(siblingSrc, 'motes/loadConfig.ts'),
    };
  }

  const pkgDist = path.resolve(root, 'node_modules/@underwoodinc/clad-audit/dist');
  const runEntry = path.join(pkgDist, 'frames/runAudit.js');
  if (!fs.existsSync(runEntry)) {
    throw new Error(
      'Cannot resolve @underwoodinc/clad-audit: run npm install or place tools/clad-audit alongside this repo.',
    );
  }

  return {
    '@underwoodinc/clad-audit/run': runEntry,
    '@underwoodinc/clad-audit/types': path.join(pkgDist, 'motes/types.js'),
    '@underwoodinc/clad-audit/audit': path.join(pkgDist, 'engines/auditEngine.js'),
    '@underwoodinc/clad-audit/config': path.join(pkgDist, 'motes/loadConfig.js'),
  };
}

fs.rmSync(path.join(extensionRoot, 'dist'), { recursive: true, force: true });

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: [path.join(extensionRoot, 'src/extension.ts')],
  bundle: true,
  outfile: path.join(extensionRoot, 'dist/extension.js'),
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  alias: cladAuditAliases(extensionRoot),
  sourcemap: true,
  logLevel: 'info',
  footer: {
    js: 'module.exports = { activate, deactivate };',
  },
});

if (watch) {
  await ctx.watch();
  console.log('watching clad-audit-vscode…');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
