import { HttpError } from "./errors.ts";
import { harGyldigSamtykke, hentInntektForPerson, vurderOrdning } from "./regler.ts";
import { leggTilRevisjon } from "./revisjon.ts";
import { compilePathPattern, matchPath, type PathParams } from "./routing.ts";
import { eiendommerForPersonIGate, finnGate, hentGater } from "./matrikkel.ts";
import {
  finnPerson,
  hentHusstandForPerson,
  hentPlasserForTjeneste
} from "./state.ts";

// SHARED RESOURCE CATALOG
//
// One entry here is simultaneously three things: an HTTP endpoint, a valid
// DATA_FETCH target and a valid SJEKK target. Before the catalog existed, the
// router and the process engine each had their own implementation of the same
// lookups, and they had drifted apart — the HTTP path skipped the revisjonslogg,
// and the matrikkel lookup leaked owner lists that the process path filtered out.
//
// The catalog is also where policy is actually enforced, rather than once per
// call path:
//   - consent-before-income       (policies/access-policy.yaml) via kreverSamtykke
//   - revisjon-av-all-datatilgang (same file)                   via ressurs/formaal
//
// To expose new data during the workshop: add one entry at the bottom. Nothing
// else needs to change.

type State = any;

export type RessursKontekst = {
  tilstand: State;
  parametere: PathParams;
  sok: URLSearchParams;
  personId: string;
  sporingsId: string;
  oekt: any | null;
  steg: any | null;
};

export type Ressurs = {
  metode: string;
  sti: string;
  /** Name the resource gets in the revisjonslogg. */
  ressurs: string;
  beskrivelse: string;
  /** Data source that requires samtykke, or null. */
  kreverSamtykke?: string | null;
  /** Purpose written to the revisjonslogg alongside the consent basis. */
  formaal?: string;
  /** Runs before the consent check, so missing parameters give 400 and not 403. */
  valider?: (kontekst: RessursKontekst) => void;
  /** For resources where the person is not in the path but must be resolved before the consent check. */
  finnPersonId?: (kontekst: RessursKontekst) => string;
  /** Set false for lookups the caller logs instead (the SJEKK step). */
  revisjon?: boolean;
  handter: (kontekst: RessursKontekst) => unknown | Promise<unknown>;
};

export const ressurser: Ressurs[] = [
  {
    metode: "GET",
    sti: "/api/personer/:personId",
    ressurs: "person",
    beskrivelse: "Folkeregisterliknende grunndata om én person.",
    handter: ({ tilstand, personId }) => {
      const person = finnPerson(tilstand, personId);
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
    handter: ({ tilstand, personId }) => {
      try {
        return hentHusstandForPerson(tilstand, personId);
      } catch (error: any) {
        throw new HttpError(error.message, 404);
      }
    }
  },
  {
    metode: "GET",
    sti: "/api/personer/:personId/inntekt",
    ressurs: "inntekt",
    beskrivelse: "Inntektsgrunnlag for husholdningen, beregnet av Fiks-simulatoren.",
    kreverSamtykke: "inntekt",
    formaal: "Vurdere rett til dialogrelatert tjeneste",
    handter: async ({ tilstand, personId }) => {
      try {
        return await hentInntektForPerson(tilstand, personId);
      } catch (error: any) {
        throw new HttpError(error.message, 404);
      }
    }
  },
  {
    metode: "GET",
    sti: "/api/personer/:personId/barnehage",
    ressurs: "barnehageplass",
    beskrivelse: "Barnehageplasser registrert på barna i husstanden.",
    handter: ({ tilstand, personId }) => {
      try {
        return hentPlasserForTjeneste(tilstand, personId, "barnehage");
      } catch (error: any) {
        throw new HttpError(error.message, 404);
      }
    }
  },
  {
    // SFO data used to be reachable only indirectly, through the rules check.
    // The asymmetry with barnehage was accidental.
    metode: "GET",
    sti: "/api/personer/:personId/sfo",
    ressurs: "sfoplass",
    beskrivelse: "SFO-plasser registrert på barna i husstanden.",
    handter: ({ tilstand, personId }) => {
      try {
        return hentPlasserForTjeneste(tilstand, personId, "sfo");
      } catch (error: any) {
        throw new HttpError(error.message, 404);
      }
    }
  },
  {
    metode: "GET",
    sti: "/api/husstander/:husstandId/inntektsgrunnlag",
    ressurs: "inntekt",
    beskrivelse: "Inntektsgrunnlag slått opp på husstand i stedet for person.",
    // Same data as the person route, so the same consent requirement. The applicant
    // is resolved via the husstand, since the person is not in the path.
    kreverSamtykke: "inntekt",
    formaal: "Vurdere rett til dialogrelatert tjeneste",
    finnPersonId: ({ tilstand, parametere }) => {
      const husstand = tilstand.husstander.find((h: any) => h.husstandId === parametere.husstandId);
      const soeker = husstand?.medlemmer.find((m: any) => m.rolle === "foresatt");
      if (!soeker) {
        throw new HttpError("Fant ikke husstand med en foresatt.", 404);
      }
      return soeker.personId;
    },
    handter: ({ tilstand, personId }) => hentInntektForPerson(tilstand, personId)
  },
  {
    metode: "GET",
    sti: "/api/matrikkel/gater",
    ressurs: "matrikkel-gate",
    beskrivelse: "Gater i matrikkelen. Med ?gate= gis nøkkeltall for én gate.",
    handter: async ({ sok }) => {
      const gateParam = sok.get("gate");
      if (!gateParam) {
        return (await hentGater()).map((g) => ({
          gateId: g.gateId,
          adressenavn: g.adressenavn,
          kommune: g.kommune,
          antallEiendommer: g.antallEiendommer,
          antallBoligeiendommer: g.antallBoligeiendommer
        }));
      }
      const gateData = await finnGate(gateParam);
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
    // The SJEKK step writes SJEKK_OK/SJEKK_AVVIST itself.
    revisjon: false,
    handter: async ({ sok, personId, steg }) => {
      const gateNavn = sok.get("gate") || "";
      const gateData = await finnGate(gateNavn);
      if (!gateData) {
        return { godkjent: false, melding: `Fant ikke gaten "${gateNavn}" i matrikkelen.` };
      }
      // Filtered in the matrikkel, so no other resident's ownership is ever sent here.
      const egne = await eiendommerForPersonIGate(gateData.adressenavn, personId);
      const harEiendom = egne.length > 0;
      return {
        godkjent: harEiendom,
        melding: harEiendom
          ? `Eierforhold i ${gateData.adressenavn} bekreftet.`
          : steg?.feilmelding || `Du har ingen registrert eiendom i ${gateData.adressenavn}. Søknad om fartsdempende tiltak kan bare sendes av eiere i gaten.`,
        grunnlag: { personId, gate: gateData.adressenavn, harEiendom, antallEiendommer: egne.length }
      };
    }
  },
  {
    metode: "GET",
    sti: "/api/regler/sjekk/foreldrebetaling",
    ressurs: "regelvurdering",
    beskrivelse: "SJEKK: rett til en moderasjonsordning i data/satser.json.",
    // The assessment reveals the household's income basis, so it carries the same
    // consent requirement as the income route.
    kreverSamtykke: "inntekt",
    formaal: "Vurdere rett til dialogrelatert tjeneste",
    revisjon: false,
    valider: ({ sok, personId }) => {
      if (!personId || !sok.get("ordning")) {
        throw new HttpError("personId og ordning er påkrevd.", 400);
      }
    },
    handter: async ({ tilstand, sok, personId }) => {
      try {
        return await vurderOrdning(tilstand, personId, sok.get("ordning"));
      } catch (error: any) {
        throw new HttpError(error.message, 400);
      }
    }
  }
];

const kompilerte = ressurser.map((ressurs) => ({ ressurs, monster: compilePathPattern(ressurs.sti) }));

export function finnRessurs(metode: string, sti: string) {
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
    kreverSamtykke: ressurs.kreverSamtykke || null,
    syntetisk: true
  }));
}

