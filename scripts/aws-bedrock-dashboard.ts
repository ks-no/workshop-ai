#!/usr/bin/env node
// Local-only admin dashboard for the shared ai-gateway-bedrock-invoke role:
// who has a key, when they last used it, how many Bedrock calls they've made
// recently, and a one-click revoke. Never meant to be deployed anywhere —
// it shells out to the `aws` CLI using whatever credentials the invoking
// shell has (AWS_PROFILE=philippe, say), the same way the aws-bedrock-*.sh
// scripts do, and binds to localhost only.
//
// Usage:
//   AWS_PROFILE=philippe AWS_REGION=eu-north-1 node scripts/aws-bedrock-dashboard.ts
//   open http://localhost:8090
//
// Usage counts require scripts/aws-bedrock-logging-setup.sh to have been run
// once — without it the usage column just reads "logging not enabled".

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REGION = process.env.AWS_REGION || "eu-north-1";
const ROLE_NAME = process.env.ROLE_NAME || "ai-gateway-bedrock-invoke";
const POLICY_NAME = `assume-${ROLE_NAME}`;
const LOG_GROUP = process.env.LOG_GROUP || "/ai-gateway/bedrock-invocations";
const PORT = Number(process.env.PORT) || 8090;
const HOST = "127.0.0.1"; // deliberately not 0.0.0.0 — this can deactivate real AWS credentials

async function aws(args: string[]): Promise<any> {
  const { stdout } = await execFileAsync("aws", [...args, "--region", REGION, "--output", "json"]);
  return stdout.trim() ? JSON.parse(stdout) : null;
}

async function isAiGatewayUser(userName: string): Promise<boolean> {
  try {
    await aws(["iam", "get-user-policy", "--user-name", userName, "--policy-name", POLICY_NAME]);
    return true;
  } catch {
    return false;
  }
}

type UserRow = { user: string; keyId: string | null; status: string; lastUsed: string | null };

async function listUsers(): Promise<UserRow[]> {
  const { Users } = await aws(["iam", "list-users"]);
  const candidates: string[] = Users.map((u: any) => u.UserName);
  const flags = await Promise.all(candidates.map(isAiGatewayUser));
  const gatewayUsers = candidates.filter((_, i) => flags[i]);

  return Promise.all(
    gatewayUsers.map(async (user): Promise<UserRow> => {
      const { AccessKeyMetadata } = await aws(["iam", "list-access-keys", "--user-name", user]);
      const key = AccessKeyMetadata[0];
      if (!key) return { user, keyId: null, status: "no-key", lastUsed: null };
      const lastUsedResp = await aws(["iam", "get-access-key-last-used", "--access-key-id", key.AccessKeyId]);
      const lastUsed = lastUsedResp?.AccessKeyLastUsed?.LastUsedDate ?? null;
      return { user, keyId: key.AccessKeyId, status: key.Status, lastUsed };
    })
  );
}

async function setKeyStatus(user: string, status: "Active" | "Inactive"): Promise<void> {
  const { AccessKeyMetadata } = await aws(["iam", "list-access-keys", "--user-name", user]);
  const key = AccessKeyMetadata[0];
  if (!key) throw new Error(`No access key for ${user}`);
  await execFileAsync("aws", [
    "iam", "update-access-key",
    "--user-name", user,
    "--access-key-id", key.AccessKeyId,
    "--status", status,
    "--region", REGION
  ]);
}

// Session name is "<username>-<epoch>" (see aws-bedrock-assume.sh) — strip
// the trailing numeric epoch to recover the username, robust to hyphens
// inside the username itself.
function usernameFromSessionArn(arn: string | undefined): string | null {
  if (!arn) return null;
  const sessionName = arn.split("/").pop();
  if (!sessionName) return null;
  return sessionName.replace(/-\d+$/, "");
}

