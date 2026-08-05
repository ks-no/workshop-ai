import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// data/ holds seed data and is tracked in git. Nothing here is ever written
// to at runtime. Everything the services change lives in state/, which is
// gitignored, so a demo run never dirties the working tree.
const seedMappe = path.resolve(__dirname, "../../../data");
const stateMappe = process.env.STATE_DIR || path.resolve(__dirname, "../../../state");
const openapiFil = path.resolve(__dirname, "../../../openapi/sandbox-backend.yaml");
const port = 8080;
const fiksBaseUrl = process.env.FIKS_BASE_URL || "http://fiks-simulator:8081";
const aiBaseUrl = process.env.AI_BASE_URL || "http://ai-gateway:8082";

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
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  response.end(data);
}

// Reads from state/ once something has been written there, and falls back to
// the seed in data/. Pure seed files are never written, so they always come
// from data/.
//
// Datasets that only exist at runtime have no seed at all, so they pass a
// default. Anything called without one is required, and a missing file fails
// loudly rather than quietly looking empty.
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

async function lesRequestBody(request) {
  const deler = [];
  for await (const del of request) {
    deler.push(del);
  }
  return deler.length === 0 ? {} : JSON.parse(Buffer.concat(deler).toString("utf8"));
}

function normaliserProsess(prosess) {
  return {
    ...prosess,
    steg: Array.isArray(prosess?.steg) ? prosess.steg : [],
    redigering: {
      status: "publisert",
      ...prosess?.redigering
    }
  };
}

function parseProsessDefinisjoner(data) {
  if (Array.isArray(data)) {
    return {
      formatVersion: "0.1.0",
      prosesser: data.map(normaliserProsess),
      maler: [],
      meta: {}
    };
  }

  const { prosesser, maler, formatVersion, ...meta } = data || {};

  return {
    formatVersion: formatVersion || "0.2.0",
    prosesser: Array.isArray(prosesser) ? prosesser.map(normaliserProsess) : [],
    maler: Array.isArray(maler) ? maler.map(normaliserProsess) : [],
    meta
  };
}

function erMalProsess(prosess) {
  return prosess?.redigering?.mal === true || prosess?.redigering?.status === "template";
}

function hentProsesserForVisning(tilstand, inkluderMaler = false) {
  if (inkluderMaler) {
    return [...tilstand.prosesser, ...tilstand.prosessMaler];
  }
  return tilstand.prosesser;
}

async function lagreProsessdefinisjoner(tilstand) {
  await skrivJson("prosessdefinisjoner.json", {
    ...tilstand.prosessKatalogMeta,
    formatVersion: tilstand.prosessFormatVersion || "0.2.0",
    prosesser: tilstand.prosesser,
    maler: tilstand.prosessMaler
  });
}

function nyttId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function erstattParametere(url, oekt) {
  let result = url;
  result = result.replace(/{personId}/g, encodeURIComponent(oekt.personId));
  for (const [stegId, svarVerdi] of Object.entries(oekt.svar || {})) {
    const enkeltMal = new RegExp(`\\{svar\\.${stegId}\\}`, "g");
    if (typeof svarVerdi === "string") {
      result = result.replace(enkeltMal, encodeURIComponent(svarVerdi));
    }
    if (typeof svarVerdi === "object" && svarVerdi !== null) {
      for (const [feltId, feltVerdi] of Object.entries(svarVerdi)) {
        const feltMal = new RegExp(`\\{svar\\.${stegId}\\.${feltId}\\}`, "g");
        result = result.replace(feltMal, encodeURIComponent(String(feltVerdi)));
      }
    }
  }
  return result;
}

function finnGate(tilstand, gateNavn) {
  if (!gateNavn) return null;
  const norm = String(gateNavn).toLowerCase().trim();
  const gater = tilstand.matrikkel?.gater || [];
  return (
    gater.find((g) => g.adressenavn.toLowerCase() === norm) ||
    gater.find((g) => g.adressenavn.toLowerCase().includes(norm)) ||
    gater.find((g) => norm.includes(g.adressenavn.toLowerCase())) ||
    null
  );
}

function hentSporingsId(url) {
  return url.searchParams.get("sporingsId") || nyttId("flyt");
}

async function lesTilstand() {
  const [
    personer,
    husstander,
    inntekter,
    barnehageplasser,
    soknader,
    prosesser,
    informasjonsmodeller,
    samtykker,
    revisjonslogg,
    prosessoekter,
    matrikkel,
    satser,
    sfoplasser
  ] = await Promise.all([
    lesJson("personer.json"),
    lesJson("husstander.json"),
    lesJson("inntekter.json"),
    lesJson("barnehageplasser.json"),
    lesJson("soknader.json", []),
    lesJson("prosessdefinisjoner.json"),
    lesJson("informasjonsmodeller.json"),
    lesJson("samtykker.json", []),
    lesJson("revisjonslogg.json", []),
    lesJson("prosessoekter.json", []),
    lesJson("matrikkel.json"),
    lesJson("satser.json"),
    lesJson("sfoplasser.json")
  ]);

  const prosesskatalog = parseProsessDefinisjoner(prosesser);

  return {
    personer,
    husstander,
    inntekter,
    barnehageplasser,
    soknader,
    prosesser: prosesskatalog.prosesser,
    prosessMaler: prosesskatalog.maler,
    prosessFormatVersion: prosesskatalog.formatVersion,
    prosessKatalogMeta: prosesskatalog.meta,
    informasjonsmodeller,
    samtykker,
    revisjonslogg,
    prosessoekter,
    matrikkel,
    satser,
    sfoplasser
  };
}

