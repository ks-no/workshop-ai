#!/usr/bin/env node

// The generated participant-facing table, in its own module so both the importer
// that writes it and the gate that checks it read the same code. A hand-written
// table over 394 people goes stale the first time anything moves; a generated one
// checked byte for byte cannot.

import { alderVed } from "../apps/shared/alder.ts";

// docs/testpersoner.md is generated, and that is the whole point. The one thing
// participants asked for was a map of who they can use, and a hand-written table
// over 394 people goes stale the first time anything moves. A generated one cannot
// lie; scripts/valider-data.ts fails if it is out of step with the data.
//
// Protected people are listed as "Skjermet person", the same way the login picker
// does it. The seed holds their names in clear text on purpose — masking happens at
// load, in skjerming.ts — but a document in the repo should not become the way
// around that.
export function buildTestpersondok(
  personer: any,
  husstander: any,
  inntekter: any,
  eierforhold: any,
  plasser: any,
  kuratert: any,
  referansedato: any
) {
  const husstandPerId = new Map(husstander.map((h: any) => [h.husstandId, h]));
  const inntektFnr = new Set(inntekter.map((r: any) => r.identifikator));
  const eierPersonIder = new Set(
    eierforhold.eierforhold.flatMap((r: any) => r.eiere.map((e: any) => e.eier))
  );
  const medPlass = new Map();
  for (const [tjeneste, rader] of Object.entries(plasser) as [string, any[]][]) {
    for (const rad of rader) {
      if (!medPlass.has(rad.personId)) medPlass.set(rad.personId, []);
      medPlass.get(rad.personId).push(tjeneste);
    }
  }
  const kuraterteIder = new Set(kuratert.personer.map((p: any) => p.personId));

  const alderFor = (person: any) => alderVed(person.foedselsdato, referansedato);
  const navnFor = (person: any) =>
    person.adressebeskyttelse === "UGRADERT"
      ? [person.navn.fornavn, person.navn.mellomnavn, person.navn.etternavn]
        .filter(Boolean)
        .join(" ")
      : "Skjermet person";

  const kanEid = (person: any) =>
    person.personstatus === "BOSATT" && alderFor(person) >= 13;
  const kanSelv = (person: any) =>
    person.personstatus === "BOSATT" && alderFor(person) >= 18;

  const linjer = [];
  linjer.push("<!-- GENERERT AV scripts/importer-tenor.ts. Ikke rediger for hånd. -->");
  linjer.push("# Testpersoner");
  linjer.push("");
  linjer.push(
    "Hele befolkningen i sandkassen, generert fra `data/personer.json`. " +
    "`pnpm test` feiler hvis denne fila er ute av takt med dataene, så tallene her " +
    "er alltid de som faktisk gjelder."
  );
  linjer.push("");

  const antall = personer.length;
  const bosatt = personer.filter((p: any) => p.personstatus === "BOSATT");
  const medEid = personer.filter(kanEid);
  const mindreaarige = bosatt.filter((p: any) => alderFor(p) < 18);
  linjer.push("## Hvor mange, og hvem kan hva");
  linjer.push("");
  linjer.push("| | Antall |");
  linjer.push("|---|---:|");
  linjer.push(`| Personer i registeret | ${antall} |`);
  linjer.push(`| Bosatte — kan være part i en sak | ${bosatt.length} |`);
  linjer.push(`| Kan ha elektronisk ID (13 år eller mer, bosatt) | ${medEid.length} |`);
  linjer.push(`| Kan opptre på egen hånd (18 år eller mer, bosatt) | ${bosatt.filter(kanSelv).length} |`);
  linjer.push(`| Mindreårige — part i saken, men foresatt må være avsender | ${mindreaarige.length} |`);
  linjer.push(`| Under 13 — kan aldri logge inn, ingen eID finnes | ${bosatt.filter((p: any) => alderFor(p) < 13).length} |`);
  linjer.push(`| 67 år eller mer | ${bosatt.filter((p: any) => alderFor(p) >= 67).length} |`);
  linjer.push(`| Ikke bosatt (død, utflyttet, inaktiv, midlertidig) | ${antall - bosatt.length} |`);
  linjer.push(`| Med adressebeskyttelse | ${personer.filter((p: any) => p.skjermet).length} |`);
  linjer.push(`| Med inntektsopplysninger | ${personer.filter((p: any) => inntektFnr.has(p.syntetiskFodselsnummer)).length} |`);
  linjer.push(`| Med registrert eiendom | ${personer.filter((p: any) => eierPersonIder.has(p.personId)).length} |`);
  linjer.push("");
  linjer.push(
    "Aldrene er regnet ved `satser.gjelderFra`, ikke ved dagens dato — samme " +
    "referansedato som reglene bruker, så en testperson gir samme utfall uansett " +
    "når demoen kjøres."
  );
  linjer.push("");
  linjer.push("### Personstatus");
  linjer.push("");
  linjer.push("| Status | Antall | Hva det betyr her |");
  linjer.push("|---|---:|---|");
  const statusforklaring: Record<string, string | undefined> = {
    BOSATT: "Bor i en norsk kommune. Har husstand, adresse og kan være part i en sak.",
    DOED: "Registrert død. Kan ikke logge inn eller være avsender, men relasjonene står — et barn har fortsatt en mor.",
    UTFLYTTET: "Flyttet ut av Norge. Ingen husstand, ingen kommune å ha dialog med.",
    INAKTIV: "Nesten alle disse har D-nummer, ikke fødselsnummer, og ingen norsk bostedsadresse.",
    MIDLERTIDIG: "Midlertidig identifikator. Samme som over."
  };
  const perStatus: Record<string, number> = {};
  for (const person of personer) {
    perStatus[person.personstatus] = (perStatus[person.personstatus] || 0) + 1;
  }
  for (const [status, n] of Object.entries(perStatus).sort((a, b) => b[1] - a[1])) {
    linjer.push(`| ${status} | ${n} | ${statusforklaring[status] || ""} |`);
  }
  linjer.push("");
  linjer.push("## Alle personene");
  linjer.push("");
  linjer.push(
    "`Logg inn`: **ja** betyr at en elektronisk ID kan finnes. **part** betyr 13–17 år " +
    "— kan logge inn, men en foresatt med foreldreansvar må være avsender. **nei** " +
    "betyr at ingen eID kan finnes."
  );
  linjer.push("");
  linjer.push("| personId | Navn | Alder | Status | Husstand | Rolle | Kommune | Logg inn | Eier | Inntekt | Plass | Kilde |");
  linjer.push("|---|---|---:|---|---|---|---|---|---|---|---|---|");
  for (const person of personer) {
    const logg = !kanEid(person) ? "nei" : kanSelv(person) ? "ja" : "part";
    const husstand = person.husstandId
      ? `${person.husstandId} (${(husstandPerId.get(person.husstandId) as { type?: string } | undefined)?.type ?? "?"})`
      : "—";
    linjer.push(
      `| \`${person.personId}\` | ${navnFor(person)} | ${alderFor(person)} | ` +
      `${person.personstatus} | ${husstand} | ${person.rolle ?? "—"} | ` +
      `${person.bostedsadresse.kommune || "—"} | ${logg} | ` +
      `${eierPersonIder.has(person.personId) ? "ja" : "—"} | ` +
      `${inntektFnr.has(person.syntetiskFodselsnummer) ? "ja" : "—"} | ` +
      `${(medPlass.get(person.personId) || []).join(", ") || "—"} | ` +
      `${kuraterteIder.has(person.personId) ? "kuratert" : "tenor"} |`
    );
  }
  linjer.push("");
  linjer.push("## Grenser du bør kjenne");
  linjer.push("");
  linjer.push(
    "- **Fødselsnumrene er syntetiske og merket som det.** Måneden har 80 lagt til, " +
    "så januar er 81 og desember er 92, og kontrollsifrene er regnet ut etter " +
    "påslaget. Det er Skatteetatens konvensjon for Tenor-data. Skal du lese en dato " +
    "ut av et nummer, må du trekke fra 80 først — men `foedselsdato` er eget felt, " +
    "så du trenger det sjelden."
  );
  linjer.push(
    "- **Tre personer har et fødselsnummer som beskriver en annen dato enn " +
    "`foedselsdato`.** Det er lovlig i Folkeregisteret — en rettet fødselsdato " +
    "beholder det opprinnelige nummeret — og det kommer fra Tenor."
  );
  linjer.push(
    "- **Inntekten er forfattet, ikke hentet.** Tenor hadde inntektsdata for 6 av 120 " +
    "hoveddokumenter og ingen av foreldrene. Beløpene for de importerte utledes " +
    "deterministisk fra fødselsnummeret; terskelscenarioene ligger hos de kuraterte " +
    "husstandene, der de er forfattet og kontrollert."
  );
  linjer.push(
    "- **`kommune` er et visningsnavn, `kommunenummer` er nøkkelen.** Tenor oppgir bare " +
    "nummeret; der `data/brreg.seed.json` kjenner navnet brukes det, ellers står " +
    "poststedet."
  );
  linjer.push(
    "- **Matrikkelen dekker de gatene befolkningen faktisk bor i**, hentet fra Geonorge " +
    "per kommune, pluss alle Bergens gater. Alle bosatte er bundet til en " +
    "matrikkelenhet gjennom `bostedsadresse.adresseIdentifikatorFraMatrikkelen`. De " +
    "som ikke er bosatt har ingen binding, og de som har D-nummer har ingen adresse " +
    "i det hele tatt."
  );
  linjer.push(
    "- **Adressebeskyttede personer står med fullt navn og adresse i `data/personer.json`.** " +
    "Det er med vilje: maskeringen skjer ved innlasting, i " +
    "`apps/shared/skjerming.ts`, og hadde seeden vært maskert ville det " +
    "ikke vært noe å beskytte. Leser du fila direkte ser du klartekst; går du gjennom " +
    "API-et ser du maskeringen. `pnpm test:skjerming` holder den på plass."
  );
  linjer.push(
    "- **Tolv personer er over 100 år**, den eldste 113. Det er Tenor slik det leveres."
  );
  linjer.push("");
  return linjer.join("\n") + "\n";
}
