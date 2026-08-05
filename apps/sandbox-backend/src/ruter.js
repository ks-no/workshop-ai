import { readFile } from "node:fs/promises";
import {
  docsHtml,
  jsonSvar,
  lesRequestBody,
  tekstSvar
} from "./http.js";
import { openapiFil } from "./konfig.js";
import { byggProsessoektRespons, opprettSoknad, utforStegHandling } from "./prosess.js";
import { harGyldigSamtykke, hentInntektForPerson, vurderOrdning } from "./regler.js";
import { leggTilRevisjon } from "./revisjon.js";
import {
  erMalProsess,
  finnGate,
  finnPerson,
  finnProsess,
  finnProsessoekt,
  hentBarnehageForPerson,
  hentHusstandForPerson,
  hentProsesserForVisning,
  lagreProsessdefinisjoner,
  lagreProsessoekter,
  lesTilstand,
  normaliserProsess,
  nyttId
} from "./tilstand.js";

function hentSporingsId(url) {
  return url.searchParams.get("sporingsId") || nyttId("flyt");
}

export async function handterForespoersel(request, response) {
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
}