// This service is the only writer of the audit log — fiks-simulator posts its
// events to /api/revisjonslogg rather than touching the file.
//
// Writes are chained so that concurrent requests cannot interleave their
// read-modify-write and drop each other's events.
let revisjonsKoe = Promise.resolve();

async function leggTilRevisjon(hendelse) {
  revisjonsKoe = revisjonsKoe.then(async () => {
    const revisjonslogg = await lesJson("revisjonslogg.json", []);
    revisjonslogg.push({
      hendelseId: nyttId("revisjon"),
      tidspunkt: new Date().toISOString(),
      syntetisk: true,
      ...hendelse
    });
    await skrivJson("revisjonslogg.json", revisjonslogg);
  }).catch((error) => {
    console.warn(`Kunne ikke skrive revisjonslogg: ${error.message}`);
  });
  return revisjonsKoe;
}

function docsHtml() {
  return `
  <!doctype html>
  <html lang="nb">
    <head><meta charset="utf-8"><title>Sandbox Backend API</title></head>
    <body style="font-family: Arial, sans-serif; padding: 24px;">
      <h1>Sandbox Backend API</h1>
      <ul>
        <li><code>GET /helse</code></li>
        <li><code>GET /api/personer</code></li>
        <li><code>GET /api/prosesser</code></li>
        <li><code>POST /api/prosessoekter</code></li>
        <li><code>GET /api/prosessoekter/{oektsId}</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/svar</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/handling</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/neste</code></li>
        <li><code>POST /api/prosessoekter/{oektsId}/forrige</code></li>
      </ul>
    </body>
  </html>`;
}

function finnPerson(tilstand, personId) {
  return tilstand.personer.find((person) => person.personId === personId) || null;
}

function finnProsess(tilstand, prosessId) {
  return hentProsesserForVisning(tilstand, true).find((prosess) => prosess.id === prosessId) || null;
}

function finnProsessoekt(tilstand, oektsId) {
  return tilstand.prosessoekter.find((oekt) => oekt.oektsId === oektsId) || null;
}

function byggProsessoektRespons(oekt, prosess) {
  return {
    ...oekt,
    aktivtSteg: prosess?.steg?.[oekt.stegIndex] || null,
    totaltAntallSteg: prosess?.steg?.length || 0
  };
}

async function lagreProsessoekter(prosessoekter) {
  await skrivJson("prosessoekter.json", prosessoekter);
}

function hentHusstandForPerson(tilstand, personId) {
  const person = finnPerson(tilstand, personId);
  if (!person) {
    throw new Error("Fant ikke person.");
  }
  const husstand = tilstand.husstander.find((kandidat) => kandidat.husstandId === person.husstandId);
  if (!husstand) {
    throw new Error("Fant ikke husstand.");
  }
  return husstand;
}

function hentBarnehageForPerson(tilstand, personId) {
  const person = finnPerson(tilstand, personId);
  if (!person) {
    throw new Error("Fant ikke person.");
  }
  const husstand = tilstand.husstander.find((kandidat) => kandidat.husstandId === person.husstandId);
  const barnIds = husstand?.medlemmer.filter((medlem) => medlem.rolle === "barn").map((medlem) => medlem.personId) || [person.personId];
  return tilstand.barnehageplasser.filter((plass) => barnIds.includes(plass.personId));
}

// Syntetisk rolle-id. I ekte Fiks identifiserer den kommunens rolle.
const fiksRolleId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

// Henter inntektsgrunnlaget fra Fiks-simulatoren for hele husholdningen.
// Ektefeller, registrerte partnere og samboere regnes som én husholdning,
// jf. forskrift om foreldrebetaling.
async function hentInntektsgrunnlag(tilstand, personId, inntektsaar) {
  const husstand = hentHusstandForPerson(tilstand, personId);
  const personer = husstand.medlemmer
    .filter((medlem) => medlem.rolle === "foresatt")
    .map((medlem) => {
      const person = finnPerson(tilstand, medlem.personId);
      return {
        identifikator: person.syntetiskFodselsnummer,
        type: medlem.personId === personId ? "SOEKER" : "ANNET"
      };
    });

  const svar = await fetch(
    `${fiksBaseUrl}/register/api/v1/ks/${fiksRolleId}/skatteoginntektsopplysninger/beregning/redusert-foreldrebetaling`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inntektsaar, personer })
    }
  );
  if (!svar.ok) {
    throw new Error(`Beregning i Fiks-simulatoren feilet med status ${svar.status}.`);
  }
  return svar.json();
}

function sisteInntektsaar(tilstand, personId) {
  const husstand = hentHusstandForPerson(tilstand, personId);
  const identer = husstand.medlemmer
    .filter((medlem) => medlem.rolle === "foresatt")
    .map((medlem) => finnPerson(tilstand, medlem.personId)?.syntetiskFodselsnummer);
  const aar = tilstand.inntekter
    .filter((rad) => identer.includes(rad.identifikator))
    .map((rad) => rad.inntektsaar);
  return aar.length ? Math.max(...aar) : new Date().getFullYear() - 1;
}

