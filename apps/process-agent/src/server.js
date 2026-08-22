import { createServer } from "node:http";

const port = Number(process.env.PORT || 8084);
const mcpBaseUrl = process.env.MCP_BASE_URL || "http://mcp-services:8083";

const sessions = new Map();

function json(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  });
  response.end(JSON.stringify(data, null, 2));
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

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const processChoiceStopWords = new Set([
  "eg",
  "jeg",
  "vil",
  "ville",
  "onsk",
  "sok",
  "soknad",
  "om",
  "pa",
  "for",
  "den",
  "det",
  "en",
  "et",
  "hjelp",
  "med"
]);

function stemToken(token) {
  const ord = normalize(token);
  if (ord.length <= 3) return ord;
  if (ord.endsWith("ende") && ord.length > 6) return ord.slice(0, -4);
  if (ord.endsWith("ene") && ord.length > 5) return ord.slice(0, -3);
  if (ord.endsWith("ing") && ord.length > 5) return ord.slice(0, -3);
  if (ord.endsWith("er") && ord.length > 4) return ord.slice(0, -2);
  if (ord.endsWith("en") && ord.length > 4) return ord.slice(0, -2);
  if (ord.endsWith("e") && ord.length > 4) return ord.slice(0, -1);
  return ord;
}

function canonicalizeProcessToken(token) {
  if (token.startsWith("fartsdemp") || token.startsWith("fart") || token.startsWith("dump") || token.startsWith("hump")) {
    return "fartsdemp";
  }
  if (token.startsWith("stottekont")) {
    return "stottekontakt";
  }
  return token;
}

function tokenizeForProcessChoice(text) {
  return normalize(text)
    .split(/[\s-]+/)
    .map(stemToken)
    .map(canonicalizeProcessToken)
    .filter((token) => token && !processChoiceStopWords.has(token));
}

function tokenMatches(a, b) {
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function countTokenOverlap(userTokens, processTokens) {
  const uniqueUser = [...new Set(userTokens)];
  const uniqueProcess = [...new Set(processTokens)];
  let matches = 0;

  for (const userToken of uniqueUser) {
    if (uniqueProcess.some((processToken) => tokenMatches(userToken, processToken))) {
      matches += 1;
    }
  }

  return {
    matches,
    userCount: uniqueUser.length,
    processCount: uniqueProcess.length
  };
}

function parseChoiceIndex(text, max) {
  const value = normalize(text);
  if (!value) return null;

  const ordinalMap = {
    forste: 1,
    andre: 2,
    tredje: 3,
    fjerde: 4,
    femte: 5
  };

  if (/^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return parsed >= 1 && parsed <= max ? parsed : null;
  }

  const tokens = value.split(/\s+/);
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      const parsed = Number.parseInt(token, 10);
      if (parsed >= 1 && parsed <= max) {
        return parsed;
      }
    }
    if (ordinalMap[token]) {
      const parsed = ordinalMap[token];
      if (parsed <= max) {
        return parsed;
      }
    }
  }

  return null;
}

function listProcessesPrompt(processes) {
  const lines = processes.map((p, i) => `${i + 1}. ${p.navn} (${p.id})`).join("\n");
  return [
    "Hei! Jeg kan hjelpe deg med å velge prosess og guide deg steg for steg.",
    "Velg en prosess ved å skrive nummer, navn, eller id:",
    lines
  ].join("\n\n");
}

