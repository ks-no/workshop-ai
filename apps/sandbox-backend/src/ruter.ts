import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { feilKropp, FeilMedStatus, statusFor } from "./feil.ts";
import {
  docsHtml,
  jsonSvar,
  lesRequestBody,
  tekstSvar
} from "./http.ts";
import { openapiFil } from "./konfig.ts";
import { byggProsessoektRespons, opprettSoknad, utforStegHandling } from "./prosess.ts";
import { finnRessurs, ressurskatalog, utforRessurs } from "./ressurser.ts";
import { leggTilRevisjon } from "./revisjon.ts";
import { lagStiMonster, stiTreff, type Parametere } from "./sti.ts";
import type { Prosessoekt } from "./typer.ts";
import {
  erMalProsess,
  finnPerson,
  finnProsess,
  finnProsessoekt,
  hentProsesserForVisning,
  lagreProsessdefinisjoner,
  lagreProsessoekter,
  lesTilstand,
  normaliserProsess,
  nyttId
} from "./tilstand.ts";

// Tilstanden er utypet inntil typer.ts kommer i steg 5.
type Tilstand = any;

type Kontekst = {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  parametere: Parametere;
  tilstand: Tilstand;
};

type Rute = {
  metode: string;
  sti: string;
  handter: (kontekst: Kontekst) => Promise<void> | void;
};

function hentSporingsId(url: URL) {
  return url.searchParams.get("sporingsId") || nyttId("flyt");
}

// --- systemruter: svarer uten å lese tilstand -----------------------------

const systemruter: Rute[] = [
  {
    metode: "GET",
    sti: "/helse",
    handter: ({ response }) => {
      jsonSvar(response, 200, { status: "ok", tjeneste: "sandbox-backend", tidspunkt: new Date().toISOString() });
    }
  },
  {
    metode: "GET",
    sti: "/health",
    handter: ({ response }) => {
      jsonSvar(response, 200, { status: "ok", tjeneste: "sandbox-backend", tidspunkt: new Date().toISOString() });
    }
  },
  {
    metode: "GET",
    sti: "/docs",
    handter: ({ response }) => {
      tekstSvar(response, 200, docsHtml());
    }
  },
  {
    metode: "GET",
    sti: "/openapi.yaml",
    handter: async ({ response }) => {
      tekstSvar(response, 200, await readFile(openapiFil, "utf8"), "text/yaml; charset=utf-8");
    }
  }
];

// --- ruter som trenger tilstand -------------------------------------------

