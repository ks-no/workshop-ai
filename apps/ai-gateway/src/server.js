import { createServer } from "node:http";
import { readFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Same split as sandbox-backend: everything written at runtime goes to state/,
// which is gitignored and cleared by ./start.sh --reset.
const stateDir = process.env.STATE_DIR || path.resolve(__dirname, "../../../state");
const traceFile = path.join(stateDir, "ai-trace.jsonl");
const port = Number(process.env.PORT) || 8082;
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://sandbox-backend:8080";
const aiProvider = (process.env.AI_PROVIDER || "mock").toLowerCase();
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
const openRouterModel = process.env.OPENROUTER_MODEL || "mistralai/mistral-7b-instruct:free";
// A large model on a slow machine can spend well over a minute on a SUMMARY
// step, so the ceiling is generous. The point is that the call eventually fails
// instead of hanging forever.
const modelTimeoutMs = Number(process.env.AI_TIMEOUT_MS) || 180000;

function jsonResponse(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(data, null, 2));
}

function textResponse(response, statusCode, data, contentType = "text/html; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.end(data);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// sandbox-backend owns the audit log. We send events there instead of writing
// the file ourselves, so there is only ever one writer.
//
// Auditing must never break the operation being audited: if the backend is
// unavailable we log locally and carry on.
async function leggTilRevisjon(hendelse) {
  try {
    const svar = await fetch(`${backendBaseUrl}/api/revisjonslogg`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hendelse),
      signal: AbortSignal.timeout(2000)
    });
    if (!svar.ok) {
      throw new Error(`status ${svar.status}`);
    }
  } catch (error) {
    console.warn(`Kunne ikke revisjonslogge mot sandbox-backend: ${error.message}`);
  }
}

function docsHtml() {
  return `
  <!doctype html>
  <html lang="nb">
    <head><meta charset="utf-8"><title>AI Gateway API</title></head>
    <body style="font-family: Arial, sans-serif; padding: 24px;">
      <h1>AI Gateway API</h1>
      <ul>
        <li><code>POST /ai/dialogforslag</code></li>
        <li><code>POST /ai/oppsummering</code></li>
        <li><code>POST /ai/forklar-databruk</code></li>
        <li><code>POST /ai/klarsprak</code></li>
        <li><code>POST /ai/risikosjekk</code></li>
        <li><code>POST /ai/tolk-svar</code></li>
        <li><code>POST /ai/velg-prosess</code></li>
        <li><code>POST /ai/velg-verktoy</code></li>
        <li><code>POST /ai/dommer</code> — LLM-dommer for <code>pnpm test:eval</code>. Revisjonslogges ikke.</li>
      </ul>
      <h2>Innsyn</h2>
      <ul>
        <li><a href="/trace"><code>GET /trace</code></a> — hva modellen faktisk fikk og svarte</li>
        <li><code>GET /trace.json</code> — samme som JSON. <code>?sporingsId=</code>, <code>?task=</code>, <code>?limit=</code></li>
        <li><code>GET /helse</code> — svarer provideren?</li>
      </ul>
    </body>
  </html>`;
}

// Newest first, and only as many as asked for.
async function readTrace({ limit = 50, sporingsId = null, task = null } = {}) {
  let raw;
  try {
    raw = await readFile(traceFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // A half-written last line must not break the whole view.
    }
  }

  return entries
    .filter((l) => !sporingsId || l.sporingsId === sporingsId)
    .filter((l) => !task || l.task === task)
    .slice(-limit)
    .reverse();
}

