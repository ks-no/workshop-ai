import { spawn } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createConnection } from 'node:net';
import { KS_DIRECTORY, KS_REVISION, KS_SERVICES } from './ks-workshop-config.mjs';
if ((await readFile(join(KS_DIRECTORY, '.sok-revision'), 'utf8').catch(() => '')).trim() !== KS_REVISION) throw new Error('Run npm run setup:ks first.');
for (const service of KS_SERVICES) {
  const occupied = await new Promise(resolve => { const socket = createConnection({ host: '127.0.0.1', port: service.port }); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
  if (occupied) throw new Error(`Port ${service.port} is already in use. Reuse the existing KS stack or stop its owner first.`);
}
const children = [];
const manifest = resolve('.runtime/ks-processes.json');
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const service of KS_SERVICES) {
  const child = spawn(process.execPath, ['--import', resolve('scripts/ks-loopback.mjs'), `apps/${service.name}/src/server.ts`], {
    cwd: KS_DIRECTORY, stdio: 'inherit', env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(service.port), AUTH_ENFORCE: 'true',
      DIGDIR_BASE_URL: 'http://127.0.0.1:8086', DIGDIR_ISSUER: 'http://localhost:8086', DIGDIR_TOKEN_TTL: '3600',
      FIKS_BASE_URL: 'http://127.0.0.1:8081', BACKEND_BASE_URL: 'http://127.0.0.1:8080' },
  });
  children.push(child);
  child.on('error', () => { process.exitCode = 1; stop(); });
  child.on('exit', code => { if (!stopping) { process.exitCode = code || 1; stop(); } });
}
await writeFile(manifest, JSON.stringify({ ownerPid: process.pid, cwd: KS_DIRECTORY, revision: KS_REVISION, services: KS_SERVICES.map((service, index) => ({ ...service, pid: children[index].pid })) }, null, 2));
await Promise.all(children.map(child => new Promise(resolve => child.once('exit', resolve))));
await rm(manifest, { force: true });
