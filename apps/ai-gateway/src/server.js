import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataMappe = path.resolve(__dirname, "../../../data");
const port = 8082;
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

async function lesJson(filnavn) {
  return JSON.parse(await readFile(path.join(dataMappe, filnavn), "utf8"));
}

async function skrivJson(filnavn, data) {
  await writeFile(path.join(dataMappe, filnavn), JSON.stringify(data, null, 2) + "\n");
}

function nyttId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function leggTilRevisjon(hendelse) {
  const revisjonslogg = await lesJson("revisjonslogg.json");
  revisjonslogg.push({
    hendelseId: nyttId("revisjon"),
    tidspunkt: new Date().toISOString(),
    syntetisk: true,
    ...hendelse
  });
  await skrivJson("revisjonslogg.json", revisjonslogg);
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
    const inntekt = finnVerdi((v) => v?.bruttoInntekt !== undefined && v?.aar !== undefined);
    if (!inntekt) return null;
    return `Inntekt ${inntekt.aar}: bruttoinntekt ${formaterBelop(inntekt.bruttoInntekt)} kr (${formaterBelop(inntekt.manedsInntekt)} kr/mnd)`;
  }

  function byggSvarLinjer() {
    const svarEntries = Object.entries(svar || {});
    if (!svarEntries.length) return null;
    return svarEntries.map(([stegId, verdi]) => `${stegId}: "${typeof verdi === "object" ? JSON.stringify(verdi) : verdi}"`).join("; ");
  }

  function byggOppsummeringstekst() {
    const husstandLinje = byggHusstandLinjer();
    const inntektLinje = byggInntektLinjer();
    const svarLinje = byggSvarLinjer();

    const detaljer = [husstandLinje, inntektLinje, svarLinje].filter(Boolean);
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

function heuristiskTolkning(body) {
  const tekst = normaliserTekst(body?.tekst);
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

  if (negativeMonstre.some((monster) => tekst.includes(monster))) {
    return {
      intent: neiIntent,
      confidence: 0.8,
      begrunnelse: "Heuristisk negativ tolkning"
    };
  }

  if (positiveMonstre.some((monster) => tekst.includes(monster))) {
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
