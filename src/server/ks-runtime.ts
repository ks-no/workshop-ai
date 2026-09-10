import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { createKsDemoClient } from '../providers/ks-demo-client';

const execute = promisify(execFile);
const tokens = new Map<string, { value: string; expires: number }>();
export function ksPersonId() { return process.env.KS_PERSON_ID || 'person-022'; }
async function token(kind: 'citizen' | 'consent') {
  const personId = ksPersonId();
  const directory = resolve(/* turbopackIgnore: true */ process.env.KS_WORKSHOP_DIR || '.runtime/ks-workshop');
  const issuer = process.env.KS_DIGDIR_BASE_URL || 'http://127.0.0.1:8086';
  const key = `${directory}:${issuer}:${personId}:${kind}`;
  const cached = tokens.get(key);
  if (cached && cached.expires > Date.now() + 30_000) return cached.value;
  const args = kind === 'citizen'
    ? ['--innbygger', personId, '--resource', 'sandbox-backend']
    : ['--maskinporten', 'ks:fiks:samtykke', '--resource', 'fiks-simulator'];
  const { stdout } = await execute(process.execPath, [join(directory, 'scripts/token.ts'), ...args, '--client', 'team-oslo-sok-en-gang'], {
    cwd: directory, timeout: 12_000, maxBuffer: 24_000,
    env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, DIGDIR_BASE_URL: issuer, DIGDIR_ISSUER: process.env.KS_DIGDIR_ISSUER || 'http://localhost:8086' },
  });
  const value = stdout.trim();
  // This expiry is only a cache hint. KS verifies the signature, issuer and audience.
  const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
  if (!Number.isFinite(claims.exp)) throw new Error('KS token expiry unavailable');
  tokens.set(key, { value, expires: claims.exp * 1000 });
  return value;
}
export function ksClient() {
  return createKsDemoClient({ backendBaseUrl: process.env.KS_BACKEND_BASE_URL || 'http://127.0.0.1:8080',
    fiksBaseUrl: process.env.KS_FIKS_BASE_URL || 'http://127.0.0.1:8081', personId: ksPersonId(),
    getCitizenToken: () => token('citizen'), getConsentToken: () => token('consent') });
}
