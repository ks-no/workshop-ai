// The HTTP plumbing every service repeats: CORS, JSON and text responses, and
// reading a request body.
//
// This lived in apps/sandbox-backend/src/http.ts and was copied by hand into five
// other services. The copies drifted - four different Allow-Headers values, two
// services that leave CORS off text responses, and one that sets Cache-Control.
// Nothing caught it, because scripts/kontrakt-smoke.js records status and body but
// not response headers.
//
// So the policy is a parameter rather than a constant: every difference is now
// visible on the one line where a service configures itself, instead of buried in
// its own copy of the same twenty lines.

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Authorization must be in Allow-Headers: demo-gui calls these services
 * cross-origin from :3001, and the moment it sends a bearer token the request
 * becomes preflighted. Without it every browser call fails in preflight, visible
 * only in the console, while curl keeps working perfectly.
 */
export function cors(
  methods = "GET,POST,PUT,OPTIONS",
  headers = "Content-Type,Authorization"
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": headers
  };
}

export type Svarpolicy = {
  /** Headers on every response. Defaults to `cors()`. */
  cors?: Record<string, string>;
  /** Extra headers on JSON responses only - digdir-mock needs Cache-Control. */
  jsonHeaders?: Record<string, string>;
  /** Headers on text and HTML responses. Defaults to the same as `cors`. */
  tekstCors?: Record<string, string>;
};

export type Svarhjelpere = {
  jsonResponse(
    response: ServerResponse,
    statusCode: number,
    data: unknown,
    headers?: Record<string, string>
  ): void;
  textResponse(
    response: ServerResponse,
    statusCode: number,
    data: string,
    contentType?: string
  ): void;
};

export function svarhjelpere(policy: Svarpolicy = {}): Svarhjelpere {
  const felles = policy.cors ?? cors();
  const tekstHeadere = policy.tekstCors ?? felles;
  const jsonHeadere = { ...felles, ...policy.jsonHeaders };

  return {
    jsonResponse(response, statusCode, data, headers = {}) {
      response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        ...jsonHeadere,
        ...headers
      });
      response.end(JSON.stringify(data, null, 2));
    },

    textResponse(response, statusCode, data, contentType = "text/html; charset=utf-8") {
      response.writeHead(statusCode, { "Content-Type": contentType, ...tekstHeadere });
      response.end(data);
    }
  };
}

/**
 * Returns `unknown`, not `any`: this is JSON off the wire and nothing has checked
 * its shape. Callers name the shape they expect with a cast at the call site, so
 * the assumption is written down where it is made rather than hidden here.
 *
 * An empty body yields `{}` - routes that take no arguments call this too.
 */
export async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
