import {
  aktorFor,
  requireTilgang,
  SCOPE_LES,
  type Caller,
  type Tilgang
} from "./autentisering.ts";
import { representantPider } from "../../shared/handleevne.ts";
import { feilmelding } from "../../shared/errors.ts";
import { HttpError } from "./errors.ts";
import {
  hasGyldigSamtykke,
  hasUtloeptSamtykke,
  getInntektForPerson,
  evaluateOrdning
} from "./regler.ts";
import { regelKreverInntekt, selectOrdningForTjeneste } from "./vilkaar.ts";
import { maskinportenHeader } from "../../digdir-mock/src/client.ts";
import { fiksBaseUrl, fiksRegisterToken, fiksRolleId } from "./config.ts";
import { buildAdvarsel, tryUpstream } from "./upstream.ts";
import { addRevisjon } from "./revisjon.ts";
import { compilePathPattern, matchPath, type PathParams } from "./routing.ts";
import {
  eiendommerForPerson,
  eiendommerForPersonIGate,
  findGate,
  getGater
} from "./matrikkel.ts";
import {
  findPerson,
  getHusstandForPerson,
  getPlasserForTjeneste
} from "./state.ts";

// SHARED RESOURCE CATALOG
//
// One entry here is simultaneously three things: an HTTP endpoint, a valid
// DATA_FETCH target and a valid SJEKK target. Before the catalog existed, the
// router and the process engine each had their own implementation of the same
// lookups, and they had drifted apart - the HTTP path skipped the revisjonslogg,
// and the matrikkel lookup leaked owner lists that the process path filtered out.
//
// The catalog is also where policy is actually enforced, rather than once per
// call path:
//   - consent-before-income       (policies/access-policy.yaml) via kreverSamtykke
//   - revisjon-av-all-datatilgang (same file)                   via ressurs/formaal
//
// To expose new data during the workshop: add one entry at the bottom. Nothing
// else needs to change.

import type { State } from "./types.ts";

// The rule type decides. An ordning assessed on need and capacity - støttekontakt -
// never reads income, so demanding consent for income would collect a basis the
// decision does not use. Anything unresolvable keeps the strict requirement.
function samtykkeForOrdningssjekk(kontekst: RessursContext): string | null {
  try {
    const ordningId =
      kontekst.sok.get("ordning") ||
      selectOrdningForTjeneste(kontekst.tilstand, kontekst.personId, kontekst.sok.get("tjeneste")!);
    const ordning = kontekst.tilstand.satser.ordninger.find((o: any) => o.id === ordningId);
    if (!ordning) return "inntekt";
    return regelKreverInntekt[ordning.regel as keyof typeof regelKreverInntekt] ? "inntekt" : null;
  } catch {
    return "inntekt";
  }
}

export type RessursContext = {
  tilstand: State;
  parametere: PathParams;
  sok: URLSearchParams;
  personId: string;
  sporingsId: string;
  oekt: any | null;
  steg: any | null;
  /** Who is calling, from the token. See autentisering.ts. */
  kaller: Caller;
};

// The foresatte whose income the calculation combines - the same set regler.ts
// sends to Fiks. Derived here rather than read back off the response so the audit
// entry is written even when the lookup fails.
function foresatteIHusstand(kontekst: RessursContext): string[] {
  try {
    const husstand = getHusstandForPerson(kontekst.tilstand, kontekst.personId);
    return husstand.medlemmer
      .filter((medlem: any) => medlem.rolle === "foresatt")
      .map((medlem: any) => medlem.personId);
  } catch {
    // A household we cannot resolve means the lookup will fail too. Fall back to
    // the applicant rather than dropping the field.
    return [kontekst.personId];
  }
}

function allIHusstand(kontekst: RessursContext): string[] {
  try {
    return getHusstandForPerson(kontekst.tilstand, kontekst.personId)
      .medlemmer.map((medlem: any) => medlem.personId);
  } catch {
    return [kontekst.personId];
  }
}

// A plass belongs to a child, not to the applicant. Both are recorded: the parent
// asked, the child's data answered.
function barnMedPlass(kontekst: RessursContext, tjeneste: string): string[] {
  try {
    const plasser = getPlasserForTjeneste(kontekst.tilstand, kontekst.personId, tjeneste);
    return [...new Set([kontekst.personId, ...plasser.map((plass: any) => plass.personId)])];
  } catch {
    return [kontekst.personId];
  }
}

