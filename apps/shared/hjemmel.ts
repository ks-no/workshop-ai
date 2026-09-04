/**
 * Hjemlene sandkassen viser til, med den korttittelen loven faktisk har.
 *
 * Grunnen til at dette er en modul og ikke et avsnitt i `docs/`: en lov har ett
 * offisielt navn, og hvilket det er, er ikke noe man kan resonnere seg til. Den
 * ene loven er nynorsk og den andre bokmål fordi Stortinget vedtok dem slik, så en
 * målformopprydding som gjør dem like gjør den ene feil. Det skjedde: `Opplæringslova`
 * ble skrevet om til `opplæringsloven` i en skrivefeilrunde, og ingenting ble rødt,
 * fordi et lovnavn bare er en streng i en `kilde`.
 *
 * `scripts/valider-data.ts` leser derfor hver `hjemmel`- og `kilde`-streng i seed-filene
 * sine og krever at lovnavnene står her. `data/brreg.seed.json` og `data/tenor/*.json`
 * er utenfor: de er eksterne uttrekk, ikke vår prosa, og et lovnavn BRREG skriver er
 * ikke vårt å rette. Ingen av dem inneholder et i dag. Navnene er prosa og ikke identifikatorer - de
 * vises til innbyggeren i vedtaket og i bekreftelsen på formål - men de er ikke
 * våre ord, og det er poenget med å ha dem ett sted.
 */

/** Én lov, slik Lovdata skriver korttittelen. */
export type Lovtittel = {
  /** Lovdatas id, så navnet kan etterprøves: <https://lovdata.no/lov/{id}>. */
  id: string;
  /** Den fulle tittelen, som er der korttittelen kommer fra. */
  tittel: string;
};

/**
 * Korttittelen er nøkkelen, i den formen den skal skrives. Målformen er lovens
 * egen: `opplæringslova` er nynorsk fordi 2023-loven ble vedtatt slik, mens
 * `barnehageloven` er bokmål fordi 2005-loven ble det. Ett avsnitt som viser til
 * begge er riktig, ikke inkonsekvent.
 */
export const LOVTITLER: Record<string, Lovtittel> = {
  barnehageloven: {
    id: "2005-06-17-64",
    tittel: "Lov om barnehager"
  },
  "opplæringslova": {
    id: "2023-06-09-30",
    tittel: "Lov om grunnskoleopplæringa og den vidaregåande opplæringa"
  },
  "helse- og omsorgstjenesteloven": {
    id: "2011-06-24-30",
    tittel: "Lov om kommunale helse- og omsorgstjenester m.m."
  },
  politiregisterloven: {
    id: "2010-05-28-16",
    tittel: "Lov om behandling av opplysninger i politiet og påtalemyndigheten"
  },
  straffeloven: {
    id: "2005-05-20-28",
    tittel: "Lov om straff"
  },
  forvaltningsloven: {
    id: "1967-02-10",
    tittel: "Lov om behandlingsmåten i forvaltningssaker"
  },
  pasientjournalloven: {
    id: "2014-06-20-42",
    tittel: "Lov om behandling av helseopplysninger ved ytelse av helsehjelp"
  }
};

/**
 * Skrivemåter som ikke er lovens korttittel, og som likevel skal stå.
 *
 * Hver av dem er et sitat. Retter du dem, siterer du ikke lenger - og teksten det
 * gjelder er den innbyggeren samtykker til, som havner ordrett i revisjonsloggen.
 *
 * Forankret til filen og den omsluttende teksten, ikke til skrivemåten alene, slik
 * `EXCEPTIONS` i `scripts/check-dokumentasjon.ts` er: et fritak på skrivemåten ville
 * gjort `forvaltningslova` lovlig hvor som helst, og da var sjekken blind for nettopp
 * det målformsveipet den finnes for.
 */
export type Sitat = {
  navn: string;
  fil: string;
  /** Teksten navnet må stå inne i. Tekst framfor linjenummer, så den tåler en endring over seg. */
  tekst: string;
  begrunnelse: string;
};

