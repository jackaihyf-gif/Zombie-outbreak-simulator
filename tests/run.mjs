import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const root = process.cwd();
const testsDir = path.join(root, 'tests');
const tmpDir = path.join(root, '.test-tmp');

fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

const testFiles = fs
  .readdirSync(testsDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort();

if (testFiles.length === 0) {
  console.error('No *.test.ts files found in tests/.');
  process.exit(1);
}

try {
  const outFiles = [];
  for (const file of testFiles) {
    const outFile = path.join(tmpDir, file.replace(/\.ts$/, '.mjs'));
    await build({
      entryPoints: [path.join(testsDir, file)],
      bundle: true,
      platform: 'node',
      format: 'esm',
      sourcemap: 'inline',
      outfile: outFile,
      logLevel: 'silent'
    });
    outFiles.push(outFile);
  }

  const res = spawnSync(process.execPath, ['--test', ...outFiles], {
    stdio: 'inherit'
  });
  process.exitCode = res.status ?? 1;
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