export type Ressurs = {
  metode: string;
  sti: string;
  /** Name the resource gets in the revisjonslogg. */
  ressurs: string;
  beskrivelse: string;
  /**
   * Which authorisation this resource requires. Omitted means the closed value,
   * "egne-data" - a resource added during the hackathon is protected by default.
   */
  tilgang?: Tilgang;
  /** Scope a machine caller must hold. Defaults to SCOPE_LES. */
  scope?: string;
  /** Data source that requires samtykke, or null. Shown in the resource catalogue. */
  kreverSamtykke?: string | null;
  /**
   * Resolves the consent requirement per request, for resources where it depends on
   * what is being asked for. Overrides kreverSamtykke when present. Fails closed:
   * if the request cannot be resolved, the strictest requirement stands.
   */
  kreverSamtykkeFor?: (kontekst: RessursContext) => string | null;
  /** Purpose written to the revisjonslogg alongside the consent basis. */
  formaal?: string;
  /**
   * Subject noun in the two consent refusals («… krever registrert samtykke» /
   * «… krever et nytt samtykke»). Omitted means the original fallback wording,
   * which is byte-frozen for the resources that predate this field.
   */
  samtykkeEmne?: string;
  /**
   * Whose data this lookup actually touched, as personIds. Omitted means the one
   * person the request was about.
   *
   * This exists because the two are not the same, and the difference is the
   * interesting part. Reading "your" income runs a household calculation: for the
   * 68 of 200 households with two foresatte, a partner's tax data is read on the
   * strength of the applicant's samtykke, and the partner never agreed to anything.
   * An audit log that records only the actor cannot answer the question a person
   * actually asks it - whose data was read - so it records both.
   */
  omfatter?: (kontekst: RessursContext) => string[];
  /** Runs before the consent check, so missing parameters give 400 and not 403. */
  valider?: (kontekst: RessursContext) => void;
  /** For resources where the person is not in the path but must be resolved before the consent check. */
  finnPersonId?: (kontekst: RessursContext) => string;
  handter: (kontekst: RessursContext) => unknown | Promise<unknown>;
};

/*
 * A domain lookup throws a plain Error, which carries no status, so each route says
 * which one it means: «fant ikke person» is a 404, «ukjent ordning» a 400.
 *
 * What this must not do is flatten an error that already knows its status:
 * rebuilding upstream.ts's 502 as the route's 400 or 404 would blame the
 * citizen's request for a service that was down.
 */
async function withStatus<T>(status: number, read: () => T | Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(feilmelding(error), status);
  }
}