function escapeHtml(tekst) {
  return String(tekst ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function traceHtml(entries) {
  const rows = entries
    .map((l) => {
      const badge = l.failed
        ? `<span style="color:#b00">feilet</span>`
        : `<span style="color:#060">${escapeHtml(l.model)}</span>`;
      return `
      <details style="border:1px solid #ddd; border-radius:6px; margin-bottom:8px; padding:8px 12px;">
        <summary style="cursor:pointer">
          <code>${escapeHtml(l.task)}</code> &middot; ${badge} &middot;
          ${l.durationMs} ms &middot;
          <span style="color:#666">${escapeHtml(l.timestamp)}</span>
          ${l.sporingsId ? `&middot; <span style="color:#666">${escapeHtml(l.sporingsId)}</span>` : ""}
        </summary>
        ${l.error ? `<p style="color:#b00"><strong>Feil:</strong> ${escapeHtml(l.error)}</p>` : ""}
        <h4>Prompt</h4>
        <pre style="white-space:pre-wrap; background:#f6f6f6; padding:8px; border-radius:4px">${escapeHtml(l.prompt)}</pre>
        ${l.response ? `<h4>Svar</h4><pre style="white-space:pre-wrap; background:#f0f7f0; padding:8px; border-radius:4px">${escapeHtml(l.response)}</pre>` : ""}
      </details>`;
    })
    .join("");

  return `
  <!doctype html>
  <html lang="nb">
    <head><meta charset="utf-8"><title>KI-spor</title></head>
    <body style="font-family: Arial, sans-serif; padding: 24px; max-width: 900px;">
      <h1>KI-spor</h1>
      <p style="color:#666">
        Ett kall per linje, nyeste øverst. Klikk for å se prompten modellen faktisk fikk
        og hva den svarte — før heuristikk og validering har vært innom.
        Sporet ligger i <code>state/ai-trace.jsonl</code> og nullstilles av
        <code>./start.sh --reset</code>.
      </p>
      ${entries.length ? rows : "<p><em>Ingen modellkall registrert ennå. Kjør en flyt, og last siden på nytt.</em></p>"}
    </body>
  </html>`;
}

function buildTemplateResponse(type, body) {
  const tjeneste = body?.kontekst?.tjeneste || "kommunal tjeneste";
  const data = body?.kontekst?.data || {};
  const svar = body?.kontekst?.svar || {};

  function finnVerdi(predicate) {
    return Object.values(data || {}).find(predicate) || null;
  }

  function formatBelop(tall) {
    return new Intl.NumberFormat("nb-NO").format(Number(tall || 0));
  }

  function byggHusstandLinjer() {
    const husstand = finnVerdi((v) => v?.husstandId && Array.isArray(v?.medlemmer));
    if (!husstand) return null;
    const foresatte = husstand.medlemmer.filter((m) => m.rolle === "foresatt");
    const barn = husstand.medlemmer.filter((m) => m.rolle === "barn");
    const chunks = [`Husstand: ${husstand.adresse || husstand.husstandId}`];
    if (foresatte.length) chunks.push(`${foresatte.length} foresatt${foresatte.length !== 1 ? "e" : ""} (${foresatte.map((m) => m.personId).join(", ")})`);
    if (barn.length) chunks.push(`${barn.length} barn (${barn.map((m) => m.personId).join(", ")})`);
    return chunks.join(", ");
  }

  function byggInntektLinjer() {
    const beregning = finnVerdi((v) => v?.beregningsbeloep !== undefined);
    if (!beregning) return null;
    const poster = (beregning.visningsposter || [])
      .flatMap((v) => v.poster || [])
      .map((p) => `${p.visningstekst} ${formatBelop(p.beloep)} kr`)
      .join(", ");
    const utenfor = (beregning.fradrag?.beregning || [])
      .flatMap((g) => g.beregningsposter || [])
      .map((p) => p.visningstekst)
      .join(", ");
    const chunks = [`Inntektsgrunnlag ${beregning.inntektsaar}: ${formatBelop(beregning.beregningsbeloep)} kr`];
    if (poster) chunks.push(`bygget av ${poster}`);
    if (utenfor) chunks.push(`holdt utenfor: ${utenfor}`);
    if (beregning.stadie === "UTKAST") chunks.push("skatteoppgjoret er ikke ferdig");
    return chunks.join(". ");
  }

  function byggSvarLinjer() {
    const chunks = [];
    for (const [, verdi] of Object.entries(svar || {})) {
      if (typeof verdi === "string" && verdi.trim()) {
        chunks.push(verdi.trim().replace(/[.]+$/g, ""));
      } else if (typeof verdi === "object" && verdi !== null) {
        const values = Object.values(verdi).filter((v) => v && String(v).trim());
        if (values.length) chunks.push(values.map((v) => String(v).trim().replace(/[.]+$/g, "")).join(", "));
      }
    }
    return chunks.length ? chunks.join(" | ") : null;
  }

  function isAffirmative(verdi) {
    const tekst = String(verdi || "").toLowerCase().trim();
    const tallMatch = tekst.match(/\b(\d{1,4})\b/);
    if (tallMatch) {
      const antall = Number.parseInt(tallMatch[1], 10);
      if (Number.isFinite(antall)) {
        return antall > 20;
      }
    }
    return ["ja", "japp", "yes", "greit", "ok", "okei", "det stemmer", "riktig"].some((ord) => tekst.includes(ord));
  }

  function byggFartsdempendeOppsummering() {
    const gateData = finnVerdi((v) => v?.adressenavn && v?.antallEiendommer !== undefined);
    if (!gateData || !String(tjeneste).toLowerCase().includes("fartsdempende")) {
      return null;
    }

    const flereEnn20 = svar["boliger-bekreft"];
    const begrunnelse = String(svar.begrunnelse || "").trim();
    const eierSjekk = finnVerdi((v) => v?.godkjent !== undefined && typeof v?.melding === "string");

    const linjer = [
      `Her er en oppsummering av søknaden om fartsdempende tiltak i ${gateData.adressenavn}, ${gateData.kommune}.`,
      `Matrikkelen viser ${gateData.antallBoligeiendommer} boligeiendommer og ${gateData.antallEiendommer} eiendommer totalt i gaten.`
    ];

    if (eierSjekk?.godkjent) {
      linjer.push("Eierforholdet er kontrollert, og søker har registrert eiendom i gaten.");
    }

    if (flereEnn20) {
      linjer.push(
        isAffirmative(flereEnn20)
          ? "Søker opplyser at gaten har mer enn 20 boliger."
          : "Søker opplyser at gaten ikke har mer enn 20 boliger."
      );
    }

    if (begrunnelse) {
      linjer.push(`Begrunnelse fra søker: ${begrunnelse}`);
    }

    linjer.push("Søknaden sendes inn med disse opplysningene som grunnlag for videre vurdering.");
    return linjer.join(" ");
  }

  function byggGateLinje() {
    const gateData = finnVerdi((v) => v?.adressenavn && v?.antallEiendommer !== undefined);
    if (!gateData) return null;
    const boligInfo = gateData.antallBoligeiendommer !== undefined
      ? `${gateData.antallBoligeiendommer} boligeiendommer av totalt ${gateData.antallEiendommer}`
      : `${gateData.antallEiendommer} eiendommer`;
    return `Gate: ${gateData.adressenavn}, ${gateData.kommune || ""} (${boligInfo})`;
  }

  function byggOppsummeringstekst() {
    const fartsdempendeOppsummering = byggFartsdempendeOppsummering();
    if (fartsdempendeOppsummering) {
      return fartsdempendeOppsummering;
    }

    const gateLinje = byggGateLinje();
    const husstandLinje = byggHusstandLinjer();
    const inntektLinje = byggInntektLinjer();
    const svarLinje = byggSvarLinjer();

    const detaljer = [gateLinje, husstandLinje, inntektLinje, svarLinje].filter(Boolean);
    const detaljtekst = detaljer.length > 0
      ? detaljer.join(" | ")
      : "Vi fant relevante opplysninger i flyten.";

    return [
      `Her er en oppsummering av det vi har funnet for «${tjeneste}»:`,
      detaljtekst + ".",
      `Søknaden sendes inn med disse opplysningene som grunnlag.`
    ].join(" ");
  }

  const tekster = {
    dialogforslag: `Hei! Jeg kan hjelpe deg med ${tjeneste}. Vi går steg for steg og bruker bare syntetiske opplysninger i denne demoen.`,
    oppsummering: byggOppsummeringstekst(),
    "forklar-databruk": `Vi bruker opplysningene i denne demoen for å vise hvordan saksflyten kan bli enklere å forstå. Dataene er syntetiske og brukes ikke til reelle vedtak.`,
    klarsprak: "Dette betyr kort fortalt at du får en enklere forklaring på hvilke opplysninger som brukes og hvorfor.",
    risikosjekk: "Ingen kritiske risikoer funnet i denne demoen, men løsningen må fortsatt unngå reelle persondata og automatiserte vedtak."
  };

  return {
    tekst: tekster[type],
    syntetisk: true,
    modell: "mock-ai-gateway",
    sprak: body.sprak || "nb"
  };
}

// ---------------------------------------------------------------------------
// Tool selection — which MCP tools are relevant for a given process step
// ---------------------------------------------------------------------------

function heuristicToolChoice(body) {
  const steg = body?.steg || {};
  const tilgjengeligeVerktoy = Array.isArray(body?.verktoy) ? body.verktoy : [];
  const felter = Array.isArray(steg.felter) ? steg.felter : [];
  const alleStegTekster = normalizeText(
    [steg.id, steg.tittel, steg.tekst, ...(steg.felter || []).map((f) => `${f.id || ""} ${f.label || ""} ${f.placeholder || ""}`)].join(" ")
  );
  const gateInnsamling =
    alleStegTekster.includes("hvilken gate") ||
    alleStegTekster.includes("gatenavn") ||
    felter.some((f) => normalizeText(`${f.id || ""} ${f.label || ""}`).includes("gatenavn"));

  const TOOL_HEURISTICS = [
    {
      navn: "matrikkel_finn_veger",
      bruk: "kontekst_og_validering",
      nodvenligord: ["gate", "gatenavn", "veg"],
      begrunnelse: "Steget ber om gatenavn. Matrikkel kan foreslå kjente gater og normalisere svaret."
    },
    {
      navn: "matrikkel_hent_eiendom",
      bruk: "kontekst",
      nodvenligord: ["matrikkelenhet", "gnr", "bnr", "matrikkelnummer"],
      begrunnelse: "Steget refererer til matrikkelenhet. Matrikkel kan slå opp eiendomsdetaljer."
    }
  ];

  const forslag = [];
  for (const regel of TOOL_HEURISTICS) {
    if (!tilgjengeligeVerktoy.some((v) => v.name === regel.navn || v === regel.navn)) continue;
    if (regel.navn === "matrikkel_finn_veger" && !gateInnsamling) continue;
    if (regel.nodvenligord.some((ord) => alleStegTekster.includes(ord))) {
      forslag.push({ name: regel.navn, bruk: regel.bruk, begrunnelse: regel.begrunnelse });
    }
  }

  return { verktoy: forslag, modell: "heuristisk-verktoyvalg", syntetisk: true };
}

function buildToolChoicePrompt(body) {
  const steg = body?.steg || {};
  const verktoyListe = Array.isArray(body?.verktoy) ? body.verktoy : [];
  const stegTekst = JSON.stringify({ id: steg.id, tittel: steg.tittel, tekst: steg.tekst, felter: steg.felter });
  const verktoyTekst = verktoyListe
    .map((v) => `- ${v.name || v}: ${v.description || ""}`)
    .join("\n");

  return [
    "Du velger hvilke verktøy agenten bør bruke for et prosessteg i en kommunal dialogløsning.",
    "Svar KUN med gyldig JSON-array, ingen annen tekst.",
    'Hvert element: {"name":"<verktøynavn>","bruk":"kontekst|validering|kontekst_og_validering","begrunnelse":"..."}',
    '"kontekst" = kall proaktivt før spørsmålet stilles for å gi nyttige hint til brukeren.',
    '"validering" = kall etter at brukeren har svart, for å normalisere eller validere svaret.',
    '"kontekst_og_validering" = begge deler.',
    "Returner tom array [] hvis ingen verktøy er relevante.",
    `Steget:\n${stegTekst}`,
    `Tilgjengelige verktøy:\n${verktoyTekst}`
  ].join("\n");
}

function validateToolChoice(data, verktoyNavn) {
  if (!Array.isArray(data)) return null;
  const gyldige = new Set(Array.isArray(verktoyNavn) ? verktoyNavn : []);
  const validUsage = new Set(["kontekst", "validering", "kontekst_og_validering"]);
  return data
    .filter((v) => v && typeof v.name === "string" && gyldige.has(v.name) && validUsage.has(v.bruk))
    .map((v) => ({ name: v.name, bruk: v.bruk, begrunnelse: typeof v.begrunnelse === "string" ? v.begrunnelse : "" }));
}

async function chooseToolsWithAi(body) {
  const heuristisk = heuristicToolChoice(body);
  if (heuristisk.verktoy.length > 0) {
    return heuristisk;
  }

  const verktoyNavn = (body?.verktoy || []).map((v) => v.name || v);
  const prompt = buildToolChoicePrompt(body);

  if (aiProvider !== "ollama" && aiProvider !== "openrouter") {
    return heuristisk;
  }

  try {
    // This step expects JSON but runs on the free-text settings (temperature 0.2,
    // free-text system message). That was preserved, not chosen. Whether
    // temperature 0 and the JSON system message pick better tools is an empirical
    // question — measure it with the eval rather than guessing.
    const { tekst, modell } = await callModel(prompt, {
      task: "velg-verktoy",
      sporingsId: body?.sporingsId
    });
    const parsed = validateToolChoice(parseJsonObject(tekst), verktoyNavn);
    if (!parsed) throw new Error("Ugyldig JSON fra LLM");
    return { verktoy: parsed, modell, syntetisk: true };
  } catch (error) {
    return {
      ...heuristisk,
      modell: `${aiProvider || "mock"}-fallback`,
      advarsel: `LLM-verktøyvalg feilet: ${error.message}`
    };
  }
}

function buildPrompt(type, body, fallbackTekst) {
  const kontekst = body?.kontekst || {};
  const sprak = body?.sprak || "nb";

  // The summary restates amounts and an outcome already decided deterministically
  // in sandbox-backend. The model phrases; it does not compute or conclude.
  // See ai-no-decisions in policies/ai-policy.yaml.
  const sperrer = type === "oppsummering"
    ? [
        "Gjenta alle tall, beløp, datoer og navn nøyaktig slik de står i anbefalt innhold.",
        "Du skal ikke regne ut noe selv, og ikke innvilge eller avslå noe.",
        "Er et utfall allerede oppgitt, gjengi det uendret."
      ]
    : [];

  return [
    "Du er en hjelpsom assistent i en kommunal demosandbox.",
    `Svar kort på ${sprak} med klart språk uten personopplysninger utover det som er gitt.`,
    "Når du oppsummerer, si tydelig hva vi fant og hva som sendes inn.",
    ...sperrer,
    `Oppgavetype: ${type}`,
    `Tjeneste: ${kontekst.tjeneste || "ukjent"}`,
    `Steg: ${kontekst.steg?.tittel || kontekst.steg?.type || "ukjent"}`,
    `Anbefalt innhold: ${fallbackTekst}`,
    `Kontekst JSON: ${JSON.stringify(kontekst)}`
  ].join("\n");
}

function normalizeText(tekst) {
  return String(tekst || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const prosessvalgStopOrd = new Set([
  "eg",
  "jeg",
  "vil",
  "ville",
  "onsker",
  "onske",
  "soke",
  "soknad",
  "om",
  "den",
  "det",
  "en",
  "et",
  "for",
  "med",
  "hjelp"
]);

function stemProcessToken(token) {
  if (!token || token.length <= 3) return token;
  if (token.endsWith("ende") && token.length > 6) return token.slice(0, -4);
  if (token.endsWith("ene") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("er") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("en") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("e") && token.length > 4) return token.slice(0, -1);
  return token;
}

function canonicalProcessToken(token) {
  if (token.startsWith("fartsdemp") || token.startsWith("fart") || token.startsWith("dump") || token.startsWith("hump")) {
    return "fartsdemp";
  }
  if (token.startsWith("stottekont")) {
    return "stottekontakt";
  }
  return token;
}

function tokenizeProcessText(tekst) {
  return normalizeText(tekst)
    .split(/[\s-]+/)
    .map(stemProcessToken)
    .map(canonicalProcessToken)
    .filter((token) => token && !prosessvalgStopOrd.has(token));
}

function sharedTokenMatches(brukerToken, prosessToken) {
  const unikeBruker = [...new Set(brukerToken)];
  const unikeProsess = [...new Set(prosessToken)];
  let treff = 0;
  for (const token of unikeBruker) {
    if (unikeProsess.some((kandidatToken) => kandidatToken === token || kandidatToken.startsWith(token) || token.startsWith(kandidatToken))) {
      treff += 1;
    }
  }
  return {
    treff,
    brukerAntall: unikeBruker.length,
    prosessAntall: unikeProsess.length
  };
}

function heuristicProcessChoice(body) {
  const tekst = normalizeText(body?.tekst);
  const prosesser = Array.isArray(body?.prosesser) ? body.prosesser : [];

  if (!tekst || !prosesser.length) {
    return {
      intent: "unknown",
      confidence: 0,
      begrunnelse: "Mangler tekst eller prosesskandidater",
      kandidater: []
    };
  }

  const nummer = Number.parseInt(tekst, 10);
  if (Number.isInteger(nummer) && nummer >= 1 && nummer <= prosesser.length) {
    const valgt = prosesser[nummer - 1];
    return {
      intent: "match",
      prosessId: valgt.id,
      confidence: 0.99,
      begrunnelse: "Heuristisk match via nummer",
      kandidater: [{ id: valgt.id, navn: valgt.navn, score: 1 }]
    };
  }

  const byId = prosesser.find((p) => normalizeText(p.id) === tekst);
  if (byId) {
    return {
      intent: "match",
      prosessId: byId.id,
      confidence: 0.98,
      begrunnelse: "Heuristisk match via prosess-id",
      kandidater: [{ id: byId.id, navn: byId.navn, score: 0.98 }]
    };
  }

  const byName = prosesser.find((p) => {
    const navn = normalizeText(p.navn);
    return navn === tekst || navn.includes(tekst) || tekst.includes(navn);
  });
  if (byName) {
    return {
      intent: "match",
      prosessId: byName.id,
      confidence: 0.95,
      begrunnelse: "Heuristisk match via navn",
      kandidater: [{ id: byName.id, navn: byName.navn, score: 0.95 }]
    };
  }

  const brukerToken = tokenizeProcessText(tekst);
  if (!brukerToken.length) {
    return {
      intent: "unknown",
      confidence: 0.1,
      begrunnelse: "Ingen tydelige prosessord i meldingen",
      kandidater: []
    };
  }

  const scoredeKandidater = prosesser
    .map((prosess) => {
      const prosessToken = tokenizeProcessText(`${prosess.navn || ""} ${prosess.id || ""} ${prosess.beskrivelse || ""}`);
      const overlap = sharedTokenMatches(brukerToken, prosessToken);
      if (!overlap.treff) return null;

      const brukerDekning = overlap.treff / overlap.brukerAntall;
      const prosessDekning = overlap.treff / overlap.prosessAntall;
      const score = brukerDekning * 0.7 + prosessDekning * 0.3;

      return {
        id: prosess.id,
        navn: prosess.navn,
        score: Number(score.toFixed(3))
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!scoredeKandidater.length) {
    return {
      intent: "unknown",
      confidence: 0.1,
      begrunnelse: "Fant ingen relevante kandidater heuristisk",
      kandidater: []
    };
  }

  const topp = scoredeKandidater[0];
  const nest = scoredeKandidater[1];
  const avstand = nest ? topp.score - nest.score : topp.score;

  if (topp.score >= 0.5 && avstand >= 0.12) {
    return {
      intent: "match",
      prosessId: topp.id,
      confidence: Math.min(0.95, topp.score + 0.1),
      begrunnelse: "Heuristisk token-match med tydelig toppkandidat",
      kandidater: scoredeKandidater.slice(0, 3)
    };
  }

  if (topp.score >= 0.35) {
    return {
      intent: "ambiguous",
      confidence: topp.score,
      begrunnelse: "Flere mulige prosesser, trenger avklaring",
      kandidater: scoredeKandidater.slice(0, 3)
    };
  }

  return {
    intent: "unknown",
    confidence: topp.score,
    begrunnelse: "Lav treffsikkerhet i heuristisk prosessvalg",
    kandidater: scoredeKandidater.slice(0, 3)
  };
}

function buildProcessChoicePrompt(body) {
  const tekst = body?.tekst || "";
  const prosesser = Array.isArray(body?.prosesser) ? body.prosesser : [];
  const historikk = Array.isArray(body?.history) ? body.history.slice(-8) : [];
  const kandidaterTekst = prosesser
    .map((p, i) => `${i + 1}. id=${p.id}; navn=${p.navn}; beskrivelse=${p.beskrivelse || ""}`)
    .join("\n");

  return [
    "Du mapper brukerens melding til riktig kommunal prosess.",
    "Svar KUN med gyldig JSON, ingen forklaring utenfor JSON.",
    'Gyldig schema: {"intent":"match|ambiguous|unknown","prosessId":"string|null","confidence":0.0,"begrunnelse":"kort tekst","kandidater":[{"id":"string","score":0.0}]}',
    "Regler:",
    "- intent=match kun hvis en prosess er tydelig mest sannsynlig.",
    "- intent=ambiguous hvis 2-3 kandidater er plausible.",
    "- intent=unknown hvis du ikke kan avgjore trygg match.",
    "- prosessId ma vaere null ved ambiguous/unknown.",
    "- kandidater ma bruke id-er fra listen under.",
    `Prosesser:\n${kandidaterTekst}`,
    `Historikk (eldst -> nyest): ${JSON.stringify(historikk)}`,
    `Ny brukermelding: ${JSON.stringify(tekst)}`
  ].join("\n");
}

function validateProcessChoice(data, body) {
  const gyldigeIntent = new Set(["match", "ambiguous", "unknown"]);
  if (!data || !gyldigeIntent.has(data.intent)) {
    return null;
  }

  const prosesser = Array.isArray(body?.prosesser) ? body.prosesser : [];
  const gyldigeProsessIder = new Set(prosesser.map((p) => p.id));
  const confidence = Number(data.confidence);
  const kandidater = Array.isArray(data.kandidater)
    ? data.kandidater
      .filter((k) => k && gyldigeProsessIder.has(k.id))
      .map((k) => ({
        id: k.id,
        score: Number.isFinite(Number(k.score)) ? Math.max(0, Math.min(1, Number(k.score))) : 0.5
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    : [];

  const prosessId = typeof data.prosessId === "string" ? data.prosessId : null;
  const safeProsessId = prosessId && gyldigeProsessIder.has(prosessId) ? prosessId : null;

  return {
    intent: data.intent,
    prosessId: data.intent === "match" ? safeProsessId : null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    begrunnelse: typeof data.begrunnelse === "string" ? data.begrunnelse : "LLM prosessvalg",
    kandidater
  };
}

// Patterns match whole words, not substrings. With tekst.includes(), "uklart"
// matched "klar" and "nok" matched "ok", so both "det er uklart for meg" and
// "jeg har ikke nok informasjon" were recorded as consent.
// normalizeText has already stripped punctuation, so words are space-separated.
function containsPhrase(ord, uttrykk) {
  const chunks = uttrykk.split(" ");
  for (let i = 0; i <= ord.length - chunks.length; i += 1) {
    if (chunks.every((del, forskyvning) => ord[i + forskyvning] === del)) {
      return true;
    }
  }
  return false;
}

function heuristicIntent(body) {
  const ord = normalizeText(body?.tekst).split(" ").filter(Boolean);
  const jaIntent = body?.jaIntent || "ja";
  const neiIntent = body?.neiIntent || "nei";
  const ukjentIntent = body?.ukjentIntent || "ukjent";

  const positivePatterns = [
    "ja",
    "japp",
    "yes",
    "klart",
    "greit",
    "okei",
    "ok",
    "gjerne",
    "ja takk",
    "det går fint",
    "det er greit",
    "samtykker",
    "jeg samtykker",
    "eg samtykker",
    "godta",
    "godtar",
    "kjør på",
    "kjor pa",
    "send inn",
    "fortsett",
    "klar"
  ];

  const negativePatterns = [
    "nei",
    "nei takk",
    "ikke nå",
    "ikke na",
    "senere",
    "stopp",
    "vil ikke",
    "samtykker ikke",
    "ikke send",
    "avslå",
    "avsla"
  ];

  const negations = ["ikke", "ikkje", "aldri"];

  const treffer = (monstre) => monstre.some((monster) => containsPhrase(ord, monster));

  if (treffer(negativePatterns)) {
    return {
      intent: neiIntent,
      confidence: 0.8,
      begrunnelse: "Heuristisk negativ tolkning"
    };
  }

  if (treffer(positivePatterns)) {
    // "det er ikke greit" matches "greit". A negation we have no explicit negative
    // pattern for is too ambiguous to read as consent, so it goes to the model
    // rather than being guessed at here.
    if (ord.some((enkeltord) => negations.includes(enkeltord))) {
      return {
        intent: ukjentIntent,
        confidence: 0.2,
        begrunnelse: "Positivt uttrykk sammen med nekting, for utydelig for heuristikk"
      };
    }
    return {
      intent: jaIntent,
      confidence: 0.8,
      begrunnelse: "Heuristisk positiv tolkning"
    };
  }

  return {
    intent: ukjentIntent,
    confidence: 0.2,
    begrunnelse: "Fant ingen tydelig heuristisk intensjon"
  };
}

function buildIntentPrompt(body) {
  const jaIntent = body?.jaIntent || "ja";
  const neiIntent = body?.neiIntent || "nei";
  const ukjentIntent = body?.ukjentIntent || "ukjent";
  return [
    "Du klassifiserer en kort brukermelding i en kommunal chatflyt.",
    "Svar KUN med gyldig JSON og ingen annen tekst.",
    `Gyldige intent-verdier: ${jaIntent}, ${neiIntent}, ${ukjentIntent}`,
    `Hvis meldingen uttrykker samtykke, bekreftelse eller godkjenning, bruk ${jaIntent}.`,
    `Hvis meldingen uttrykker avslag, usikkerhet eller at brukeren ikke vil gå videre, bruk ${neiIntent}.`,
    `Hvis du ikke kan avgjøre det trygt, bruk ${ukjentIntent}.`,
    "Returner nøyaktig dette skjemaet:",
    '{"intent":"<verdi>","confidence":0.0,"begrunnelse":"kort forklaring"}',
    `Brukermelding: ${JSON.stringify(body?.tekst || "")}`,
    `Kontekst: ${JSON.stringify(body?.kontekst || {})}`
  ].join("\n");
}

function parseJsonObject(tekst) {
  const trimmet = String(tekst || "").trim();
  if (!trimmet) {
    return null;
  }

  try {
    return JSON.parse(trimmet);
  } catch {
    const start = trimmet.indexOf("{");
    const slutt = trimmet.lastIndexOf("}");
    if (start !== -1 && slutt !== -1 && slutt > start) {
      try {
        return JSON.parse(trimmet.slice(start, slutt + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function validateIntent(data, body) {
  const jaIntent = body?.jaIntent || "ja";
  const neiIntent = body?.neiIntent || "nei";
  const ukjentIntent = body?.ukjentIntent || "ukjent";
  const gyldige = new Set([jaIntent, neiIntent, ukjentIntent]);

  if (!data || !gyldige.has(data.intent)) {
    return null;
  }

  const confidence = Number(data.confidence);
  return {
    intent: data.intent,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    begrunnelse: typeof data.begrunnelse === "string" ? data.begrunnelse : "LLM-tolkning"
  };
}

// --- The single call site for the model -------------------------------------
//
// Every model call goes through callModel. There used to be six near-identical
// fetch functions — one per (provider x task) — and they had already drifted
// apart in system message and error text. One call site is also one place to put
// the timeout, the trace, and any new provider.
//
// The system message is used only by OpenRouter. Ollama's /api/generate takes a
// single prompt with no role structure.

const SYSTEM_FREETEXT = "Du skriver korte, tydelige svar pa norsk i en kommunal demosandbox.";
const SYSTEM_JSON = "Du returnerer kun gyldig JSON uten kodeblokker eller forklarende tekst.";

async function callOllama(prompt, temperature, signal) {
  const svar = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt,
      stream: false,
      options: { temperature: temperature }
    }),
    signal
  });
  if (!svar.ok) {
    throw new Error(`Ollama svarte med status ${svar.status}`);
  }
  const data = await svar.json();
  return {
    tekst: data.response?.trim() || "",
    modell: `ollama:${ollamaModel}`
  };
}

async function callOpenRouter(prompt, temperature, systemMessage, signal) {
  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY mangler");
  }
  const svar = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterApiKey}`
    },
    body: JSON.stringify({
      model: openRouterModel,
      temperature: temperature,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: prompt }
      ]
    }),
    signal
  });
  if (!svar.ok) {
    throw new Error(`OpenRouter svarte med status ${svar.status}`);
  }
  const data = await svar.json();
  return {
    tekst: data?.choices?.[0]?.message?.content?.trim() || "",
    modell: `openrouter:${openRouterModel}`
  };
}

// --- Trace ------------------------------------------------------------------
//
// One JSONL line per model call. Without it you cannot see what the model
// actually received and answered — only the result after heuristics and
// validation have been through it.
//
// Tracing must never break a call. If the write fails, the response still goes out.
async function writeTrace(linje) {
  try {
    await mkdir(stateDir, { recursive: true });
    await appendFile(traceFile, JSON.stringify(linje) + "\n", "utf8");
  } catch (feil) {
    console.error(`Kunne ikke skrive KI-spor: ${feil.message}`);
  }
}

// Cheap provider probe for /helse: lists models instead of generating text, so
// it is fast enough to run on every health call.
async function checkProvider() {
  if (aiProvider === "mock") {
    return { naaBar: false, modell: "mock-ai-gateway", feil: "AI_PROVIDER=mock: svar er maltekst, ikke en modell" };
  }

  if (aiProvider === "ollama") {
    const modell = `ollama:${ollamaModel}`;
    try {
      const svar = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!svar.ok) {
        return { naaBar: false, modell, feil: `Ollama svarte med status ${svar.status}` };
      }
      const data = await svar.json();
      const finnes = (data?.models || []).some((m) => m.name === ollamaModel || m.model === ollamaModel);
      if (!finnes) {
        return { naaBar: false, modell, feil: `Ollama kjoerer, men modellen ${ollamaModel} er ikke lastet ned` };
      }
      return { naaBar: true, modell };
    } catch (feil) {
      const melding = feil?.name === "TimeoutError" ? "Ollama svarte ikke innen 3000 ms" : feil.message;
      return { naaBar: false, modell, feil: `Naar ikke Ollama paa ${ollamaBaseUrl}: ${melding}` };
    }
  }

  if (aiProvider === "openrouter") {
    const modell = `openrouter:${openRouterModel}`;
    if (!openRouterApiKey) {
      return { naaBar: false, modell, feil: "OPENROUTER_API_KEY mangler" };
    }
    return { naaBar: true, modell };
  }

  return { naaBar: false, modell: null, feil: `Ukjent AI_PROVIDER: ${aiProvider}` };
}

// Returns { tekst, modell }. Throws on failure, timeout or unknown provider —
// callers already have fallback logic for that.
async function callModel(prompt, valg = {}) {
  const temperature = valg.temperature ?? 0.2;
  const systemMessage = valg.systemMessage || SYSTEM_FREETEXT;
  const start = Date.now();

  // Without a timeout a call hangs indefinitely when Ollama is slow or half-started,
  // and it looks like the sandbox itself has frozen.
  const signal = AbortSignal.timeout(modelTimeoutMs);

  const baseEntry = {
    timestamp: new Date().toISOString(),
    sporingsId: valg.sporingsId || null,
    task: valg.task || "ukjent",
    provider: aiProvider,
    temperature,
    prompt
  };

  try {
    let svar;
    if (aiProvider === "ollama") {
      svar = await callOllama(prompt, temperature, signal);
    } else if (aiProvider === "openrouter") {
      svar = await callOpenRouter(prompt, temperature, systemMessage, signal);
    } else {
      throw new Error(`Ukjent AI_PROVIDER: ${aiProvider}`);
    }

    await writeTrace({
      ...baseEntry,
      model: svar.modell,
      response: svar.tekst,
      durationMs: Date.now() - start,
      failed: false
    });
    return svar;
  } catch (feil) {
    const melding =
      feil?.name === "TimeoutError" || feil?.name === "AbortError"
        ? `Modellen svarte ikke innen ${modelTimeoutMs} ms`
        : feil.message;

    await writeTrace({
      ...baseEntry,
      model: null,
      response: null,
      durationMs: Date.now() - start,
      failed: true,
      error: melding
    });
    throw new Error(melding);
  }
}

// Task-specific calls. Each builds its prompt, calls the model, and validates the
// answer against a whitelist so hallucinated ids never get through.

// LLM-as-judge for scripts/eval.js. It lives here rather than in the eval script
// so it uses the configured provider, inherits the timeout, and shows up in the
// trace like any other model call.
//
// The judge never sees the expected answer — only the criterion and the text — so
// it cannot pattern-match its way to a passing score.
function buildJudgePrompt(body) {
  return [
    "Du er en streng evaluator. Vurder om teksten oppfyller kriteriet.",
    'Svar med kun JSON: {"score": <tall mellom 0.0 og 1.0>, "begrunnelse": "<kort>"}',
    "Ingen kodeblokker og ingen tekst utenfor JSON-en.",
    "1.0 betyr fullt oppfylt, 0.0 betyr ikke oppfylt i det hele tatt.",
    "Er du i tvil, gi lav score.",
    "",
    `Kriterium: ${body?.kriterium || "(mangler)"}`,
    "",
    "Tekst som skal vurderes:",
    String(body?.tekst ?? "")
  ].join("\n");
}

async function judgeWithAi(body) {
  const { tekst, modell } = await callModel(buildJudgePrompt(body), {
    temperature: 0,
    systemMessage: SYSTEM_JSON,
    task: "dommer",
    sporingsId: body?.sporingsId
  });
  const parsed = parseJsonObject(tekst);
  const score = Number(parsed?.score);
  if (!Number.isFinite(score)) {
    throw new Error(`Dommeren ga ikke et tall: ${String(tekst).slice(0, 120)}`);
  }
  return {
    score: Math.max(0, Math.min(1, score)),
    begrunnelse: typeof parsed.begrunnelse === "string" ? parsed.begrunnelse : "",
    modell,
    syntetisk: true
  };
}

async function getIntentFromModel(body) {
  const { tekst, modell } = await callModel(buildIntentPrompt(body), {
    temperature: 0,
    systemMessage: SYSTEM_JSON,
    task: "tolk-svar",
    sporingsId: body?.sporingsId
  });
  const parsed = validateIntent(parseJsonObject(tekst), body);
  if (!parsed) {
    throw new Error(`Kunne ikke tolke JSON-svar fra ${modell}`);
  }
  return { ...parsed, modell };
}

async function getProcessChoiceFromModel(body) {
  const { tekst, modell } = await callModel(buildProcessChoicePrompt(body), {
    temperature: 0,
    systemMessage: SYSTEM_JSON,
    task: "velg-prosess",
    sporingsId: body?.sporingsId
  });
  const parsed = validateProcessChoice(parseJsonObject(tekst), body);
  if (!parsed) {
    throw new Error(`Kunne ikke tolke prosessvalg fra ${modell}`);
  }
  return { ...parsed, modell };
}

async function interpretReplyWithAi(body) {
  const fallback = heuristicIntent(body);
  const ukjentIntent = body?.ukjentIntent || "ukjent";

  if (fallback.intent !== ukjentIntent && fallback.confidence >= 0.75) {
    return {
      ...fallback,
      syntetisk: true,
      modell: "heuristisk-tolkning"
    };
  }

  if (aiProvider !== "ollama" && aiProvider !== "openrouter") {
    return {
      ...fallback,
      syntetisk: true,
      modell: "heuristisk-tolkning"
    };
  }

  // The heuristic overrides the model when the model is vague — but only if the
  // heuristic found something itself.
  const override = (modell, begrunnelse) => ({
    ...fallback,
    syntetisk: true,
    modell: `${modell} (heuristisk overstyring)`,
    advarsel: begrunnelse
  });

  try {
    const llmSvar = { ...(await getIntentFromModel(body)), syntetisk: true };

    if (fallback.intent !== ukjentIntent) {
      if (llmSvar.intent === ukjentIntent) {
        return override(llmSvar.modell, "LLM returnerte ukjent, brukte heuristisk tolkning");
      }
      if (llmSvar.confidence < 0.6) {
        return override(llmSvar.modell, "LLM hadde lav trygghet, brukte heuristisk tolkning");
      }
    }
    return llmSvar;
  } catch (error) {
    return {
      ...fallback,
      syntetisk: true,
      modell: `${aiProvider || "mock"}-fallback`,
      advarsel: `LLM-tolkning feilet: ${error.message}`
    };
  }
}

async function chooseProcessWithAi(body) {
  const fallback = heuristicProcessChoice(body);
  if (fallback.intent === "match" && fallback.confidence >= 0.8) {
    return {
      ...fallback,
      syntetisk: true,
      modell: "heuristisk-prosessvalg"
    };
  }

  if (aiProvider !== "ollama" && aiProvider !== "openrouter") {
    return {
      ...fallback,
      syntetisk: true,
      modell: "heuristisk-prosessvalg"
    };
  }

  const override = (modell, begrunnelse) => ({
    ...fallback,
    syntetisk: true,
    modell: `${modell} (heuristisk overstyring)`,
    advarsel: begrunnelse
  });

  try {
    const llmSvar = { ...(await getProcessChoiceFromModel(body)), syntetisk: true };

    if (llmSvar.intent === "unknown" && fallback.intent !== "unknown") {
      return override(llmSvar.modell, "LLM returnerte unknown, brukte heuristisk prosessvalg");
    }
    if (llmSvar.intent === "match" && !llmSvar.prosessId && fallback.intent === "match") {
      return override(llmSvar.modell, "LLM returnerte ugyldig prosess-id, brukte heuristikk");
    }
    return llmSvar;
  } catch (error) {
    return {
      ...fallback,
      syntetisk: true,
      modell: `${aiProvider || "mock"}-fallback`,
      advarsel: `LLM-prosessvalg feilet: ${error.message}`
    };
  }
}

async function buildAiResponse(type, body) {
  const mockSvar = buildTemplateResponse(type, body);

  const prompt = buildPrompt(type, body, mockSvar.tekst);

  if (aiProvider !== "ollama" && aiProvider !== "openrouter") {
    return mockSvar;
  }

  try {
    // Temperature 0, not the 0.2 default. These tasks reproduce amounts, dates and
    // an outcome that sandbox-backend already decided — there is nothing to be
    // creative about, and evals/ai-policy.json needs the same input to give the
    // same answer twice.
    const llm = await callModel(prompt, {
      task: type,
      temperature: 0,
      sporingsId: body?.sporingsId
    });
    if (!llm.tekst) {
      throw new Error(`Tomt svar fra ${llm.modell}`);
    }
    return {
      tekst: llm.tekst,
      syntetisk: true,
      modell: llm.modell,
      sprak: body.sprak || "nb"
    };
  } catch (error) {
    return {
      ...mockSvar,
      modell: `${mockSvar.modell} (fallback)`,
      advarsel: `Provider ${aiProvider} feilet: ${error.message}`
    };
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonResponse(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse" || url.pathname === "/health") {
      // "The service answers" is not "the model answers". Without the provider
      // status here, a gateway with a dead model looks perfectly healthy, and the
      // failure first surfaces as template text in a response nobody suspects.
      const provider = await checkProvider();
      jsonResponse(response, 200, {
        status: "ok",
        tjeneste: "ai-gateway",
        provider: aiProvider,
        modell: provider.modell,
        modellNaaBar: provider.naaBar,
        ...(provider.feil ? { feil: provider.feil } : {}),
        tidspunkt: new Date().toISOString()
      });
      return;
    }

    if (url.pathname === "/docs") {
      textResponse(response, 200, docsHtml());
      return;
    }

    if (url.pathname === "/trace" || url.pathname === "/trace.json") {
      const trace = await readTrace({
        limit: Number(url.searchParams.get("limit")) || 50,
        sporingsId: url.searchParams.get("sporingsId"),
        task: url.searchParams.get("task")
      });
      if (url.pathname === "/trace.json") {
        jsonResponse(response, 200, { count: trace.length, trace });
      } else {
        textResponse(response, 200, traceHtml(trace));
      }
      return;
    }

    if (url.pathname === "/openapi.yaml") {
      const yaml = await readFile(path.resolve(__dirname, "../../../openapi/ai-gateway.yaml"), "utf8");
      textResponse(response, 200, yaml, "text/yaml; charset=utf-8");
      return;
    }

    if (request.method === "POST" && url.pathname === "/ai/tolk-svar") {
      const body = await readBody(request);
      const svar = await interpretReplyWithAi(body);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || newId("flyt"),
        handling: "KI_TOLKNING",
        ressurs: "tolk-svar",
        aktor: { type: "system", id: "ai-gateway" }
      });
      jsonResponse(response, 200, svar);
      return;
    }

    if (request.method === "POST" && url.pathname === "/ai/velg-prosess") {
      const body = await readBody(request);
      const svar = await chooseProcessWithAi(body);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || newId("flyt"),
        handling: "KI_TOLKNING",
        ressurs: "velg-prosess",
        aktor: { type: "system", id: "ai-gateway" }
      });
      jsonResponse(response, 200, svar);
      return;
    }

    // Not audited: this is a developer tool scoring text, never a lookup of
    // anyone's data.
    if (request.method === "POST" && url.pathname === "/ai/dommer") {
      const body = await readBody(request);
      if (!body?.kriterium || typeof body?.tekst !== "string") {
        jsonResponse(response, 400, { feil: "Krever feltene kriterium og tekst." });
        return;
      }
      jsonResponse(response, 200, await judgeWithAi(body));
      return;
    }

    if (request.method === "POST" && url.pathname === "/ai/velg-verktoy") {
      const body = await readBody(request);
      const svar = await chooseToolsWithAi(body);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || newId("flyt"),
        handling: "KI_TOLKNING",
        ressurs: "velg-verktoy",
        aktor: { type: "system", id: "ai-gateway" }
      });
      jsonResponse(response, 200, svar);
      return;
    }

    const gyldigeStier = ["/ai/dialogforslag", "/ai/oppsummering", "/ai/forklar-databruk", "/ai/klarsprak", "/ai/risikosjekk"];
    if (request.method === "POST" && gyldigeStier.includes(url.pathname)) {
      const body = await readBody(request);
      const type = url.pathname.replace("/ai/", "");
      const svar = await buildAiResponse(type, body);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || newId("flyt"),
        handling: "KI_KALL",
        ressurs: type,
        aktor: { type: "system", id: "ai-gateway" }
      });
      jsonResponse(response, 200, svar);
      return;
    }

    jsonResponse(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    jsonResponse(response, 500, { feil: "Intern feil i AI-gateway.", detalj: error.message, syntetisk: true });
  }
});

server.listen(port, () => {
  console.log(`AI-gateway kjører på http://localhost:${port}`);
});