async function hentInntektForPerson(tilstand, personId) {
  return hentInntektsgrunnlag(tilstand, personId, sisteInntektsaar(tilstand, personId));
}

function formaterBelop(belop) {
  return new Intl.NumberFormat("nb-NO").format(Math.round(belop));
}

// Vurderer én ordning i data/satser.json mot inntektsgrunnlaget fra Fiks.
// Beregningen er deterministisk og skjer her, ikke i KI-laget — jf.
// regelen ai-no-decisions i policies/ai-policy.yaml.
async function vurderOrdning(tilstand, personId, ordningId) {
  const satser = tilstand.satser;
  const ordning = satser.ordninger.find((kandidat) => kandidat.id === ordningId);
  if (!ordning) {
    throw new Error(`Ukjent ordning: ${ordningId}. Gyldige: ${satser.ordninger.map((o) => o.id).join(", ")}.`);
  }

  const beregning = await hentInntektsgrunnlag(tilstand, personId, sisteInntektsaar(tilstand, personId));
  if (beregning.feilmeldinger.length > 0) {
    const feil = beregning.feilmeldinger[0];
    return {
      godkjent: false,
      melding: feil.melding,
      grunnlag: { ordning: ordning.id, feilkode: feil.kode, stadie: beregning.stadie }
    };
  }

  const grunnlag = beregning.beregningsbeloep;
  const felles = {
    ordning: ordning.id,
    ordningNavn: ordning.navn,
    beregningsbeloep: grunnlag,
    stadie: beregning.stadie,
    gjelderFra: satser.gjelderFra,
    kilde: satser.kilde
  };
  const forbehold = beregning.stadie === "UTKAST"
    ? " Merk at skatteoppgjøret ikke er ferdig, så grunnlaget kan endre seg."
    : "";

  if (ordning.regel === "INNTEKTSGRENSE") {
    const godkjent = grunnlag < ordning.inntektsgrense;
    return {
      godkjent,
      melding: godkjent
        ? `Husholdningens inntektsgrunnlag er ${formaterBelop(grunnlag)} kr, under grensen på ${formaterBelop(ordning.inntektsgrense)} kr for ${ordning.navn}.${forbehold}`
        : `Husholdningens inntektsgrunnlag er ${formaterBelop(grunnlag)} kr, over grensen på ${formaterBelop(ordning.inntektsgrense)} kr for ${ordning.navn}.${forbehold}`,
      grunnlag: { ...felles, inntektsgrense: ordning.inntektsgrense }
    };
  }

  if (ordning.regel === "MAKS_ANDEL_AV_INNTEKT") {
    const plasser = ordning.tjeneste === "sfo"
      ? hentSfoForPerson(tilstand, personId)
      : hentBarnehageForPerson(tilstand, personId);
    if (plasser.length === 0) {
      return {
        godkjent: false,
        melding: `Fant ingen ${ordning.tjeneste}-plass registrert på husstanden.`,
        grunnlag: felles
      };
    }
    const aarspris = plasser.reduce((sum, p) => sum + p.manedspris, 0) * satser.maanederMedBetaling;
    const tak = satser.maksAndelAvInntekt * grunnlag;
    const godkjent = aarspris > tak;
    return {
      godkjent,
      melding: godkjent
        ? `Full pris er ${formaterBelop(aarspris)} kr i året, mer enn ${Math.round(satser.maksAndelAvInntekt * 100)} % av inntektsgrunnlaget på ${formaterBelop(grunnlag)} kr (${formaterBelop(tak)} kr). Du har rett til redusert betaling.${forbehold}`
        : `Full pris er ${formaterBelop(aarspris)} kr i året, som er under ${Math.round(satser.maksAndelAvInntekt * 100)} % av inntektsgrunnlaget på ${formaterBelop(grunnlag)} kr (${formaterBelop(tak)} kr). Du har ikke rett til redusert betaling.${forbehold}`,
      grunnlag: { ...felles, aarspris, maksAndelAvInntekt: satser.maksAndelAvInntekt, tak: Math.round(tak) }
    };
  }

  throw new Error(`Ukjent regeltype: ${ordning.regel}.`);
}

// SJEKK-steg slår opp her på sti. Nye sjekker legges til i tabellen uten at
// stegutførelsen må røres. Hver håndterer returnerer { godkjent, melding }
// og kan legge ved et grunnlag som forklarer utfallet.
const sjekkHandtere = {
  "/api/matrikkel/sjekk/eierforhold": async (params, oekt, tilstand, steg) => {
    const gateNavn = decodeURIComponent(params.get("gate") || "");
    const sjekkerPersonId = decodeURIComponent(params.get("personId") || oekt.personId);
    const gateData = finnGate(tilstand, gateNavn);
    if (!gateData) {
      return { godkjent: false, melding: `Fant ikke gaten "${gateNavn}" i matrikkelen.` };
    }
    const harEiendom = gateData.eiendommer.some(
      (e) => Array.isArray(e.eiere) && e.eiere.includes(sjekkerPersonId)
    );
    return harEiendom
      ? { godkjent: true, melding: `Eierforhold i ${gateData.adressenavn} bekreftet.` }
      : {
          godkjent: false,
          melding: steg.feilmelding || `Du har ingen registrert eiendom i ${gateData.adressenavn}. Søknad om fartsdempende tiltak kan bare sendes av eiere i gaten.`
        };
  },

  "/api/regler/sjekk/foreldrebetaling": async (params, oekt, tilstand) => {
    const personId = decodeURIComponent(params.get("personId") || oekt.personId);
    const ordning = params.get("ordning");
    return vurderOrdning(tilstand, personId, ordning);
  }
};