export const ressurser: Ressurs[] = [
  {
    metode: "GET",
    sti: "/api/personer/:personId",
    ressurs: "person",
    beskrivelse: "Folkeregisterliknende grunndata om én person.",
    handter: ({ tilstand, personId }) => {
      const person = findPerson(tilstand, personId);
      if (!person) {
        throw new HttpError("Fant ikke person.", 404);
      }
      return person;
    }
  },
  {
    metode: "GET",
    sti: "/api/personer/:personId/husstand",
    ressurs: "husstand",
    beskrivelse: "Husstanden personen tilhører, med roller for foresatte og barn.",
    omfatter: allIHusstand,
    handter: ({ tilstand, personId }) =>
      withStatus(404, () => getHusstandForPerson(tilstand, personId))
  },
  {
    metode: "GET",
    sti: "/api/personer/:personId/inntekt",
    ressurs: "inntekt",
    beskrivelse: "Inntektsgrunnlag for husholdningen, beregnet av Fiks-simulatoren.",
    // The calculation combines every foresatt in the household, so a two-parent
    // household means a second person's tax data is read here.
    omfatter: foresatteIHusstand,
    kreverSamtykke: "inntekt",
    samtykkeEmne: "Inntektsdata",
    formaal: "Vurdere rett til dialogrelatert tjeneste",
    handter: ({ tilstand, personId }) =>
      withStatus(404, () => getInntektForPerson(tilstand, personId))
  },
  {
    metode: "GET",
    sti: "/api/personer/:personId/barnehage",
    ressurs: "barnehageplass",
    beskrivelse: "Barnehageplasser registrert på barna i husstanden.",
    omfatter: (kontekst) => barnMedPlass(kontekst, "barnehage"),
    handter: ({ tilstand, personId }) =>
      withStatus(404, () => getPlasserForTjeneste(tilstand, personId, "barnehage"))
  },
  {
    metode: "GET",
    sti: "/api/personer/:personId/sfo",
    ressurs: "sfoplass",
    beskrivelse: "SFO-plasser registrert på barna i husstanden.",
    omfatter: (kontekst) => barnMedPlass(kontekst, "sfo"),
    handter: ({ tilstand, personId }) =>
      withStatus(404, () => getPlasserForTjeneste(tilstand, personId, "sfo"))
  },
  {
    metode: "GET",
    sti: "/api/personer/:personId/fritid",
    ressurs: "fritidsdeltakelse",
    beskrivelse: "Fritidsaktiviteter barna i husstanden deltar i.",
    omfatter: (kontekst) => barnMedPlass(kontekst, "fritid"),
    formaal: "Vise fritidsaktiviteter i husstanden",
    handter: ({ tilstand, personId }) =>
      withStatus(404, () => getPlasserForTjeneste(tilstand, personId, "fritid"))
  },
  {
    // KRR through the real Fiks path, so «sjekk reservasjon før valg av kanal»
    // is a valid DATA_FETCH step.
    //
    // The SUBMIT kvittering does not read this resource - SvarUt decides the
    // channel from KRR on its own side, the way the real one does (svarut.ts).
    // This resource is the participants' build surface for everything past the
    // receipt: the vedtaksbrev, the varsling, and channel logic of their own.
    metode: "GET",
    sti: "/api/personer/:personId/kontaktinfo",
    ressurs: "kontaktinfo",
    beskrivelse:
      "Kontaktinformasjon og reservasjonsstatus fra kontaktregisteret (KRR), hentet fra Fiks-simulatoren.",
    kreverSamtykke: "kontaktinfo",
    samtykkeEmne: "Kontaktopplysningene",
    formaal: "Velge varslings- og forsendelseskanal",
    handter: async ({ tilstand, personId }) => {
      const person = findPerson(tilstand, personId);
      if (!person) {
        throw new HttpError("Fant ikke person.", 404);
      }
      // Best effort, like the Fiks task in createSoknad: a reservation check
      // that gets no answer must not sink the process session. Everything
      // non-ok - Fiks down, or KRR holding no row for the person (under 15,
      // not bosatt) - degrades into the one advarsel shape, and detalj says
      // which it was. The DATA_LES below is still written: the attempt is
      // what the log audits, not the luck of the lookup.
      const svar = await tryUpstream<unknown>(
        { service: "Fiks-simulatoren", action: "Oppslaget i kontaktregisteret" },
        async () => fetch(`${fiksBaseUrl}/register/api/v1/ks/${fiksRolleId}/krr/person`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(await maskinportenHeader(fiksRegisterToken))
          },
          // syntetiskFodselsnummer survives masking - see skjerming.ts - and
          // Fiks nulls epost/tlf for kode 6/7 on its side of the wire.
          body: JSON.stringify({ fnr: person.syntetiskFodselsnummer })
        })
      );
      if (!svar.ok) {
        return buildAdvarsel(
          "Fikk ikke kontaktinformasjon fra kontaktregisteret. Reservasjonsstatus er ukjent.",
          svar.error.message
        );
      }
      return svar.data;
    }
  },
  {
    metode: "GET",
    sti: "/api/husstander/:husstandId/inntektsgrunnlag",
    ressurs: "inntekt",
    beskrivelse: "Inntektsgrunnlag slått opp på husstand i stedet for person.",
    omfatter: foresatteIHusstand,
    // Same data as the person route, so the same consent requirement. The applicant
    // is resolved via the husstand, since the person is not in the path.
    kreverSamtykke: "inntekt",
    samtykkeEmne: "Inntektsdata",
    formaal: "Vurdere rett til dialogrelatert tjeneste",
    finnPersonId: ({ tilstand, parametere }) => {
      const husstand = tilstand.husstander.find((h: any) => h.husstandId === parametere.husstandId);
      const soeker = husstand?.medlemmer.find((m: any) => m.rolle === "foresatt");
      if (!soeker) {
        throw new HttpError("Fant ikke husstand med en foresatt.", 404);
      }
      return soeker.personId;
    },
    handter: ({ tilstand, personId }) => getInntektForPerson(tilstand, personId)
  },
  {
    metode: "GET",
    sti: "/api/matrikkel/gater",
    ressurs: "matrikkel-gate",
    beskrivelse: "Gater i matrikkelen. Med ?gate= gis nøkkeltall for én gate.",
    // The street register is public and has no person subject - there is no one
    // whose data this is. That is why its revisjonslogg rows say aktor: ukjent.
    tilgang: "aapen",
    handter: async ({ sok }) => {
      const gateParam = sok.get("gate");
      if (!gateParam) {
        return (await getGater()).map((g) => ({
          gateId: g.gateId,
          adressenavn: g.adressenavn,
          kommune: g.kommune,
          antallEiendommer: g.antallEiendommer,
          antallBoligeiendommer: g.antallBoligeiendommer
        }));
      }
      const gateData = await findGate(gateParam);
      if (!gateData) {
        // 221 street names is too many to hand back on a typo, so point at the list
        // instead. The matrikkel already does prefix and substring matching, so a
        // miss here means the name really is not there.
        throw new HttpError(`Fant ikke gaten "${gateParam}".`, 404, {
          hint: "Se GET /api/matrikkel/gater for hele lista over gater.",
          syntetisk: true
        });
      }
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
  },
  {
    metode: "GET",
    sti: "/api/matrikkel/sjekk/eierforhold",
    ressurs: "matrikkel-eierforhold",
    beskrivelse: "SJEKK: eier søkeren en eiendom i den oppgitte gaten?",
    handter: async ({ sok, personId, steg }) => {
      const gateNavn = sok.get("gate") || "";
      const gateData = await findGate(gateNavn);
      if (!gateData) {
        return { godkjent: false, melding: `Fant ikke gaten "${gateNavn}" i matrikkelen.` };
      }
      // Filtered in the matrikkel, so no other resident's ownership is ever sent here.
      const egne = await eiendommerForPersonIGate(gateData.adressenavn, personId);
      const hasEiendom = egne.length > 0;
      return {
        godkjent: hasEiendom,
        melding: hasEiendom
          ? `Eierforhold i ${gateData.adressenavn} bekreftet.`
          : steg?.feilmelding || `Du har ingen registrert eiendom i ${gateData.adressenavn}. Søknad om fartsdempende tiltak kan bare sendes av eiere i gaten.`,
        // harEiendom står eksplisitt: nøkkelen er wire. Som shorthand ville den fulgt
        // navnet på den lokale variabelen.
        grunnlag: { personId, gate: gateData.adressenavn, harEiendom: hasEiendom, antallEiendommer: egne.length }
      };
    }
  },
  {
    metode: "GET",
    sti: "/api/matrikkel/mine-eiendommer",
    ressurs: "matrikkel-mine-eiendommer",
    beskrivelse: "Eiendommer i matrikkelen der søkeren er registrert som eier, på tvers av alle gater.",
    // No tilgang here means "egne-data", which is what this is: the applicant's own
    // holdings, not the open street register.
    valider: ({ personId }) => {
      if (!personId) {
        throw new HttpError("personId er påkrevd.", 400);
      }
    },
    handter: async ({ personId }) => {
      const mine = await eiendommerForPerson(personId);
      return {
        personId,
        eiendommer: mine.map((eiendom) => ({
          matrikkelId: eiendom.matrikkelId,
          adresse: eiendom.adresse,
          bruksenhetstype: eiendom.bruksenhetstype,
          gate: eiendom.adressenavn,
          kommune: eiendom.kommune
        })),
        syntetisk: true
      };
    }
  },
  {
    metode: "GET",
    sti: "/api/regler/sjekk/ordning",
    ressurs: "regelvurdering",
    beskrivelse:
      "SJEKK: rett til en ordning i data/satser.json. Krever samtykke til inntekt " +
      "kun for ordninger som faktisk vurderes mot inntekt.",
    kreverSamtykke: "inntekt",
    kreverSamtykkeFor: samtykkeForOrdningssjekk,
    formaal: "Vurdere rett til dialogrelatert tjeneste",
    valider: ({ sok, personId }) => {
      if (!personId || (!sok.get("ordning") && !sok.get("tjeneste"))) {
        throw new HttpError("personId og enten ordning eller tjeneste er påkrevd.", 400);
      }
    },
    handter: ({ tilstand, sok, personId }) =>
      withStatus(400, () => {
        // `tjeneste` lets a process say "assess SFO" and leave the choice of ordning
        // to the child's actual trinn, instead of naming one and being wrong for
        // every household outside it.
        const ordning = sok.get("ordning")
          || selectOrdningForTjeneste(tilstand, personId, sok.get("tjeneste")!);
        return evaluateOrdning(tilstand, personId, ordning);
      })
  },
  {
    metode: "GET",
    // Alias of /api/regler/sjekk/ordning. The name says foreldrebetaling, but the
    // route has always taken any ordning id - including fritidskort, which is not a
    // parental payment at all. Process definitions, the curl cookbook and the
    // OpenAPI spec all point here, so the path stays.
    sti: "/api/regler/sjekk/foreldrebetaling",
    ressurs: "regelvurdering",
    beskrivelse: "SJEKK: alias for /api/regler/sjekk/ordning.",
    kreverSamtykke: "inntekt",
    kreverSamtykkeFor: samtykkeForOrdningssjekk,
    formaal: "Vurdere rett til dialogrelatert tjeneste",
    valider: ({ sok, personId }) => {
      if (!personId || (!sok.get("ordning") && !sok.get("tjeneste"))) {
        throw new HttpError("personId og enten ordning eller tjeneste er påkrevd.", 400);
      }
    },
    handter: ({ tilstand, sok, personId }) =>
      withStatus(400, () => {
        const ordning = sok.get("ordning")
          || selectOrdningForTjeneste(tilstand, personId, sok.get("tjeneste")!);
        return evaluateOrdning(tilstand, personId, ordning);
      })
  }
];

