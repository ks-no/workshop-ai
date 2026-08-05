import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = 8082;
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://sandbox-backend:8080";
const aiProvider = (process.env.AI_PROVIDER || "mock").toLowerCase();
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
const openRouterModel = process.env.OPENROUTER_MODEL || "mistralai/mistral-7b-instruct:free";

function jsonSvar(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(JSON.stringify(data, null, 2));
}

function tekstSvar(response, statusCode, data, contentType = "text/html; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  response.end(data);
}

async function lesBody(request) {
  const deler = [];
  for await (const del of request) {
    deler.push(del);
  }
  return deler.length ? JSON.parse(Buffer.concat(deler).toString("utf8")) : {};
}

function nyttId(prefix) {
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
      </ul>
    </body>
  </html>`;
}

function byggSvar(type, body) {
  const tjeneste = body?.kontekst?.tjeneste || "kommunal tjeneste";
  const data = body?.kontekst?.data || {};
  const svar = body?.kontekst?.svar || {};

  function finnVerdi(predicate) {
    return Object.values(data || {}).find(predicate) || null;
  }

  function formaterBelop(tall) {
    return new Intl.NumberFormat("nb-NO").format(Number(tall || 0));
  }

  function byggHusstandLinjer() {
    const husstand = finnVerdi((v) => v?.husstandId && Array.isArray(v?.medlemmer));
    if (!husstand) return null;
    const foresatte = husstand.medlemmer.filter((m) => m.rolle === "foresatt");
    const barn = husstand.medlemmer.filter((m) => m.rolle === "barn");
    const deler = [`Husstand: ${husstand.adresse || husstand.husstandId}`];
    if (foresatte.length) deler.push(`${foresatte.length} foresatt${foresatte.length !== 1 ? "e" : ""} (${foresatte.map((m) => m.personId).join(", ")})`);
    if (barn.length) deler.push(`${barn.length} barn (${barn.map((m) => m.personId).join(", ")})`);
    return deler.join(", ");
  }

  function byggInntektLinjer() {
    const beregning = finnVerdi((v) => v?.beregningsbeloep !== undefined);
    if (!beregning) return null;
    const poster = (beregning.visningsposter || [])
      .flatMap((v) => v.poster || [])
      .map((p) => `${p.visningstekst} ${formaterBelop(p.beloep)} kr`)
      .join(", ");
    const utenfor = (beregning.fradrag?.beregning || [])
      .flatMap((g) => g.beregningsposter || [])
      .map((p) => p.visningstekst)
      .join(", ");
    const deler = [`Inntektsgrunnlag ${beregning.inntektsaar}: ${formaterBelop(beregning.beregningsbeloep)} kr`];
    if (poster) deler.push(`bygget av ${poster}`);
    if (utenfor) deler.push(`holdt utenfor: ${utenfor}`);
    if (beregning.stadie === "UTKAST") deler.push("skatteoppgjoret er ikke ferdig");
    return deler.join(". ");
  }

  function byggSvarLinjer() {
    const deler = [];
    for (const [, verdi] of Object.entries(svar || {})) {
      if (typeof verdi === "string" && verdi.trim()) {
        deler.push(verdi.trim().replace(/[.]+$/g, ""));
      } else if (typeof verdi === "object" && verdi !== null) {
        const verdier = Object.values(verdi).filter((v) => v && String(v).trim());
        if (verdier.length) deler.push(verdier.map((v) => String(v).trim().replace(/[.]+$/g, "")).join(", "));
      }
    }
    return deler.length ? deler.join(" | ") : null;
  }

  function erJaSvar(verdi) {
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
        erJaSvar(flereEnn20)
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

function byggPrompt(type, body, fallbackTekst) {
  const kontekst = body?.kontekst || {};
  const sprak = body?.sprak || "nb";
  return [
    "Du er en hjelpsom assistent i en kommunal demosandbox.",
    `Svar kort på ${sprak} med klart språk uten personopplysninger utover det som er gitt.`,
    "Når du oppsummerer, si tydelig hva vi fant og hva som sendes inn.",
    `Oppgavetype: ${type}`,
    `Tjeneste: ${kontekst.tjeneste || "ukjent"}`,
    `Steg: ${kontekst.steg?.tittel || kontekst.steg?.type || "ukjent"}`,
    `Anbefalt innhold: ${fallbackTekst}`,
    `Kontekst JSON: ${JSON.stringify(kontekst)}`
  ].join("\n");
}

function normaliserTekst(tekst) {
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

function stammeProsessToken(token) {
  if (!token || token.length <= 3) return token;
  if (token.endsWith("ende") && token.length > 6) return token.slice(0, -4);
  if (token.endsWith("ene") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("er") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("en") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("e") && token.length > 4) return token.slice(0, -1);
  return token;
}

function kanoniskProsessToken(token) {
  if (token.startsWith("fartsdemp") || token.startsWith("fart") || token.startsWith("dump") || token.startsWith("hump")) {
    return "fartsdemp";
  }
  if (token.startsWith("stottekont")) {
    return "stottekontakt";
  }
  return token;
}

function tokeniserProsessTekst(tekst) {
  return normaliserTekst(tekst)
    .split(/[\s-]+/)
    .map(stammeProsessToken)
    .map(kanoniskProsessToken)
    .filter((token) => token && !prosessvalgStopOrd.has(token));
}

function delteTokenTreff(brukerToken, prosessToken) {
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

function heuristiskProsessvalg(body) {
  const tekst = normaliserTekst(body?.tekst);
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

  const byId = prosesser.find((p) => normaliserTekst(p.id) === tekst);
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
    const navn = normaliserTekst(p.navn);
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

  const brukerToken = tokeniserProsessTekst(tekst);
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
      const prosessToken = tokeniserProsessTekst(`${prosess.navn || ""} ${prosess.id || ""} ${prosess.beskrivelse || ""}`);
      const overlap = delteTokenTreff(brukerToken, prosessToken);
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

function byggProsessvalgPrompt(body) {
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

function validerProsessvalg(data, body) {
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

// Mønstrene matches mot hele ord, ikke delstrenger. Med tekst.includes() ble
// "uklart" lest som "klar" og "nok" som "ok", slik at "det er uklart for meg"
// og "jeg har ikke nok informasjon" begge ble registrert som samtykke.
// normaliserTekst har alt fjernet tegnsetting, så ordene er mellomromdelte.
function inneholderUttrykk(ord, uttrykk) {
  const deler = uttrykk.split(" ");
  for (let i = 0; i <= ord.length - deler.length; i += 1) {
    if (deler.every((del, forskyvning) => ord[i + forskyvning] === del)) {
      return true;
    }
  }
  return false;
}

function heuristiskTolkning(body) {
  const ord = normaliserTekst(body?.tekst).split(" ").filter(Boolean);
  const jaIntent = body?.jaIntent || "ja";
  const neiIntent = body?.neiIntent || "nei";
  const ukjentIntent = body?.ukjentIntent || "ukjent";

  const positiveMonstre = [
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

  const negativeMonstre = [
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

  const nektinger = ["ikke", "ikkje", "aldri"];

  const treffer = (monstre) => monstre.some((monster) => inneholderUttrykk(ord, monster));

  if (treffer(negativeMonstre)) {
    return {
      intent: neiIntent,
      confidence: 0.8,
      begrunnelse: "Heuristisk negativ tolkning"
    };
  }

  if (treffer(positiveMonstre)) {
    // "det er ikke greit" treffer "greit". Nekting vi ikke har et eksplisitt
    // negativt mønster for er for utydelig til å bli lest som samtykke, så den
    // overlates til modellen framfor å bli gjettet på her.
    if (ord.some((enkeltord) => nektinger.includes(enkeltord))) {
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

function byggTolkningsPrompt(body) {
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

function parseJsonObjekt(tekst) {
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

function validerTolkning(data, body) {
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

async function hentFraOllama(prompt) {
  const svar = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt,
      stream: false,
      options: { temperature: 0.2 }
    })
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

async function hentTolkningFraOllama(body) {
  const svar = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: byggTolkningsPrompt(body),
      stream: false,
      options: { temperature: 0 }
    })
  });
  if (!svar.ok) {
    throw new Error(`Ollama svarte med status ${svar.status}`);
  }
  const data = await svar.json();
  const parsed = validerTolkning(parseJsonObjekt(data.response), body);
  if (!parsed) {
    throw new Error("Kunne ikke tolke JSON-svar fra Ollama");
  }
  return {
    ...parsed,
    modell: `ollama:${ollamaModel}`
  };
}

async function hentFraOpenRouter(prompt) {
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
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "Du skriver korte, tydelige svar pa norsk i en kommunal demosandbox."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });
  if (!svar.ok) {
    throw new Error(`OpenRouter svarte med status ${svar.status}`);
  }
  const data = await svar.json();
  const tekst = data?.choices?.[0]?.message?.content?.trim() || "";
  return {
    tekst,
    modell: `openrouter:${openRouterModel}`
  };
}

async function hentTolkningFraOpenRouter(body) {
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
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "Du returnerer kun gyldig JSON uten kodeblokker eller forklarende tekst."
        },
        {
          role: "user",
          content: byggTolkningsPrompt(body)
        }
      ]
    })
  });
  if (!svar.ok) {
    throw new Error(`OpenRouter svarte med status ${svar.status}`);
  }
  const data = await svar.json();
  const tekst = data?.choices?.[0]?.message?.content?.trim() || "";
  const parsed = validerTolkning(parseJsonObjekt(tekst), body);
  if (!parsed) {
    throw new Error("Kunne ikke tolke JSON-svar fra OpenRouter");
  }
  return {
    ...parsed,
    modell: `openrouter:${openRouterModel}`
  };
}

async function hentProsessvalgFraOllama(body) {
  const svar = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: byggProsessvalgPrompt(body),
      stream: false,
      options: { temperature: 0 }
    })
  });
  if (!svar.ok) {
    throw new Error(`Ollama svarte med status ${svar.status}`);
  }
  const data = await svar.json();
  const parsed = validerProsessvalg(parseJsonObjekt(data.response), body);
  if (!parsed) {
    throw new Error("Kunne ikke tolke prosessvalg fra Ollama");
  }
  return {
    ...parsed,
    modell: `ollama:${ollamaModel}`
  };
}

async function hentProsessvalgFraOpenRouter(body) {
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
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "Du returnerer kun gyldig JSON uten kodeblokker eller forklaringer."
        },
        {
          role: "user",
          content: byggProsessvalgPrompt(body)
        }
      ]
    })
  });
  if (!svar.ok) {
    throw new Error(`OpenRouter svarte med status ${svar.status}`);
  }
  const data = await svar.json();
  const tekst = data?.choices?.[0]?.message?.content?.trim() || "";
  const parsed = validerProsessvalg(parseJsonObjekt(tekst), body);
  if (!parsed) {
    throw new Error("Kunne ikke tolke prosessvalg fra OpenRouter");
  }
  return {
    ...parsed,
    modell: `openrouter:${openRouterModel}`
  };
}

async function tolkSvarMedAi(body) {
  const fallback = heuristiskTolkning(body);
  const ukjentIntent = body?.ukjentIntent || "ukjent";

  if (fallback.intent !== ukjentIntent && fallback.confidence >= 0.75) {
    return {
      ...fallback,
      syntetisk: true,
      modell: "heuristisk-tolkning"
    };
  }

  try {
    if (aiProvider === "ollama") {
      const llmSvar = {
        ...(await hentTolkningFraOllama(body)),
        syntetisk: true
      };
      if (llmSvar.intent === ukjentIntent && fallback.intent !== ukjentIntent) {
        return {
          ...fallback,
          syntetisk: true,
          modell: `${llmSvar.modell} (heuristisk overstyring)`,
          advarsel: "LLM returnerte ukjent, brukte heuristisk tolkning"
        };
      }
      if (llmSvar.confidence < 0.6 && fallback.intent !== ukjentIntent) {
        return {
          ...fallback,
          syntetisk: true,
          modell: `${llmSvar.modell} (heuristisk overstyring)`,
          advarsel: "LLM hadde lav trygghet, brukte heuristisk tolkning"
        };
      }
      return llmSvar;
    }

    if (aiProvider === "openrouter") {
      const llmSvar = {
        ...(await hentTolkningFraOpenRouter(body)),
        syntetisk: true
      };
      if (llmSvar.intent === ukjentIntent && fallback.intent !== ukjentIntent) {
        return {
          ...fallback,
          syntetisk: true,
          modell: `${llmSvar.modell} (heuristisk overstyring)`,
          advarsel: "LLM returnerte ukjent, brukte heuristisk tolkning"
        };
      }
      if (llmSvar.confidence < 0.6 && fallback.intent !== ukjentIntent) {
        return {
          ...fallback,
          syntetisk: true,
          modell: `${llmSvar.modell} (heuristisk overstyring)`,
          advarsel: "LLM hadde lav trygghet, brukte heuristisk tolkning"
        };
      }
      return llmSvar;
    }
  } catch (error) {
    return {
      ...fallback,
      syntetisk: true,
      modell: `${aiProvider || "mock"}-fallback`,
      advarsel: `LLM-tolkning feilet: ${error.message}`
    };
  }

  return {
    ...fallback,
    syntetisk: true,
    modell: "heuristisk-tolkning"
  };
}

async function velgProsessMedAi(body) {
  const fallback = heuristiskProsessvalg(body);
  if (fallback.intent === "match" && fallback.confidence >= 0.8) {
    return {
      ...fallback,
      syntetisk: true,
      modell: "heuristisk-prosessvalg"
    };
  }

  try {
    if (aiProvider === "ollama") {
      const llmSvar = {
        ...(await hentProsessvalgFraOllama(body)),
        syntetisk: true
      };
      if (llmSvar.intent === "unknown" && fallback.intent !== "unknown") {
        return {
          ...fallback,
          syntetisk: true,
          modell: `${llmSvar.modell} (heuristisk overstyring)`,
          advarsel: "LLM returnerte unknown, brukte heuristisk prosessvalg"
        };
      }
      if (llmSvar.intent === "match" && !llmSvar.prosessId && fallback.intent === "match") {
        return {
          ...fallback,
          syntetisk: true,
          modell: `${llmSvar.modell} (heuristisk overstyring)`,
          advarsel: "LLM returnerte ugyldig prosess-id, brukte heuristikk"
        };
      }
      return llmSvar;
    }

    if (aiProvider === "openrouter") {
      const llmSvar = {
        ...(await hentProsessvalgFraOpenRouter(body)),
        syntetisk: true
      };
      if (llmSvar.intent === "unknown" && fallback.intent !== "unknown") {
        return {
          ...fallback,
          syntetisk: true,
          modell: `${llmSvar.modell} (heuristisk overstyring)`,
          advarsel: "LLM returnerte unknown, brukte heuristisk prosessvalg"
        };
      }
      if (llmSvar.intent === "match" && !llmSvar.prosessId && fallback.intent === "match") {
        return {
          ...fallback,
          syntetisk: true,
          modell: `${llmSvar.modell} (heuristisk overstyring)`,
          advarsel: "LLM returnerte ugyldig prosess-id, brukte heuristikk"
        };
      }
      return llmSvar;
    }
  } catch (error) {
    return {
      ...fallback,
      syntetisk: true,
      modell: `${aiProvider || "mock"}-fallback`,
      advarsel: `LLM-prosessvalg feilet: ${error.message}`
    };
  }

  return {
    ...fallback,
    syntetisk: true,
    modell: "heuristisk-prosessvalg"
  };
}

async function byggAiSvar(type, body) {
  const mockSvar = byggSvar(type, body);

  if (type === "oppsummering") {
    return {
      tekst: mockSvar.tekst,
      syntetisk: true,
      modell: "mock-ai-gateway",
      sprak: body.sprak || "nb"
    };
  }

  const prompt = byggPrompt(type, body, mockSvar.tekst);

  try {
    if (aiProvider === "ollama") {
      const llm = await hentFraOllama(prompt);
      if (llm.tekst) {
        return {
          tekst: llm.tekst,
          syntetisk: true,
          modell: llm.modell,
          sprak: body.sprak || "nb"
        };
      }
      throw new Error("Tomt svar fra Ollama");
    }

    if (aiProvider === "openrouter") {
      const llm = await hentFraOpenRouter(prompt);
      if (llm.tekst) {
        return {
          tekst: llm.tekst,
          syntetisk: true,
          modell: llm.modell,
          sprak: body.sprak || "nb"
        };
      }
      throw new Error("Tomt svar fra OpenRouter");
    }
  } catch (error) {
    return {
      ...mockSvar,
      modell: `${mockSvar.modell} (fallback)` ,
      advarsel: `Provider ${aiProvider} feilet: ${error.message}`
    };
  }

  return mockSvar;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonSvar(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse" || url.pathname === "/health") {
      jsonSvar(response, 200, { status: "ok", tjeneste: "ai-gateway", tidspunkt: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/docs") {
      tekstSvar(response, 200, docsHtml());
      return;
    }

    if (url.pathname === "/openapi.yaml") {
      const yaml = await readFile(path.resolve(__dirname, "../../../openapi/ai-gateway.yaml"), "utf8");
      tekstSvar(response, 200, yaml, "text/yaml; charset=utf-8");
      return;
    }

    if (request.method === "POST" && url.pathname === "/ai/tolk-svar") {
      const body = await lesBody(request);
      const svar = await tolkSvarMedAi(body);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || nyttId("flyt"),
        handling: "KI_TOLKNING",
        ressurs: "tolk-svar",
        aktor: { type: "system", id: "ai-gateway" }
      });
      jsonSvar(response, 200, svar);
      return;
    }

    if (request.method === "POST" && url.pathname === "/ai/velg-prosess") {
      const body = await lesBody(request);
      const svar = await velgProsessMedAi(body);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || nyttId("flyt"),
        handling: "KI_TOLKNING",
        ressurs: "velg-prosess",
        aktor: { type: "system", id: "ai-gateway" }
      });
      jsonSvar(response, 200, svar);
      return;
    }

    const gyldigeStier = ["/ai/dialogforslag", "/ai/oppsummering", "/ai/forklar-databruk", "/ai/klarsprak", "/ai/risikosjekk"];
    if (request.method === "POST" && gyldigeStier.includes(url.pathname)) {
      const body = await lesBody(request);
      const type = url.pathname.replace("/ai/", "");
      const svar = await byggAiSvar(type, body);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || nyttId("flyt"),
        handling: "KI_KALL",
        ressurs: type,
        aktor: { type: "system", id: "ai-gateway" }
      });
      jsonSvar(response, 200, svar);
      return;
    }

    jsonSvar(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    jsonSvar(response, 500, { feil: "Intern feil i AI-gateway.", detalj: error.message, syntetisk: true });
  }
});

server.listen(port, () => {
  console.log(`AI-gateway kjører på http://localhost:${port}`);
});
