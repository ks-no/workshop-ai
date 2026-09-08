import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { createContext, SourceTextModule } from "node:vm";

// Run the shipped modules, including their imports and event handlers. Only the
// browser surface and HTTP transport are replaced; no client decisions are copied.
class Element {
  children: Element[] = [];
  textContent = "";
  value = "";
  disabled = false;
  className = "";
  dataset: Record<string, string> = {};
  selectedIndex = 0;
  options = [{ text: "Testperson" }];
  selectedOptions = [{ textContent: "Testperson" }];
  onclick: (() => unknown) | null = null;
  listeners: Record<string, (event: unknown) => unknown> = {};
  set innerHTML(_html: string) { this.children = []; }
  appendChild(child: Element): Element { this.children.push(child); return child; }
  querySelectorAll(): Element[] { return this.children; }
  querySelector(): null { return null; }
  addEventListener(name: string, callback: (event: unknown) => unknown): void { this.listeners[name] = callback; }
  focus(): void {}
}

type Call = { path: string; method: string; body: Record<string, unknown>; headers: Record<string, string> };
type Step = { id: string; type: string; tittel: string; felter?: unknown[] };
const step = (type: string, id = type.toLowerCase()): Step => ({ id, type, tittel: id });
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

async function client(name: "chat" | "agent", respond: (call: Call) => Response | Promise<Response>) {
  const elements = new Map<string, Element>();
  const element = (id: string): Element => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const messages: { role: string; text: string }[] = [];
  const calls: Call[] = [];
  let typing = false;
  const context = createContext({
    console,
    setTimeout: (callback: () => void) => { callback(); return 0; },
    document: { createElement: () => new Element(), createTextNode: () => new Element() },
    renderTopNav: () => {},
    krevEl: element,
    initChat: () => {},
    checkModell: () => {},
    requireLogin: async () => false,
    showLoggedInPerson: () => {},
    withToken: (headers: Record<string, string> = {}) => ({ ...headers, Authorization: "Bearer test" }),
    addMsg: (role: string, text: string) => { messages.push({ role, text }); return new Element(); },
    addTyping: () => { typing = true; },
    removeTyping: () => { typing = false; },
    addGrunnlagsfot: () => {},
    warnAboutFallback: () => {},
    feilmelding: (error: Error) => error.message,
    formatNumber: String,
    htmlEscape: String,
    alternativLabel: (value: string | { label: string }) => typeof value === "string" ? value : value.label,
    alternativVerdi: (value: string | { verdi: string }) => typeof value === "string" ? value : value.verdi,
    fetch: async (url: string, options: RequestInit = {}) => {
      const call: Call = {
        path: new URL(url).pathname, method: options.method || "GET",
        body: JSON.parse(String(options.body || "{}")) as Record<string, unknown>,
        headers: options.headers as Record<string, string>
      };
      calls.push(call);
      return respond(call);
    }
  });
  const modules = new Map<string, SourceTextModule>();
  async function load(file: string): Promise<SourceTextModule> {
    const cached = modules.get(file);
    if (cached) return cached;
    let source = await readFile(file, "utf8");
    if (file.endsWith("/chat.ts")) {
      source += "\nexport { loadOptions }; export const snapshot = () => JSON.stringify(oekt);";
    }
    const module = new SourceTextModule(stripTypeScriptTypes(source), { context, identifier: file });
    modules.set(file, module);
    await module.link((specifier, importer) => load(path.resolve(path.dirname(importer.identifier), specifier)));
    return module;
  }
  const module = await load(path.resolve(`apps/demo-gui/src/client/${name}.ts`));
  await module.evaluate();
  if (name === "chat") {
    await (module.namespace as { loadOptions: () => Promise<unknown> }).loadOptions();
  }
  element("person").value = "person-test";
  element("prosess").value = "prosess-test";
  return {
    calls, messages, element,
    get typing() { return typing; },
    snapshot: () => (module.namespace as { snapshot: () => string }).snapshot(),
    labels: () => element("quickActions").children.map((button) => button.textContent),
    async click(id: string) { await element(id).onclick?.(); },
    async quick(label: string) {
      const button = element("quickActions").children.find((node) => node.textContent === label);
      assert.ok(button, `Mangler knappen «${label}»`);
      assert.equal(button.disabled, false, `Knappen «${label}» skal være tilgjengelig`);
      await button.onclick?.();
    },
    async send(text: string) { element("input").value = text; await element("send").onclick?.(); }
  };
}

