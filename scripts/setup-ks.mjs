import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { KS_DIRECTORY, KS_REVISION } from './ks-workshop-config.mjs';
const marker = join(KS_DIRECTORY, '.sok-revision');
try {
  if ((await readFile(marker, 'utf8')).trim() === KS_REVISION) { console.log('KS workshop is already installed at the pinned revision.'); process.exit(0); }
} catch {}
const staging = await mkdtemp(join(tmpdir(), 'sok-ks-'));
try {
  const response = await fetch(`https://codeload.github.com/ks-no/workshop-ai/tar.gz/${KS_REVISION}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`KS download failed (${response.status}).`);
  const archive = join(staging, 'workshop.tar.gz');
  await writeFile(archive, Buffer.from(await response.arrayBuffer()));
  await mkdir(KS_DIRECTORY, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', KS_DIRECTORY], { stdio: 'inherit' });
  await writeFile(marker, `${KS_REVISION}\n`);
  console.log(`Official KS workshop installed: ${KS_REVISION}`);
} finally { await rm(staging, { recursive: true, force: true }); }
