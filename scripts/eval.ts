#!/usr/bin/env node

// Eval harness for the AI layer.
//
// Prompts are code you cannot unit-test: the same prompt gives a slightly
// different answer every run, so "did my change make it better?" has no answer
// without a scored dataset. This is that dataset runner.
//
// Two kinds of check:
//
//   deterministic  contains / notContains / matches / field — no model needed,
//                  fast, and the right tool for endpoints that already return
//                  validated JSON.
//   judge          a second model call scoring free text against a criterion.
//                  Use it only where no deterministic check can express the rule.
//
// Usage:
//   pnpm test:eval                       run every dataset in evals/
//   pnpm test:eval evals/ai-policy.json  run one
//   pnpm test:eval --json                machine-readable summary on stdout
//
// Exits non-zero when a dataset falls below its threshold, so it can gate a
// prompt change the same way a failing test gates a code change.
//
// Requires a running ai-gateway with a reachable model. It deliberately does not
// mock: a template answer would pass checks the model would fail.

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feilmelding } from "../apps/shared/errors.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const aiBaseUrl = process.env.AI_BASE_URL || "http://localhost:8082";
const evalsDir = path.join(root, "evals");
const reportFile = path.join(process.env.STATE_DIR || path.join(root, "state"), "eval-report.html");
const asJson = process.argv.includes("--json");
const argFiles = process.argv.slice(2).filter((a) => !a.startsWith("--"));

// --- checks -----------------------------------------------------------------

/** Svaret et endepunkt ga, slik sjekkene leser det. */
type Evalsvar = { text: string; body?: any };

function valueAtPath(object: any, dottedPath: string) {
  return dottedPath.split(".").reduce((current: any, key: any) => current?.[key], object);
}

function normalise(text: string) {
  // Amounts are rendered "485 000" with a non-breaking space by Intl, but written
  // "485 000" with a normal one in a dataset. Without this every amount check
  // fails for a reason nobody would guess from the output.
  return String(text ?? "").replace(/ /g, " ").toLowerCase();
}

const deterministicChecks: Record<string, ((check: any, svar: Evalsvar) => any) | undefined> = {
  contains: (check: any, { text }: Evalsvar) => ({
    ok: normalise(text).includes(normalise(check.value)),
    detail: `forventet å finne "${check.value}"`
  }),
  notContains: (check: any, { text }: Evalsvar) => ({
    ok: !normalise(text).includes(normalise(check.value)),
    detail: `forventet å IKKE finne "${check.value}"`
  }),
  matches: (check: any, { text }: Evalsvar) => ({
    ok: new RegExp(check.pattern, check.flags ?? "i").test(String(text ?? "")),
    detail: `forventet treff på /${check.pattern}/`
  }),
  field: (check: any, { body }: Evalsvar) => {
    const actual = valueAtPath(body, check.path);
    const ok = check.equals !== undefined
      ? actual === check.equals
      : check.atLeast !== undefined
        ? Number(actual) >= check.atLeast
        : check.atMost !== undefined
          ? Number(actual) <= check.atMost
          : actual !== undefined;
    const want = check.equals !== undefined ? `= ${JSON.stringify(check.equals)}`
      : check.atLeast !== undefined ? `>= ${check.atLeast}`
        : check.atMost !== undefined ? `<= ${check.atMost}` : "finnes";
    return { ok, detail: `${check.path} ${want}, fikk ${JSON.stringify(actual)}` };
  }
};

