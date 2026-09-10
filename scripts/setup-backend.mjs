import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const environment = resolve('backend/.venv');
const localPython = resolve(environment, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) {
    console.error('Python setup failed. Install Python 3.11+ and retry npm run setup:backend.');
    process.exit(result.status || 1);
  }
}
if (!existsSync(localPython)) run(python, ['-m', 'venv', environment]);
run(localPython, ['-c', 'import sys; assert sys.version_info >= (3, 11), "This app requires Python 3.11 or newer."']);
run(localPython, ['-m', 'ensurepip', '--upgrade']);
run(localPython, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', 'backend/requirements.txt']);
run(localPython, ['-c', 'from agent_framework import Agent, WorkflowBuilder; from agent_framework.openai import OpenAIChatCompletionClient; print("Microsoft Agent Framework Python is ready.")']);
