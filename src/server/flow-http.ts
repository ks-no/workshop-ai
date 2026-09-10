import type { NextRequest } from 'next/server';
import type { FlowCase } from '../domain/flow-types';
import { modelStatus } from './assistant-model';
import { loadFlowCase } from './flow-store';
import { json } from './http';

export const FLOW_COOKIE = 'sok-flow-session';
export function flowFrom(request: NextRequest) { return loadFlowCase(request.cookies.get(FLOW_COOKIE)?.value); }
export async function flowResponse(session: FlowCase | null, status = 200) {
  return json({ session, model: await modelStatus() }, status);
}