function backend(steps: Step[], options: { reject?: boolean } = {}) {
  let index = 0;
  let complete = false;
  let status = "AKTIV";
  let samtykkeId: string | null = null;
  const resultater: Record<string, unknown> = {};
  const svar: Record<string, unknown> = {};
  const state = () => ({
    oektsId: "oekt-test", prosessId: "prosess-test", sporingsId: "spor-test",
    personId: "person-test", stegIndex: index, totaltAntallSteg: steps.length,
    aktivtSteg: steps[index], aktivtStegFullfort: complete || steps[index].type === "INFO",
    aktivtSamtykkeId: samtykkeId, status, resultater, svar,
    avvistMelding: status === "AVVIST" ? "Inntekten er over grensen." : undefined
  });
  function respond(call: Call): Response {
    if (call.path === "/api/personer") return json([]);
    if (call.path === "/api/prosesser") return json([{ id: "prosess-test", navn: "Test", steg: steps }]);
    if (call.path === "/api/regler/satser") return json({});
    if (call.path === "/api/prosessoekter" || call.method === "GET") return json(state());
    if (call.path === "/ai/sporsmaal") return json({ tekst: "Det skyldes inntektsgrensen." });
    assert.equal(status, "AKTIV", "En lukket økt skal aldri få en mutasjon");
    if (call.path.endsWith("/neste")) {
      assert.ok(complete || steps[index].type === "INFO", "Et ufullført steg skal ikke hoppes over");
      index += 1;
      complete = false;
      return json(state());
    }
    if (call.path.endsWith("/svar")) {
      svar[steps[index].id] = call.body.svar;
      complete = true;
      return json(state());
    }
    assert.ok(call.path.endsWith("/handling"), `Uventet kall: ${call.path}`);
    if (call.body.handling === "opprett-samtykke") {
      samtykkeId = "samtykke-test";
      return json({ oekt: state(), resultat: { status: "VENTER_PAA_SVAR" } });
    }
    complete = true;
    if (steps[index].type === "SJEKK" && options.reject) status = "AVVIST";
    if (steps[index].type === "SUBMIT") status = "FULLFORT";
    const resultat = steps[index].type === "SJEKK"
      ? { godkjent: !options.reject, melding: options.reject ? "Inntekten er over grensen." : "Godkjent." }
      : { tekst: "Opplysninger hentet.", status: call.body.status };
    resultater[steps[index].id] = resultat;
    return json({ oekt: state(), resultat });
  }
  return { state, respond };
}

let passed = 0;
async function test(name: string, run: () => Promise<void>) {
  await run();
  passed += 1;
  console.log(`✓ ${name}`);
}

for (const type of ["DATA_FETCH", "SJEKK", "SUMMARY"]) {
  for (const retry of ["knapp", "tekst"]) {
    await test(`${type}: 502 etterfulgt av nytt forsøk med ${retry}`, async () => {
      const api = backend([step("INFO"), step(type), step("QUESTION")]);
      let fail = true;
      const ui = await client("chat", (call) => {
        if (call.path.endsWith("/handling") && fail) { fail = false; return json({ feil: "Midlertidig feil" }, 502); }
        return api.respond(call);
      });
      await ui.click("start");
      await ui.quick("Start");
      assert.ok(ui.messages.some((message) => message.role === "error" && message.text.includes("Midlertidig feil")));
      assert.deepEqual(ui.labels(), ["Prøv igjen"]);
      assert.equal(ui.typing, false);
      assert.equal(api.state().stegIndex, 1);
      await ui.send("Hvorfor trenger dere opplysningene?");
      assert.deepEqual(ui.labels(), ["Prøv igjen"]);
      assert.equal(api.state().stegIndex, 1);
      if (retry === "knapp") await ui.quick("Prøv igjen");
      else await ui.send("prøv igjen");
      assert.equal(ui.calls.filter((call) => call.path.endsWith("/handling")).length, 2);
      assert.equal(api.state().stegIndex, 2);
      assert.ok(ui.calls.some((call) => call.method === "GET" && call.path.endsWith("/oekt-test")));
      assert.equal(ui.typing, false);
      assert.equal(ui.element("send").disabled, false);
    });
  }
}

