import { aktorFor, type Kaller } from "./autentisering.ts";
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
      const felter = Object.entries(svarVerdi);
      for (const [feltId, feltVerdi] of felter) {
        const feltMal = new RegExp(`\\{svar\\.${stegId}\\.${feltId}\\}`, "g");
        result = result.replace(feltMal, encodeURIComponent(String(feltVerdi)));
      }
      // A one-field answer also satisfies the short form {svar.<stegId>}.
      //
      // The two reference clients disagree on shape for the same step: a QUESTION
      // with `felter` makes demo-gui's step-by-step page post an object
      // ({gatenavn: "Storgata"}), while /chat posts the raw string. Without this,
      // `fartsdempende-tiltak` worked in /chat and via curl but left a literal
      // "{svar.velg-gate}" in the URL on localhost:3001 — surfacing as
      // `Fant ikke gaten "{svar.velg-gate}"`, which reads like a typo by the user.
      //
      // Only when there is exactly one field: with several, the short form is
      // genuinely ambiguous and should stay unsubstituted.
      if (felter.length === 1) {
        result = result.replace(enkeltMal, encodeURIComponent(String(felter[0][1])));
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
async function hentFraKatalog(tilstand: State, oekt: Prosessoekt, steg: any, kaller: Kaller) {
  const resolvertUrl = erstattParametere(steg.api.url, oekt);
  return utforRessurs(tilstand, steg.api.method || "GET", new URL(`http://localhost${resolvertUrl}`), {
    oekt,
    steg,
    sporingsId: oekt.sporingsId,
    kaller
  });
}

/**
 * The Fiks answer, or the Fiks error raised as our own.
 *
 * The samtykke routes have a state machine from Del D on, so answering the same
 * request twice, or answering one that was withdrawn, comes back as 409. This code
 * called `svar.json()` without looking at the status: the error body was stored as
 * the step's result and the flow carried on with HTTP 200, which is a worse outcome
 * than the 409 it hid. The status and the melding are passed through unchanged, so
 * the citizen reads what the samtykke service said rather than a paraphrase.
 */
async function fiksSvar(svar: Response, hva: string) {
  const data = await svar.json() as any;
  if (!svar.ok) {
    throw new HttpError(
      data?.feil || `${hva} feilet i Fiks-simulatoren (status ${svar.status}).`,
      svar.status,
      { syntetisk: true, ...(data?.feilmeldinger ? { feilmeldinger: data.feilmeldinger } : {}) }
    );
  }
  return data;
}

export async function opprettSoknad(tilstand: State, body: any, kaller: Kaller) {
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
    aktor: aktorFor(kaller, nySoknad.personId)
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
  /** Who is calling, from the token. See autentisering.ts. */
  kaller: Kaller;
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

  CONSENT_REQUEST: async ({ oekt, steg, body, kaller }) => {
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
      const data = await fiksSvar(svar, "Å opprette samtykke");
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
          sporingsId: oekt.sporingsId,
          // Only this service holds the verified token, so only it can say who
          // agreed. Without this the samtykke event would name fiks-simulator as
          // the actor — honest, but far less useful than the truth.
          aktor: aktorFor(kaller, oekt.personId)
        })
      });
      const data = await fiksSvar(svar, "Å svare på samtykket");
      oekt.resultater[steg.id] = data;
      return data;
    }

    throw new HttpError("Samtykkesteg krever handlingen opprett-samtykke eller samtykkesvar.", 400);
  },

  DATA_FETCH: async ({ tilstand, oekt, steg, kaller }) => {
    const data = await hentFraKatalog(tilstand, oekt, steg, kaller);
    oekt.resultater[steg.id] = data;
    return data;
  },

  SJEKK: async ({ tilstand, oekt, steg, kaller }) => {
    const resultat = await hentFraKatalog(tilstand, oekt, steg, kaller) as SjekkResultat;

    oekt.resultater[steg.id] = resultat;
    if (!resultat.godkjent) {
      oekt.status = "AVVIST";
      oekt.avvistMelding = resultat.melding;
    }
    await leggTilRevisjon({
      sporingsId: oekt.sporingsId,
      handling: resultat.godkjent ? "SJEKK_OK" : "SJEKK_AVVIST",
      ressurs: "prosessoekt",
      aktor: aktorFor(kaller, oekt.personId)
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

  SUBMIT: async ({ tilstand, oekt, prosess, steg, kaller }) => {
    const data = await opprettSoknad(tilstand, {
      personId: oekt.personId,
      prosessId: oekt.prosessId,
      prosessNavn: prosess.navn,
      sporingsId: oekt.sporingsId
    }, kaller);
    oekt.resultater[steg.id] = data;
    oekt.status = "FULLFORT";
    return data;
  }
};

export async function utforStegHandling(
  tilstand: State,
  oekt: Prosessoekt,
  prosess: ProsessDefinisjon,
  body: any,
  kaller: Kaller
) {
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

  return handterer({ tilstand, oekt, prosess, steg, body, kaller });
}