const ruter: Rute[] = [
  {
    metode: "GET",
    sti: "/api/personer",
    handter: ({ response, tilstand }) => {
      // visningsnavn spares klientene for å sette sammen navn selv.
      jsonSvar(response, 200, tilstand.personer.map((person: any) => ({
        ...person,
        visningsnavn: [person.navn.fornavn, person.navn.mellomnavn, person.navn.etternavn]
          .filter(Boolean).join(" ")
      })));
    }
  },
  {
    metode: "GET",
    sti: "/api/regler/satser",
    handter: ({ response, tilstand }) => {
      jsonSvar(response, 200, tilstand.satser);
    }
  },
  {
    metode: "GET",
    sti: "/api/prosesser",
    handter: ({ response, url, tilstand }) => {
      const inkluderMaler = url.searchParams.get("inkluderMaler") === "true";
      jsonSvar(response, 200, hentProsesserForVisning(tilstand, inkluderMaler));
    }
  },
  {
    metode: "POST",
    sti: "/api/prosesser",
    handter: async ({ request, response, tilstand }) => {
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
      if (alleProsesser.some((prosess: any) => prosess.id === nyProsess.id)) {
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
    }
  },
  {
    metode: "GET",
    sti: "/api/katalog/datasett",
    handter: ({ response }) => {
      jsonSvar(response, 200, [
        { id: "personer", fil: "data/personer.json", syntetisk: true },
        { id: "husstander", fil: "data/husstander.json", syntetisk: true },
        { id: "inntekter", fil: "data/inntekter.json", syntetisk: true },
        { id: "barnehageplasser", fil: "data/barnehageplasser.json", syntetisk: true }
      ]);
    }
  },
  {
    metode: "GET",
    sti: "/api/katalog/informasjonsmodeller",
    handter: ({ response, tilstand }) => {
      jsonSvar(response, 200, tilstand.informasjonsmodeller);
    }
  },
  {
    // Lar den som skriver et DATA_FETCH- eller SJEKK-steg slå opp hvilke
    // URL-er som finnes, i stedet for å gjette.
    metode: "GET",
    sti: "/api/katalog/ressurser",
    handter: ({ response }) => {
      jsonSvar(response, 200, ressurskatalog());
    }
  },
  {
    metode: "GET",
    sti: "/api/personer/:personId/soknader",
    handter: ({ response, parametere, tilstand }) => {
      jsonSvar(response, 200, tilstand.soknader.filter((soknad: any) => soknad.personId === parametere.personId));
    }
  },
  {
    metode: "GET",
    sti: "/api/prosesser/:prosessId",
    handter: ({ response, parametere, tilstand }) => {
      const prosess = finnProsess(tilstand, parametere.prosessId);
      jsonSvar(response, prosess ? 200 : 404, prosess || { feil: "Fant ikke prosess." });
    }
  },
  {
    metode: "PUT",
    sti: "/api/prosesser/:prosessId",
    handter: async ({ request, response, parametere, tilstand }) => {
      const body = await lesRequestBody(request);
      const indeks = tilstand.prosesser.findIndex((prosess: any) => prosess.id === parametere.prosessId);
      const malIndeks = tilstand.prosessMaler.findIndex((prosess: any) => prosess.id === parametere.prosessId);
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
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter",
    handter: async ({ request, response, tilstand }) => {
      const body = await lesRequestBody(request);
      const prosess = tilstand.prosesser.find((kandidat: any) => kandidat.id === body.prosessId) || null;
      const person = finnPerson(tilstand, body.personId);
      if (!prosess || !person) {
        jsonSvar(response, 404, { feil: "Fant ikke prosess eller person." });
        return;
      }
      const nyOekt: Prosessoekt = {
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
    }
  },
  {
    metode: "GET",
    sti: "/api/prosessoekter/:oektsId",
    handter: ({ response, parametere, tilstand }) => {
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
      if (!oekt) {
        jsonSvar(response, 404, { feil: "Fant ikke prosessøkt." });
        return;
      }
      jsonSvar(response, 200, byggProsessoektRespons(oekt, finnProsess(tilstand, oekt.prosessId)));
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/svar",
    handter: async ({ request, response, parametere, tilstand }) => {
      const body = await lesRequestBody(request);
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
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
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/handling",
    handter: async ({ request, response, parametere, tilstand }) => {
      const body = await lesRequestBody(request);
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
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
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/neste",
    handter: async ({ response, parametere, tilstand }) => {
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
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
    }
  },
  {
    metode: "POST",
    sti: "/api/prosessoekter/:oektsId/forrige",
    handter: async ({ response, parametere, tilstand }) => {
      const oekt = finnProsessoekt(tilstand, parametere.oektsId);
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
    }
  },
  {
    metode: "POST",
    sti: "/api/soknader",
    handter: async ({ request, response, tilstand }) => {
      const body = await lesRequestBody(request);
      jsonSvar(response, 201, await opprettSoknad(tilstand, body));
    }
  },
  {
    metode: "GET",
    sti: "/api/soknader/:soknadId",
    handter: ({ response, parametere, tilstand }) => {
      const soknad = tilstand.soknader.find((kandidat: any) => kandidat.soknadId === parametere.soknadId);
      jsonSvar(response, soknad ? 200 : 404, soknad || { feil: "Fant ikke søknad." });
    }
  },
  {
    metode: "GET",
    sti: "/api/revisjonslogg",
    handter: ({ response, tilstand }) => {
      jsonSvar(response, 200, tilstand.revisjonslogg);
    }
  },
  {
    // Used by fiks-simulator so this service stays the only writer.
    metode: "POST",
    sti: "/api/revisjonslogg",
    handter: async ({ request, response }) => {
      const hendelse = await lesRequestBody(request);
      if (!hendelse.handling) {
        jsonSvar(response, 400, { feil: "Revisjonshendelse mangler handling." });
        return;
      }
      await leggTilRevisjon(hendelse);
      jsonSvar(response, 201, { status: "registrert", syntetisk: true });
    }
  },
  {
    metode: "GET",
    sti: "/api/revisjonslogg/:sporingsId",
    handter: ({ response, parametere, tilstand }) => {
      jsonSvar(response, 200, tilstand.revisjonslogg.filter((rad: any) => rad.sporingsId === parametere.sporingsId));
    }
  }
];

// Mønstrene kompileres én gang ved modullasting, ikke per request.
const kompilerte = [...systemruter, ...ruter].map((rute) => ({
  rute,
  monster: lagStiMonster(rute.sti)
}));

function finnRute(metode: string, sti: string): { rute: Rute; parametere: Parametere } | null {
  for (const { rute, monster } of kompilerte) {
    if (rute.metode !== metode) continue;
    const parametere = stiTreff(monster, sti);
    if (parametere) {
      return { rute, parametere };
    }
  }
  return null;
}

const systemstier = new Set(systemruter.map((rute) => rute.sti));

export async function handterForespoersel(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url!, `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    jsonSvar(response, 204, {});
    return;
  }

  try {
    const treff = finnRute(request.method!, url.pathname);

    // Systemrutene svarer uten tilstand, slik at /helse fortsatt virker
    // hvis et datasett er ødelagt.
    if (treff && systemstier.has(treff.rute.sti)) {
      await treff.rute.handter({ request, response, url, parametere: treff.parametere, tilstand: null });
      return;
    }

    const tilstand = await lesTilstand();

    if (treff) {
      await treff.rute.handter({ request, response, url, parametere: treff.parametere, tilstand });
      return;
    }

    // Ingen orkestreringsrute: prøv den delte ressurskatalogen, som
    // prosessmotoren slår opp i på nøyaktig samme måte.
    if (finnRessurs(request.method!, url.pathname)) {
      const data = await utforRessurs(tilstand, request.method!, url, {
        sporingsId: hentSporingsId(url)
      });
      jsonSvar(response, 200, data);
      return;
    }

    jsonSvar(response, 404, { feil: "Fant ikke endepunkt." });
  } catch (error) {
    jsonSvar(response, statusFor(error), feilKropp(error));
  }
}

export { FeilMedStatus, ruter, systemruter };
