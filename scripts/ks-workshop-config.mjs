import { resolve } from 'node:path';
export const KS_REVISION = '656a5c69edbddad4b0e3f194c44289f12f09ef0d';
export const KS_DIRECTORY = resolve(process.env.KS_WORKSHOP_DIR || '.runtime/ks-workshop');
export const KS_SERVICES = [
  { name: 'digdir-mock', port: 8086 },
  { name: 'fiks-simulator', port: 8081 },
  { name: 'sandbox-backend', port: 8080 },
];
