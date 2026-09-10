// I/O-halvparten til tilgangsstatus.ts: finner fram til søknad, samtykke og
// regelresultat per prosess, og lar den rene klassifiseringen der avgjøre
// statusen. Kjører ikke reglene på nytt med sin egen kopi av RegelContext -
// SJEKK-stegets egen api.url er allerede en gyldig ressurs i ressurser.ts (se
// kommentaren der: "en katalogoppføring er samtidig et HTTP-endepunkt, et
// DATA_FETCH-mål og et SJEKK-mål"), så denne modulen kaller den samme veien en
// ekte prosessøkt ville kalt, og samtykkesperren og revisjonsloggen er dermed
// nøyaktig de samme.
import type { Caller } from "./autentisering.ts";
import { effektivtUtfall, replaceParametere } from "./prosess.ts";
import { hasGyldigSamtykke } from "./regler.ts";
import { findRessurs, runRessurs, samtykkekildeFor, type RessursContext } from "./ressurser.ts";
import { finnSisteSoknad, getProsesserForVisning, newId } from "./state.ts";
import { kombinerAlternativstatuser, velgTilgangsstatus, type Tilgangsstatus } from "./tilgangsstatus.ts";
import { alternativLabel, alternativVerdi } from "./types.ts";
import type { ProsessSteg, SjekkResultat, State } from "./types.ts";
import type { Datakilde } from "../../shared/samtykke.ts";

export type TilgangAlternativ = {
  verdi: string;
  label: string;
  status: Tilgangsstatus;
  manglerSamtykke?: Datakilde[];
};

export type TilgangPerCase = {
  prosessId: string;
  status: Tilgangsstatus;
  manglerSamtykke?: Datakilde[];
  soknadId?: string;
  /**
   * Bare til stede når SJEKK-steget avhenger av et spørsmålssvar med et lukket
   * sett alternativer (se finnAlternativer under) - status for saken er da
   * kombinert fra disse, ikke ett enkelt regelresultat.
   */
  alternativer?: TilgangAlternativ[];
};

export type TilgangsoversiktSvar = {
  tilganger: TilgangPerCase[];
};

export async function byggTilgangsoversikt(
  tilstand: State,
  personId: string,
  kaller: Caller
): Promise<TilgangsoversiktSvar> {
  const caser = getProsesserForVisning(tilstand);
  const tilganger: TilgangPerCase[] = [];
  for (const prosess of caser) {
    tilganger.push(await vurderCase(tilstand, personId, kaller, prosess.id, prosess.steg));
  }
  return { tilganger };
}

const SVAR_PLASSHOLDER = /\{svar\.([^.}]+)(?:\.([^}]+))?\}/;

function finnUresolvertPlassholder(url: string): { stegId: string; feltId?: string } | null {
  const treff = SVAR_PLASSHOLDER.exec(url);
  if (!treff) return null;
  return { stegId: treff[1], feltId: treff[2] };
}

/**
 * Alternativene for spørsmålet en uresolvert plassholder navngir, eller null
 * når spørsmålet ikke har noe lukket sett å prøve - et fritekstsvar som
 * hvilken gate en søknad om fartsdempende tiltak gjelder, har ingen liste å
 * prøve alle av, og skal ikke late som det.
 */
function finnAlternativer(steg: ProsessSteg[], stegId: string, feltId?: string) {
  const spoersmaal = steg.find((kandidat) => kandidat.id === stegId);
  if (!spoersmaal || spoersmaal.type !== "QUESTION" || !spoersmaal.felter) return null;
  const felt = feltId
    ? spoersmaal.felter.find((kandidat) => kandidat.id === feltId)
    : spoersmaal.felter.length === 1 ? spoersmaal.felter[0] : undefined;
  if (!felt || felt.type !== "valg" || !felt.alternativer) return null;
  return felt.alternativer;
}

type EvalueringResultat = { status: Tilgangsstatus; manglerSamtykke?: Datakilde[] };