for (const malformed of ["json", "oekt", "resultat", "neste"]) {
  await test(`Ugyldig ${malformed}: bevarer økten og gjentar ikke et lagret steg`, async () => {
    const api = backend([step("DATA_FETCH"), step("QUESTION")]);
    let fail = true;
    const ui = await client("chat", (call) => {
      const result = api.respond(call);
      if (fail && call.path.endsWith(malformed === "neste" ? "/neste" : "/handling")) {
        fail = false;
        if (malformed === "json") return new Response("<html>Feil</html>");
        if (malformed === "resultat") return json({ oekt: api.state(), resultat: 42 });
        return json({});
      }
      return result;
    });
    await ui.click("start");
    assert.deepEqual(ui.labels(), ["Prøv igjen"]);
    assert.ok(ui.snapshot().includes("oekt-test"), "Et ugyldig svar skal ikke slette økten");
    await ui.quick("Prøv igjen");
    assert.equal(api.state().stegIndex, 1);
    assert.equal(ui.calls.filter((call) => call.path.endsWith("/handling")).length, 1);
    assert.equal(ui.calls.filter((call) => call.path.endsWith("/neste")).length, 1);
  });
}

await test("Nettverksbrudd i /neste: gjentar ikke DATA_FETCH", async () => {
  const api = backend([step("DATA_FETCH"), step("QUESTION")]);
  let fail = true;
  const ui = await client("chat", (call) => {
    if (fail && call.path.endsWith("/neste")) { fail = false; throw new Error("Frakoblet"); }
    return api.respond(call);
  });
  await ui.click("start");
  await ui.quick("Prøv igjen");
  assert.equal(api.state().stegIndex, 1);
  assert.equal(ui.calls.filter((call) => call.path.endsWith("/handling")).length, 1);
});

await test("To automatiske steg: nytt forsøk treffer steget som feilet", async () => {
  const api = backend([step("DATA_FETCH"), step("SJEKK"), step("QUESTION")]);
  let fail = true;
  const ui = await client("chat", (call) => {
    if (fail && call.path.endsWith("/handling") && api.state().stegIndex === 1) {
      fail = false;
      return json({ feil: "Midlertidig feil" }, 502);
    }
    return api.respond(call);
  });
  await ui.click("start");
  await ui.quick("Prøv igjen");
  assert.equal(api.state().stegIndex, 2);
  assert.equal(ui.calls.filter((call) => call.path.endsWith("/handling")).length, 3);
});

await test("Feil under gjenlesing: beholder forsøket uten å sende en mutasjon", async () => {
  const api = backend([step("SUMMARY"), step("QUESTION")]);
  let failHandling = true;
  let failRead = true;
  const ui = await client("chat", (call) => {
    if (failHandling && call.path.endsWith("/handling")) {
      failHandling = false;
      return json({ feil: "Midlertidig feil" }, 502);
    }
    if (failRead && call.method === "GET" && call.path.endsWith("/oekt-test")) {
      failRead = false;
      return json({});
    }
    return api.respond(call);
  });
  await ui.click("start");
  const snapshot = ui.snapshot();
  await ui.quick("Prøv igjen");
  assert.equal(ui.snapshot(), snapshot);
  assert.equal(ui.calls.filter((call) => call.path.endsWith("/handling")).length, 1);
  assert.deepEqual(ui.labels(), ["Prøv igjen"]);
  await ui.quick("Prøv igjen");
  assert.equal(api.state().stegIndex, 1);
});

for (const type of ["SJEKK", "SUBMIT"]) {
  await test(`Tapt svar fra ${type}: viser lagret utfall uten å mutere en lukket økt`, async () => {
    const api = backend([step(type)], { reject: true });
    let fail = true;
    const ui = await client("chat", (call) => {
      const response = api.respond(call);
      if (fail && call.path.endsWith("/handling")) {
        fail = false;
        return new Response("<html>Forbindelsen ble brutt</html>", { status: 502 });
      }
      return response;
    });
    await ui.click("start");
    if (type === "SUBMIT") await ui.quick("Ja, send inn");
    assert.ok(ui.messages.some((message) => message.role === "error"));
    await ui.quick("Prøv igjen");
    assert.equal(ui.calls.filter((call) => call.path.endsWith("/handling")).length, 1);
    assert.equal(ui.calls.filter((call) => call.path.endsWith("/neste")).length, 0);
    assert.ok(ui.messages.some((message) => message.text.includes(type === "SJEKK" ? "Inntekten er over grensen." : "Søknaden er sendt inn.")));
    await ui.send("ja");
    assert.equal(ui.calls.filter((call) => call.path.endsWith("/handling")).length, 1);
    if (type === "SJEKK") assert.ok(ui.labels().includes("Hvorfor ble det slik?"));
  });
}

