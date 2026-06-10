import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataMappe = path.resolve(__dirname, "../../../data");
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

async function lesJson(filnavn) {
  const innhold = await readFile(path.join(dataMappe, filnavn), "utf8");
  return JSON.parse(innhold);
}

async function skrivJson(filnavn, data) {
  await writeFile(path.join(dataMappe, filnavn), JSON.stringify(data, null, 2) + "\n");
}

async function lesRequestBody(request) {
  const deler = [];
  for await (const del of request) {
    deler.push(del);
  }
  return deler.length === 0 ? {} : JSON.parse(Buffer.concat(deler).toString("utf8"));
}

function nyttId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    prosessoekter
  ] = await Promise.all([
    lesJson("personer.json"),
    lesJson("husstander.json"),
    lesJson("inntekter.json"),
    lesJson("barnehageplasser.json"),
    lesJson("soknader.json"),
    lesJson("prosessdefinisjoner.json"),
    lesJson("informasjonsmodeller.json"),
    lesJson("samtykker.json"),
    lesJson("revisjonslogg.json"),
    lesJson("prosessoekter.json")
  ]);

  return {
    personer,
    husstander,
    inntekter,
    barnehageplasser,
    soknader,
    prosesser,
    informasjonsmodeller,
    samtykker,
    revisjonslogg,
    prosessoekter
  };
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
  return tilstand.prosesser.find((prosess) => prosess.id === prosessId) || null;
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

function hentInntektForPerson(tilstand, personId) {
  const inntekt = tilstand.inntekter.find((kandidat) => kandidat.personId === personId);
  if (!inntekt) {
    throw new Error("Fant ikke inntekt.");
  }
  return inntekt;
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
  if (apiUrl.endsWith(`/api/personer/{personId}/husstand`)) {
    const data = hentHusstandForPerson(tilstand, personId);
    await leggTilRevisjon({
      sporingsId,
      handling: "DATA_LES",
      ressurs: "husstand",
      aktor: { type: "testbruker", id: personId }
    });
    return data;
  }

  if (apiUrl.endsWith(`/api/personer/{personId}/inntekt`)) {
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
    const data = hentInntektForPerson(tilstand, personId);
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

  if (apiUrl.endsWith(`/api/personer/{personId}/barnehage`)) {
    const data = hentBarnehageForPerson(tilstand, personId);
    await leggTilRevisjon({
      sporingsId,
      handling: "DATA_LES",
      ressurs: "barnehageplass",
      aktor: { type: "testbruker", id: personId }
    });
    return data;
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
    const data = await hentDataForUrl(tilstand, steg.api.url, oekt.personId, oekt.sporingsId);
    oekt.resultater[steg.id] = data;
    return data;
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
      jsonSvar(response, 200, tilstand.personer);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/prosesser") {
      jsonSvar(response, 200, tilstand.prosesser);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/prosesser") {
      const body = await lesRequestBody(request);
      const nyProsess = {
        id: body.id || nyttId("prosess"),
        navn: body.navn || "Ny prosess",
        beskrivelse: body.beskrivelse || "Prosess opprettet i prosessbyggeren.",
        versjon: body.versjon || "0.1.0",
        steg: Array.isArray(body.steg) ? body.steg : [],
        syntetisk: true
      };
      if (tilstand.prosesser.some((prosess) => prosess.id === nyProsess.id)) {
        jsonSvar(response, 409, { feil: "Prosess med samme id finnes allerede." });
        return;
      }
      tilstand.prosesser.push(nyProsess);
      await skrivJson("prosessdefinisjoner.json", tilstand.prosesser);
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
        jsonSvar(response, 200, hentInntektForPerson(tilstand, inntektTreff[1]));
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

    const prosessTreff = url.pathname.match(/^\/api\/prosesser\/([^/]+)$/);
    if (request.method === "GET" && prosessTreff) {
      const prosess = finnProsess(tilstand, prosessTreff[1]);
      jsonSvar(response, prosess ? 200 : 404, prosess || { feil: "Fant ikke prosess." });
      return;
    }

    if (request.method === "PUT" && prosessTreff) {
      const body = await lesRequestBody(request);
      const indeks = tilstand.prosesser.findIndex((prosess) => prosess.id === prosessTreff[1]);
      if (indeks === -1) {
        jsonSvar(response, 404, { feil: "Fant ikke prosess." });
        return;
      }
      const oppdatertProsess = {
        ...tilstand.prosesser[indeks],
        navn: body.navn ?? tilstand.prosesser[indeks].navn,
        beskrivelse: body.beskrivelse ?? tilstand.prosesser[indeks].beskrivelse,
        versjon: body.versjon ?? tilstand.prosesser[indeks].versjon,
        steg: Array.isArray(body.steg) ? body.steg : tilstand.prosesser[indeks].steg,
        syntetisk: true
      };
      tilstand.prosesser[indeks] = oppdatertProsess;
      await skrivJson("prosessdefinisjoner.json", tilstand.prosesser);
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
      const prosess = finnProsess(tilstand, body.prosessId);
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