/** Kjører samtykkesjekken og selve regelen for én ferdig utfylt SJEKK-URL. */
async function evaluerUrl(
  tilstand: State,
  personId: string,
  kaller: Caller,
  metode: string,
  url: URL
): Promise<EvalueringResultat> {
  const treff = findRessurs(metode, url.pathname);
  if (!treff) return { status: "tilgjengelig" };

  const sporingsId = newId("flyt");
  const kontekst: RessursContext = {
    tilstand,
    parametere: treff.parametere,
    sok: url.searchParams,
    personId,
    sporingsId,
    oekt: null,
    steg: null,
    kaller
  };
  const kreverSamtykke = samtykkekildeFor(treff.ressurs, kontekst);
  if (kreverSamtykke && !hasGyldigSamtykke(tilstand, personId, kreverSamtykke)) {
    return { status: "krever-samtykke", manglerSamtykke: [kreverSamtykke] };
  }

  try {
    const resultat = await runRessurs(tilstand, metode, url, { sporingsId, kaller, personId }) as SjekkResultat;
    return { status: velgTilgangsstatus({ sjekkutfall: effektivtUtfall(resultat) }) };
  } catch {
    // En domenefeil her (f.eks. "fant ingen husstand") betyr at saken ikke passer
    // akkurat nå - ikke at selve oversikten har feilet.
    return { status: "ikke-aktuell" };
  }
}

async function vurderCase(
  tilstand: State,
  personId: string,
  kaller: Caller,
  prosessId: string,
  steg: ProsessSteg[]
): Promise<TilgangPerCase> {
  const eksisterende = finnSisteSoknad(tilstand, personId, prosessId);
  if (eksisterende?.utfall) {
    return {
      prosessId,
      status: velgTilgangsstatus({ eksisterendeUtfall: eksisterende.utfall }),
      soknadId: eksisterende.soknadId
    };
  }

  const sjekksteg = steg.find((kandidat) => kandidat.type === "SJEKK");
  if (!sjekksteg) {
    // Ingen SJEKK-steg å forhåndsvurdere mot - vi utelukker ingen uten grunnlag.
    return { prosessId, status: "tilgjengelig" };
  }

  const metode = sjekksteg.api.method || "GET";
  const resolvedUrl = replaceParametere(sjekksteg.api.url, { personId, svar: {} });
  const uresolvert = finnUresolvertPlassholder(resolvedUrl);

  if (uresolvert) {
    const alternativer = finnAlternativer(steg, uresolvert.stegId, uresolvert.feltId);
    // Et fritt tekstsvar - som hvilken gate en søknad gjelder - har ingenting å
    // forhåndsvise ennå, og saken skal ikke gjemmes bort for det.
    if (!alternativer) {
      return { prosessId, status: "tilgjengelig" };
    }

    const perAlternativ: TilgangAlternativ[] = [];
    for (const alternativ of alternativer) {
      const verdi = alternativVerdi(alternativ);
      const svarUrl = replaceParametere(sjekksteg.api.url, { personId, svar: { [uresolvert.stegId]: verdi } });
      const evaluering = await evaluerUrl(
        tilstand, personId, kaller, metode, new URL(`http://localhost${svarUrl}`)
      );
      perAlternativ.push({
        verdi,
        label: alternativLabel(alternativ),
        status: evaluering.status,
        ...(evaluering.manglerSamtykke ? { manglerSamtykke: evaluering.manglerSamtykke } : {})
      });
    }

    const status = kombinerAlternativstatuser(perAlternativ.map((alternativ) => alternativ.status));
    const manglerSamtykke = status === "krever-samtykke"
      ? [...new Set(perAlternativ.flatMap((alternativ) => alternativ.manglerSamtykke ?? []))]
      : undefined;
    return {
      prosessId,
      status,
      ...(manglerSamtykke ? { manglerSamtykke } : {}),
      alternativer: perAlternativ
    };
  }

  const url = new URL(`http://localhost${resolvedUrl}`);
  const evaluering = await evaluerUrl(tilstand, personId, kaller, metode, url);
  return {
    prosessId,
    status: evaluering.status,
    ...(evaluering.manglerSamtykke ? { manglerSamtykke: evaluering.manglerSamtykke } : {})
  };
}