await test("Samtykkeknappens feil vises, og dobbelttrykk gir bare ett nytt forsøk", async () => {
  const api = backend([step("CONSENT_REQUEST"), step("QUESTION")]);
  let fail = true;
  let release: (() => void) | undefined;
  const ui = await client("chat", async (call) => {
    if (call.path.endsWith("/handling") && fail) { fail = false; return json({ feil: "Fiks svarer ikke" }, 502); }
    if (call.method === "GET" && call.path.endsWith("/oekt-test")) {
      await new Promise<void>((resolve) => { release = resolve; });
    }
    return api.respond(call);
  });
  await ui.click("start");
  await ui.quick("Ja, det går fint");
  assert.ok(ui.messages.some((message) => message.role === "error" && message.text.includes("Fiks svarer ikke")));
  const retryButton = ui.element("quickActions").children[0];
  const first = retryButton.onclick?.();
  const second = retryButton.onclick?.();
  await ui.click("reset");
  assert.ok(ui.snapshot().includes("oekt-test"));
  assert.ok(release);
  release();
  await Promise.all([first, second]);
  assert.equal(api.state().stegIndex, 1);
  assert.equal(ui.calls.filter((call) => call.body.handling === "samtykkesvar").length, 1);
});

await test("Avslag: forklaringsknapper og frie spørsmål uten mutasjoner", async () => {
  const api = backend([step("SJEKK"), step("SUBMIT")], { reject: true });
  const ui = await client("chat", api.respond);
  await ui.click("start");
  assert.deepEqual(ui.labels(), ["Hvorfor ble det slik?", "Hvilke opplysninger brukte dere?", "Hva skjer med opplysningene mine?"]);
  const snapshot = ui.snapshot();
  const mutations = ui.calls.filter((call) => call.method === "POST").length;
  for (const label of ui.labels()) await ui.quick(label);
  await ui.send("Hvorfor ble søknaden avvist?");
  for (const text of ["ja", "prøv igjen", "svar: send inn", "svar: hvorfor?"]) await ui.send(text);
  assert.equal(ui.snapshot(), snapshot);
  const questions = ui.calls.filter((call) => call.path === "/ai/sporsmaal");
  assert.equal(questions.length, 4);
  assert.equal((questions[0].body.kontekst as { flyt: { status: string } }).flyt.status, "AVVIST");
  assert.equal(ui.calls.filter((call) => call.method === "POST").length, mutations + 4);
  assert.ok(!ui.labels().includes("Nei, dette var svaret mitt"));
  assert.ok(!ui.messages.some((message) => message.text.includes("flyten står på pause")));
  assert.ok(!ui.messages.some((message) => message.text.includes("Da er vi ferdige")));
});

await test("Avslag med ugyldig KI-svar: viser feilen og beholder forklaringsknappene", async () => {
  const api = backend([step("SJEKK"), step("SUBMIT")], { reject: true });
  const ui = await client("chat", (call) => call.path === "/ai/sporsmaal" ? json({}) : api.respond(call));
  await ui.click("start");
  const before = ui.snapshot();
  await ui.quick("Hvorfor ble det slik?");
  assert.equal(ui.snapshot(), before);
  assert.ok(ui.messages.some((message) => message.role === "error" && message.text.includes("uten tekst")));
  assert.ok(ui.labels().includes("Hvorfor ble det slik?"));
  assert.equal(ui.typing, false);
});

await test("Ugyldig opprettelsessvar viser ikke en gammel økt", async () => {
  const api = backend([step("INFO"), step("QUESTION")]);
  let fail = false;
  const ui = await client("chat", (call) => call.path === "/api/prosessoekter" && fail ? json({}) : api.respond(call));
  await ui.click("start");
  fail = true;
  await ui.click("start");
  assert.equal(ui.snapshot(), "null");
  assert.equal(ui.element("sessionInfo").textContent, "Ingen aktiv prosess.");
  assert.deepEqual(ui.labels(), []);
});

