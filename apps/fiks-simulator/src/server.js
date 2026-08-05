import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// See the same split in sandbox-backend: data/ is seed and stays untouched,
// state/ holds everything written at runtime and is gitignored.
const seedMappe = path.resolve(__dirname, "../../../data");
const stateMappe = process.env.STATE_DIR || path.resolve(__dirname, "../../../state");
const port = 8081;
const backendBaseUrl = process.env.BACKEND_BASE_URL || "http://sandbox-backend:8080";

function jsonSvar(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
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

// Same two-level lookup as sandbox-backend: state/ first, then the seed in
// data/. Runtime-only datasets have no seed and pass a default; anything
// without one is required and fails loudly if missing.
async function lesJson(filnavn, standardverdi) {
  for (const mappe of [stateMappe, seedMappe]) {
    try {
      return JSON.parse(await readFile(path.join(mappe, filnavn), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (standardverdi !== undefined) {
    return standardverdi;
  }
  throw new Error(`Fant ikke ${filnavn} i verken state/ eller data/.`);
}

async function skrivJson(filnavn, data) {
  await mkdir(stateMappe, { recursive: true });
  await writeFile(path.join(stateMappe, filnavn), JSON.stringify(data, null, 2) + "\n");
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

// --------------------------------------------------------------------------
// Skatte- og inntektsopplysninger: beregning
//
// Modellert etter KS Fiks sitt register-API, beregningstype BARNEHAGE_SFO:
// https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json
//
// Simulatoren beregner grunnlaget. Inntektsgrensene eies av kommunen og
// ligger i data/satser.json, som sandbox-backend bruker.
// --------------------------------------------------------------------------

// Poster som ikke inngår i grunnlaget føres som ADDERE i inntekt og
// SUBTRAHERE i fradrag. Da blir beregningsbeloep riktig, samtidig som
// innbyggeren kan se hvilke ytelser som ble holdt utenfor og hvorfor.
function byggPost(post, identifikator) {
  return {
    tekniskNavn: post.tekniskNavn,
    visningstekst: post.visningstekst,
    operasjon: "ADDERE",
    beloep: post.beloep,
    kilde: post.kilde || "SKATTEETATEN",
    kanEndreVisningstekst: false,
    identifikator,
    ...(post.infotekst ? { infotekst: post.infotekst } : {}),
    ...(post.referanse ? { referanse: post.referanse } : {})
  };
}

function byggBeregning(deltakere) {
  const inntektsposter = [];
  const fradragsposter = [];

  for (const d of deltakere) {
    for (const post of d.poster) {
      inntektsposter.push(byggPost(post, d.identifikator));
      if (!post.medregnes) {
        fradragsposter.push({
          ...byggPost(post, d.identifikator),
          operasjon: "SUBTRAHERE",
          infotekst: post.infotekst || "Inngår ikke i grunnlaget."
        });
      }
    }
  }

  const sum = (poster) => poster.reduce((t, p) => t + p.beloep, 0);
  const gruppe = (tekniskNavn, visningstekst, operasjon, poster) => ({
    tekniskNavn,
    visningstekst,
    beloep: sum(poster),
    operasjon,
    type: "GRUNNLAG",
    beregningsposter: poster
  });

  const inntekt = {
    beloep: sum(inntektsposter),
    beregning: [gruppe("samletInntekt", "Samlet innrapportert inntekt", "ADDERE", inntektsposter)]
  };
  const fradrag = {
    beloep: sum(fradragsposter),
    beregning: [gruppe("ytelserUtenforGrunnlaget", "Ytelser som ikke inngår i grunnlaget", "SUBTRAHERE", fradragsposter)]
  };

  return { inntekt, fradrag, beregningsbeloep: inntekt.beloep - fradrag.beloep };
}

// Én visningspost per inntektstype, med beløp fordelt på personene bak.
// Skjermede personer teller med i totalen, men fordelingen deres vises ikke.
function byggVisningsposter(deltakere) {
  const perType = new Map();

  for (const d of deltakere) {
    for (const post of d.poster) {
      if (!post.medregnes) continue;
      if (!perType.has(post.tekniskNavn)) {
        perType.set(post.tekniskNavn, {
          tekniskNavn: post.tekniskNavn,
          visningstekst: post.visningstekst,
          beloep: 0,
          personer: []
        });
      }
      const vp = perType.get(post.tekniskNavn);
      vp.beloep += post.beloep;
      if (d.skjermet) {
        vp.infotekst = "Beløpet inkluderer et husstandsmedlem med skjermet identitet, som ikke kan spesifiseres.";
      } else {
        vp.personer.push({ identifikator: d.identifikator, beloep: post.beloep });
      }
    }
  }

  return [{ kategori: "INNTEKT", poster: [...perType.values()] }];
}

function beregnRedusertForeldrebetaling(body, personer, inntekter) {
  const feilmeldinger = [];
  const inntektsaar = body.inntektsaar;

  if (!Number.isInteger(inntektsaar)) {
    feilmeldinger.push({ kode: "INNTEKTSAAR_MANGLER", melding: "inntektsaar må være et heltall." });
  }
  if (!Array.isArray(body.personer) || body.personer.length === 0) {
    feilmeldinger.push({ kode: "PERSONER_MANGLER", melding: "personer må inneholde minst én person." });
  }
  if (feilmeldinger.length) {
    return { feilmeldinger, deltakere: [], svarPersoner: [] };
  }

  const deltakere = [];
  const svarPersoner = [];

  for (const forespurt of body.personer) {
    const type = forespurt.type || "SOEKER";
    if (!["SOEKER", "ANNET"].includes(type)) {
      feilmeldinger.push({
        kode: "UGYLDIG_PERSONTYPE",
        melding: `type må være SOEKER eller ANNET for beregningstype BARNEHAGE_SFO, fikk ${type}.`
      });
      continue;
    }

    const person = personer.find((p) => p.syntetiskFodselsnummer === forespurt.identifikator);
    if (!person) {
      feilmeldinger.push({
        kode: "PERSON_IKKE_FUNNET",
        melding: `Fant ingen person med identifikator ${forespurt.identifikator}.`
      });
      continue;
    }

    const rad = inntekter.find(
      (i) => i.identifikator === forespurt.identifikator && i.inntektsaar === inntektsaar
    );
    const ekstraposter = (forespurt.ekstraposter || []).map((e) => ({
      tekniskNavn: e.tekniskNavn,
      visningstekst: e.visningstekst || e.tekniskNavn,
      beloep: e.beloep,
      kilde: "MANUELL_INPUT",
      medregnes: true,
      referanse: e.referanse
    }));

    if (!rad && ekstraposter.length === 0) {
      feilmeldinger.push({
        kode: "INGEN_SKATTEOPPGJOER_FUNNET",
        melding: `Fant ingen skatteopplysninger for ${forespurt.identifikator} i inntektsåret ${inntektsaar}.`
      });
      continue;
    }

    deltakere.push({
      identifikator: forespurt.identifikator,
      skjermet: Boolean(person.skjermet),
      poster: [...(rad?.poster || []), ...ekstraposter]
    });

    svarPersoner.push({
      identifikator: forespurt.identifikator,
      navn: person.skjermet ? undefined : person.navn,
      type,
      skjermet: Boolean(person.skjermet),
      skatteoppgjoersdato: rad?.skatteoppgjoersdato || undefined,
      stadie: rad?.stadie || "UKJENT",
      registreringstidpunkt: new Date().toISOString()
    });
  }

  return { feilmeldinger, deltakere, svarPersoner };
}

function docsHtml() {
  return `
  <!doctype html>
  <html lang="nb">
    <head><meta charset="utf-8"><title>Fiks Simulator API</title></head>
    <body style="font-family: Arial, sans-serif; padding: 24px;">
      <h1>Fiks Simulator API</h1>
      <ul>
        <li><code>POST /fiks/samtykke</code></li>
        <li><code>GET /fiks/samtykke/{samtykkeId}</code></li>
        <li><code>PUT /fiks/samtykke/{samtykkeId}/svar</code></li>
        <li><code>PUT /fiks/samtykke/{samtykkeId}/trekk</code></li>
        <li><code>GET /fiks/personer/{personId}/samtykker</code></li>
        <li><code>POST /fiks/oppgaver</code></li>
      </ul>
    </body>
  </html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonSvar(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse" || url.pathname === "/health") {
      jsonSvar(response, 200, { status: "ok", tjeneste: "fiks-simulator", tidspunkt: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/docs") {
      tekstSvar(response, 200, docsHtml());
      return;
    }

    if (url.pathname === "/openapi.yaml") {
      const yaml = await readFile(path.resolve(__dirname, "../../../openapi/fiks-simulator.yaml"), "utf8");
      tekstSvar(response, 200, yaml, "text/yaml; charset=utf-8");
      return;
    }

    const personer = await lesJson("personer.json");
    const husstander = await lesJson("husstander.json");
    const inntekter = await lesJson("inntekter.json");
    const barnehageplasser = await lesJson("barnehageplasser.json");
    const samtykker = await lesJson("samtykker.json", []);
    const oppgaver = await lesJson("oppgaver.json", []);
    const meldinger = await lesJson("meldinger.json", []);

    // Full Fiks-sti, slik at kall kan kopieres fra Fiks-dokumentasjonen og
    // senere peke på det ekte API-et ved kun å bytte base-URL.
    const beregningTreff = url.pathname.match(
      /^\/register\/api\/v1\/ks\/([^/]+)\/skatteoginntektsopplysninger\/beregning\/redusert-foreldrebetaling$/
    );
    if (request.method === "POST" && beregningTreff) {
      const body = await lesBody(request);
      const { feilmeldinger, deltakere, svarPersoner } = beregnRedusertForeldrebetaling(
        body, personer, inntekter
      );
      const { inntekt, fradrag, beregningsbeloep } = byggBeregning(deltakere);
      const stadier = svarPersoner.map((p) => p.stadie);

      await leggTilRevisjon({
        sporingsId: body.sporingsId,
        handling: "BEREGNING_UTFOERT",
        ressurs: "skatteoginntektsopplysninger",
        aktor: { type: "system", id: "fiks-simulator" }
      });

      jsonSvar(response, 200, {
        inntektsaar: body.inntektsaar,
        stadie: stadier.length === 0 || stadier.includes("UKJENT")
          ? "UKJENT"
          : stadier.includes("UTKAST") ? "UTKAST" : "OPPGJOER",
        personer: svarPersoner,
        visningsposter: byggVisningsposter(deltakere),
        beregningsbeloep,
        inntekt,
        fradrag,
        soeketidspunkt: new Date().toISOString(),
        beregningstype: "BARNEHAGE_SFO",
        feilmeldinger,
        syntetisk: true
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/fiks/samtykke") {
      const body = await lesBody(request);
      const nyttSamtykke = {
        samtykkeId: nyttId("samtykke"),
        personId: body.personId,
        formaal: body.formaal,
        dataKilder: body.dataKilder || [],
        status: "VENTER_PAA_SVAR",
        opprettet: new Date().toISOString(),
        utloper: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        sporingsId: body.sporingsId || nyttId("flyt"),
        historikk: [{ tidspunkt: new Date().toISOString(), status: "VENTER_PAA_SVAR" }],
        syntetisk: true
      };
      samtykker.push(nyttSamtykke);
      await skrivJson("samtykker.json", samtykker);
      await leggTilRevisjon({
        sporingsId: nyttSamtykke.sporingsId,
        handling: "SAMTYKKE_OPPRETTET",
        ressurs: "samtykke",
        aktor: { type: "testbruker", id: nyttSamtykke.personId }
      });
      jsonSvar(response, 201, nyttSamtykke);
      return;
    }

    const samtykkeTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)$/);
    if (request.method === "GET" && samtykkeTreff) {
      const samtykke = samtykker.find((kandidat) => kandidat.samtykkeId === samtykkeTreff[1]);
      if (!samtykke) {
        jsonSvar(response, 404, { feil: "Fant ikke samtykke." });
        return;
      }
      jsonSvar(response, 200, samtykke);
      return;
    }

    const historikkTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)\/historikk$/);
    if (request.method === "GET" && historikkTreff) {
      const samtykke = samtykker.find((kandidat) => kandidat.samtykkeId === historikkTreff[1]);
      if (!samtykke) {
        jsonSvar(response, 404, { feil: "Fant ikke samtykke." });
        return;
      }
      jsonSvar(response, 200, samtykke.historikk || []);
      return;
    }

    const svarTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)\/svar$/);
    if (request.method === "PUT" && svarTreff) {
      const body = await lesBody(request);
      const samtykke = samtykker.find((kandidat) => kandidat.samtykkeId === svarTreff[1]);
      if (!samtykke) {
        jsonSvar(response, 404, { feil: "Fant ikke samtykke." });
        return;
      }
      samtykke.status = body.status || "SAMTYKKET";
      samtykke.historikk.push({ tidspunkt: new Date().toISOString(), status: samtykke.status });
      await skrivJson("samtykker.json", samtykker);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || samtykke.sporingsId,
        handling: "SAMTYKKE_SVART",
        ressurs: "samtykke",
        aktor: { type: "testbruker", id: samtykke.personId },
        grunnlag: { status: samtykke.status, id: samtykke.samtykkeId }
      });
      jsonSvar(response, 200, samtykke);
      return;
    }

    const trekkTreff = url.pathname.match(/^\/fiks\/samtykke\/([^/]+)\/trekk$/);
    if (request.method === "PUT" && trekkTreff) {
      const body = await lesBody(request);
      const samtykke = samtykker.find((kandidat) => kandidat.samtykkeId === trekkTreff[1]);
      if (!samtykke) {
        jsonSvar(response, 404, { feil: "Fant ikke samtykke." });
        return;
      }
      samtykke.status = "TRUKKET";
      samtykke.historikk.push({ tidspunkt: new Date().toISOString(), status: "TRUKKET" });
      await skrivJson("samtykker.json", samtykker);
      await leggTilRevisjon({
        sporingsId: body.sporingsId || samtykke.sporingsId,
        handling: "SAMTYKKE_TRUKKET",
        ressurs: "samtykke",
        aktor: { type: "testbruker", id: samtykke.personId }
      });
      jsonSvar(response, 200, samtykke);
      return;
    }

    const personSamtykkeTreff = url.pathname.match(/^\/fiks\/personer\/([^/]+)\/samtykker$/);
    if (request.method === "GET" && personSamtykkeTreff) {
      jsonSvar(response, 200, samtykker.filter((samtykke) => samtykke.personId === personSamtykkeTreff[1]));
      return;
    }

    const personTreff = url.pathname.match(/^\/fiks\/register\/person\/([^/]+)$/);
    if (request.method === "GET" && personTreff) {
      const person = personer.find((kandidat) => kandidat.personId === personTreff[1]);
      jsonSvar(response, person ? 200 : 404, person || { feil: "Fant ikke person." });
      return;
    }

    const husstandTreff = url.pathname.match(/^\/fiks\/register\/husstand\/([^/]+)$/);
    if (request.method === "GET" && husstandTreff) {
      const person = personer.find((kandidat) => kandidat.personId === husstandTreff[1]);
      const husstand = husstander.find((kandidat) => kandidat.husstandId === person?.husstandId);
      jsonSvar(response, husstand ? 200 : 404, husstand || { feil: "Fant ikke husstand." });
      return;
    }

    const inntektTreff = url.pathname.match(/^\/fiks\/register\/inntekt\/([^/]+)$/);
    if (request.method === "GET" && inntektTreff) {
      const inntekt = inntekter.find((kandidat) => kandidat.personId === inntektTreff[1]);
      jsonSvar(response, inntekt ? 200 : 404, inntekt || { feil: "Fant ikke inntekt." });
      return;
    }

    const barnehageTreff = url.pathname.match(/^\/fiks\/register\/barnehage\/([^/]+)$/);
    if (request.method === "GET" && barnehageTreff) {
      jsonSvar(response, 200, barnehageplasser.filter((kandidat) => kandidat.personId === barnehageTreff[1]));
      return;
    }

    const kontaktTreff = url.pathname.match(/^\/fiks\/register\/kontaktinfo\/([^/]+)$/);
    if (request.method === "GET" && kontaktTreff) {
      const person = personer.find((kandidat) => kandidat.personId === kontaktTreff[1]);
      jsonSvar(response, person ? 200 : 404, person ? { personId: person.personId, kontakt: person.kontakt, syntetisk: true } : { feil: "Fant ikke person." });
      return;
    }

    if (request.method === "POST" && url.pathname === "/fiks/oppgaver") {
      const body = await lesBody(request);
      const oppgave = {
        oppgaveId: nyttId("oppgave"),
        personId: body.personId,
        soknadId: body.soknadId,
        tittel: body.tittel || "Ny oppgave",
        status: "OPPRETTET",
        opprettet: new Date().toISOString(),
        sporingsId: body.sporingsId || nyttId("flyt"),
        syntetisk: true
      };
      oppgaver.push(oppgave);
      await skrivJson("oppgaver.json", oppgaver);
      await leggTilRevisjon({
        sporingsId: oppgave.sporingsId,
        handling: "OPPGAVE_OPPRETTET",
        ressurs: "oppgave",
        aktor: { type: "system", id: "fiks-simulator" }
      });
      jsonSvar(response, 201, oppgave);
      return;
    }

    const oppgaveTreff = url.pathname.match(/^\/fiks\/oppgaver\/([^/]+)$/);
    if (request.method === "GET" && oppgaveTreff) {
      const oppgave = oppgaver.find((kandidat) => kandidat.oppgaveId === oppgaveTreff[1]);
      jsonSvar(response, oppgave ? 200 : 404, oppgave || { feil: "Fant ikke oppgave." });
      return;
    }

    if (request.method === "POST" && url.pathname === "/fiks/meldinger") {
      const body = await lesBody(request);
      const melding = {
        meldingId: nyttId("melding"),
        tittel: body.tittel || "Ny melding",
        innhold: body.innhold || "",
        opprettet: new Date().toISOString(),
        syntetisk: true
      };
      meldinger.push(melding);
      await skrivJson("meldinger.json", meldinger);
      jsonSvar(response, 201, melding);
      return;
    }

    const meldingTreff = url.pathname.match(/^\/fiks\/meldinger\/([^/]+)$/);
    if (request.method === "GET" && meldingTreff) {
      const melding = meldinger.find((kandidat) => kandidat.meldingId === meldingTreff[1]);
      jsonSvar(response, melding ? 200 : 404, melding || { feil: "Fant ikke melding." });
      return;
    }

    jsonSvar(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    jsonSvar(response, 500, { feil: "Intern feil i Fiks-simulator.", detalj: error.message, syntetisk: true });
  }
});

server.listen(port, () => {
  console.log(`Fiks-simulator kjører på http://localhost:${port}`);
});
