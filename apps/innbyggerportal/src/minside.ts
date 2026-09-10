/**
 * The view model behind Min side, assembled from what the sandbox already holds.
 *
 * Nothing here is written by hand. Every value on the page is read out of
 * `data/*.json` or `state/*.json` and carries the file it came from in `kilde`,
 * so a participant can follow a number on screen back to the row it sits in.
 * Where the sandbox has no data for something a municipal portal would show -
 * renovasjon, feiing, eiendomsskatt - the block is left out rather than filled
 * with a plausible number.
 *
 * Reads happen per request. The one exception is `matrikkel.json`, which is a
 * 13 MB extract: parsing it on every page load would dominate the response, so
 * the id-to-property index is built once and kept.
 */

import { alderVed, maanederEtter } from "../../shared/alder.ts";
import type { Husstand, Krr, Person, Plass } from "../../shared/innbyggerdata.ts";
import { readJson } from "../../shared/jsonstore.ts";
import { TREMAANEDSGRENSEN } from "../../shared/politiattest.ts";
import { maskKrr, maskPerson } from "../../shared/skjerming.ts";

/*
 * Kommunen siden er for. Ett sted, fordi alt annet leser den herfra: hvem som
 * står i velgeren, hvilke tilbud som telles, hva som står i toppfeltet og hvilket
 * kommunevåpen som hentes. Filnavnet på våpenet er kommunenummeret, se
 * docs/designsystem.md.
 */
export const KOMMUNENUMMER = "1103";
export const KOMMUNENAVN = "Stavanger";

export type Eiendom = {
  matrikkelId: string;
  gnr: number;
  bnr: number;
  adresse: string;
  bruksenhetstype: string | null;
  eierform: string | null;
  andel: number | null;
  koordinater: { lat: number; lon: number } | null;
  kilde: string;
};

export type Stegstatus = "fullfoert" | "godkjent" | "paagaar" | "venter";

export type Saksteg = {
  nummer: number;
  tittel: string;
  status: Stegstatus;
  statustekst: string;
};

export type Sak = {
  saksId: string;
  prosessId: string;
  navn: string;
  enhet: string;
  status: string;
  statustekst: string;
  sistOppdatert: string;
  steg: Saksteg[];
  kilde: string;
};

export type Tjeneste = {
  id: string;
  tittel: string;
  beskrivelse: string;
  /** Tallet ved siden av tittelen. Null når det ikke finnes noe å telle. */
  merke: string | null;
  /** Radene som folder seg ut. Tomt når personen ikke har noe der. */
  detaljer: string[];
  kilde: string;
};

export type Hendelse = {
  dato: string;
  kategori: string;
  farge: "info" | "warning" | "success" | "danger" | "neutral";
  tittel: string;
  detalj: string;
  kilde: string;
};

export type Samtykkerad = {
  samtykkeId: string;
  formaal: string;
  dataKilder: string[];
  status: string;
  utloper: string | null;
};

export type Innbygger = {
  personId: string;
  navn: string;
  adresse: string;
};

export type Minside = {
  kommune: { nummer: string; navn: string; vaapen: string };
  person: {
    personId: string;
    navn: string;
    fornavn: string;
    foedselsnummerMaskert: string;
    foedselsdato: string | null;
    alder: number | null;
    adresse: string;
    kommune: string;
    kommunenummer: string;
    skjermet: boolean;
    adressebeskyttelse: string;
  };
  kontakt: {
    epost: string | null;
    telefon: string | null;
    reservert: boolean;
    kanVarsles: boolean;
    sistVerifisert: string | null;
  } | null;
  husstand: {
    husstandId: string;
    type: string;
    medlemmer: { personId: string; navn: string; rolle: string; alder: number | null }[];
  } | null;
  eiendom: Eiendom | null;
  samtykker: Samtykkerad[];
  saker: Sak[];
  tjenester: Tjeneste[];
  hendelser: Hendelse[];
};

/*
 * Property lookup. matrikkel.seed.json is the small fixture the mock's own tests
 * point at, and stands in when the full extract is absent - the same fallback
 * order apps/matrikkel-mock/src/server.ts uses.
 */
let eiendomsindeks: Promise<Map<string, any>> | null = null;