async function invokeTool(name, args = {}) {
  const res = await fetch(`${mcpBaseUrl}/mcp/tools/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args })
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.detalj || data.feil || `Tool call feilet: ${name}`);
  }
  return data.result;
}

function parseProcessChoice(text, processes) {
  const value = normalize(text);

  const number = parseChoiceIndex(value, processes.length);
  if (number) {
    return processes[number - 1];
  }

  const byId = processes.find((p) => normalize(p.id) === value);
  if (byId) return byId;

  const byNameExact = processes.find((p) => normalize(p.navn) === value);
  if (byNameExact) return byNameExact;

  const byNameContains = processes.find((p) => {
    const navn = normalize(p.navn);
    return navn.includes(value) || value.includes(navn);
  });
  if (byNameContains) return byNameContains;

  const userTokens = tokenizeForProcessChoice(value);
  if (userTokens.length > 0) {
    let bestMatch = null;
    let bestScore = 0;

    for (const process of processes) {
      const processTokens = tokenizeForProcessChoice(`${process.navn || ""} ${process.id || ""}`);
      if (!processTokens.length) continue;

      const overlap = countTokenOverlap(userTokens, processTokens);
      if (!overlap.matches) continue;

      const userCoverage = overlap.matches / overlap.userCount;
      const processCoverage = overlap.matches / overlap.processCount;
      const score = userCoverage * 0.7 + processCoverage * 0.3;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = process;
      }
    }

    // Threshold avoids accidentally selecting a process from very weak token overlap.
    if (bestMatch && bestScore >= 0.4) {
      return bestMatch;
    }
  }

  return null;
}

function formatProcessOptions(processes, title) {
  const lines = processes.map((process, index) => `${index + 1}. ${process.navn} (${process.id})`).join("\n");
  return [title, lines].join("\n\n");
}

function mapCandidateProcesses(allProcesses, candidates = []) {
  const byId = new Map((allProcesses || []).map((p) => [p.id, p]));
  return (candidates || [])
    .map((candidate) => {
      const process = byId.get(candidate.id);
      if (!process) return null;
      return {
        ...process,
        score: candidate.score
      };
    })
    .filter(Boolean);
}

function recentHistory(state, count = 8) {
  return (state.history || []).slice(-count).map((entry) => ({
    role: entry.role,
    message: entry.message
  }));
}

function parseNumberFromText(text) {
  const match = normalize(text).match(/\b(\d{1,4})\b/);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function normalizeQuestionAnswer(stepId, text) {
  const value = String(text || "").trim();
  if (!stepId || !value) {
    return { answer: value, inferred: false, note: null, valid: Boolean(value), retryMessage: value ? null : "Svar gjerne med en verdi." };
  }

  if (stepId === "boliger-bekreft") {
    const lower = normalize(value);
    const number = parseNumberFromText(value);

    if (number !== null) {
      return {
        answer: number > 20 ? "ja" : "nei",
        inferred: true,
        valid: true,
        retryMessage: null,
        note: number > 20
          ? "Takk, jeg tolker dette som at gaten har mer enn 20 boliger."
          : "Takk, jeg tolker dette som at gaten ikke har mer enn 20 boliger."
      };
    }

    if (/(flere enn|mer enn|over)\s*20/.test(lower)) {
      return {
        answer: "ja",
        inferred: true,
        valid: true,
        retryMessage: null,
        note: "Takk, jeg tolker dette som at gaten har mer enn 20 boliger."
      };
    }

    if (/(mindre enn|under)\s*20/.test(lower)) {
      return {
        answer: "nei",
        inferred: true,
        valid: true,
        retryMessage: null,
        note: "Takk, jeg tolker dette som at gaten ikke har mer enn 20 boliger."
      };
    }

    const jaNei = normalize(value);
    if (["ja", "japp", "yes", "nei", "no"].includes(jaNei)) {
      return {
        answer: jaNei.startsWith("ja") || jaNei === "yes" ? "ja" : "nei",
        inferred: true,
        valid: true,
        retryMessage: null,
        note: null
      };
    }

    return {
      answer: null,
      inferred: false,
      valid: false,
      note: null,
      retryMessage: "Jeg trenger et ja/nei-svar eller et tall for antall boliger, for eksempel 'ja', 'nei' eller 'det er 24 boliger'."
    };
  }

  return { answer: value, inferred: false, note: null, valid: true, retryMessage: null };
}

// Per-step guided interview: ordered questions to collect before composing a final answer.
const guidedInterviewDefinitions = {
  begrunnelse: [
    {
      key: "problem",
      question: "Hva er selve trafikkproblemet i gaten? (for eksempel høy fart, mye gjennomkjøring, uoversiktlig kryss)"
    },
    {
      key: "tidspunkt",
      question: "Når på dagen eller uken skjer problemet? (for eksempel rushtid, på skolevei om morgenen, i helgene)"
    },
    {
      key: "berort",
      question: "Hvem blir berørt? (for eksempel barn på skolevei, eldre fotgjengere, syklister)"
    },
    {
      key: "tiltak",
      question: "Hva slags tiltak ønsker du? (for eksempel fartshumper, 30-sone, opphøyd gangfelt, innsnevring)"
    }
  ]
};

function composeGuidedAnswer(stepId, answers) {
  if (stepId === "begrunnelse") {
    const parts = [];
    if (answers.problem) {
      parts.push(String(answers.problem).trim().replace(/\.+$/, ""));
    }
    if (answers.tidspunkt) {
      const t = String(answers.tidspunkt).trim().replace(/\.+$/, "").toLowerCase();
      parts.push(`Dette skjer ${t}`);
    }
    if (answers.berort) {
      const b = String(answers.berort).trim().replace(/\.+$/, "");
      parts.push(`${b} blir berørt`);
    }
    if (answers.tiltak) {
      const ti = String(answers.tiltak).trim().replace(/\.+$/, "").toLowerCase();
      parts.push(`Vi ønsker ${ti}`);
    }
    return parts.join(". ") + ".";
  }
  return Object.values(answers).filter(Boolean).join(". ");
}

function looksLikeHelpQuestion(stepId, text) {
  if (!stepId) return false;
  const value = String(text || "").trim();
  if (!value) return false;

  // Only treat as help request when the step has a guided interview defined
  if (!guidedInterviewDefinitions[stepId]) return false;

  if (value.includes("?")) return true;
  const lower = normalize(value);
  return ["hvilke", "hva", "hvordan", "kan du", "eksempel", "tips", "hjelp"].some(
    (prefix) => lower.startsWith(prefix) || lower.includes(`${prefix} `)
  );
}

function fallbackGuidanceForQuestion(stepId) {
  if (stepId === "boliger-bekreft") {
    return "Du kan svare med ja/nei eller et tall, for eksempel 'ja', 'nei' eller 'det er 38 boliger'.";
  }
  return "Svar gjerne kort med de viktigste opplysningene, så hjelper jeg deg videre.";
}

function extractLookupCandidate(text) {
  let value = String(text || "").trim().replace(/[?]+$/g, "").trim();
  if (!value) return "";

  const lower = normalize(value);
  const prefixes = [
    "er det en gate som heter ",
    "finnes det en gate som heter ",
    "finnes det gate som heter ",
    "finnes ",
    "finns ",
    "fins ",
    "er det ",
    "har dere ",
    "kan du sjekke ",
    "kan du finne ",
    "finn "
  ];

  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      value = value.slice(prefix.length).trim();
      break;
    }
  }

  value = value.replace(/\bi matrikkelen\b/gi, "").trim();
  value = value.replace(/^en gate som heter\s+/i, "").trim();
  value = value.replace(/^gate som heter\s+/i, "").trim();
  value = value.replace(/\bfinnes\s+den\b/gi, "").trim();

  // Natural language fallback: pick the last "i <sted/gate>" phrase.
  const iMatches = [...value.matchAll(/\bi\s+([^,?.!]+)/gi)];
  if (iMatches.length > 0) {
    value = iMatches[iMatches.length - 1][1].trim();
  }

  value = value.replace(/^(en|ei|et)\s+/i, "").trim();
  value = value.replace(/^(gate|gaten|gante|veg|veien|vegen)\s+/i, "").trim();
  value = value.replace(/[,:;.!]+$/g, "").trim();

  value = value.replace(/^['"`]+|['"`]+$/g, "").trim();
  return value;
}

function isLikelyGateQuestionStep(step) {
  const allText = normalize(`${step?.id || ""} ${step?.tittel || ""} ${step?.tekst || ""}`);
  return allText.includes("gate") || allText.includes("gatenavn");
}

function extractPossibleGateMention(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  const renset = value.replace(/\d+[\p{L}]?$/u, "").trim();
  const match = renset.match(/\b([\p{L}][\p{L}-]*(?:gata|gate|veien|vegen))\b/iu);
  return match?.[1] || null;
}

function utledGateSoeketekst(rawText) {
  const raatekst = String(rawText || "").trim();
  if (!raatekst) return "";

  // Accept both "Storgata 5" and compact forms like "Bønesheien258".
  const utenHusnummer = raatekst.replace(/[\s,]*\d+[\p{L}]?$/u, "").trim();
  if (utenHusnummer) return utenHusnummer;

  return extractPossibleGateMention(raatekst) || raatekst;
}

function extractPossibleAdresseMention(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  const direkte = value.match(/\b([\p{L}][\p{L}\s.-]*(?:gata|gate|veien|vegen)\s+\d+[\p{L}]?)\b/iu);
  if (direkte?.[1]) {
    return direkte[1].replace(/\s+/g, " ").trim();
  }

  const lookup = extractLookupCandidate(value);
  const medNummer = lookup.match(/([\p{L}][\p{L}\s.-]*(?:gata|gate|veien|vegen)\s+\d+[\p{L}]?)/iu);
  return medNummer?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function extractPossibleOrgnr(text) {
  const match = String(text || "").match(/\b(\d{9})\b/);
  return match?.[1] || null;
}

function extractBrregQuery(text) {
  let value = String(text || "").trim().replace(/[?]+$/g, "").trim();
  if (!value) return "";

  const quoted = value.match(/["'`“”]([^"'`“”]{2,})["'`“”]/);
  if (quoted?.[1]) return quoted[1].trim();

  const prefixes = [
    /^hva vet du om\s+/i,
    /^kan du finne\s+/i,
    /^kan du sjekke\s+/i,
    /^finn\s+/i,
    /^sok opp\s+/i,
    /^sok\s+/i,
    /^hvem er\s+/i,
    /^hva er\s+/i,
    /^oppslag\s+pa\s+/i,
    /^brreg\s+/i,
    /^enhetsregisteret\s+/i
  ];

  for (const pattern of prefixes) {
    value = value.replace(pattern, "").trim();
  }

  value = value
    .replace(/\b(i|fra)\s+brreg\b/gi, "")
    .replace(/\b(i|fra)\s+enhetsregisteret\b/gi, "")
    .replace(/\borganisasjon(en)?\b/gi, "")
    .replace(/\bbedrift(en)?\b/gi, "")
    .replace(/\bfirma(et)?\b/gi, "")
    .replace(/\borg\.?(nr|nummer)?\b/gi, "")
    .replace(/[,:;.!]+$/g, "")
    .trim();

  return value;
}

function extractPossibleFnr(text) {
  const match = String(text || "").match(/\b(\d{11})\b/);
  return match?.[1] || null;
}

function extractFolkeregisterQuery(text) {
  let value = String(text || "").trim().replace(/[?]+$/g, "").trim();
  const quoted = value.match(/["'`""]([^"'`""]{2,})["'`""]/);
  if (quoted?.[1]) return quoted[1].trim();

  const prefixes = [
    /^hva vet du om\s+/i,
    /^hvem er\s+/i,
    /^finn\s+/i,
    /^kan du finne\s+/i,
    /^sok\s+/i,
    /^sok opp\s+/i,
    /^folkeregister(et)?\s*/i,
    /^person(en)?\s+/i
  ];
  for (const pattern of prefixes) {
    value = value.replace(pattern, "").trim();
  }
  return value
    .replace(/\bi\s+folkeregister(et)?\b/gi, "")
    .replace(/\bfolkeregister(et)?\b/gi, "")
    .replace(/[,:;.!]+$/g, "")
    .trim();
}

async function maybeAnswerFolkeregisterQuestion(text) {
  const lower = normalize(text);
  const mentionsPerson = [
    "folkeregister",
    "person",
    "fodselsnummer",
    "fnr",
    "bosatt",
    "registrert",
    "hvem bor"
  ].some((term) => lower.includes(term));
  if (!mentionsPerson) return null;

  // 11-digit fnr takes priority
  const fnr = extractPossibleFnr(text);
  if (fnr) {
    try {
      const person = await invokeTool("folkeregister_get_person", { foedselsEllerDNummer: fnr });
      const navn = person.personnavn;
      const fullNavn = [navn?.fornavn, navn?.mellomnavn, navn?.etternavn].filter(Boolean).join(" ");
      const kommune = person.bostedsadresse?.kommune || "ukjent kommune";
      return `${fullNavn} (${fnr}) er registrert bosatt i ${kommune}.`;
    } catch {
      return `Jeg fant ingen person med fødselsnummer ${fnr} i folkeregisteret (testdata).`;
    }
  }

  const query = extractFolkeregisterQuery(text);
  if (!query || query.length < 2) {
    return "Jeg kan slå opp personer i folkeregisteret (testdata). Oppgi navn eller fødselsnummer.";
  }

  try {
    const result = await invokeTool("folkeregister_search_persons", { query, limit: 5 });
    const treff = Array.isArray(result?.personer) ? result.personer : [];
    if (!treff.length) {
      return `Jeg fant ingen personer som matcher «${query}» i folkeregisteret (testdata).`;
    }
    if (treff.length === 1) {
      const p = treff[0];
      const navn = p.personnavn;
      const fullNavn = [navn?.fornavn, navn?.mellomnavn, navn?.etternavn].filter(Boolean).join(" ");
      const kommune = p.bostedsadresse?.kommune || "ukjent";
      return `Jeg fant ${fullNavn} (fnr: ${p.foedselsEllerDNummer}) registrert i ${kommune}.`;
    }
    const liste = treff.slice(0, 5).map((p) => {
      const navn = p.personnavn;
      return [navn?.fornavn, navn?.mellomnavn, navn?.etternavn].filter(Boolean).join(" ");
    }).join(", ");
    return `Jeg fant flere treff i folkeregisteret (testdata): ${liste}.`;
  } catch {
    return "Jeg klarte ikke gjøre folkeregister-oppslaget akkurat nå. Prøv igjen om litt.";
  }
}

async function maybeAnswerBrregQuestion(text) {
  const lower = normalize(text);
  const mentionsBrreg = [
    "brreg",
    "enhetsregister",
    "organisasjon",
    "orgnr",
    "organisasjonsnummer",
    "bedrift",
    "firma"
  ].some((term) => lower.includes(term));
  if (!mentionsBrreg) return null;

  const organisasjonsnummer = extractPossibleOrgnr(text);
  if (organisasjonsnummer) {
    try {
      const org = await invokeTool("brreg_get_organisation", { organisasjonsnummer });
      const kommune = org?.forretningsadresse?.kommune || org?.postadresse?.kommune || "ukjent kommune";
      const form = org?.organisasjonsform?.kode || org?.organisasjonsform?.beskrivelse || "ukjent organisasjonsform";
      return `${org.navn} (${org.organisasjonsnummer}) er registrert som ${form} i ${kommune}.`;
    } catch {
      return `Jeg fant ingen organisasjon med organisasjonsnummer ${organisasjonsnummer} i BRREG-testdata.`;
    }
  }

  const query = extractBrregQuery(text);
  if (!query || query.length < 2) {
    return "Jeg kan slå opp organisasjoner i BRREG-testdata. Oppgi gjerne organisasjonsnummer (9 siffer) eller navn.";
  }

  try {
    const result = await invokeTool("brreg_search_organisations", { query, limit: 5, offset: 0 });
    const treff = Array.isArray(result?.organisasjoner) ? result.organisasjoner : [];
    if (!treff.length) {
      return `Jeg fant ingen organisasjoner som matcher «${query}» i BRREG-testdata.`;
    }
    if (treff.length === 1) {
      const org = treff[0];
      const kommune = org?.forretningsadresse?.kommune || "ukjent kommune";
      return `Jeg fant ${org.navn} (${org.organisasjonsnummer}) i ${kommune}.`;
    }
    return `Jeg fant flere treff i BRREG-testdata: ${treff.slice(0, 5).map((org) => `${org.navn} (${org.organisasjonsnummer})`).join(", ")}.`;
  } catch {
    return "Jeg klarte ikke gjøre BRREG-oppslaget akkurat nå. Prøv igjen om litt.";
  }
}

async function maybeAnswerPreciseMatrikkelQuestion(text) {
  if (!text.includes("?")) return null;
  const lower = normalize(text);
  const adresse = extractPossibleAdresseMention(text);
  if (!adresse) return null;

  try {
    const eiendom = await invokeTool("matrikkel_hent_eiendom", { adresse });
    if (lower.includes("hvem eier") || lower.includes("kven eig") || lower.includes("eier")) {
      const eiere = await invokeTool("matrikkel_hent_eiere", { adresse });
      if (!eiere.eiere?.length) {
        if (eiere.syntetisk === false) {
          return `Jeg finner eiendommen ${eiendom.adresse}, men den offentlige adressekilden inneholder ikke eierinformasjon.`;
        }
        return `Jeg finner eiendommen ${eiendom.adresse}, men mocken har ingen registrerte eiere på den akkurat nå.`;
      }
      return `${eiendom.adresse} er registrert med eier${eiere.eiere.length > 1 ? "e" : ""}: ${eiere.eiere.join(", ")}.`;
    }

    return `Ja, ${eiendom.adresse} finnes i matrikkelen. Den har gnr ${eiendom.gnr} og bnr ${eiendom.bnr}.`;
  } catch {
    return `Jeg fant ikke adressen ${adresse} i matrikkelen.`;
  }
}

// ---------------------------------------------------------------------------
// Dynamisk verktøyoppdagelse via suggest_step_tools
// ---------------------------------------------------------------------------

// Decide which step-level tools to run and how: "kontekst", "validering", or both.
// Returns { kontekst: [{name, args}], validering: [{name, args}] }
async function discoverStepTools(step) {
  if (!step || step.type !== "QUESTION") return { kontekst: [], validering: [] };
  try {
    const result = await invokeTool("suggest_step_tools", {
      steg: { id: step.id, tittel: step.tittel, tekst: step.tekst, felter: step.felter || [] }
    });
    const verktoy = Array.isArray(result?.verktoy) ? result.verktoy : [];
    const kontekst = verktoy.filter((v) => v.bruk === "kontekst" || v.bruk === "kontekst_og_validering");
    const validering = verktoy.filter((v) => v.bruk === "validering" || v.bruk === "kontekst_og_validering");
    return { kontekst, validering };
  } catch {
    return { kontekst: [], validering: [] };
  }
}

// Run a single context tool and format its result as a human-readable hint line.
async function runKontekstTool(toolName, stepAnswer) {
  if (toolName === "matrikkel_finn_veger") {
    try {
      const gater = await invokeTool("matrikkel_finn_veger", { all: true, limit: 12, offset: 0 });
      if (Array.isArray(gater) && gater.length > 0) {
        const forslag = gater.slice(0, 6).map((g) => g.adressenavn).join(", ");
        return `Eksempler på veier i matrikkelen: ${forslag}. Du kan søke på alle veier ved å skrive hele eller deler av gatenavnet.`;
      }
    } catch {
      // ignore – context hint is optional
    }
  }
  return null;
}

// Run a single validation tool against the user's raw answer.
// Returns { answer, inferred, note } on success, or null when the answer is invalid.
// On invalid input returns { retry, hint } so the agent can ask the user to try again.
async function runValideringTool(toolName, userText) {
  if (toolName === "matrikkel_finn_veger") {
    try {
      const query = utledGateSoeketekst(userText);

      const gateTreff = await invokeTool("matrikkel_finn_veger", { gate: query, all: true, limit: 10, offset: 0 });
      const treffliste = Array.isArray(gateTreff) ? gateTreff : [];
      if (treffliste.length > 0) {
        const kandidat = treffliste[0];
        if (!kandidat?.adressenavn) {
          return { retry: true, hint: "Jeg fant ikke et gyldig gatenavn. Prøv et annet søk." };
        }
        const fraOffentligKilde = typeof kandidat.gateId === "string" && kandidat.gateId.startsWith("geo-");
        const inputNormalisert = normalize(query);
        const gateNormalisert = normalize(kandidat.adressenavn);
        const erEksaktTreff = inputNormalisert === gateNormalisert;
        if (!erEksaktTreff) {
          const forslag = treffliste.slice(0, 5).map((g) => g.adressenavn).join(", ");
          return {
            confirm: true,
            proposedAnswer: kandidat.adressenavn,
            question: `Jeg fant flere treff i matrikkelen (${forslag}). Mener du ${kandidat.adressenavn}? Svar ja/nei.`
          };
        }
        return {
          answer: kandidat.adressenavn,
          inferred: true,
          note: fraOffentligKilde
            ? `Takk, jeg fant ${kandidat.adressenavn} i offentlig adressekilde og bruker det gatenavnet videre.`
            : `Takk, jeg fant ${kandidat.adressenavn} i matrikkelen og bruker det gatenavnet videre.`
        };
      }
    } catch {
      // Gate not found – build a retry hint
    }
    // Build suggestions for retry
    try {
      const gater = await invokeTool("matrikkel_finn_veger", { all: true, limit: 12, offset: 0 });
      const forslag = Array.isArray(gater) ? gater.slice(0, 6).map((g) => g.adressenavn).join(", ") : null;
      return {
        retry: true,
        hint: forslag
          ? `Jeg fant ikke gaten i matrikkelen med det navnet. Prøv gjerne en av disse: ${forslag}.`
          : "Jeg fant ikke gaten i matrikkelen med det navnet. Prøv et annet gatenavn."
      };
    } catch {
      return { retry: true, hint: "Jeg fant ikke gaten i matrikkelen. Prøv et annet gatenavn." };
    }
  }
  return null;
}

async function moveSessionToStepId(state, targetStepId) {
  const steg = Array.isArray(state.processDefinition?.steg) ? state.processDefinition.steg : [];
  const targetIndex = steg.findIndex((s) => s.id === targetStepId);
  if (targetIndex === -1) return false;

  for (let i = 0; i < 30; i += 1) {
    const session = await invokeTool("get_session", { oektsId: state.oektsId });
    state.lastSession = session;
    if (session?.aktivtSteg?.id === targetStepId) return true;

    if (typeof session?.stegIndex === "number") {
      if (session.stegIndex > targetIndex) {
        await invokeTool("previous_step", { oektsId: state.oektsId });
        continue;
      }
      if (session.stegIndex < targetIndex) {
        await invokeTool("next_step", { oektsId: state.oektsId });
        continue;
      }
    }

    // Fallback when stegIndex is unavailable.
    try {
      await invokeTool("previous_step", { oektsId: state.oektsId });
    } catch {
      return false;
    }
  }
  return false;
}

function findProcessStepById(state, stepId) {
  const steg = state.processDefinition?.steg;
  if (!Array.isArray(steg) || !stepId) return null;
  return steg.find((s) => s.id === stepId) || null;
}

function findNextFreeTextQuestionStep(state, fromStepId) {
  const steg = state.processDefinition?.steg;
  if (!Array.isArray(steg)) return null;
  const fromIndex = steg.findIndex((s) => s.id === fromStepId);
  if (fromIndex === -1) return null;

  for (let i = fromIndex + 1; i < steg.length; i += 1) {
    const kandidat = steg[i];
    if (kandidat.type !== "QUESTION") continue;
    if (kandidat.id === "boliger-bekreft") continue;
    return kandidat;
  }
  return null;
}

function maybeCaptureDeferredAnswer(state, currentStepId, text) {
  const value = String(text || "").trim();
  if (!value || value.includes("?")) return null;
  if (value.length < 12) return null;

  const targetStep = findNextFreeTextQuestionStep(state, currentStepId);
  if (!targetStep) return null;

  state.deferredAnswers[targetStep.id] = value;
  return {
    targetStep,
    message: `Jeg lagrer dette som utkast til «${targetStep.tittel || targetStep.id}».`
  };
}

function maybeAnswerProcessMetaQuestion(state, text) {
  if (!text.includes("?")) return null;
  const lower = normalize(text);
  const step = state.lastSession?.aktivtSteg;

  // "hva skjer" alone was too greedy: it swallowed "hva skjer med opplysningene
  // mine?", which maybeAnswerCitizenQuestion can actually answer.
  if (["hva skjer na", "hva skjer videre", "hvor er vi", "hvilket steg", "hva er neste", "hva gjenstar", "hvor langt"].some((q) => lower.includes(q))) {
    const navn = step?.tittel || step?.id || "ukjent steg";
    const steg = Array.isArray(state.processDefinition?.steg) ? state.processDefinition.steg : [];
    const idx = typeof state.lastSession?.stegIndex === "number" ? state.lastSession.stegIndex : -1;
    const remaining = idx >= 0 ? Math.max(steg.length - idx - 1, 0) : null;
    if (remaining === null) {
      return `Akkurat nå er vi i steget «${navn}».`;
    }
    return `Akkurat nå er vi i steget «${navn}». Etter dette gjenstår ${remaining} steg.`;
  }

  if (["kan jeg bytte gate", "endre gate", "annen gate"].some((q) => lower.includes(q))) {
    return "Ja. Skriv hvilken gate du vil bruke, så oppdaterer vi det før innsending.";
  }

  // A "hvorfor"-clause used to live here and returned a generic non-answer for
  // every why-question. It was removed rather than kept as a fallback: it sat
  // ahead of every other handler, so maybeAnswerCitizenQuestion — which has the
  // schemes and the process definition to answer from — never saw one.

  return null;
}

/*
 * Last stop in the detour chain: a question the precise register lookups above
 * could not answer. Grounded in the schemes, the process definition and what
 * this session has already fetched, with the guardrails in ai-gateway on top.
 *
 * Never touches state.awaiting. The flow is paused, not moved — an answer here
 * costs the citizen one turn, and losing their place would cost far more.
 */
/*
 * Says explicitly what has *not* happened yet. Without it the model reads the
 * step named "Send søknad" in the process definition and reports it as done.
 */
function byggFlyt(state) {
  const oekt = state.lastSession;
  if (!oekt) return null;
  const steg = state.processDefinition?.steg || [];
  const submitSteg = steg.find((s) => s.type === "SUBMIT");
  const index = typeof oekt.stegIndex === "number" ? oekt.stegIndex : 0;

  return {
    staarPaa: oekt.aktivtSteg?.tittel || oekt.aktivtSteg?.type || null,
    stegNummer: index + 1,
    avTotalt: oekt.totaltAntallSteg ?? steg.length,
    status: oekt.status,
    fullforteSteg: steg.slice(0, index).map((s) => s.tittel || s.id),
    gjenstaaendeSteg: steg.slice(index).map((s) => s.tittel || s.id),
    soknadSendt: Boolean(submitSteg && oekt.resultater?.[submitSteg.id])
  };
}

async function maybeAnswerCitizenQuestion(state, text) {
  // On a QUESTION step the citizen's text carries a value we would lose by
  // treating it as a side question, so the bar is higher there. Everywhere else
  // they can only say yes, no or nothing, and a stray reply is already a dead
  // end today.
  if (!looksLikeCitizenQuestion(text, state.awaiting === "question")) return null;

  try {
    const svar = await invokeTool("answer_citizen_question", {
      tekst: text,
      sporingsId: state.lastSession?.sporingsId,
      kontekst: {
        tjeneste: state.processDefinition?.navn || state.selectedProcess?.navn,
        prosess: state.processDefinition || null,
        steg: state.lastSession?.aktivtSteg || null,
        flyt: byggFlyt(state),
        resultater: state.lastSession?.resultater || null,
        samtale: recentHistory(state, 6).map((entry) => ({
          rolle: entry.role === "assistant" ? "assistent" : "innbygger",
          tekst: entry.message
        }))
      }
    });
    return svar?.tekst ? { tekst: svar.tekst, grunnlag: svar.grunnlag, sperre: svar.sperre } : null;
  } catch {
    // A failed side question must never break the flow the citizen is in.
    return null;
  }
}

const SPORREORD = [
  "hva", "hvorfor", "hvordan", "hvem", "hvor", "nar", "kan jeg", "ma jeg", "far jeg", "hvilke", "hvilken"
];

// Closed list on purpose. A side question that is not about the service is
// better left to the flow than answered from a grounding that does not cover it.
const SIDESPORSMAALSTEMA = [
  "inntektsgrense", "grense", "sats", "samtykke", "opplysning", "data", "personvern",
  "lagre", "slette", "hvem ser", "hvor lenge", "skatt", "prosent", "avslag", "vedtak",
  "syntetisk", "ekte", "personvernerklaring", "behandler"
];

function looksLikeCitizenQuestion(text, streng = false) {
  const lower = normalize(text);
  if (!lower) return false;

  // startsWith, not includes: "jeg lurte på hva du mente med Storgata" is an
  // answer with a question word in the middle of it.
  const starterMedSporreord = SPORREORD.some((ord) => lower === ord || lower.startsWith(`${ord} `));
  const harSporsmaalstegn = String(text).includes("?");

  if (!streng) {
    return starterMedSporreord || harSporsmaalstegn;
  }

  return starterMedSporreord
    && harSporsmaalstegn
    && SIDESPORSMAALSTEMA.some((tema) => lower.includes(tema));
}

function startGuidedInterview(state, stepId) {
  const questions = guidedInterviewDefinitions[stepId] || [];
  if (!questions.length) return null;

  state.awaiting = "guided_interview";
  state.guidedInterviewQueue = questions.slice(1);
  state.guidedInterviewCurrentKey = questions[0].key;
  state.guidedInterviewAnswers = {};
  state.guidedInterviewStepId = stepId;
  state.guidedInterviewSessionStepId = state.awaitingStepId;

  return [
    "Bra spørsmål. Jeg stiller deg noen korte spørsmål, så setter jeg sammen en god beskrivelse for deg.",
    questions[0].question
  ];
}

async function resolveProcessChoiceWithAi(state, text, options = {}) {
  const processes = options.processes || state.processes || [];
  if (!processes.length) {
    return { status: "unknown" };
  }

  const result = await invokeTool("match_process_choice", {
    tekst: text,
    prosesser: processes.map((p) => ({
      id: p.id,
      navn: p.navn,
      beskrivelse: p.beskrivelse || ""
    })),
    history: recentHistory(state),
    sporingsId: state.sporingsId || newId("flyt"),
    kontekst: {
      stegType: "PROCESS_CHOICE",
      pendingCandidates: (state.pendingProcessCandidates || []).map((p) => p.id)
    }
  });

  if (result.intent === "match" && typeof result.prosessId === "string") {
    const match = processes.find((p) => p.id === result.prosessId);
    if (match) {
      return {
        status: "matched",
        process: match,
        confidence: Number(result.confidence || 0),
        source: result.modell || "ai"
      };
    }
  }

  const mappedCandidates = mapCandidateProcesses(processes, result.kandidater || []);
  if (result.intent === "ambiguous" && mappedCandidates.length > 0) {
    return {
      status: "ambiguous",
      candidates: mappedCandidates.slice(0, 3),
      confidence: Number(result.confidence || 0),
      source: result.modell || "ai"
    };
  }

  return {
    status: "unknown",
    candidates: mappedCandidates.slice(0, 3),
    confidence: Number(result.confidence || 0),
    source: result.modell || "ai"
  };
}

async function startSelectedProcess(state, choice) {
  const started = await invokeTool("start_process_session", {
    personId: state.personId,
    prosessId: choice.id,
    sporingsId: newId("flyt")
  });

  state.selectedProcess = choice;
  try {
    state.processDefinition = await invokeTool("get_process_definition", { prosessId: choice.id });
  } catch {
    state.processDefinition = null;
  }
  state.oektsId = started.oektsId;
  state.sporingsId = started.sporingsId;
  state.pendingProcessCandidates = [];

  const intro = [`Supert. Vi starter prosessen: ${choice.navn}.`];
  return intro.concat(await advanceAndPrompt(state));
}

async function tryNextStep(oektsId) {
  try {
    await invokeTool("next_step", { oektsId });
  } catch {
    // Ignore when already on last step.
  }
}

async function advanceAndPrompt(state) {
  const messages = [];

  while (true) {
    const session = await invokeTool("get_session", { oektsId: state.oektsId });
    state.lastSession = session;
    state.sporingsId = session.sporingsId;

    if (session.status === "FULLFORT") {
      state.awaiting = null;
      messages.push("Prosessen er fullført. Søknaden er sendt inn.");
      return messages;
    }

    if (session.status === "AVVIST") {
      state.awaiting = null;
      messages.push(session.avvistMelding || "Søknaden ble avvist. Du kan starte en ny prosess om du vil prøve igjen.");
      return messages;
    }

    const step = session.aktivtSteg;
    if (!step) {
      state.awaiting = null;
      messages.push("Fant ikke aktivt steg. Du kan starte en ny prosess.");
      return messages;
    }

    if (step.type === "INFO") {
      if (step.tekst) {
        messages.push(step.tekst);
      }
      await tryNextStep(state.oektsId);
      continue;
    }

    if (step.type === "DATA_FETCH") {
      const dataFetchResult = await invokeTool("run_current_action", { oektsId: state.oektsId });
      const data = dataFetchResult?.resultat || dataFetchResult?.oekt?.resultater?.[step.id] || null;
      if (step.id === "hent-gate") {
        if (data?.funnetILokaltMatrikkel === false) {
          messages.push(`Jeg fant ${data?.adressenavn || "gaten"} i offentlig adressekilde, men den finnes ikke i lokal matrikkel for eierkontroll.`);
        } else {
          messages.push("Jeg har slått opp gaten i matrikkelen.");
        }
      } else {
        messages.push("Jeg har hentet opplysningene som trengs i dette steget.");
      }
      await tryNextStep(state.oektsId);
      continue;
    }

    if (step.type === "SJEKK") {
      const result = await invokeTool("run_current_action", { oektsId: state.oektsId });
      const avvist = result?.oekt?.status === "AVVIST" || result?.resultat?.godkjent === false;
      if (avvist) {
        state.awaiting = null;
        messages.push(result?.resultat?.melding || result?.oekt?.avvistMelding || "Søknaden kan ikke behandles videre.");
        return messages;
      }
      messages.push(result?.resultat?.melding || "Sjekken er gjennomført.");
      await tryNextStep(state.oektsId);
      continue;
    }

    if (step.type === "SUMMARY") {
      const result = await invokeTool("run_current_action", { oektsId: state.oektsId });
      const text = result?.resultat?.tekst;
      state.latestSummary = text || null;
      if (text) {
        messages.push(`Oppsummering: ${text}`);
      } else {
        messages.push("Jeg har laget en oppsummering av informasjonen.");
      }
      state.awaiting = "summary_confirm";
      messages.push("Er du enig i oppsummeringen? Svar ja for a ga videre til innsending, eller nei for a endre beskrivelsen.");
      return messages;
    }

    if (step.type === "QUESTION") {
      state.awaiting = "question";
      state.awaitingStepId = step.id;

      if (state.deferredAnswers[step.id]) {
        state.awaiting = "deferred_answer_confirm";
        state.pendingDeferredStepId = step.id;
        state.pendingValidatedAnswer = state.deferredAnswers[step.id];
        messages.push(`Du svarte tidligere på dette steget: «${state.pendingValidatedAnswer}». Vil du bruke dette svaret? (ja/nei)`);
        return messages;
      }

      const prompt = step.tekst || step.tittel || "Kan du svare på et spørsmål?";
      messages.push(prompt);

      // Dynamically discover which tools can provide useful context for this step.
      const { kontekst, validering } = await discoverStepTools(step);
      state.awaitingValideringTools = validering.map((v) => v.name);
      for (const v of kontekst) {
        const hint = await runKontekstTool(v.name);
        if (hint) messages.push(hint);
      }

      return messages;
    }

    if (step.type === "CONSENT_REQUEST") {
      state.awaiting = "consent";
      const datakilder = (step.dataKilder || []).join(", ") || "nødvendige opplysninger";
      const formaal = step.formaal || "behandle saken";
      messages.push(`For å gå videre trenger jeg samtykke til å hente ${datakilder}. Dette brukes for å ${formaal.toLowerCase()}. Er det greit?`);
      return messages;
    }

    if (step.type === "SUBMIT") {
      state.awaiting = "submit";
      messages.push("Alt er klart. Vil du at jeg skal sende inn søknaden nå?");
      return messages;
    }

    state.awaiting = null;
    messages.push(`Ukjent stegtype ${step.type}.`);
    return messages;
  }
}

async function handleMessage(state, message) {
  const text = String(message || "").trim();
  if (!text) {
    return ["Skriv en melding, så hjelper jeg deg videre."];
  }

  if (!state.selectedProcess) {
    const allProcesses = state.processes || [];
    if (!allProcesses.length) {
      return ["Jeg finner ingen tilgjengelige prosesser akkurat na. Prov igjen om litt."];
    }

    const pendingProcesses = state.pendingProcessCandidates || [];
    if (pendingProcesses.length > 0) {
      const pendingChoice = parseProcessChoice(text, pendingProcesses);
      if (pendingChoice) {
        return startSelectedProcess(state, pendingChoice);
      }
    }

    const deterministicChoice = parseProcessChoice(text, allProcesses);
    if (deterministicChoice) {
      return startSelectedProcess(state, deterministicChoice);
    }

    const aiChoice = await resolveProcessChoiceWithAi(state, text, {
      processes: pendingProcesses.length > 0 ? pendingProcesses : allProcesses
    });

    if (aiChoice.status === "matched") {
      return startSelectedProcess(state, aiChoice.process);
    }

    if (aiChoice.status === "ambiguous") {
      state.pendingProcessCandidates = aiChoice.candidates;
      return [
        "Jeg tror dette kan vaere en av disse prosessene. Hvilken mener du?",
        formatProcessOptions(aiChoice.candidates, "Svar med nummer, navn, eller id:")
      ];
    }

    if (pendingProcesses.length > 0) {
      return [
        "Jeg er fortsatt usikker pa hvilken av kandidatene du mener.",
        formatProcessOptions(pendingProcesses, "Svar med nummer, navn, eller id:")
      ];
    }

    return ["Jeg fant ikke den prosessen. Skriv nummer, navn, eller id fra listen."];
  }

  const metaSvar = maybeAnswerProcessMetaQuestion(state, text);
  if (metaSvar) {
    return [metaSvar];
  }

  const presisMatrikkelSvar = await maybeAnswerPreciseMatrikkelQuestion(text);
  if (presisMatrikkelSvar) {
    return [presisMatrikkelSvar];
  }

  const brregSvar = await maybeAnswerBrregQuestion(text);
  if (brregSvar) {
    return [brregSvar];
  }

  const folkeregisterSvar = await maybeAnswerFolkeregisterQuestion(text);
  if (folkeregisterSvar) {
    return [folkeregisterSvar];
  }

  // Last in the chain, so the precise register lookups above still win. The
  // flow is left exactly where it was — see maybeAnswerCitizenQuestion.
  const sidesvar = await maybeAnswerCitizenQuestion(state, text);
  if (sidesvar) {
    const step = state.lastSession?.aktivtSteg;
    const tilbake = step?.tekst || step?.tittel;
    return tilbake
      ? [sidesvar.tekst, `Tilbake til der vi var: ${tilbake}`]
      : [sidesvar.tekst];
  }

  if (state.awaiting === "question") {
    const step = state.lastSession?.aktivtSteg;
    const activeQuestionId = step?.id || state.awaitingStepId || null;
    const valideringsToolNavn = state.awaitingValideringTools || [];
    const likelyGateStep = isLikelyGateQuestionStep(step);

    if (activeQuestionId !== "velg-gate") {
      const gateMention = extractPossibleGateMention(text);
      if (gateMention) {
        const gateResult = await runValideringTool("matrikkel_finn_veger", gateMention);
        if (gateResult?.answer || gateResult?.proposedAnswer) {
          const foreslatt = gateResult.answer || gateResult.proposedAnswer;
          state.awaiting = "gate_switch_confirm";
          state.pendingGateSwitch = {
            gate: foreslatt,
            returnStepId: activeQuestionId
          };
          return [`Du nevner ${foreslatt}. Vil du bytte gate til ${foreslatt} nå? Svar ja/nei.`];
        }
      }
    }

    // If the user asks a lookup question (e.g. "Finnes Storgata?"), answer it
    // directly and keep the step open so the user can submit a final value.
    if (text.includes("?") && (valideringsToolNavn.length > 0 || likelyGateStep)) {
      const lookupText = extractLookupCandidate(text) || text;
      const lookupTools = valideringsToolNavn.length > 0 ? valideringsToolNavn : (likelyGateStep ? ["matrikkel_finn_veger"] : []);
      for (const toolName of lookupTools) {
        const valResult = await runValideringTool(toolName, lookupText);
        if (!valResult) continue;
        if (valResult.retry) {
          return [valResult.hint, step?.tekst || "Skriv inn svaret ditt når du er klar."];
        }
        if (valResult.confirm) {
          state.awaiting = "question_value_confirm";
          state.pendingValidatedAnswer = valResult.proposedAnswer;
          return [valResult.question];
        }
        if (!valResult.answer) {
          return ["Jeg ble litt usikker på oppslaget. Kan du skrive gatenavnet en gang til?"];
        }
        return [
          `Ja, ${valResult.answer} finnes i matrikkelen.`,
          `Hvis du vil bruke den gaten, svar gjerne bare «${valResult.answer}».`
        ];
      }
    }

    // Give hint suggestions if user asks for help on a step that has context tools.
    if (!looksLikeHelpQuestion(activeQuestionId, text)) {
      const lower = normalize(text);
      const isHelpish = text.includes("?") || ["hjelp", "vet ikke", "usikker", "forslag", "hvilke", "hva kan jeg"].some((ord) => lower.includes(ord));
      if (isHelpish && valideringsToolNavn.length > 0) {
        const hints = [];
        for (const toolName of valideringsToolNavn) {
          const hint = await runKontekstTool(toolName);
          if (hint) hints.push(hint);
        }
        if (hints.length > 0) {
          return [...hints, step?.tekst || "Skriv inn svaret ditt når du er klar."];
        }
      }
    }

    if (looksLikeHelpQuestion(activeQuestionId, text)) {
      const interviewReplies = startGuidedInterview(state, activeQuestionId);
      if (interviewReplies) {
        return interviewReplies;
      }
      return [fallbackGuidanceForQuestion(activeQuestionId), step?.tekst || "Skriv gjerne svaret ditt når du er klar."];
    }

    let normalizedAnswer = normalizeQuestionAnswer(activeQuestionId, text);
    if (!normalizedAnswer.valid) {
      const deferred = maybeCaptureDeferredAnswer(state, activeQuestionId, text);
      if (deferred) {
        return [deferred.message, normalizedAnswer.retryMessage || "Før vi går videre trenger jeg svar på spørsmålet i dette steget."];
      }
      return [normalizedAnswer.retryMessage || "Jeg fikk ikke tolket svaret. Kan du prøve igjen?"];
    }

    // Run dynamic validation tools discovered when the step was entered.
    for (const toolName of valideringsToolNavn) {
      const valResult = await runValideringTool(toolName, text);
      if (!valResult) continue;
      if (valResult.retry) {
        const deferred = maybeCaptureDeferredAnswer(state, activeQuestionId, text);
        if (deferred) {
          return [deferred.message, valResult.hint, step?.tekst || "Kan du skrive svaret på nytt?"];
        }
        return [valResult.hint];
      }
      if (valResult.confirm) {
        state.awaiting = "question_value_confirm";
        state.pendingValidatedAnswer = valResult.proposedAnswer;
        return [valResult.question];
      }
      // Successful normalisation – override answer with the canonical value.
      normalizedAnswer = { answer: valResult.answer, inferred: valResult.inferred, note: valResult.note };
      state.latestMatrikkelGate = { adressenavn: valResult.answer };
      break;
    }

    await invokeTool("answer_question", {
      oektsId: state.oektsId,
      stegId: state.awaitingStepId,
      svar: normalizedAnswer.answer
    });
    await tryNextStep(state.oektsId);
    const ack = normalizedAnswer.note || "Takk, jeg har lagret svaret ditt.";
    return [ack].concat(await advanceAndPrompt(state));
  }

  if (state.awaiting === "deferred_answer_confirm") {
    const intent = await invokeTool("interpret_reply", {
      tekst: text,
      jaIntent: "confirm_yes",
      neiIntent: "confirm_no",
      ukjentIntent: "unknown",
      sporingsId: state.sporingsId,
      kontekst: {
        prosessId: state.selectedProcess?.id,
        stegType: "DEFERRED_ANSWER_CONFIRM",
        stegId: state.pendingDeferredStepId,
        foreslattSvar: state.pendingValidatedAnswer
      }
    });

    if (intent.intent === "confirm_yes") {
      const proposed = state.pendingValidatedAnswer;
      const stepId = state.pendingDeferredStepId || state.awaitingStepId;
      if (!proposed || !stepId) {
        state.awaiting = "question";
        return ["Jeg mistet forslaget underveis. Kan du skrive svaret på nytt?"];
      }
      await invokeTool("answer_question", {
        oektsId: state.oektsId,
        stegId: stepId,
        svar: proposed
      });
      delete state.deferredAnswers[stepId];
      state.pendingDeferredStepId = null;
      state.pendingValidatedAnswer = null;
      state.awaiting = "question";
      await tryNextStep(state.oektsId);
      return ["Flott, da bruker jeg svaret du ga tidligere."].concat(await advanceAndPrompt(state));
    }

    if (intent.intent === "confirm_no") {
      const stepId = state.pendingDeferredStepId;
      if (stepId) delete state.deferredAnswers[stepId];
      state.pendingDeferredStepId = null;
      state.pendingValidatedAnswer = null;
      state.awaiting = "question";
      return [state.lastSession?.aktivtSteg?.tekst || "Skriv gjerne svaret ditt på nytt."];
    }

    if (text.trim() && !["ja", "nei", "japp", "yes", "no", "ok"].includes(normalize(text))) {
      state.pendingDeferredStepId = null;
      state.pendingValidatedAnswer = null;
      state.awaiting = "question";
      return handleMessage(state, text);
    }

    return ["Jeg ble litt usikker. Svar gjerne ja eller nei."];
  }

  if (state.awaiting === "gate_switch_confirm") {
    const intent = await invokeTool("interpret_reply", {
      tekst: text,
      jaIntent: "confirm_yes",
      neiIntent: "confirm_no",
      ukjentIntent: "unknown",
      sporingsId: state.sporingsId,
      kontekst: {
        prosessId: state.selectedProcess?.id,
        stegType: "GATE_SWITCH_CONFIRM",
        foreslattGate: state.pendingGateSwitch?.gate
      }
    });

    if (intent.intent === "confirm_yes") {
      const nyGate = state.pendingGateSwitch?.gate;
      const returnStepId = state.pendingGateSwitch?.returnStepId;
      state.pendingGateSwitch = null;
      if (!nyGate) {
        state.awaiting = "question";
        return ["Jeg mistet hvilken gate som skulle brukes. Kan du skrive gatenavnet på nytt?"];
      }

      const movedToGateStep = await moveSessionToStepId(state, "velg-gate");
      if (!movedToGateStep) {
        state.awaiting = "question";
        return ["Jeg klarte ikke å hoppe tilbake til gatevalget akkurat nå. Kan du skrive gatenavnet direkte?"].concat(await advanceAndPrompt(state));
      }

      await invokeTool("answer_question", {
        oektsId: state.oektsId,
        stegId: "velg-gate",
        svar: nyGate
      });
      state.latestMatrikkelGate = { adressenavn: nyGate };

      await tryNextStep(state.oektsId);
      const replies = [`Da bytter vi gate til ${nyGate}.`].concat(await advanceAndPrompt(state));

      // If we still ended up at the same step, keep normal question mode.
      if (returnStepId && state.lastSession?.aktivtSteg?.id === returnStepId) {
        state.awaiting = "question";
      }
      return replies;
    }

    if (intent.intent === "confirm_no") {
      const sammeStegTekst = state.lastSession?.aktivtSteg?.tekst;
      state.pendingGateSwitch = null;
      state.awaiting = "question";
      return ["Greit, vi beholder nåværende gate.", sammeStegTekst || "Fortsett gjerne med svaret ditt på dette steget."];
    }

    if (text.trim() && !["ja", "nei", "japp", "yes", "no", "ok"].includes(normalize(text))) {
      state.pendingGateSwitch = null;
      state.awaiting = "question";
      return handleMessage(state, text);
    }

    return ["Jeg ble litt usikker. Svar gjerne ja eller nei."];
  }

  if (state.awaiting === "question_value_confirm") {
    const intent = await invokeTool("interpret_reply", {
      tekst: text,
      jaIntent: "confirm_yes",
      neiIntent: "confirm_no",
      ukjentIntent: "unknown",
      sporingsId: state.sporingsId,
      kontekst: {
        prosessId: state.selectedProcess?.id,
        stegType: "QUESTION_VALUE_CONFIRM",
        foreslattSvar: state.pendingValidatedAnswer
      }
    });

    if (intent.intent === "confirm_yes") {
      const proposed = state.pendingValidatedAnswer;
      if (!proposed) {
        state.awaiting = "question";
        return ["Jeg mistet hvilket forslag som skulle bekreftes. Kan du skrive gatenavnet en gang til?"];
      }
      await invokeTool("answer_question", {
        oektsId: state.oektsId,
        stegId: state.awaitingStepId,
        svar: proposed
      });
      state.latestMatrikkelGate = { adressenavn: proposed };
      state.pendingValidatedAnswer = null;
      state.awaiting = "question";
      await tryNextStep(state.oektsId);
      return [`Flott, jeg bruker ${proposed}.`].concat(await advanceAndPrompt(state));
    }

    if (intent.intent === "confirm_no") {
      state.pendingValidatedAnswer = null;
      state.awaiting = "question";
      return [
        "Skjønner. Skriv gjerne gatenavnet på nytt slik du ønsker det registrert.",
        state.lastSession?.aktivtSteg?.tekst || "Hvilken gate gjelder søknaden?"
      ];
    }

    if (text.trim() && !["ja", "nei", "japp", "yes", "no", "ok"].includes(normalize(text))) {
      state.pendingValidatedAnswer = null;
      state.awaiting = "question";
      return handleMessage(state, text);
    }

    return ["Jeg ble litt usikker. Svar gjerne ja eller nei."];
  }

  if (state.awaiting === "guided_interview") {
    // Store answer to the current question
    state.guidedInterviewAnswers[state.guidedInterviewCurrentKey] = text;

    if (state.guidedInterviewQueue && state.guidedInterviewQueue.length > 0) {
      // More questions to ask
      const next = state.guidedInterviewQueue.shift();
      state.guidedInterviewCurrentKey = next.key;
      return [next.question];
    }

    // All questions answered – compose the full answer and save it
    const composed = composeGuidedAnswer(state.guidedInterviewStepId, state.guidedInterviewAnswers);
    await invokeTool("answer_question", {
      oektsId: state.oektsId,
      stegId: state.guidedInterviewSessionStepId || state.guidedInterviewStepId,
      svar: composed
    });

    // Clean up interview state
    state.awaiting = "question";
    state.guidedInterviewQueue = [];
    state.guidedInterviewAnswers = {};
    state.guidedInterviewCurrentKey = null;
    state.guidedInterviewStepId = null;
    state.guidedInterviewSessionStepId = null;

    await tryNextStep(state.oektsId);
    return [
      `Takk. Jeg satte sammen denne beskrivelsen fra svarene dine:`,
      `«${composed}»`,
      ...await advanceAndPrompt(state)
    ];
  }

  if (state.awaiting === "summary_confirm") {
    const intent = await invokeTool("interpret_reply", {
      tekst: text,
      jaIntent: "summary_yes",
      neiIntent: "summary_no",
      ukjentIntent: "unknown",
      sporingsId: state.sporingsId,
      kontekst: {
        prosessId: state.selectedProcess?.id,
        stegType: "SUMMARY_CONFIRM"
      }
    });

    if (intent.intent === "summary_yes") {
      await tryNextStep(state.oektsId);
      return ["Flott. Da gar vi videre til innsending."].concat(await advanceAndPrompt(state));
    }

    if (intent.intent === "summary_no") {
      await invokeTool("previous_step", { oektsId: state.oektsId });
      state.awaiting = null;
      state.awaitingStepId = null;
      return [
        "Skjonner. Da gar vi tilbake sa du kan forbedre beskrivelsen av trafikkproblemet.",
        "Skriv gjerne problemet sa konkret som mulig, og hva slags tiltak du onsker."
      ].concat(await advanceAndPrompt(state));
    }

    return ["Jeg ble litt usikker. Svar gjerne 'ja' hvis oppsummeringen stemmer, eller 'nei' hvis du vil endre den."];
  }

  if (state.awaiting === "consent") {
    const intent = await invokeTool("interpret_reply", {
      tekst: text,
      jaIntent: "consent_yes",
      neiIntent: "consent_no",
      ukjentIntent: "unknown",
      sporingsId: state.sporingsId,
      kontekst: {
        prosessId: state.selectedProcess?.id,
        stegType: "CONSENT_REQUEST"
      }
    });

    if (intent.intent === "consent_yes") {
      await invokeTool("consent_response", { oektsId: state.oektsId, approved: true });
      await tryNextStep(state.oektsId);
      return ["Takk. Samtykke er registrert."].concat(await advanceAndPrompt(state));
    }

    if (intent.intent === "consent_no") {
      await invokeTool("consent_response", { oektsId: state.oektsId, approved: false });
      await tryNextStep(state.oektsId);
      return ["Skjønner. Jeg har registrert at du ikke vil samtykke nå."].concat(await advanceAndPrompt(state));
    }

    return ["Jeg ble litt usikker. Du kan svare for eksempel 'ja, det er greit' eller 'nei, ikke nå'."];
  }

  if (state.awaiting === "submit") {
    const intent = await invokeTool("interpret_reply", {
      tekst: text,
      jaIntent: "submit_yes",
      neiIntent: "submit_no",
      ukjentIntent: "unknown",
      sporingsId: state.sporingsId,
      kontekst: {
        prosessId: state.selectedProcess?.id,
        stegType: "SUBMIT"
      }
    });

    if (intent.intent === "submit_yes") {
      await invokeTool("run_current_action", { oektsId: state.oektsId });
      return ["Da sender jeg inn søknaden."].concat(await advanceAndPrompt(state));
    }

    if (intent.intent === "submit_no") {
      return ["Helt i orden. Si fra når du vil sende inn."];
    }

    return ["Jeg ble litt usikker. Du kan svare for eksempel 'ja, send inn' eller 'nei, ikke ennå'."];
  }

  return advanceAndPrompt(state);
}

async function createAgentSession(body) {
  const personId = body.personId || "person-001";
  const processesResult = await invokeTool("list_processes", {});

  const session = {
    sessionId: newId("agent"),
    personId,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    processes: processesResult.prosesser,
    selectedProcess: null,
    processDefinition: null,
    oektsId: null,
    sporingsId: null,
    awaiting: "process_choice",
    awaitingStepId: null,
    awaitingValideringTools: [],
    lastSession: null,
    history: [],
    pendingProcessCandidates: [],
    latestSummary: null,
    latestMatrikkelGate: null,
    pendingValidatedAnswer: null,
    pendingDeferredStepId: null,
    pendingGateSwitch: null,
    deferredAnswers: {},
    guidedInterviewQueue: [],
    guidedInterviewAnswers: {},
    guidedInterviewCurrentKey: null,
    guidedInterviewStepId: null,
    guidedInterviewSessionStepId: null
  };

  sessions.set(session.sessionId, session);

  return {
    sessionId: session.sessionId,
    personId,
    message: listProcessesPrompt(session.processes)
  };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    json(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse" || url.pathname === "/health") {
      json(response, 200, { status: "ok", tjeneste: "process-agent", tidspunkt: new Date().toISOString() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/agent/sessions") {
      const body = await readBody(request);
      json(response, 201, await createAgentSession(body));
      return;
    }

    const getSessionMatch = url.pathname.match(/^\/agent\/sessions\/([^/]+)$/);
    if (request.method === "GET" && getSessionMatch) {
      const session = sessions.get(getSessionMatch[1]);
      if (!session) {
        json(response, 404, { feil: "Fant ikke agent-session." });
        return;
      }
      json(response, 200, {
        sessionId: session.sessionId,
        personId: session.personId,
        selectedProcess: session.selectedProcess,
        pendingProcessCandidates: session.pendingProcessCandidates,
        oektsId: session.oektsId,
        sporingsId: session.sporingsId,
        awaiting: session.awaiting,
        created: session.created,
        updated: session.updated
      });
      return;
    }

    const msgMatch = url.pathname.match(/^\/agent\/sessions\/([^/]+)\/messages$/);
    if (request.method === "POST" && msgMatch) {
      const session = sessions.get(msgMatch[1]);
      if (!session) {
        json(response, 404, { feil: "Fant ikke agent-session." });
        return;
      }

      const body = await readBody(request);
      const userMessage = String(body.message || "");
      session.history.push({ role: "user", message: userMessage, tidspunkt: new Date().toISOString() });

      const replies = await handleMessage(session, userMessage);
      for (const message of replies) {
        session.history.push({ role: "assistant", message, tidspunkt: new Date().toISOString() });
      }
      session.updated = new Date().toISOString();

      json(response, 200, {
        sessionId: session.sessionId,
        replies,
        awaiting: session.awaiting,
        selectedProcess: session.selectedProcess,
        pendingProcessCandidates: session.pendingProcessCandidates,
        oektsId: session.oektsId,
        sporingsId: session.sporingsId
      });
      return;
    }

    json(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    json(response, 500, { feil: "Intern feil i process-agent.", detalj: error.message });
  }
});

server.listen(port, () => {
  console.log(`Process-agent kjører på http://localhost:${port}`);
});