await test("Flere obligatoriske felt beholdes gjennom sidespørsmål og feil", async () => {
  const question = { ...step("QUESTION"), felter: [
    { id: "navn", label: "Hva heter du?", type: "tekst", obligatorisk: true },
    { id: "formaal", label: "Velg formål", type: "valg", alternativer: ["barnehage", "skole"], obligatorisk: true }
  ] };
  const api = backend([question, step("SUBMIT")]);
  let fail = true;
  const ui = await client("chat", (call) => {
    if (fail && call.path.endsWith("/svar")) { fail = false; return json({ feil: "Midlertidig feil" }, 502); }
    return api.respond(call);
  });
  await ui.click("start");
  await ui.send("Testperson");
  await ui.send("Hvem ser opplysningene?");
  await ui.send("barnehage");
  await ui.quick("Prøv igjen");
  assert.deepEqual(api.state().svar.question, { navn: "Testperson", formaal: "barnehage" });
  assert.equal(api.state().stegIndex, 1);
});

await test("Et svar som avvises etter nytt forsøk kan rettes", async () => {
  const api = backend([step("QUESTION"), step("SUBMIT")]);
  let attempts = 0;
  const ui = await client("chat", (call) => {
    if (call.path.endsWith("/svar")) {
      attempts += 1;
      if (attempts === 1) return json({ feil: "Midlertidig feil" }, 502);
      if (attempts === 2) return json({ feil: "Svaret må rettes" }, 400);
    }
    return api.respond(call);
  });
  await ui.click("start");
  await ui.send("Ugyldig svar");
  await ui.quick("Prøv igjen");
  assert.ok(!ui.labels().includes("Prøv igjen"));
  await ui.send("Rettet svar");
  assert.equal(api.state().svar.question, "Rettet svar");
  assert.equal(api.state().stegIndex, 1);
});

for (const status of ["AVVIST", "FULLFORT", "AKTIV", "ukjent", "feil"]) {
  await test(`Agentens awaiting:null viser riktig status: ${status}`, async () => {
    const ui = await client("agent", (call) => {
      if (call.path === "/agent/sessions") return json({ sessionId: "agent-test", message: "Velg prosess." });
      if (call.path.endsWith("/messages")) return json({ sessionId: "agent-test", awaiting: null, replies: ["Svar."], oektsId: "oekt-test" });
      assert.equal(call.method, "GET");
      assert.equal(call.headers.Authorization, "Bearer test");
      return status === "feil" ? json({ feil: "Frakoblet" }, 502) : json({ status });
    });
    await ui.click("start");
    await ui.send("Fortsett");
    assert.equal(ui.messages.some((message) => message.text === "Prosessen er fullført."), status === "FULLFORT");
    if (status === "AVVIST") {
      assert.ok(ui.element("sessionInfo").textContent.includes("avvist"));
      assert.ok(ui.messages.some((message) => message.text.includes("Søknaden er avvist")));
    }
    if (status === "AKTIV") assert.ok(ui.element("sessionInfo").textContent.includes("pågår"));
  });
}

await test("Agentens process_end avslutter dialogen uten å påstå innsending", async () => {
  const ui = await client("agent", (call) => call.path === "/agent/sessions"
    ? json({ sessionId: "agent-test", message: "Velg prosess." })
    : json({ sessionId: "agent-test", awaiting: "process_end", replies: ["Ingen flere steg."], oektsId: "oekt-test" }));
  await ui.click("start");
  await ui.send("Fortsett");
  assert.ok(ui.element("sessionInfo").textContent.includes("Status: dialog avsluttet uten innsending"));
  assert.ok(ui.messages.some((message) => message.text.includes("Du kan starte en ny sesjon.")));
  assert.ok(!ui.messages.some((message) => message.text === "Prosessen er fullført."));
  assert.equal(ui.calls.filter((call) => call.path.startsWith("/api/prosessoekter")).length, 0);
  assert.equal(ui.element("start").disabled, false);
  await ui.click("reset");
  assert.equal(ui.element("sessionInfo").textContent, "Ingen aktiv agent-sesjon.");
});

for (const data of [null, {}, { sessionId: "agent-test", replies: [] }, { sessionId: "agent-test", awaiting: null, replies: [1] }]) {
  await test(`Ugyldig agentsvar: ${JSON.stringify(data)}`, async () => {
    const ui = await client("agent", (call) => call.path === "/agent/sessions"
      ? json({ sessionId: "agent-test", message: "Velg prosess." }) : json(data));
    await ui.click("start");
    await ui.send("Fortsett");
    assert.ok(ui.messages.some((message) => message.role === "error"));
    assert.ok(!ui.messages.some((message) => message.text === "Prosessen er fullført."));
    assert.equal(ui.element("send").disabled, false);
  });
}

console.log(`Chat og agent: ${passed} regresjoner bestått uten tjenester eller modell.`);