function hentSfoForPerson(tilstand, personId) {
  const person = finnPerson(tilstand, personId);
  const husstand = tilstand.husstander.find((kandidat) => kandidat.husstandId === person?.husstandId);
  const barnIds = husstand?.medlemmer.filter((m) => m.rolle === "barn").map((m) => m.personId) || [];
  return tilstand.sfoplasser.filter((plass) => barnIds.includes(plass.personId));
}

function harGyldigSamtykke(tilstand, personId, datakilde) {
  return tilstand.samtykker.find((samtykke) =>
    samtykke.personId === personId &&
    samtykke.status === "SAMTYKKET" &&
    Array.isArray(samtykke.dataKilder) &&
    samtykke.dataKilder.includes(datakilde)
  ) || null;
}

async function hentDataForUrl(tilstand, apiUrl, personId, sporingsId) {
  const matcherPersonUrl = (ressurs) => (
    apiUrl.endsWith(`/api/personer/{personId}/${ressurs}`) ||
    apiUrl.endsWith(`/api/personer/${personId}/${ressurs}`)
  );

  if (matcherPersonUrl("husstand")) {
    const data = hentHusstandForPerson(tilstand, personId);
    await leggTilRevisjon({
      sporingsId,
      handling: "DATA_LES",
      ressurs: "husstand",
      aktor: { type: "testbruker", id: personId }
    });
    return data;
  }

  if (matcherPersonUrl("inntekt")) {
    const samtykke = harGyldigSamtykke(tilstand, personId, "inntekt");
    if (!samtykke) {
      await leggTilRevisjon({
        sporingsId,
        handling: "DATA_NEKTET",
        ressurs: "inntekt",
        formaal: "Mangler samtykke",
        aktor: { type: "testbruker", id: personId }
      });
      throw new Error("Inntektsdata krever registrert samtykke.");
    }
    const data = await hentInntektForPerson(tilstand, personId);
    await leggTilRevisjon({
      sporingsId,
      handling: "DATA_LES",
      ressurs: "inntekt",
      formaal: "Vurdere rett til dialogrelatert tjeneste",
      grunnlag: { type: "samtykke", id: samtykke.samtykkeId, status: samtykke.status },
      aktor: { type: "testbruker", id: personId }
    });
    return data;
  }

  if (matcherPersonUrl("barnehage")) {
    const data = hentBarnehageForPerson(tilstand, personId);
    await leggTilRevisjon({
      sporingsId,
      handling: "DATA_LES",
      ressurs: "barnehageplass",
      aktor: { type: "testbruker", id: personId }
    });
    return data;
  }

  if (apiUrl.includes("/api/matrikkel/")) {
    const matrikkelUrl = new URL(`http://localhost${apiUrl}`);
    if (matrikkelUrl.pathname === "/api/matrikkel/gater") {
      const gateNavn = decodeURIComponent(matrikkelUrl.searchParams.get("gate") || "");
      const gateData = finnGate(tilstand, gateNavn);
      if (!gateData) {
        throw new Error(`Fant ikke gaten "${gateNavn}" i matrikkelen. Tilgjengelige gater: ${(tilstand.matrikkel?.gater || []).map((g) => g.adressenavn).join(", ")}.`);
      }
      await leggTilRevisjon({
        sporingsId,
        handling: "DATA_LES",
        ressurs: "matrikkel-gate",
        aktor: { type: "testbruker", id: personId }
      });
      return {
        gateId: gateData.gateId,
        adressenavn: gateData.adressenavn,
        kommune: gateData.kommune,
        kommunenummer: gateData.kommunenummer,
        postnummer: gateData.postnummer,
        poststed: gateData.poststed,
        antallEiendommer: gateData.antallEiendommer,
        antallBoligeiendommer: gateData.antallBoligeiendommer,
        syntetisk: true
      };
    }
    throw new Error(`Ukjent matrikkel-endepunkt: ${apiUrl}`);
  }

  throw new Error(`Støtter ikke API-kall for ${apiUrl}`);
}

