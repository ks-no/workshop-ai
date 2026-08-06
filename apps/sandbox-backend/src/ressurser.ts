import { FeilMedStatus } from "./feil.ts";
import { harGyldigSamtykke, hentInntektForPerson, vurderOrdning } from "./regler.ts";
import { leggTilRevisjon } from "./revisjon.ts";
import { lagStiMonster, stiTreff, type Parametere } from "./sti.ts";
import {
  finnGate,
  finnPerson,
  hentHusstandForPerson,
  hentPlasserForTjeneste
} from "./tilstand.ts";

// DELT RESSURSKATALOG
//
// Én oppføring her blir samtidig tre ting: et HTTP-endepunkt, et gyldig
// DATA_FETCH-mål og et gyldig SJEKK-mål. Før katalogen fantes hadde ruteren og
// prosessmotoren hver sin implementasjon av de samme oppslagene, og de hadde
// rukket å divergere — HTTP-veien hoppet over revisjonsloggen, og
// matrikkeloppslaget lekket eierlister som prosessveien filtrerte bort.
//
// Katalogen er også stedet policyene faktisk håndheves, i stedet for én gang per
// kallevei:
//   - consent-before-income      (policies/access-policy.yaml) via kreverSamtykke
//   - revisjon-av-all-datatilgang (samme fil)                  via ressurs/formaal
//
// Skal du tilby nye data i workshopen: legg til én oppføring nederst. Ingenting
// annet må røres.

// Tilstanden er utypet inntil typer.ts kommer i steg 5.
type Tilstand = any;

export type RessursKontekst = {
  tilstand: Tilstand;
  parametere: Parametere;
  sok: URLSearchParams;
  personId: string;
  sporingsId: string;
  oekt: any | null;
  steg: any | null;
};