export const SITERTE_LOVNAVN: Sitat[] = [
  {
    navn: "forvaltningslova",
    fil: "data/prosessdefinisjoner.json",
    tekst: "enkeltvedtak etter forvaltningslova",
    begrunnelse: "Nynorsk. Formålet i TT-kort-casen er hentet ordrett fra Vestland "
      + "fylkeskommune sitt skjema, og fylkeskommunen skriver nynorsk. Korttittelen er "
      + "forvaltningsloven; sitatet er ikke vårt å skrive om."
  }
];

/**
 * Spennene de registrerte sitatene dekker i denne filen.
 *
 * Posisjoner og ikke `tekst.includes`: et fritak som bare spør om sitatet finnes
 * et eller annet sted i filen, gjelder i praksis hele filen - da var «forankret til
 * teksten» en påstand og ikke en mekanisme.
 */
export function sitatspenn(fil: string, tekst: string): { fra: number; til: number }[] {
  const spenn: { fra: number; til: number }[] = [];
  for (const sitat of SITERTE_LOVNAVN) {
    if (!fil.endsWith(sitat.fil)) continue;
    let fra = tekst.indexOf(sitat.tekst);
    while (fra !== -1) {
      spenn.push({ fra, til: fra + sitat.tekst.length });
      fra = tekst.indexOf(sitat.tekst, fra + 1);
    }
  }
  return spenn;
}

/**
 * Sitatene som er registrert for filen, men som ikke står der.
 *
 * Et fritak som bare slipper gjennom en skrivemåte, fanger ikke det motsatte: at
 * noen retter selve sitatet til den offisielle korttittelen. Da forsvinner
 * nynorskformen, den nye formen står i `LOVTITLER`, og alt er grønt - altså
 * nøyaktig endringen registeret finnes for å hindre.
 */
export function bortkomneSitater(fil: string, tekst: string): Sitat[] {
  return SITERTE_LOVNAVN.filter((sitat) =>
    fil.endsWith(sitat.fil) && !tekst.includes(sitat.tekst));
}

// Et lovnavn må ende på «loven» eller «lova», og de fleste filene her er data uten
// et eneste. Forprøven avviser dem på et forankringsløst søk, som er femti ganger
// billigere enn å la mønsteret under gå gjennom 12 MB matrikkeldata.
const HAR_LOVNAVN = /(?:loven|lova)s?\b/i;

// «helse- og omsorgstjenesteloven» er ett navn med bindestrek og mellomrom inni,
// derfor den valgfrie «- og …»-delen: uten den ville strengen gitt
// «omsorgstjenesteloven», som ikke er noen lov.
//
// Genitiven er med fordi en hjemmel oftest skrives slik: «opplæringslovens § 17-11».
// Uten den ga mønsteret ingen treff i det hele tatt på den formen, så et sveip som
// skrev om hjemlene til genitiv slapp forbi hele registeret.
const LOVNAVN = /[a-zæøå]+(?:-\s+og\s+[a-zæøå]+)*(?:loven|lova)s?\b/gi;

/** Grunnformen: genitiven slås opp som den korttittelen den bøyer. */
function grunnform(navn: string): string {
  return navn.endsWith("s") ? navn.slice(0, -1) : navn;
}

/** Ett treff på et lovnavn, med posisjonen sin i teksten. */
export type Lovnavntreff = { navn: string; indeks: number };

/** Lovnavnene en tekst viser til, i den formen de er skrevet, med posisjon. */
export function finnLovnavn(tekst: string): Lovnavntreff[] {
  if (!HAR_LOVNAVN.test(tekst)) return [];
  const treff: Lovnavntreff[] = [];
  for (const funn of tekst.matchAll(LOVNAVN)) {
    const navn = grunnform(funn[0].toLowerCase());
    // «loven» og «lova» alene er vanlig prosa og viser ikke til en korttittel.
    if (navn === "loven" || navn === "lova") continue;
    treff.push({ navn, indeks: funn.index });
  }
  return treff;
}