async function opprettSoknad(tilstand, body) {
  const nySoknad = {
    soknadId: nyttId("soknad"),
    personId: body.personId,
    prosessId: body.prosessId,
    status: "SENDT_INN",
    opprettet: new Date().toISOString(),
    sporingsId: body.sporingsId || nyttId("flyt"),
    syntetisk: true
  };

  tilstand.soknader.push(nySoknad);
  await skrivJson("soknader.json", tilstand.soknader);
  await leggTilRevisjon({
    sporingsId: nySoknad.sporingsId,
    handling: "SOKNAD_SENDT_INN",
    ressurs: "soknad",
    aktor: { type: "testbruker", id: nySoknad.personId }
  });

  let oppgave = null;
  try {
    const svar = await fetch(`${fiksBaseUrl}/fiks/oppgaver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personId: nySoknad.personId,
        soknadId: nySoknad.soknadId,
        tittel: `Behandle ${body.prosessNavn || "søknad"}`,
        sporingsId: nySoknad.sporingsId
      })
    });
    if (svar.ok) {
      oppgave = await svar.json();
    }
  } catch {
    oppgave = { advarsel: "Kunne ikke opprette oppgave i Fiks-simulator." };
  }

  return { ...nySoknad, oppgave };
}

async function utforStegHandling(tilstand, oekt, prosess, body) {
  const steg = prosess.steg[oekt.stegIndex];
  if (!steg) {
    throw new Error("Fant ikke aktivt steg.");
  }

  if (steg.type === "INFO") {
    return { type: "INFO", melding: "Informasjonssteg krever ingen handling." };
  }

  if (steg.type === "QUESTION") {
    const svar = body.svar ?? oekt.svar[steg.id];
    if (!svar) {
      throw new Error("Spørsmålssteg krever et svar.");
    }
    oekt.svar[steg.id] = svar;
    return { type: "QUESTION", svar };
  }

  if (steg.type === "CONSENT_REQUEST") {
    if (body.handling === "opprett-samtykke") {
      const svar = await fetch(`${fiksBaseUrl}/fiks/samtykke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: oekt.personId,
          formaal: steg.formaal,
          dataKilder: steg.dataKilder || [],
          sporingsId: oekt.sporingsId
        })
      });
      const data = await svar.json();
      oekt.aktivtSamtykkeId = data.samtykkeId;
      oekt.resultater[steg.id] = data;
      return data;
    }

    if (body.handling === "samtykkesvar") {
      const status = body.status || "SAMTYKKET";
      const samtykkeId = oekt.aktivtSamtykkeId;
      if (!samtykkeId) {
        throw new Error("Ingen aktiv samtykkeforespørsel finnes.");
      }
      const svar = await fetch(`${fiksBaseUrl}/fiks/samtykke/${samtykkeId}/svar`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          sporingsId: oekt.sporingsId
        })
      });
      const data = await svar.json();
      oekt.resultater[steg.id] = data;
      return data;
    }

    throw new Error("Samtykkesteg krever handlingen opprett-samtykke eller samtykkesvar.");
  }

  if (steg.type === "DATA_FETCH") {
    const resolvertUrl = erstattParametere(steg.api.url, oekt);
    const data = await hentDataForUrl(tilstand, resolvertUrl, oekt.personId, oekt.sporingsId);
    oekt.resultater[steg.id] = data;
    return data;
  }

  if (steg.type === "SJEKK") {
    const resolvertUrl = erstattParametere(steg.api.url, oekt);
    const sjekketUrl = new URL(`http://localhost${resolvertUrl}`);
    const handterer = sjekkHandtere[sjekketUrl.pathname];
    if (!handterer) {
      throw new Error(
        `Ukjent SJEKK-endepunkt: ${sjekketUrl.pathname}. Gyldige: ${Object.keys(sjekkHandtere).join(", ")}.`
      );
    }
    const resultat = await handterer(sjekketUrl.searchParams, oekt, tilstand, steg);

    oekt.resultater[steg.id] = resultat;
    if (!resultat.godkjent) {
      oekt.status = "AVVIST";
      oekt.avvistMelding = resultat.melding;
    }
    await leggTilRevisjon({
      sporingsId: oekt.sporingsId,
      handling: resultat.godkjent ? "SJEKK_OK" : "SJEKK_AVVIST",
      ressurs: "prosessoekt",
      aktor: { type: "testbruker", id: oekt.personId }
    });
    return resultat;
  }

  if (steg.type === "SUMMARY") {
    const svar = await fetch(`${aiBaseUrl}/ai/oppsummering`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sporingsId: oekt.sporingsId,
        kontekst: {
          tjeneste: prosess.navn,
          personId: oekt.personId,
          prosessId: oekt.prosessId,
          data: oekt.resultater,
          svar: oekt.svar
        },
        sprak: "nb"
      })
    });
    const data = await svar.json();
    oekt.resultater[steg.id] = data;
    return data;
  }

  if (steg.type === "SUBMIT") {
    const data = await opprettSoknad(tilstand, {
      personId: oekt.personId,
      prosessId: oekt.prosessId,
      prosessNavn: prosess.navn,
      sporingsId: oekt.sporingsId
    });
    oekt.resultater[steg.id] = data;
    oekt.status = "FULLFORT";
    return data;
  }

  throw new Error(`Støtter ikke stegtypen ${steg.type}`);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonSvar(response, 204, {});
    return;
  }

  try {
    if (url.pathname === "/helse" || url.pathname === "/health") {
      jsonSvar(response, 200, { status: "ok", tjeneste: "sandbox-backend", tidspunkt: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/docs") {
      tekstSvar(response, 200, docsHtml());
      return;
    }

    if (url.pathname === "/openapi.yaml") {
      tekstSvar(response, 200, await readFile(openapiFil, "utf8"), "text/yaml; charset=utf-8");
      return;
    }

    const tilstand = await lesTilstand();

    if (request.method === "GET" && url.pathname === "/api/personer") {
      // visningsnavn spares klientene for å sette sammen navn selv.
      jsonSvar(response, 200, tilstand.personer.map((person) => ({
        ...person,
        visningsnavn: [person.navn.fornavn, person.navn.mellomnavn, person.navn.etternavn]
          .filter(Boolean).join(" ")
      })));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/regler/satser") {
      jsonSvar(response, 200, tilstand.satser);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/regler/sjekk/foreldrebetaling") {
      const personId = url.searchParams.get("personId");
      const ordning = url.searchParams.get("ordning");
      if (!personId || !ordning) {
        jsonSvar(response, 400, { feil: "personId og ordning er påkrevd." });
        return;
      }
      try {
        jsonSvar(response, 200, await vurderOrdning(tilstand, personId, ordning));
      } catch (error) {
        jsonSvar(response, 400, { feil: error.message });
      }
      return;
    }

    const inntektsgrunnlagTreff = url.pathname.match(/^\/api\/husstander\/([^/]+)\/inntektsgrunnlag$/);
    if (request.method === "GET" && inntektsgrunnlagTreff) {
      const husstand = tilstand.husstander.find((h) => h.husstandId === inntektsgrunnlagTreff[1]);
      const soeker = husstand?.medlemmer.find((m) => m.rolle === "foresatt");
      if (!soeker) {
        jsonSvar(response, 404, { feil: "Fant ikke husstand med en foresatt." });
        return;
      }
      jsonSvar(response, 200, await hentInntektForPerson(tilstand, soeker.personId));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/prosesser") {
      const inkluderMaler = url.searchParams.get("inkluderMaler") === "true";
      jsonSvar(response, 200, hentProsesserForVisning(tilstand, inkluderMaler));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/prosesser") {
      const body = await lesRequestBody(request);
      const nyProsess = normaliserProsess({
        id: body.id || nyttId("prosess"),
        navn: body.navn || "Ny prosess",
        beskrivelse: body.beskrivelse || "Prosess opprettet i prosessbyggeren.",
        versjon: body.versjon || "0.1.0",
        steg: Array.isArray(body.steg) ? body.steg : [],
        redigering: body.redigering || {},
        syntetisk: true
      });
      const alleProsesser = hentProsesserForVisning(tilstand, true);
      if (alleProsesser.some((prosess) => prosess.id === nyProsess.id)) {
        jsonSvar(response, 409, { feil: "Prosess med samme id finnes allerede." });
        return;
      }
      if (erMalProsess(nyProsess)) {
        tilstand.prosessMaler.push(nyProsess);
      } else {
        tilstand.prosesser.push(nyProsess);
      }
      await lagreProsessdefinisjoner(tilstand);
      await leggTilRevisjon({
        sporingsId: nyttId("flyt"),
        handling: "PROSESS_OPPRETTET",
        ressurs: "prosess",
        aktor: { type: "utvikler", id: "prosessbygger" }
      });
      jsonSvar(response, 201, nyProsess);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/katalog/datasett") {
      jsonSvar(response, 200, [
        { id: "personer", fil: "data/personer.json", syntetisk: true },
        { id: "husstander", fil: "data/husstander.json", syntetisk: true },
        { id: "inntekter", fil: "data/inntekter.json", syntetisk: true },
        { id: "barnehageplasser", fil: "data/barnehageplasser.json", syntetisk: true }
      ]);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/katalog/informasjonsmodeller") {
      jsonSvar(response, 200, tilstand.informasjonsmodeller);
      return;
    }

    const personTreff = url.pathname.match(/^\/api\/personer\/([^/]+)$/);
    if (request.method === "GET" && personTreff) {
      const person = finnPerson(tilstand, personTreff[1]);
      if (!person) {
        jsonSvar(response, 404, { feil: "Fant ikke person." });
        return;
      }
      await leggTilRevisjon({
        sporingsId: hentSporingsId(url),
        handling: "DATA_LES",
        ressurs: "person",
        aktor: { type: "testbruker", id: person.personId }
      });
      jsonSvar(response, 200, person);
      return;
    }

    const husstandTreff = url.pathname.match(/^\/api\/personer\/([^/]+)\/husstand$/);
    if (request.method === "GET" && husstandTreff) {
      try {
        jsonSvar(response, 200, hentHusstandForPerson(tilstand, husstandTreff[1]));
      } catch (error) {
        jsonSvar(response, 404, { feil: error.message });
      }
      return;
    }

    const inntektTreff = url.pathname.match(/^\/api\/personer\/([^/]+)\/inntekt$/);
    if (request.method === "GET" && inntektTreff) {
      const samtykke = harGyldigSamtykke(tilstand, inntektTreff[1], "inntekt");
      if (!samtykke) {
        jsonSvar(response, 403, { feil: "Inntektsdata krever registrert samtykke.", syntetisk: true });
        return;
      }
      try {
        jsonSvar(response, 200, await hentInntektForPerson(tilstand, inntektTreff[1]));
      } catch (error) {
        jsonSvar(response, 404, { feil: error.message });
      }
      return;
    }

    const barnehageTreff = url.pathname.match(/^\/api\/personer\/([^/]+)\/barnehage$/);
    if (request.method === "GET" && barnehageTreff) {
      try {
        jsonSvar(response, 200, hentBarnehageForPerson(tilstand, barnehageTreff[1]));
      } catch (error) {
        jsonSvar(response, 404, { feil: error.message });
      }
      return;
    }

    const soknadListeTreff = url.pathname.match(/^\/api\/personer\/([^/]+)\/soknader$/);
    if (request.method === "GET" && soknadListeTreff) {
      jsonSvar(response, 200, tilstand.soknader.filter((soknad) => soknad.personId === soknadListeTreff[1]));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/matrikkel/gater") {
      const gateParam = url.searchParams.get("gate");
      const gater = tilstand.matrikkel?.gater || [];
      if (gateParam) {
        const funnet = finnGate(tilstand, gateParam);
        if (!funnet) {
          jsonSvar(response, 404, { feil: `Fant ikke gaten "${gateParam}".`, tilgjengelige: gater.map((g) => g.adressenavn) });
        } else {
          jsonSvar(response, 200, funnet);
        }
      } else {
        jsonSvar(response, 200, gater.map((g) => ({
          gateId: g.gateId,
          adressenavn: g.adressenavn,
          kommune: g.kommune,
          antallEiendommer: g.antallEiendommer,
          antallBoligeiendommer: g.antallBoligeiendommer
        })));
      }
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/matrikkel/sjekk/eierforhold") {
      const gateParam = url.searchParams.get("gate");
      const personIdParam = url.searchParams.get("personId");
      const gateData = finnGate(tilstand, gateParam);
      if (!gateData) {
        jsonSvar(response, 404, { feil: `Fant ikke gaten "${gateParam}".` });
        return;
      }
      const harEiendom = gateData.eiendommer.some(
        (e) => Array.isArray(e.eiere) && e.eiere.includes(personIdParam)
      );
      jsonSvar(response, 200, { personId: personIdParam, gate: gateData.adressenavn, harEiendom, godkjent: harEiendom });
      return;
    }

    const prosessTreff = url.pathname.match(/^\/api\/prosesser\/([^/]+)$/);


    if (request.method === "GET" && prosessTreff) {
      const prosess = finnProsess(tilstand, prosessTreff[1]);
      jsonSvar(response, prosess ? 200 : 404, prosess || { feil: "Fant ikke prosess." });
      return;
    }

    if (request.method === "PUT" && prosessTreff) {
      const body = await lesRequestBody(request);
      const indeks = tilstand.prosesser.findIndex((prosess) => prosess.id === prosessTreff[1]);
      const malIndeks = tilstand.prosessMaler.findIndex((prosess) => prosess.id === prosessTreff[1]);
      if (indeks === -1 && malIndeks === -1) {
        jsonSvar(response, 404, { feil: "Fant ikke prosess." });
        return;
      }
      const erMal = malIndeks !== -1;
      const liste = erMal ? tilstand.prosessMaler : tilstand.prosesser;
      const listeIndeks = erMal ? malIndeks : indeks;
      const eksisterende = liste[listeIndeks];
      const oppdatertProsess = normaliserProsess({
        ...eksisterende,
        navn: body.navn ?? eksisterende.navn,
        beskrivelse: body.beskrivelse ?? eksisterende.beskrivelse,
        versjon: body.versjon ?? eksisterende.versjon,
        steg: Array.isArray(body.steg) ? body.steg : eksisterende.steg,
        redigering: body.redigering ? { ...eksisterende.redigering, ...body.redigering } : eksisterende.redigering,
        syntetisk: true
      });
      liste[listeIndeks] = oppdatertProsess;
      await lagreProsessdefinisjoner(tilstand);
      await leggTilRevisjon({
        sporingsId: nyttId("flyt"),
        handling: "PROSESS_OPPDATERT",
        ressurs: "prosess",
        aktor: { type: "utvikler", id: "prosessbygger" }
      });
      jsonSvar(response, 200, oppdatertProsess);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/prosessoekter") {
      const body = await lesRequestBody(request);
      const prosess = tilstand.prosesser.find((kandidat) => kandidat.id === body.prosessId) || null;
      const person = finnPerson(tilstand, body.personId);
      if (!prosess || !person) {
        jsonSvar(response, 404, { feil: "Fant ikke prosess eller person." });
        return;
      }
      const nyOekt = {
        oektsId: nyttId("oekt"),
        prosessId: prosess.id,
        personId: person.personId,
        sporingsId: body.sporingsId || nyttId("flyt"),
        status: "AKTIV",
        stegIndex: 0,
        svar: {},
        resultater: {},
        aktivtSamtykkeId: null,
        opprettet: new Date().toISOString(),
        oppdatert: new Date().toISOString(),
        syntetisk: true
      };
      tilstand.prosessoekter.push(nyOekt);
      await lagreProsessoekter(tilstand.prosessoekter);
      await leggTilRevisjon({
        sporingsId: nyOekt.sporingsId,
        handling: "PROSESSOEKT_OPPRETTET",
        ressurs: "prosessoekt",
        aktor: { type: "testbruker", id: nyOekt.personId }
      });
      jsonSvar(response, 201, byggProsessoektRespons(nyOekt, prosess));
      return;
    }

    const oektTreff = url.pathname.match(/^\/api\/prosessoekter\/([^/]+)$/);
    if (request.method === "GET" && oektTreff) {
      const oekt = finnProsessoekt(tilstand, oektTreff[1]);
      if (!oekt) {
        jsonSvar(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      jsonSvar(response, 200, byggProsessoektRespons(oekt, finnProsess(tilstand, oekt.prosessId)));
      return;
    }

    const oektSvarTreff = url.pathname.match(/^\/api\/prosessoekter\/([^/]+)\/svar$/);
    if (request.method === "POST" && oektSvarTreff) {
      const body = await lesRequestBody(request);
      const oekt = finnProsessoekt(tilstand, oektSvarTreff[1]);
      if (!oekt) {
        jsonSvar(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      const prosess = finnProsess(tilstand, oekt.prosessId);
      const steg = prosess?.steg?.[oekt.stegIndex];
      if (!steg) {
        jsonSvar(response, 400, { feil: "Fant ikke aktivt steg." });
        return;
      }
      oekt.svar[body.stegId || steg.id] = body.svar;
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekter(tilstand.prosessoekter);
      await leggTilRevisjon({
        sporingsId: oekt.sporingsId,
        handling: "STEG_SVAR_LAGRET",
        ressurs: "prosessoekt",
        aktor: { type: "testbruker", id: oekt.personId }
      });
      jsonSvar(response, 200, byggProsessoektRespons(oekt, prosess));
      return;
    }

    const oektHandlingTreff = url.pathname.match(/^\/api\/prosessoekter\/([^/]+)\/handling$/);
    if (request.method === "POST" && oektHandlingTreff) {
      const body = await lesRequestBody(request);
      const oekt = finnProsessoekt(tilstand, oektHandlingTreff[1]);
      if (!oekt) {
        jsonSvar(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      const prosess = finnProsess(tilstand, oekt.prosessId);
      const resultat = await utforStegHandling(tilstand, oekt, prosess, body);
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekter(tilstand.prosessoekter);
      jsonSvar(response, 200, {
        oekt: byggProsessoektRespons(oekt, prosess),
        resultat
      });
      return;
    }

    const oektNesteTreff = url.pathname.match(/^\/api\/prosessoekter\/([^/]+)\/neste$/);
    if (request.method === "POST" && oektNesteTreff) {
      const oekt = finnProsessoekt(tilstand, oektNesteTreff[1]);
      if (!oekt) {
        jsonSvar(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      if (oekt.status === "AVVIST" || oekt.status === "FULLFORT") {
        jsonSvar(response, 400, { feil: "Prosessøkten er avsluttet og kan ikke fortsette." });
        return;
      }
      const prosess = finnProsess(tilstand, oekt.prosessId);
      if (oekt.stegIndex >= prosess.steg.length - 1) {
        jsonSvar(response, 400, { feil: "Prosessøkten er allerede på siste steg." });
        return;
      }
      oekt.stegIndex += 1;
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekter(tilstand.prosessoekter);
      jsonSvar(response, 200, byggProsessoektRespons(oekt, prosess));
      return;
    }

    const oektForrigeTreff = url.pathname.match(/^\/api\/prosessoekter\/([^/]+)\/forrige$/);
    if (request.method === "POST" && oektForrigeTreff) {
      const oekt = finnProsessoekt(tilstand, oektForrigeTreff[1]);
      if (!oekt) {
        jsonSvar(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      const prosess = finnProsess(tilstand, oekt.prosessId);
      if (oekt.stegIndex <= 0) {
        jsonSvar(response, 400, { feil: "Prosessøkten er allerede på første steg." });
        return;
      }
      oekt.stegIndex -= 1;
      oekt.oppdatert = new Date().toISOString();
      await lagreProsessoekter(tilstand.prosessoekter);
      jsonSvar(response, 200, byggProsessoektRespons(oekt, prosess));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/soknader") {
      const body = await lesRequestBody(request);
      jsonSvar(response, 201, await opprettSoknad(tilstand, body));
      return;
    }

    const soknadTreff = url.pathname.match(/^\/api\/soknader\/([^/]+)$/);
    if (request.method === "GET" && soknadTreff) {
      const soknad = tilstand.soknader.find((kandidat) => kandidat.soknadId === soknadTreff[1]);
      jsonSvar(response, soknad ? 200 : 404, soknad || { feil: "Fant ikke søknad." });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/revisjonslogg") {
      jsonSvar(response, 200, tilstand.revisjonslogg);
      return;
    }

    // Used by fiks-simulator so this service stays the only writer.
    if (request.method === "POST" && url.pathname === "/api/revisjonslogg") {
      const hendelse = await lesRequestBody(request);
      if (!hendelse.handling) {
        jsonSvar(response, 400, { feil: "Revisjonshendelse mangler handling." });
        return;
      }
      await leggTilRevisjon(hendelse);
      jsonSvar(response, 201, { status: "registrert", syntetisk: true });
      return;
    }

    const revisjonsTreff = url.pathname.match(/^\/api\/revisjonslogg\/([^/]+)$/);
    if (request.method === "GET" && revisjonsTreff) {
      jsonSvar(response, 200, tilstand.revisjonslogg.filter((rad) => rad.sporingsId === revisjonsTreff[1]));
      return;
    }

    jsonSvar(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    jsonSvar(response, 500, {
      feil: "Intern feil i sandbox-backend.",
      detalj: error.message,
      syntetisk: true
    });
  }
});

server.listen(port, () => {
  console.log(`Sandbox-backend kjører på http://localhost:${port}`);
});