function hentEiendomsindeks(): Promise<Map<string, any>> {
  eiendomsindeks ??= (async () => {
    const register = (await readJson("matrikkel.json", null)) ?? (await readJson("matrikkel.seed.json"));
    const indeks = new Map<string, any>();
    for (const gate of register.gater ?? []) {
      for (const eiendom of gate.eiendommer ?? []) {
        indeks.set(eiendom.matrikkelId, eiendom);
      }
    }
    return indeks;
  })();
  return eiendomsindeks;
}

/**
 * De seks første sifrene er fødselsdatoen personen alt ser øverst på siden. De
 * fem siste er personnummeret, og det vises ikke.
 */
function maskerFoedselsnummer(fnr: string): string {
  if (fnr.length < 11) return "•••••••••••";
  return `${fnr.slice(0, 6)} •••••`;
}

function helnavn(person: Person): string {
  return [person.navn.fornavn, person.navn.mellomnavn, person.navn.etternavn]
    .filter((del): del is string => Boolean(del))
    .join(" ");
}

function gateadresse(person: Person): string {
  const adresse = person.bostedsadresse;
  if (!adresse || !adresse.adressenavn) return "Skjermet adresse";
  const husbokstav = adresse.husbokstav ?? "";
  const linje = `${adresse.adressenavn} ${adresse.husnummer ?? ""}${husbokstav}`.trim();
  return [linje, [adresse.postnummer, adresse.poststed].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}

function idag(): string {
  return new Date().toISOString().slice(0, 10);
}

function kroner(beloep: number): string {
  return `${beloep.toLocaleString("nb-NO")} kr`;
}

/** «1 melding», «2 meldinger». Merkene står ved siden av en tittel og må bøyes. */
function antall(tall: number, entall: string, flertall: string): string {
  return `${tall} ${tall === 1 ? entall : flertall}`;
}

/** Innbyggerne siden kan vises for: de voksne i kommunen, sortert på navn. */
export async function listInnbyggere(): Promise<Innbygger[]> {
  const personer: Person[] = await readJson("personer.json");
  return personer
    .filter((person) => person.bostedsadresse?.kommunenummer === KOMMUNENUMMER)
    .filter((person) => person.rolle !== "barn")
    .map(maskPerson)
    .map((person) => ({
      personId: person.personId,
      navn: helnavn(person),
      adresse: gateadresse(person)
    }))
    .sort((a, b) => a.navn.localeCompare(b.navn, "nb"));
}

/**
 * Eiendommen personen bor på, slått opp på matrikkel-iden folkeregisteret bærer.
 * Eierskapet står i grunnboken og ikke i matrikkelen, så eierformen kommer fra
 * data/eierforhold.json - det er derfor to filer og ikke én.
 */
async function finnEiendom(person: Person): Promise<Eiendom | null> {
  const matrikkelId = person.bostedsadresse?.adresseIdentifikatorFraMatrikkelen;
  if (!matrikkelId) return null;

  const eiendom = (await hentEiendomsindeks()).get(matrikkelId);
  if (!eiendom) return null;

  const register = await readJson("eierforhold.json");
  const rad = (register.eierforhold ?? []).find((post: any) => post.matrikkelId === matrikkelId);
  const eier = (rad?.eiere ?? []).find((post: any) => post.eier === person.personId) ?? null;

  return {
    matrikkelId,
    gnr: eiendom.gnr,
    bnr: eiendom.bnr,
    adresse: eiendom.adresse,
    bruksenhetstype: eiendom.bruksenhetstype ?? null,
    eierform: eier?.eierform ?? null,
    andel: eier?.andel ?? null,
    koordinater: eiendom.koordinater
      ? { lat: eiendom.koordinater.lat, lon: eiendom.koordinater.lon }
      : null,
    kilde: "data/matrikkel.json og data/eierforhold.json"
  };
}

const FULLFOERT: Record<string, string> = {
  SJEKK: "Godkjent",
  CONSENT_REQUEST: "Samtykket",
  SUBMIT: "Sendt inn"
};

function byggSteg(definisjonssteg: any[], ferdigTilOgMed: number): Saksteg[] {
  return definisjonssteg.map((steg, index) => {
    if (index < ferdigTilOgMed) {
      return {
        nummer: index + 1,
        tittel: steg.tittel ?? steg.id,
        status: steg.type === "SJEKK" ? "godkjent" : "fullfoert",
        statustekst: FULLFOERT[steg.type] ?? "Fullført"
      };
    }
    if (index === ferdigTilOgMed) {
      return { nummer: index + 1, tittel: steg.tittel ?? steg.id, status: "paagaar", statustekst: "Pågår nå" };
    }
    return { nummer: index + 1, tittel: steg.tittel ?? steg.id, status: "venter", statustekst: "Venter" };
  });
}

/**
 * Sakene personen har. En innsendt søknad står øverst med behandlingen lagt til
 * på slutten: prosessdefinisjonen slutter når søknaden er sendt, mens saken for
 * innbyggeren fortsetter hos saksbehandleren. Oppgaven i state/oppgaver.json er
 * det leddet, og vedtaket er steget etter.
 */
async function byggSaker(personId: string): Promise<Sak[]> {
  const katalog = await readJson("prosessdefinisjoner.json");
  const definisjoner: any[] = katalog.prosesser ?? [];
  const finnDefinisjon = (prosessId: string) => definisjoner.find((post) => post.id === prosessId);

  const soknader: any[] = await readJson("soknader.json", []);
  const oppgaver: any[] = await readJson("oppgaver.json", []);
  const oekter: any[] = await readJson("prosessoekter.json", []);

  const saker: Sak[] = [];

  for (const soknad of soknader.filter((post) => post.personId === personId)) {
    const definisjon = finnDefinisjon(soknad.prosessId);
    const steg = byggSteg(definisjon?.steg ?? [], definisjon?.steg?.length ?? 0);
    const oppgave = oppgaver.find((post) => post.soknadId === soknad.soknadId);
    const antall = steg.length;
    steg.push({
      nummer: antall + 1,
      tittel: "Til behandling hos saksbehandler",
      status: oppgave ? "paagaar" : "venter",
      statustekst: oppgave ? "Pågår nå" : "Venter"
    });
    steg.push({
      nummer: antall + 2,
      tittel: "Endelig vedtaksbrev",
      status: "venter",
      statustekst: "Venter"
    });

    saker.push({
      saksId: soknad.soknadId,
      prosessId: soknad.prosessId,
      navn: definisjon?.navn ?? soknad.prosessId,
      enhet: `${KOMMUNENAVN} kommune ${definisjon?.redigering?.eier ?? "Innbyggerservice"}`,
      status: "AKTIV",
      statustekst: "Aktiv",
      sistOppdatert: oppgave?.opprettet ?? soknad.opprettet,
      steg,
      kilde: "state/soknader.json og state/oppgaver.json"
    });
  }

  // En økt som endte i en søknad er allerede tatt med over. Den som ikke gjorde
  // det er en påbegynt søknad, og det er den innbyggeren trenger å se.
  const innsendteProsesser = new Set(saker.map((sak) => sak.prosessId));
  for (const oekt of oekter.filter((post) => post.personId === personId)) {
    if (innsendteProsesser.has(oekt.prosessId)) continue;
    const definisjon = finnDefinisjon(oekt.prosessId);
    saker.push({
      saksId: oekt.oektsId,
      prosessId: oekt.prosessId,
      navn: definisjon?.navn ?? oekt.prosessId,
      enhet: `${KOMMUNENAVN} kommune ${definisjon?.redigering?.eier ?? "Innbyggerservice"}`,
      status: oekt.status,
      statustekst: oekt.status === "AKTIV" ? "Påbegynt" : "Avsluttet",
      sistOppdatert: oekt.oppdatert,
      steg: byggSteg(definisjon?.steg ?? [], oekt.stegIndex ?? 0),
      kilde: "state/prosessoekter.json"
    });
  }

  return saker.sort((a, b) => b.sistOppdatert.localeCompare(a.sistOppdatert));
}

type Betaling = { type: "barnehage" | "sfo" | "fritid"; tekst: string; maanedspris: number };

async function finnBetalinger(personIder: string[]): Promise<Betaling[]> {
  const barnehage: Plass[] = await readJson("barnehageplasser.json");
  const sfo: Plass[] = await readJson("sfoplasser.json");
  const fritid: any[] = await readJson("fritidsdeltakelse.json");
  const ider = new Set(personIder);

  return [
    ...barnehage
      .filter((plass) => ider.has(plass.personId))
      .map((plass): Betaling => ({
        type: "barnehage",
        tekst: `Barnehage: ${plass.barnehagenavn}, ${plass.plassprosent} % plass`,
        maanedspris: plass.manedspris
      })),
    ...sfo
      .filter((plass) => ider.has(plass.personId))
      .map((plass): Betaling => ({
        type: "sfo",
        tekst: `SFO: ${plass.sfonavn}, ${plass.trinn}. trinn`,
        maanedspris: plass.manedspris
      })),
    ...fritid
      .filter((rad) => ider.has(rad.personId))
      .map((rad): Betaling => ({
        type: "fritid",
        tekst: `Fritid: ${rad.aktivitetsnavn}, ${rad.arrangoer}`,
        maanedspris: rad.manedspris
      }))
  ];
}

async function byggTjenester(
  person: Person,
  krr: Krr | null,
  saker: Sak[],
  betalinger: Betaling[]
): Promise<Tjeneste[]> {
  const forsendelser: any[] = await readJson("forsendelser.json", []);
  const mine = forsendelser.filter(
    (post) => post.mottaker?.digitalId === person.syntetiskFodselsnummer
  );

  const register = await readJson("eierforhold.json");
  const eide = (register.eierforhold ?? []).filter((rad: any) =>
    (rad.eiere ?? []).some((eier: any) => eier.eier === person.personId)
  );

  const maanedsbeloep = betalinger.reduce((sum, post) => sum + post.maanedspris, 0);
  const plasser = betalinger.filter((post) => post.type !== "fritid");

  const tilbud: any[] = await readJson("tjenestetilbud.json");
  const iKommunen = tilbud.filter((post) => post.kommunenummer === KOMMUNENUMMER);

  return [
    {
      id: "postkasse",
      tittel: "Åpne postkasse",
      beskrivelse: "Digital postkasse, meldinger og vedtak fra kommunen",
      merke: krr?.reservert
        ? "Reservert"
        : mine.length > 0
          ? antall(mine.length, "ulest", "uleste")
          : null,
      detaljer: mine.map(
        (post) => `${post.tittel} - sendt ${post.opprettet.slice(0, 10)} som ${post.kanal.toLowerCase()}`
      ),
      kilde: "state/forsendelser.json og data/krr.json"
    },
    {
      id: "saker",
      tittel: "Se dine saker og søknader",
      beskrivelse: "Søknader, påbegynte prosesser og pågående henvendelser",
      merke: saker.length > 0 ? antall(saker.length, "sak", "saker") : null,
      detaljer: saker.map((sak) => `${sak.navn} - ${sak.statustekst}, sist oppdatert ${sak.sistOppdatert.slice(0, 10)}`),
      kilde: "state/soknader.json og state/prosessoekter.json"
    },
    {
      id: "eiendom",
      tittel: "Se eiendommer og gebyrer",
      beskrivelse: "Matrikkelopplysninger, eierforhold og kommunale gebyrer",
      merke: eide.length > 0 ? antall(eide.length, "eiendom", "eiendommer") : null,
      detaljer: eide.map((rad: any) => {
        const eier = (rad.eiere ?? []).find((post: any) => post.eier === person.personId);
        return `${rad.matrikkelId} - ${eier?.eierform?.toLowerCase() ?? "ukjent eierform"}, andel ${eier?.andel ?? "ukjent"}`;
      }),
      kilde: "data/eierforhold.json"
    },
    {
      id: "betaling",
      tittel: "Se fakturaer og betaling",
      beskrivelse: "Kommunale krav husstanden betaler hver måned",
      merke: maanedsbeloep > 0 ? `${kroner(maanedsbeloep)} per måned` : null,
      detaljer: betalinger.map((post) => `${post.tekst} - ${kroner(post.maanedspris)} per måned`),
      kilde: "data/barnehageplasser.json, data/sfoplasser.json og data/fritidsdeltakelse.json"
    },
    {
      id: "oppvekst",
      tittel: "Barnehage, skole og omsorg",
      beskrivelse: "Plassene husstanden har, og tilbudene kommunen har ledig",
      merke: plasser.length > 0 ? antall(plasser.length, "plass", "plasser") : null,
      detaljer: [
        ...plasser.map((post) => post.tekst),
        ...iKommunen
          .filter((post) => post.ledigePlasser > 0)
          .slice(0, 5)
          .map((post) => `Ledig i kommunen: ${post.navn}, ${post.ledigePlasser} av ${post.kapasitet} plasser`)
      ],
      kilde: "data/barnehageplasser.json, data/sfoplasser.json og data/tjenestetilbud.json"
    }
  ];
}

async function byggSamtykker(personId: string): Promise<Samtykkerad[]> {
  const samtykker: any[] = await readJson("samtykker.json", []);
  return samtykker
    .filter((post) => post.personId === personId)
    .map((post) => ({
      samtykkeId: post.samtykkeId,
      formaal: post.formaal,
      dataKilder: post.dataKilder ?? [],
      status: post.status,
      utloper: post.utloper ? post.utloper.slice(0, 10) : null
    }));
}

/**
 * Kalenderen. Hver rad er en dato som står i dataene fra før: en frist, en
 * utløpsdato eller et tidspunkt noe faktisk skjedde. Renovasjon og feiing hører
 * hjemme i en kommunal kalender, men sandkassen har ingen slike datoer, så de
 * står ikke her framfor å bli funnet på.
 */
async function byggHendelser(
  person: Person,
  krr: Krr | null,
  saker: Sak[],
  betalinger: Betaling[]
): Promise<Hendelse[]> {
  const hendelser: Hendelse[] = [];
  const fnr = person.syntetiskFodselsnummer;

  // Satsdatoen angår bare den som betaler for en plass. Uten den sperren fikk
  // hver eneste innbygger en frist for en ordning de ikke er i.
  if (betalinger.some((post) => post.type !== "fritid")) {
    const satser = await readJson("satser.json");
    hendelser.push({
      dato: satser.gjelderFra,
      kategori: "Satser",
      farge: "info",
      tittel: "Nye satser for foreldrebetaling gjelder",
      detalj: `Maksimalt ${Math.round(satser.maksAndelAvInntekt * 100)} % av inntekten, fordelt på ${satser.maanederMedBetaling} måneder`,
      kilde: "data/satser.json"
    });
  }

  const samtykker: any[] = await readJson("samtykker.json", []);
  for (const samtykke of samtykker.filter((post) => post.personId === person.personId)) {
    if (!samtykke.utloper) continue;
    hendelser.push({
      dato: samtykke.utloper.slice(0, 10),
      kategori: "Samtykke",
      farge: "warning",
      tittel: "Samtykket ditt utløper",
      detalj: samtykke.formaal,
      kilde: "state/samtykker.json"
    });
  }

  const inntekter: any[] = await readJson("inntekter.json");
  const inntekt = inntekter.find((post) => post.personId === person.personId);
  if (inntekt?.skatteoppgjoersdato) {
    hendelser.push({
      dato: inntekt.skatteoppgjoersdato,
      kategori: "Inntekt",
      farge: "neutral",
      tittel: `Skatteoppgjøret for ${inntekt.inntektsaar} ble lagt til grunn`,
      detalj: "Grunnlaget kommunen regner ordninger mot",
      kilde: "data/inntekter.json"
    });
  }

  for (const sak of saker) {
    hendelser.push({
      dato: sak.sistOppdatert.slice(0, 10),
      kategori: "Sak",
      farge: "success",
      tittel: `${sak.navn} ble oppdatert`,
      detalj: sak.saksId,
      kilde: sak.kilde
    });
  }

  const legeerklaeringer = await readJson("legeerklaeringer.json");
  for (const erklaering of (legeerklaeringer.legeerklaeringer ?? []).filter((post: any) => post.fnr === fnr)) {
    hendelser.push({
      dato: erklaering.gyldigTil,
      kategori: "Helse",
      farge: "danger",
      tittel: "Legeerklæringen din går ut",
      detalj: erklaering.dokumenttype,
      kilde: "data/legeerklaeringer.json"
    });
  }

  const politiattester = await readJson("politiattester.json");
  for (const attest of (politiattester.attester ?? []).filter((post: any) => post.fnr === fnr)) {
    hendelser.push({
      // Tremånedersgrensen er regelen, ikke en dato som står i attesten.
      dato: maanederEtter(attest.utstedt, TREMAANEDSGRENSEN),
      kategori: "Vandel",
      farge: "warning",
      tittel: "Politiattesten er for gammel til nye oppdrag",
      detalj: `Utstedt ${attest.utstedt} for formålet ${attest.formaal}`,
      kilde: "data/politiattester.json og apps/shared/politiattest.ts"
    });
  }

  if (krr?.epost?.sistVerifisert) {
    hendelser.push({
      dato: krr.epost.sistVerifisert,
      kategori: "Kontaktinfo",
      farge: "neutral",
      tittel: "Kontaktopplysningene ble sist bekreftet",
      detalj: krr.kanVarsles ? "Kommunen kan varsle deg digitalt" : "Kommunen kan ikke varsle deg digitalt",
      kilde: "data/krr.json"
    });
  }

  // Nærmeste frist først, og det som alt har skjedd etter. En kalender som
  // sorterer rent kronologisk begraver fristen under fjorårets hendelser.
  const naa = idag();
  const kommende = hendelser.filter((post) => post.dato >= naa).sort((a, b) => a.dato.localeCompare(b.dato));
  const passerte = hendelser.filter((post) => post.dato < naa).sort((a, b) => b.dato.localeCompare(a.dato));
  return [...kommende, ...passerte];
}

export async function byggMinside(personId: string): Promise<Minside | null> {
  const personer: Person[] = await readJson("personer.json");
  const raa = personer.find((post) => post.personId === personId);
  if (!raa) return null;
  // Kommunen har ingen Min side for en som ikke bor her. Uten denne sperren
  // svarte en håndskrevet URL med en Bergen-adresse under Stavanger sitt våpen.
  if (raa.bostedsadresse?.kommunenummer !== KOMMUNENUMMER) return null;

  const person = maskPerson(raa);
  const husstander: Husstand[] = await readJson("husstander.json");
  const husstand = husstander.find((post) => post.husstandId === person.husstandId) ?? null;

  const navnPaa = new Map(personer.map((post) => [post.personId, maskPerson(post)]));
  const medlemmer = (husstand?.medlemmer ?? []).map((medlem) => {
    const annen = navnPaa.get(medlem.personId);
    return {
      personId: medlem.personId,
      navn: annen ? helnavn(annen) : medlem.personId,
      rolle: medlem.rolle,
      alder: annen?.foedselsdato ? alderVed(annen.foedselsdato, idag()) : null
    };
  });

  const krrRader: Krr[] = await readJson("krr.json");
  const krrRad = krrRader.find((post) => post.fnr === person.syntetiskFodselsnummer) ?? null;
  const krr = krrRad ? maskKrr(krrRad, person.adressebeskyttelse) : null;

  const husstandsIder = medlemmer.map((medlem) => medlem.personId);
  const betalinger = await finnBetalinger(husstandsIder);
  const saker = await byggSaker(person.personId);

  return {
    kommune: {
      nummer: KOMMUNENUMMER,
      navn: KOMMUNENAVN,
      vaapen: `https://static.fiks.ks.no/img/kommunevaapen/${KOMMUNENUMMER}.png`
    },
    person: {
      personId: person.personId,
      navn: helnavn(person),
      fornavn: person.navn.fornavn,
      foedselsnummerMaskert: maskerFoedselsnummer(person.syntetiskFodselsnummer),
      foedselsdato: person.foedselsdato ?? null,
      alder: person.foedselsdato ? alderVed(person.foedselsdato, idag()) : null,
      adresse: gateadresse(person),
      kommune: person.bostedsadresse?.kommune ?? KOMMUNENAVN,
      kommunenummer: person.bostedsadresse?.kommunenummer ?? KOMMUNENUMMER,
      skjermet: person.skjermet,
      adressebeskyttelse: person.adressebeskyttelse
    },
    kontakt: krr
      ? {
          epost: krr.epost?.adresse ?? null,
          telefon: krr.tlf?.nummer ?? null,
          reservert: krr.reservert,
          kanVarsles: krr.kanVarsles,
          sistVerifisert: krr.epost?.sistVerifisert ?? null
        }
      : null,
    husstand: husstand ? { husstandId: husstand.husstandId, type: husstand.type, medlemmer } : null,
    eiendom: await finnEiendom(person),
    samtykker: await byggSamtykker(person.personId),
    saker,
    tjenester: await byggTjenester(person, krr, saker, betalinger),
    hendelser: await byggHendelser(person, krr, saker, betalinger)
  };
}