async function usageCounts(minutes: number): Promise<{ counts: Record<string, number>; truncated: boolean } | { error: string }> {
  const startTime = Date.now() - minutes * 60_000;
  let resp: any;
  try {
    resp = await aws([
      "logs", "filter-log-events",
      "--log-group-name", LOG_GROUP,
      "--start-time", String(startTime),
      "--limit", "10000"
    ]);
  } catch (err: any) {
    if (String(err.message).includes("ResourceNotFoundException")) {
      return { error: "logging not enabled — run scripts/aws-bedrock-logging-setup.sh" };
    }
    throw err;
  }

  const counts: Record<string, number> = {};
  for (const event of resp.events ?? []) {
    try {
      const record = JSON.parse(event.message);
      const user = usernameFromSessionArn(record.identity?.arn) ?? "(unattributed)";
      counts[user] = (counts[user] ?? 0) + 1;
    } catch {
      // one malformed log line shouldn't sink the whole count
    }
  }
  return { counts, truncated: Boolean(resp.nextToken) };
}

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ai-gateway Bedrock access</title>
<style>
  body { font: 14px/1.4 -apple-system, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.1rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; }
  .active { color: #16794a; }
  .inactive { color: #999; }
  button { cursor: pointer; }
  #note { color: #999; font-size: 0.85rem; }
  #err { color: #b00020; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>ai-gateway Bedrock access — ${ROLE_NAME} (${REGION})</h1>
<p id="note">Local-only. Revoking deactivates the IAM access key immediately; a session already in flight still expires on its own within 12h.</p>
<div id="err"></div>
<table id="t"><thead>
  <tr><th>User</th><th>Key status</th><th>Last used</th><th>Requests (last <span id="win">60</span>m)</th><th></th></tr>
</thead><tbody></tbody></table>
<p><button id="refresh">Refresh</button>
  <select id="minutes"><option value="15">15m</option><option value="60" selected>1h</option><option value="1440">24h</option></select>
</p>

<script>
async function load() {
  const minutes = document.getElementById('minutes').value;
  document.getElementById('win').textContent = minutes;
  const errEl = document.getElementById('err');
  errEl.textContent = '';
  const [usersResp, usageResp] = await Promise.all([
    fetch('/api/users').then(r => r.json()),
    fetch('/api/usage?minutes=' + minutes).then(r => r.json())
  ]);
  const usage = usageResp.error ? {} : usageResp.counts;
  if (usageResp.error) errEl.textContent = usageResp.error;

  const tbody = document.querySelector('#t tbody');
  tbody.innerHTML = '';
  for (const row of usersResp) {
    const tr = document.createElement('tr');
    const isActive = row.status === 'Active';
    tr.innerHTML = \`
      <td>\${row.user}</td>
      <td class="\${isActive ? 'active' : 'inactive'}">\${row.status}</td>
      <td>\${row.lastUsed ?? '-'}</td>
      <td>\${usage[row.user] ?? 0}</td>
      <td></td>\`;
    const actionCell = tr.lastElementChild;
    const btn = document.createElement('button');
    btn.textContent = isActive ? 'Revoke' : 'Reactivate';
    btn.onclick = async () => {
      btn.disabled = true;
      const res = await fetch('/api/' + (isActive ? 'revoke' : 'reactivate'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: row.user })
      });
      if (!res.ok) errEl.textContent = await res.text();
      await load();
    };
    actionCell.appendChild(btn);
    tbody.appendChild(tr);
  }
}
document.getElementById('refresh').onclick = load;
document.getElementById('minutes').onchange = load;
load();
</script>
</body>
</html>`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      const users = await listUsers();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(users));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/usage") {
      const minutes = Number(url.searchParams.get("minutes")) || 60;
      const result = await usageCounts(minutes);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.method === "POST" && (url.pathname === "/api/revoke" || url.pathname === "/api/reactivate")) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const { user } = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (!user || typeof user !== "string") {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Missing user");
        return;
      }
      await setKeyStatus(user, url.pathname === "/api/revoke" ? "Inactive" : "Active");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  } catch (err: any) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(err?.message ?? err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ai-gateway Bedrock dashboard: http://${HOST}:${PORT}`);
});
