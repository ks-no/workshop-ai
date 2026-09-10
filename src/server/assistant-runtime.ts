import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ModelRole } from '../domain/assistant-types';

export type AgentJob = { id: string; name: string; role: ModelRole; model: string; prompt: string; context: unknown; schema: Record<string, unknown> };
type RequestHandler = (method: string, data: Record<string, unknown>) => Promise<unknown>;
const requestSchema = z.object({ type: z.literal('request'), id: z.string().uuid(), method: z.enum(['started', 'prepare', 'specialist', 'stage', 'model']), data: z.record(z.string(), z.unknown()) }).strict();

/** Explicit allowlist, as in ks-runtime.ts: an agent process inherits its own settings and no other server secret. */
const runtimeEnvKeys = ['LLM_BASE_URL', 'LLM_API_KEY', 'AI_PROVIDER', 'CF_ACCOUNT_ID', 'CF_AI_GATEWAY_TOKEN', 'CF_AI_GATEWAY_ID',
  'TELENOR_AI_FACTORY_BASE_URL', 'TELENOR_AI_FACTORY_API_KEY', 'ASSISTANT_MODEL_TIMEOUT_MS',
  'PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE'];
function runtimeEnv(): NodeJS.ProcessEnv {
  const env = { NODE_ENV: process.env.NODE_ENV } as NodeJS.ProcessEnv;
  for (const key of runtimeEnvKeys) if (process.env[key] !== undefined) env[key] = process.env[key];
  return env;
}

function runtimePaths() {
  return { python: resolve(/* turbopackIgnore: true */ process.env.ASSISTANT_PYTHON || (process.platform === 'win32' ? 'backend/.venv/Scripts/python.exe' : 'backend/.venv/bin/python')),
    script: resolve(/* turbopackIgnore: true */ 'backend/agent_runtime.py') };
}
export function runtimeInstalled() {
  try { const paths = runtimePaths(); accessSync(paths.python, constants.X_OK); accessSync(paths.script, constants.R_OK); return true; }
  catch { return false; }
}

/** One owned Python process per bounded workflow. No shell, public port or detached daemon. */
export async function runPythonRuntime(payload: Record<string, unknown>, handler?: RequestHandler): Promise<Record<string, unknown>> {
  const paths = runtimePaths();
  if (!runtimeInstalled()) throw new Error('Python-agentene er ikke installert. Kjør npm run setup:backend og prøv igjen.');
  const budget = Math.min(180000, Math.max(10000, Number(process.env.ASSISTANT_MODEL_TIMEOUT_MS) || 90000));
  return new Promise((resolveResult, reject) => {
    const child = spawn(paths.python, ['-u', paths.script], { stdio: ['pipe', 'pipe', 'pipe'], env: runtimeEnv() });
    child.stdout.setEncoding('utf8');
    let buffer = ''; let settled = false; let complete: Record<string, unknown> | null = null;
    let pending = 0; let closed = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      child.stdin.end();
      if (!closed) child.kill('SIGTERM');
      if (error) reject(error); else resolveResult(complete!);
    };
    const timer = setTimeout(() => finish(new Error('Agentanalysen tok for lang tid. Opplysningene er bevart; prøv igjen.')), budget * 2 + 30000);
    child.on('error', () => finish(new Error('Python-agentene kunne ikke startes. Kontroller backend-oppsettet.')));
    child.stdin.on('error', () => { if (!settled && !complete) finish(new Error('Forbindelsen til Python-agentene ble avbrutt. Prøv igjen.')); });
    child.stderr.on('data', () => { /* Do not leak SDK errors, prompts or credentials into browser/server logs. */ });
    child.on('close', code => {
      closed = true;
      if (complete && pending === 0 && code === 0) finish();
      else if (!settled) finish(new Error('Python-agentene avsluttet før analysen var ferdig. Kontroller backend-oppsettet og prøv igjen.'));
    });
    async function receive(message: Record<string, unknown>) {
      if (message.type === 'error') { finish(new Error(typeof message.message === 'string' ? message.message : 'Agentanalysen kunne ikke fullføres.')); return; }
      if (message.type === 'complete') { complete = message; child.stdin.end(); return; }
      const request = requestSchema.parse(message);
      if (!handler) throw new Error('Uventet forespørsel fra agentene.');
      pending++;
      try {
        const data = await handler(request.method, request.data);
        if (!settled) child.stdin.write(JSON.stringify({ id: request.id, data: data ?? null }) + '\n');
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Agentforespørselen ble avvist.'));
      } finally { pending--; }
    }
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 2 * 1024 * 1024) { finish(new Error('Agentene returnerte for mye data.')); return; }
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        try { void receive(JSON.parse(line)).catch(() => finish(new Error('Agentene returnerte en ugyldig intern melding.'))); }
        catch { finish(new Error('Agentene returnerte et ugyldig format.')); }
      }
    });
    child.stdin.write(JSON.stringify(payload) + '\n');
  });
}