type UtforValg = {
  oekt?: any | null;
  steg?: any | null;
  personId?: string | null;
  sporingsId: string;
};

export async function utforRessurs(
  tilstand: State,
  metode: string,
  url: URL,
  valg: UtforValg
): Promise<unknown> {
  const treff = finnRessurs(metode, url.pathname);
  if (!treff) {
    const gyldige = ressurser.map((r) => `${r.metode} ${r.sti}`).join(", ");
    throw new HttpError(`Ukjent ressurs: ${metode} ${url.pathname}. Gyldige: ${gyldige}.`, 404);
  }

  const { ressurs, parametere } = treff;
  const sok = url.searchParams;

  const kontekst: RessursKontekst = {
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
    steg: valg.steg ?? null
  };

  ressurs.valider?.(kontekst);

  if (ressurs.finnPersonId) {
    kontekst.personId = ressurs.finnPersonId(kontekst);
  }

  let samtykke = null;
  if (ressurs.kreverSamtykke) {
    samtykke = harGyldigSamtykke(tilstand, kontekst.personId, ressurs.kreverSamtykke);
    if (!samtykke) {
      await leggTilRevisjon({
        sporingsId: kontekst.sporingsId,
        handling: "DATA_NEKTET",
        ressurs: ressurs.ressurs,
        formaal: "Mangler samtykke",
        aktor: { type: "testbruker", id: kontekst.personId }
      });
      throw new HttpError(
        `${ressurs.ressurs === "inntekt" ? "Inntektsdata" : "Denne vurderingen"} krever registrert samtykke.`,
        403,
        { syntetisk: true }
      );
    }
  }

  const data = await ressurs.handter(kontekst);

  if (ressurs.revisjon !== false) {
    // Purpose limitation is the point of asking for consent, so the audit entry
    // records the purpose the person actually consented to. The catalogue label
    // is a generic fallback for reads with no consent behind them; logging it
    // for a consented read would say the data was used for something other than
    // what was agreed.
    const formaal = samtykke?.formaal || ressurs.formaal;

    await leggTilRevisjon({
      sporingsId: kontekst.sporingsId,
      handling: "DATA_LES",
      ressurs: ressurs.ressurs,
      ...(formaal ? { formaal } : {}),
      ...(samtykke ? { grunnlag: { type: "samtykke", id: samtykke.samtykkeId, status: samtykke.status } } : {}),
      aktor: { type: "testbruker", id: kontekst.personId }
    });
  }

  return data;
}
