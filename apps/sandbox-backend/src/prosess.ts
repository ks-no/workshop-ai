import { aiBaseUrl, fiksBaseUrl } from "./config.ts";
import { HttpError } from "./errors.ts";
import { utforRessurs } from "./ressurser.ts";
import { leggTilRevisjon } from "./revisjon.ts";
import { newId, writeJson } from "./state.ts";
import type {
  ProsessDefinisjon,
  ProsessSteg,
  Prosessoekt,
  SjekkResultat,
  Stegtype,
  State
} from "./types.ts";

function erstattParametere(url: string, oekt: Prosessoekt) {
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

export function byggProsessoektRespons(oekt: Prosessoekt, prosess: ProsessDefinisjon | null) {
  return {
    ...oekt,
    aktivtSteg: prosess?.steg?.[oekt.stegIndex] || null,
    totaltAntallSteg: prosess?.steg?.length || 0
  };
}

// DATA_FETCH and SJEKK both consult the shared resource catalog, exactly the way
// the HTTP router does. The engine used to keep its own copy of these lookups,
// and the copies had drifted apart.
async function hentFraKatalog(tilstand: State, oekt: Prosessoekt, steg: any) {
  const resolvertUrl = erstattParametere(steg.api.url, oekt);
  return utforRessurs(tilstand, steg.api.method || "GET", new URL(`http://localhost${resolvertUrl}`), {
    oekt,
    steg,
    sporingsId: oekt.sporingsId
  });
}

export async function opprettSoknad(tilstand: State, body: any) {
  const nySoknad = {
    soknadId: newId("soknad"),
    personId: body.personId,
    prosessId: body.prosessId,
    status: "SENDT_INN",
    opprettet: new Date().toISOString(),
    sporingsId: body.sporingsId || newId("flyt"),
    syntetisk: true
  };

  tilstand.soknader.push(nySoknad);
  await writeJson("soknader.json", tilstand.soknader);
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

type StegKontekst = {
  tilstand: State;
  oekt: Prosessoekt;
  prosess: ProsessDefinisjon;
  steg: any;
  body: any;
};

// One handler per step type. A new step type is one entry here; the execution
// below needs no change. Record<Stegtype, ...> makes the compiler demand a
// handler as soon as a new step type is added to types.ts.
export const stegHandtere: Record<Stegtype, (k: StegKontekst) => unknown | Promise<unknown>> = {
  INFO: () => ({ type: "INFO", melding: "Informasjonssteg krever ingen handling." }),

  QUESTION: ({ oekt, steg, body }) => {
    const svar = body.svar ?? oekt.svar[steg.id];
    if (!svar) {
      throw new HttpError("Spørsmålssteg krever et svar.", 400);
    }
    oekt.svar[steg.id] = svar;
    return { type: "QUESTION", svar };
  },

  CONSENT_REQUEST: async ({ oekt, steg, body }) => {
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
      const data = await svar.json() as any;
      oekt.aktivtSamtykkeId = data.samtykkeId;
      oekt.resultater[steg.id] = data;
      return data;
    }

    if (body.handling === "samtykkesvar") {
      const status = body.status || "SAMTYKKET";
      const samtykkeId = oekt.aktivtSamtykkeId;
      if (!samtykkeId) {
        throw new HttpError("Ingen aktiv samtykkeforespørsel finnes.", 400);
      }
      const svar = await fetch(`${fiksBaseUrl}/fiks/samtykke/${samtykkeId}/svar`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          sporingsId: oekt.sporingsId
        })
      });
      const data = await svar.json() as any;
      oekt.resultater[steg.id] = data;
      return data;
    }

    throw new HttpError("Samtykkesteg krever handlingen opprett-samtykke eller samtykkesvar.", 400);
  },

  DATA_FETCH: async ({ tilstand, oekt, steg }) => {
    const data = await hentFraKatalog(tilstand, oekt, steg);
    oekt.resultater[steg.id] = data;
    return data;
  },

  SJEKK: async ({ tilstand, oekt, steg }) => {
    const resultat = await hentFraKatalog(tilstand, oekt, steg) as SjekkResultat;

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
  },

  SUMMARY: async ({ oekt, prosess, steg }) => {
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
  },

  SUBMIT: async ({ tilstand, oekt, prosess, steg }) => {
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
};

export async function utforStegHandling(tilstand: State, oekt: Prosessoekt, prosess: ProsessDefinisjon, body: any) {
  const steg: ProsessSteg | undefined = prosess.steg[oekt.stegIndex];
  if (!steg) {
    throw new HttpError("Fant ikke aktivt steg.", 400);
  }

  const handterer = stegHandtere[steg.type as Stegtype];
  if (!handterer) {
    throw new HttpError(
      `Støtter ikke stegtypen ${steg.type}. Gyldige: ${Object.keys(stegHandtere).join(", ")}.`,
      400
    );
  }

  return handterer({ tilstand, oekt, prosess, steg, body });
}