// The judge lives in ai-gateway (POST /ai/dommer) so it uses the configured
// provider and shows up in the trace. It sees only the criterion and the answer,
// never the expected result, so it cannot pattern-match its way to a pass.
async function runJudge(check: any, { text }: Evalsvar) {
  const response = await fetch(`${aiBaseUrl}/ai/dommer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kriterium: check.criterion, tekst: String(text ?? "") }),
    signal: AbortSignal.timeout(180000)
  });
  if (!response.ok) {
    // Svarene er any med vilje — se scripts/test-agent-natural-language.ts for begrunnelsen.
    const body = (await response.json().catch(() => ({}))) as any;
    return { ok: false, detail: `dommeren svarte ${response.status}: ${body.feil || ""}` };
  }
  const { score, begrunnelse } = (await response.json()) as any;
  const threshold = check.threshold ?? 0.7;
  return {
    ok: score >= threshold,
    score,
    detail: `score ${score.toFixed(2)} mot terskel ${threshold} — ${begrunnelse || "ingen begrunnelse"}`
  };
}

// --- running ----------------------------------------------------------------

async function callEndpoint(endpoint: string, body: any) {
  const response = await fetch(`${aiBaseUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000)
  });
  const data = (await response.json()) as any;
  return { status: response.status, body: data };
}

async function runCase(dataset: any, testCase: any) {
  const started = Date.now();
  const { status, body } = await callEndpoint(dataset.endpoint, testCase.body);

  // A fallback answer is template text. Scoring it would report a healthy pass
  // rate for a setup where the model never ran.
  //
  // But advarsel alone is the wrong signal: a guardrail firing and a heuristic
  // overriding a vague model answer both set it, and in both cases the model
  // *did* run and the replacement is the behaviour under test. ai-gateway marks
  // a genuine provider fallback in `modell` ("…-fallback"), so that is the
  // discriminator; `sperre` covers the guardrails on /ai/sporsmaal.
  const providerFallback = String(body?.modell || "").includes("fallback");
  if (body?.advarsel && providerFallback && !body?.sperre) {
    return {
      name: testCase.name,
      passed: false,
      durationMs: Date.now() - started,
      results: [{ ok: false, type: "provider", detail: `fallback til maltekst: ${body.advarsel}` }],
      answer: body?.tekst ?? ""
    };
  }

  const text = testCase.textPath ? valueAtPath(body, testCase.textPath) : body?.tekst;
  const context = { text, body, status };

  const results = [];
  for (const check of testCase.checks) {
    if (check.type === "judge") {
      results.push({ ...(await runJudge(check, context)), type: "judge", label: check.criterion });
    } else {
      const run = deterministicChecks[check.type];
      if (!run) {
        results.push({ ok: false, type: check.type, detail: `ukjent sjekktype "${check.type}"` });
        continue;
      }
      results.push({ ...run(check, context), type: check.type, label: check.value ?? check.path ?? check.pattern });
    }
  }

  return {
    name: testCase.name,
    passed: results.every((r) => r.ok),
    durationMs: Date.now() - started,
    results,
    answer: text
  };
}

async function runDataset(file: string) {
  const dataset = JSON.parse(await readFile(file, "utf8"));
  const cases = [];
  for (const testCase of dataset.cases) {
    cases.push(await runCase(dataset, testCase));
  }
  const passed = cases.filter((c) => c.passed).length;
  const passRate = cases.length ? passed / cases.length : 0;
  const threshold = dataset.threshold ?? 1;
  return {
    name: dataset.name,
    description: dataset.description,
    endpoint: dataset.endpoint,
    file: path.relative(root, file),
    threshold,
    passRate,
    passed,
    total: cases.length,
    ok: passRate >= threshold,
    cases
  };
}

// --- reporting --------------------------------------------------------------