const kompilerte = ressurser.map((ressurs) => ({ ressurs, monster: compilePathPattern(ressurs.sti) }));

export function findRessurs(metode: string, sti: string) {
  for (const { ressurs, monster } of kompilerte) {
    if (ressurs.metode !== metode) continue;
    const parametere = matchPath(monster, sti);
    if (parametere) {
      return { ressurs, parametere };
    }
  }
  return null;
}

/** Serialisable overview for GET /api/katalog/ressurser. */
export function ressurskatalog() {
  return ressurser.map((ressurs) => ({
    metode: ressurs.metode,
    sti: ressurs.sti,
    ressurs: ressurs.ressurs,
    beskrivelse: ressurs.beskrivelse,
    tilgang: ressurs.tilgang || "egne-data",
    kreverSamtykke: ressurs.kreverSamtykke || null,
    syntetisk: true
  }));
}

type RunOptions = {
  oekt?: any | null;
  steg?: any | null;
  personId?: string | null;
  sporingsId: string;
  kaller?: Caller;
};

export async function runRessurs(
  tilstand: State,
  metode: string,
  url: URL,
  valg: RunOptions
): Promise<unknown> {
  const treff = findRessurs(metode, url.pathname);
  if (!treff) {
    const gyldige = ressurser.map((r) => `${r.metode} ${r.sti}`).join(", ");
    throw new HttpError(`Ukjent ressurs: ${metode} ${url.pathname}. Gyldige: ${gyldige}.`, 404);
  }

  const { ressurs, parametere } = treff;
  const sok = url.searchParams;

  const kontekst: RessursContext = {
    tilstand,
    parametere,
    sok,
    personId:
      valg.personId ||
      parametere.personId ||
      sok.get("personId") ||
      valg.oekt?.personId ||
      "",
    sporingsId: valg.sporingsId,
    oekt: valg.oekt ?? null,
    steg: valg.steg ?? null,
    kaller: valg.kaller ?? { type: "anonym" }
  };

  ressurs.valider?.(kontekst);

  if (ressurs.finnPersonId) {
    kontekst.personId = ressurs.finnPersonId(kontekst);
  }

  // Authorisation goes here, after valider() and after finnPersonId() resolved who
  // the request is about, and before the samtykke check. That order is what makes
  // the four outcomes distinguishable:
  //
  //   400  a parameter is missing            (valider)
  //   401  we do not know who you are        (no token)
  //   403  we know, and you have no hjemmel  (wrong pid, or missing scope)
  //   403  you have hjemmel but no samtykke  (below, and a different grunn)
  //
  // syntetiskFodselsnummer survives the masking in skjerming.ts precisely so this
  // lookup works for an address-protected person too.
  try {
    requireTilgang({
      kaller: kontekst.kaller,
      tilgang: ressurs.tilgang ?? "egne-data",
      scope: ressurs.scope ?? SCOPE_LES,
      pid: kontekst.personId
        ? findPerson(tilstand, kontekst.personId)?.syntetiskFodselsnummer ?? null
        : null,
      // A guardian driving a minor's flow has to be able to read the minor's data,
      // or the flow stops at the first DATA_FETCH. Only registered representatives,
      // and only for that one person.
      representantPider: kontekst.personId
        ? representantPider(tilstand, kontekst.personId, tilstand.satser.gjelderFra)
        : [],
      hva: `å lese ${ressurs.ressurs}`
    });
  } catch (feil) {
    // A refused attempt is exactly what an audit log is for. TILGANG_NEKTET, not
    // DATA_NEKTET: that one means "had hjemmel, lacked samtykke", and conflating
    // the two would erase the distinction Del B exists to teach.
    await addRevisjon({
      sporingsId: kontekst.sporingsId,
      handling: "TILGANG_NEKTET",
      ressurs: ressurs.ressurs,
      formaal: "Mangler hjemmel",
      ...(kontekst.personId ? { gjaldt: kontekst.personId } : {}),
      aktor: aktorFor(kontekst.kaller, kontekst.personId)
    });
    throw feil;
  }

  // Computed once, before the handler, so a DATA_LES and a DATA_NEKTET for the same
  // request describe the same set of people.
  const omfatter = ressurs.omfatter ? ressurs.omfatter(kontekst) : [];
  // Only recorded when it says more than `aktor` already does. A single-subject
  // read where the subject is the caller needs no second field.
  const omfatterFelt = omfatter.length > 1 || (omfatter.length === 1 && omfatter[0] !== kontekst.personId)
    ? { omfatter }
    : {};

  const kreverSamtykke = ressurs.kreverSamtykkeFor
    ? ressurs.kreverSamtykkeFor(kontekst)
    : ressurs.kreverSamtykke;

  let samtykke = null;
  if (kreverSamtykke) {
    // The session knows which consent it just created. Prefer it, so the basis in
    // the audit log is the one the citizen actually gave in this flow.
    samtykke = hasGyldigSamtykke(
      tilstand,
      kontekst.personId,
      kreverSamtykke,
      kontekst.oekt?.aktivtSamtykkeId
    );
    if (!samtykke) {
      // A consent that ran out is not the same refusal as one that was never
      // given, and telling a citizen who remembers agreeing that they must
      // "register a samtykke" reads as the system having forgotten. Both are
      // DATA_NEKTET - hjemmel was there, samtykke was not - but the reason differs.
      const utloept = hasUtloeptSamtykke(tilstand, kontekst.personId, kreverSamtykke);
      await addRevisjon({
        sporingsId: kontekst.sporingsId,
        handling: "DATA_NEKTET",
        ressurs: ressurs.ressurs,
        formaal: utloept ? "Utløpt samtykke" : "Mangler samtykke",
        ...omfatterFelt,
        aktor: aktorFor(kontekst.kaller, kontekst.personId)
      });
      // The refusal names what was asked for - from the catalog entry, so a new
      // gated resource does not grow a name cascade here. The fallback is the
      // original wording, byte-frozen for the resources that carry no emne.
      const emne = ressurs.samtykkeEmne ?? "Denne vurderingen";
      throw new HttpError(
        utloept
          ? `Samtykket som dekket dette har utløpt. ${emne} krever et nytt samtykke.`
          : `${emne} krever registrert samtykke.`,
        403,
        // Both 403s carry a machine-readable grunn, so a client can tell "you may
        // not" from "you may, but nobody has consented yet" without parsing prose.
        { syntetisk: true, grunn: utloept ? "utloept_samtykke" : "mangler_samtykke" }
      );
    }
  }

  const data = await ressurs.handter(kontekst);

  // The SJEKK step logs SJEKK_OK/SJEKK_AVVIST itself, so a lookup running under it
  // stays out of the log. The call context decides that, not a catalog flag: the
  // same resource called directly over HTTP has no SJEKK caller, and a successful
  // read that leaves no DATA_LES breaks revisjon-av-all-datatilgang.
  if (kontekst.steg?.type !== "SJEKK") {
    // Purpose limitation is the point of asking for consent, so the audit entry
    // records the purpose the person actually consented to. The catalogue label
    // is a generic fallback for reads with no consent behind them; logging it
    // for a consented read would say the data was used for something other than
    // what was agreed.
    const formaal = samtykke?.formaal || ressurs.formaal;

    await addRevisjon({
      sporingsId: kontekst.sporingsId,
      handling: "DATA_LES",
      ressurs: ressurs.ressurs,
      ...(formaal ? { formaal } : {}),
      ...(samtykke ? { grunnlag: { type: "samtykke", id: samtykke.samtykkeId, status: samtykke.status } } : {}),
      ...omfatterFelt,
      aktor: aktorFor(kontekst.kaller, kontekst.personId)
    });
  }

  return data;
}