export type Ressurs = {
  metode: string;
  sti: string;
  /** Navnet ressursen får i revisjonsloggen. */
  ressurs: string;
  beskrivelse: string;
  /** Datakilde det må foreligge samtykke for, eller null. */
  kreverSamtykke?: string | null;
  /** Formål som skrives til revisjonsloggen sammen med samtykkegrunnlaget. */
  formaal?: string;
  /** Kjøres før samtykkesjekken, så manglende parametere gir 400 og ikke 403. */
  valider?: (kontekst: RessursKontekst) => void;
  /** For ressurser der personen ikke ligger i stien, men må finnes før samtykke sjekkes. */
  finnPersonId?: (kontekst: RessursKontekst) => string;
  /** Sett false for oppslag som logges av kalleren i stedet (SJEKK-steget). */
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
        throw new FeilMedStatus("Fant ikke person.", 404);
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
        throw new FeilMedStatus(error.message, 404);
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
        throw new FeilMedStatus(error.message, 404);
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
        throw new FeilMedStatus(error.message, 404);
      }
    }
  },
  {
    // SFO-data fantes tidligere bare indirekte, gjennom regelvurderingen.
    // Asymmetrien med barnehage var tilfeldig.
    metode: "GET",
    sti: "/api/personer/:personId/sfo",
    ressurs: "sfoplass",
    beskrivelse: "SFO-plasser registrert på barna i husstanden.",
    handter: ({ tilstand, personId }) => {
      try {
        return hentPlasserForTjeneste(tilstand, personId, "sfo");
      } catch (error: any) {
        throw new FeilMedStatus(error.message, 404);
      }
    }
  },
  {
    metode: "GET",
    sti: "/api/husstander/:husstandId/inntektsgrunnlag",
    ressurs: "inntekt",
    beskrivelse: "Inntektsgrunnlag slått opp på husstand i stedet for person.",
    // Samme data som personruta, altså samme samtykkekrav. Søkeren finnes via
    // husstanden, siden personen ikke står i stien.
    kreverSamtykke: "inntekt",
    formaal: "Vurdere rett til dialogrelatert tjeneste",
    finnPersonId: ({ tilstand, parametere }) => {
      const husstand = tilstand.husstander.find((h: any) => h.husstandId === parametere.husstandId);
      const soeker = husstand?.medlemmer.find((m: any) => m.rolle === "foresatt");
      if (!soeker) {
        throw new FeilMedStatus("Fant ikke husstand med en foresatt.", 404);
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
    handter: ({ tilstand, sok }) => {
      const gater = tilstand.matrikkel?.gater || [];
      const gateParam = sok.get("gate");
      if (!gateParam) {
        return gater.map((g: any) => ({
          gateId: g.gateId,
          adressenavn: g.adressenavn,
          kommune: g.kommune,
          antallEiendommer: g.antallEiendommer,
          antallBoligeiendommer: g.antallBoligeiendommer
        }));
      }
      const gateData = finnGate(tilstand, gateParam);
      if (!gateData) {
        throw new FeilMedStatus(`Fant ikke gaten "${gateParam}".`, 404, {
          tilgjengelige: gater.map((g: any) => g.adressenavn)
        });
      }
      // Projeksjon med vilje: eiendomslisten inneholder personId-ene til andre
      // innbyggere, og den hører ikke hjemme i et gateoppslag.
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
    // SJEKK-steget skriver SJEKK_OK/SJEKK_AVVIST selv.
    revisjon: false,
    handter: ({ tilstand, sok, personId, steg }) => {
      const gateNavn = sok.get("gate") || "";
      const gateData = finnGate(tilstand, gateNavn);
      if (!gateData) {
        return { godkjent: false, melding: `Fant ikke gaten "${gateNavn}" i matrikkelen.` };
      }
      const harEiendom = gateData.eiendommer.some(
        (e: any) => Array.isArray(e.eiere) && e.eiere.includes(personId)
      );
      return {
        godkjent: harEiendom,
        melding: harEiendom
          ? `Eierforhold i ${gateData.adressenavn} bekreftet.`
          : steg?.feilmelding || `Du har ingen registrert eiendom i ${gateData.adressenavn}. Søknad om fartsdempende tiltak kan bare sendes av eiere i gaten.`,
        grunnlag: { personId, gate: gateData.adressenavn, harEiendom }
      };
    }
  },
  {
    metode: "GET",
    sti: "/api/regler/sjekk/foreldrebetaling",
    ressurs: "regelvurdering",
    beskrivelse: "SJEKK: rett til en moderasjonsordning i data/satser.json.",
    // Vurderingen røper husholdningens inntektsgrunnlag, så den er underlagt
    // samme samtykkekrav som inntektsruta.
    kreverSamtykke: "inntekt",
    formaal: "Vurdere rett til dialogrelatert tjeneste",
    revisjon: false,
    valider: ({ sok, personId }) => {
      if (!personId || !sok.get("ordning")) {
        throw new FeilMedStatus("personId og ordning er påkrevd.", 400);
      }
    },
    handter: async ({ tilstand, sok, personId }) => {
      try {
        return await vurderOrdning(tilstand, personId, sok.get("ordning"));
      } catch (error: any) {
        throw new FeilMedStatus(error.message, 400);
      }
    }
  }
];

const kompilerte = ressurser.map((ressurs) => ({ ressurs, monster: lagStiMonster(ressurs.sti) }));

export function finnRessurs(metode: string, sti: string) {
  for (const { ressurs, monster } of kompilerte) {
    if (ressurs.metode !== metode) continue;
    const parametere = stiTreff(monster, sti);
    if (parametere) {
      return { ressurs, parametere };
    }
  }
  return null;
}

/** Serialiserbar oversikt for GET /api/katalog/ressurser. */
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
  tilstand: Tilstand,
  metode: string,
  url: URL,
  valg: UtforValg
): Promise<unknown> {
  const treff = finnRessurs(metode, url.pathname);
  if (!treff) {
    const gyldige = ressurser.map((r) => `${r.metode} ${r.sti}`).join(", ");
    throw new FeilMedStatus(`Ukjent ressurs: ${metode} ${url.pathname}. Gyldige: ${gyldige}.`, 404);
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
      throw new FeilMedStatus(
        `${ressurs.ressurs === "inntekt" ? "Inntektsdata" : "Denne vurderingen"} krever registrert samtykke.`,
        403,
        { syntetisk: true }
      );
    }
  }

  const data = await ressurs.handter(kontekst);

  if (ressurs.revisjon !== false) {
    await leggTilRevisjon({
      sporingsId: kontekst.sporingsId,
      handling: "DATA_LES",
      ressurs: ressurs.ressurs,
      ...(ressurs.formaal ? { formaal: ressurs.formaal } : {}),
      ...(samtykke ? { grunnlag: { type: "samtykke", id: samtykke.samtykkeId, status: samtykke.status } } : {}),
      aktor: { type: "testbruker", id: kontekst.personId }
    });
  }

  return data;
}