function escapeHtml(text: string) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function reportHtml(suites: any) {
  const body = suites.map((s: any) => `
    <section style="border:1px solid ${s.ok ? "#cbe3cb" : "#e8c4c4"}; border-radius:8px; margin-bottom:16px; padding:14px 18px;">
      <h2 style="margin:0 0 4px 0">${escapeHtml(s.name)}
        <span style="font-size:15px; font-weight:normal; color:${s.ok ? "#2a6b2a" : "#a32222"}">
          ${(s.passRate * 100).toFixed(0)}% (${s.passed}/${s.total}), terskel ${(s.threshold * 100).toFixed(0)}%
        </span>
      </h2>
      <p style="color:#666; margin:0 0 10px 0">${escapeHtml(s.description || "")} <code>${escapeHtml(s.endpoint)}</code></p>
      ${s.cases.map((c: any) => `
        <details style="margin-bottom:6px" ${c.passed ? "" : "open"}>
          <summary style="cursor:pointer; color:${c.passed ? "#2a6b2a" : "#a32222"}">
            ${c.passed ? "✓" : "✗"} ${escapeHtml(c.name)} <span style="color:#888">${c.durationMs} ms</span>
          </summary>
          <ul style="margin:6px 0">
            ${c.results.map((r: any) => `<li style="color:${r.ok ? "#2a6b2a" : "#a32222"}">
              <code>${escapeHtml(r.type)}</code> ${escapeHtml(r.label || "")} — ${escapeHtml(r.detail)}</li>`).join("")}
          </ul>
          <pre style="white-space:pre-wrap; background:#f6f6f6; padding:8px; border-radius:4px">${escapeHtml(c.answer)}</pre>
        </details>`).join("")}
    </section>`).join("");

  return `<!doctype html>
<html lang="nb"><head><meta charset="utf-8"><title>Eval-rapport</title></head>
<body style="font-family: Arial, sans-serif; padding:24px; max-width:960px">
  <h1>Eval-rapport</h1>
  <p style="color:#666">Kjørt ${new Date().toISOString()} mot <code>${escapeHtml(aiBaseUrl)}</code>.
     Nullstilles ikke — kjør på nytt for å oppdatere.</p>
  ${body}
</body></html>`;
}

// --- main -------------------------------------------------------------------

async function main() {
  const files = argFiles.length
    ? argFiles.map((f) => path.resolve(root, f))
    : (await readdir(evalsDir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => path.join(evalsDir, f));

  if (!files.length) {
    console.error("Fant ingen datasett i evals/.");
    process.exit(1);
  }

  // One clear failure beats a full run of misleading passes.
  const health = (await fetch(`${aiBaseUrl}/helse`).then((r) => r.json()).catch(() => null)) as
    { modellNaaBar?: boolean; feil?: string } | null;
  if (!health) {
    console.error(`Får ikke kontakt med ai-gateway på ${aiBaseUrl}. Start sandboxen først.`);
    process.exit(1);
  }
  if (!health?.modellNaaBar) {
    console.error(`Modellen er ikke koblet på: ${health?.feil || "ukjent årsak"}`);
    console.error("Evalen ville målt maltekst, ikke modellen. Avbryter.");
    process.exit(1);
  }

  const suites = [];
  for (const file of files) {
    if (!asJson) console.log(`\n▸ ${path.relative(root, file)}`);
    const suite = await runDataset(file);
    suites.push(suite);
    if (!asJson) {
      for (const c of suite.cases) {
        console.log(`  ${c.passed ? "✓" : "✗"} ${c.name}  (${c.durationMs} ms)`);
        for (const r of c.results.filter((x) => !x.ok)) {
          console.log(`      ${r.type}: ${r.detail}`);
        }
      }
      const pct = (suite.passRate * 100).toFixed(0);
      console.log(`  ${suite.ok ? "BESTÅTT" : "UNDER TERSKEL"}: ${pct}% (${suite.passed}/${suite.total}), terskel ${(suite.threshold * 100).toFixed(0)}%`);
    }
  }

  await mkdir(path.dirname(reportFile), { recursive: true });
  await writeFile(reportFile, reportHtml(suites), "utf8");

  if (asJson) {
    console.log(JSON.stringify(suites, null, 2));
  } else {
    console.log(`\nRapport: ${path.relative(root, reportFile)}`);
  }

  process.exit(suites.every((s) => s.ok) ? 0 : 1);
}

main().catch((error) => {
  console.error(`Eval feilet: ${feilmelding(error)}`);
  process.exit(1);
});
