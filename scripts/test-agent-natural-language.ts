#!/usr/bin/env node
import { feilmelding } from "../apps/shared/errors.ts";


const agentBaseUrl = process.env.AGENT_BASE_URL || "http://localhost:8084";

async function req(
  path: string,
  options: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}
): Promise<any> {
  const res = await fetch(`${agentBaseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  // Svarene fra endepunktene er `any` her med vilje: skriptet finnes for å påstå
  // noe om formen deres, og en type som lovet formen ville gjort påstanden sirkulær.
  const data = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(`${res.status} ${data.feil || "Feil"}`);
  }
  return data;
}

async function createSession(personId = "person-001") {
  return req("/agent/sessions", {
    method: "POST",
    body: JSON.stringify({ personId })
  });
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCase(name: string, fn: any) {
  process.stdout.write(`- ${name} ... `);
  await fn();
  console.log("OK");
}

async function run() {
  console.log("Testing natural-language process selection via process-agent");

  await runCase("maps 'farts dumper' to fartsdempende-tiltak", async () => {
    const session = await createSession();
    const result = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Eg vil soke om farts dumper" })
    });
    assert(result?.selectedProcess?.id === "fartsdempende-tiltak", `Expected fartsdempende-tiltak, got ${result?.selectedProcess?.id || "none"}`);
  });

  await runCase("maps free text to stottekontakt-behov", async () => {
    const session = await createSession();
    const result = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Jeg trenger hjelp med stottekontakt for barnet" })
    });
    assert(result?.selectedProcess?.id === "stottekontakt-behov", `Expected stottekontakt-behov, got ${result?.selectedProcess?.id || "none"}`);
  });

  await runCase("supports clarification flow when message is ambiguous", async () => {
    const session = await createSession();

    const first = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "jeg vil soke om redusert betaling" })
    });

    assert(Array.isArray(first.replies) && first.replies.length > 0, "Expected agent replies for ambiguous message");

    if (first?.selectedProcess?.id) {
      const allowed = new Set(["redusert-foreldrebetaling-barnehage", "sfo-moderasjon"]);
      assert(allowed.has(first.selectedProcess.id), `Expected one of redusert-foreldrebetaling-barnehage or sfo-moderasjon, got ${first.selectedProcess.id}`);
      return;
    }

    assert(Array.isArray(first.pendingProcessCandidates), "Expected pendingProcessCandidates in response");
    assert(first.pendingProcessCandidates.length >= 1, "Expected at least one pending process candidate");

    const followUp = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "den andre" })
    });

    const selectedId = followUp?.selectedProcess?.id;
    assert(Boolean(selectedId), "Expected selected process after clarification");
  });

  await runCase("supports discussion + summary confirmation in fartsdempende flow", async () => {
    const session = await createSession();

    const choose = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Eg vil soke om farts dumper" })
    });
    assert(choose?.selectedProcess?.id === "fartsdempende-tiltak", "Expected fartsdempende process to be selected");

    // Storgata, not Nordnesveien: person-001 owns matr-storg-003 and nothing else.
    // The old fixture worked because ownership was spread absurdly thin - 28 people
    // held 1280 titles, person-001 in 44 of 220 streets - so almost any street
    // passed the eierforhold check. Issue #8 was exactly that, and the flow stops at
    // that step when the applicant owns nothing in the street they name.
    const gate = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Storgata" })
    });
    assert(gate.replies.some((line: any) => line.toLowerCase().includes("mer enn 20 boliger")), "Expected home-count question after gate lookup");

    const homes = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "det er 38 boliger i gaten" })
    });
    assert(homes.replies.some((line: any) => line.toLowerCase().includes("trafikkproblemet")), "Expected follow-up question about traffic problem");

    // Ask for help on the traffic problem step → guided interview should start
    const askHelp = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "hvilke trafikkproblem kan være aktuelle?" })
    });
    assert(askHelp.replies.some((line: any) => /bra sp(ø|o)rsm(å|a)l|jeg stiller deg/i.test(line)), "Expected guided interview to start");
    assert(askHelp.replies.some((line: any) => line.toLowerCase().includes("trafikkproblemet") || line.toLowerCase().includes("problemet")), "Expected first guided question about the problem");

    // Answer the 4 guided interview questions one by one
    const a1 = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST", body: JSON.stringify({ message: "høy fart og mye gjennomkjøring" })
    });
    assert(a1.replies.some((line: any) => /når|tidspunkt/i.test(line)), "Expected question about timing");

    const a2 = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST", body: JSON.stringify({ message: "rushtid morgen og ettermiddag" })
    });
    assert(a2.replies.some((line: any) => /hvem|berørt/i.test(line)), "Expected question about who is affected");

    const a3 = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST", body: JSON.stringify({ message: "barn på skolevei og eldre fotgjengere" })
    });
    assert(a3.replies.some((line: any) => /tiltak/i.test(line)), "Expected question about desired measures");

    const a4 = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST", body: JSON.stringify({ message: "fartshumper og 30-sone" })
    });
    // After the last interview answer, agent shows composed description + summary + confirmation prompt
    assert(a4.replies.some((line: any) => line.toLowerCase().includes("satte sammen")), "Expected composed description to be shown");
    assert(a4.replies.some((line: any) => line.toLowerCase().includes("oppsummering:")), "Expected generated summary");
    assert(a4.replies.some((line: any) => line.toLowerCase().includes("er du enig i oppsummeringen")), "Expected summary confirmation prompt");
    // Deliberately no assertion on a specific property count: the summary reports
    // whatever data/matrikkel.json holds, and a count phrased off one seed state
    // ("mer enn 20 boliger") pins the data, not the behaviour.
    //
    // KNOWN GAP, deliberately not asserted here: the summary reports the register's
    // count and drops the citizen's own answer to boliger-bekreft entirely. That
    // step exists because "Matrikkelen kan være ufullstendig", so ignoring the
    // answer defeats its purpose. It is a grounding problem in the SUMMARY step, not
    // a data problem, and it needs its own fix.
    const oppsummeringstekst = a4.replies.join(" ").toLowerCase();
    assert(oppsummeringstekst.includes("storgata"), "Expected summary to name the street");
    assert(
      /boliger|boligeiendom|eiendommer/.test(oppsummeringstekst),
      "Expected summary to say something about the number of homes"
    );

    // Reject summary → should step back to the description question
    const disagree = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST", body: JSON.stringify({ message: "nei" })
    });
    assert(disagree.replies.some((line: any) => line.toLowerCase().includes("gar vi tilbake")), "Expected step back when summary is rejected");

    // Write a revised answer directly (without going through interview again)
    const rewrite = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message: "Det er hoy fart pa kveld og mange myke trafikanter. Vi onsker opphoyd gangfelt og 30-sone." })
    });
    assert(rewrite.replies.some((line: any) => line.toLowerCase().includes("er du enig i oppsummeringen")), "Expected confirmation prompt after revised summary");

    // Approve summary → proceed to submit
    const agree = await req(`/agent/sessions/${session.sessionId}/messages`, {
      method: "POST", body: JSON.stringify({ message: "ja" })
    });
    assert(agree.replies.some((line: any) => line.toLowerCase().includes("vil du at jeg skal sende inn")), "Expected submit prompt after summary approval");
  });

  console.log("All natural-language process selection checks passed.");
}

run().catch((error) => {
  console.error("Natural-language test failed:", feilmelding(error));
  process.exit(1);
});






