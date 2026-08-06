import { aiBaseUrl, fiksBaseUrl } from "./konfig.js";
import { harGyldigSamtykke, hentInntektForPerson, sjekkHandtere } from "./regler.js";
import { leggTilRevisjon } from "./revisjon.js";
import {
  finnGate,
  hentBarnehageForPerson,
  hentHusstandForPerson,
  nyttId,
  skrivJson
} from "./tilstand.js";

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

export function byggProsessoektRespons(oekt, prosess) {
  return {
    ...oekt,
    aktivtSteg: prosess?.steg?.[oekt.stegIndex] || null,
    totaltAntallSteg: prosess?.steg?.length || 0
  };
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

export async function opprettSoknad(tilstand, body) {
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

export async function utforStegHandling(tilstand, oekt, prosess, body) {
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
