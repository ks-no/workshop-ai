/*
 * Varsler: den korte beskjeden, ikke dokumentet.
 *
 * Dette er ikke SvarUt, og det er hele grunnen til at filen finnes ved siden av
 * forsendelse.ts. De to gjør forskjellige ting, og kanalvalget skiller seg på det
 * ene punktet som betyr noe:
 *
 *   forsendelse  et dokument - vedtaket, kvitteringen. Faller til PRINT, fordi et
 *                brev er et brev, og det er greit at det kommer om tre dager.
 *   varsel       «husk turen på tirsdag», «kurset er avlyst». Faller *ikke* til
 *                papir. En påminnelse i posten kommer etter turen, og et varsel
 *                ingen kan lese i tide er verre enn ikke noe varsel: det ser
 *                sendt ut i loggen.
 *
 * Derfor kjenner `chooseKanal` bare DIGITAL og PRINT, og denne bare SMS, EPOST og
 * INGEN. Å legge SMS inn i den andre ville slått de to sammen, og da hadde
 * spørsmålet «hvem fikk vedtaket» og «hvem ble minnet på» hatt samme svar.
 *
 * Modulen er ren og kjenner ingen HTTP: `pnpm test:varsel` kjører den uten port.
 *
 * Filen kom inn med team Haugesanders innlevering. Noen av kommentarene deres er
 * nynorsk eller transliterert - «Ein SMS er 160 tegn», «paakrevd», «maa gaa» - og de
 * står som de står. Se AGENTS.md, punkt 5.
 */

import type { Krr } from "../../shared/innbyggerdata.ts";

// --- kodeverket -------------------------------------------------------------
//
// Her, ved siden av avgjørelsen som leser det, slik INFORMASJONSDELER ligger i
// folkeregister.ts. Fiks er eneste leser i dag, og `sjekk-openapi-dekning.ts`
// måler listene mot spesifikasjonen herfra. Trenger en annen tjeneste dem, er
// flyttingen til apps/shared én importsti - og `test:imports` gjør den umulig å
// glemme.

/**
 * Kanalene et varsel kan gå på. Ingen papirkanal - filhodet over sier hvorfor.
 *
 * `INGEN` er derfor et utfall og ikke en feil.
 */
export const VARSELKANALER = ["SMS", "EPOST", "INGEN"] as const;
export type Varselkanal = (typeof VARSELKANALER)[number];

/**
 * Hva varselet er.
 *
 * Typen avgjør ikke kanalen i dag, men den står i loggen, og det er poenget:
 * «hvem fikk et uanmodet varsel om et tilbud» og «hvem ble minnet på noe hun selv
 * meldte seg på» er to spørsmål med to hjemler, og en logg som ikke skiller dem
 * kan ikke svare på noen av dem.
 *
 * `paamelding-bekreftet` er den tredje varianten: den er *bedt om*. Innbyggeren
 * meldte seg nettopp på, og bekreftelsen er en del av tjenesten hun ba om - ikke
 * en henvendelse vi tok initiativ til.
 *
 * `portal-kunngjoring` er en fjerde: den nevner ikke noe tilbud i det hele tatt,
 * bare at portalen finnes. Den kan ikke dele hjemmel med `tilbud-finnes`, som
 * loggen leser som «et konkret tilbud ble vurdert for henne» - kunngjøringen har
 * ikke vurdert noe ennå.
 */
export const VARSELTYPER = [
  "tilbud-finnes",
  "paamelding-bekreftet",
  "paaminnelse",
  "avlysning",
  "portal-kunngjoring"
] as const;
export type Varseltype = (typeof VARSELTYPER)[number];

/**
 * Hvorfor et varsel ikke kunne sendes.
 *
 * Fire grunner og ikke én, fordi de fører til fire forskjellige handlinger: en
 * ukjent i registeret er en datafeil hos oss, en reservert er et valg innbyggeren
 * har tatt og skal respekteres, «kan ikke varsles» er en tom kontaktrad, og
 * `ingen_kontaktopplysning` er en rad som sier at hun kan varsles uten å oppgi noe
 * å varsle på - en selvmotsigelse i registeret.
 */
export const VARSELGRUNNER = [
  "ukjent_i_kontaktregisteret",
  "reservert",
  "kan_ikke_varsles",
  "ingen_kontaktopplysning"
] as const;
export type Varselgrunn = (typeof VARSELGRUNNER)[number];

/**
 * Ein SMS er 160 tegn i GSM-7. Lengre tekst maa gaa paa e-post.
 *
 * `validateVarsellengde` teller med `tekst.length`, altså UTF-16-enheter, og ikke en
 * ekte GSM-7-telling. En tekst med «» eller emoji er i virkeligheten UCS-2 og deles ved
 * 70 tegn, så grensen her er bevisst naiv: den finnes for at en sperre skal stå på
 * sendeflaten, ikke for å regne ut hva en operatør ville fakturert.
 */
export const SMS_MAKSLENGDE = 160;

// `typeof` foran, og ingen String(): uten den var `["paaminnelse"]` en gyldig type,
// fordi String() på en ettelements array gir elementet. Raden ble da skrevet med en
// array som type, og forsvant ut av sitt eget `?type=`-filter.
export function erVarseltype(verdi: unknown): verdi is Varseltype {
  return typeof verdi === "string" && (VARSELTYPER as readonly string[]).includes(verdi);
}

export type Varselkanalutfall = {
  kanal: Varselkanal;
  /** Bare naar kanalen er INGEN. Da er den paakrevd - se VARSELGRUNNER. */
  grunn?: Varselgrunn;
};

/**
 * Kanalen et varsel går på, ut fra kontakt- og reservasjonsregisteret.
 *
 * **Reservasjonen stenger.** Den gjelder digital kommunikasjon fra det offentlige,
 * og et varsel er nettopp det. At innbyggeren ellers ville fått brev hjelper ikke
 * her: det finnes ingen papirkanal for et varsel. Følgen er at en reservert
 * innbygger ikke får påminnelser i det hele tatt, og det er et svar påmeldingen må
 * kunne gi henne på forhånd framfor at det oppdages ved at ingenting skjer.
 *
 * **SMS foran e-post.** Et varsel er tidskritisk og kort. Er begge oppgitt, vinner
 * telefonen; e-post er reserven, ikke førstevalget.
 */
export function velgVarselkanal(
  krrRad: Pick<Krr, "kanVarsles" | "reservert" | "tlf" | "epost"> | undefined
): Varselkanalutfall {
  if (!krrRad) return { kanal: "INGEN", grunn: "ukjent_i_kontaktregisteret" };
  if (krrRad.reservert) return { kanal: "INGEN", grunn: "reservert" };
  if (!krrRad.kanVarsles) return { kanal: "INGEN", grunn: "kan_ikke_varsles" };
  if (krrRad.tlf?.nummer) return { kanal: "SMS" };
  if (krrRad.epost?.adresse) return { kanal: "EPOST" };
  // kanVarsles uten en eneste kontaktopplysning er en selvmotsigelse i registeret,
  // ikke en tilstand vi kan handle paa. Den faar sin egen grunn framfor aa bli
  // stilltiende slaatt sammen med «kan ikke varsles».
  return { kanal: "INGEN", grunn: "ingen_kontaktopplysning" };
}

/**
 * Kroppen slik den kom inn: JSON fra tråden, ikke noe mer.
 *
 * Feltene er `unknown` og ikke `string?`. De *ser* ut som strenger fordi kalleren
 * som regel sender strenger, og det er nettopp derfor typen ikke skal si det:
 * `tekst: 123` ga 500 på `.trim()` og `digitalId: 12818800078` slapp gjennom
 * fnr-porten for så aldri å matche en rad i registeret, fordi begge var skrevet som
 * om `as Varselkropp` hadde sjekket noe. Med `unknown` nekter kompilatoren å bygge en
 * `Validertvarsel` før `validateVarsel` faktisk har sett etter.
 */
export type Varselkropp = {
  type?: unknown;
  digitalId?: unknown;
  tekst?: unknown;
  /** Kallerens egen noekkel, saa den kan kjenne igjen raden sin. */
  eksternReferanse?: unknown;
  /** Flyten varselet hører til. Settes av kalleren, ellers av oss. */
  sporingsId?: unknown;
};

export type Varselfeil = { melding: string; kode: string };

/** Et valgfritt felt fra en ukontrollert kropp: en streng, eller ingenting. */
const somStreng = (verdi: unknown) => (typeof verdi === "string" ? verdi : undefined);

/**
 * Avslaget for en type som ikke står i kodeverket.
 *
 * Egen funksjon fordi to veier inn stiller det samme spørsmålet: typen i kroppen på
 * `POST /fiks/varsler`, og `?type=` på utboksen. Skrevet to steder ville de to
 * meldingene begynt likt og endt forskjellig. Selve avgjørelsen er `erVarseltype`,
 * som narrower - denne kler bare på et nei.
 */
export function ukjentVarseltype(verdi: unknown): Varselfeil {
  return {
    melding: `Ukjent varseltype ${verdi}. Gyldige: ${VARSELTYPER.join(", ")}.`,
    kode: "UKJENT_VARSELTYPE"
  };
}

/** Kroppen etter validering: hvert felt er til stede og typen står i kodeverket. */
export type Validertvarsel = {
  type: Varseltype;
  digitalId: string;
  tekst: string;
  eksternReferanse?: string;
  sporingsId?: string;
};

/**
 * Kroppen, før kanalen er valgt.
 *
 * Lengden sjekkes ikke her, men i `validateVarsellengde` etter kanalvalget: en
 * tekst på 200 tegn er feil for en SMS og helt i orden for en e-post, og hvilken
 * det blir vet vi først når registeret er lest.
 *
 * Svaret er enten en feil eller den validerte kroppen, slik at kalleren ikke
 * trenger å påstå med `!` eller en cast det denne funksjonen nettopp har sjekket.
 */
export function validateVarsel(kropp: Varselkropp): { feil: Varselfeil } | { varsel: Validertvarsel } {
  // Typen og ikke bare tilstedeværelsen. En streng er det eneste `digitalId` kan
  // være: fnr-porten under coercer et tall og slipper det, mens oppslaget i
  // registeret sammenligner strengt og aldri treffer - og utfallet blir «ukjent i
  // kontaktregisteret» for en innbygger som er der.
  // `kropp?` og ikke `kropp`: readRequestBody gir JSON.parse tilbake ordrett, så en
  // kropp som er literal `null` kommer hit. Uten ?. er den en 500 i stedet for en 400.
  if (typeof kropp?.digitalId !== "string" || !kropp.digitalId) {
    return { feil: { melding: "digitalId er påkrevd, som streng.", kode: "MANGLER_MOTTAKER" } };
  }
  if (typeof kropp.tekst !== "string" || !kropp.tekst.trim()) {
    return { feil: { melding: "tekst er påkrevd, som streng.", kode: "MANGLER_TEKST" } };
  }
  if (!erVarseltype(kropp.type)) {
    return { feil: ukjentVarseltype(kropp.type) };
  }
  const eksternReferanse = somStreng(kropp.eksternReferanse);
  const sporingsId = somStreng(kropp.sporingsId);
  return {
    varsel: {
      type: kropp.type,
      digitalId: kropp.digitalId,
      tekst: kropp.tekst,
      ...(eksternReferanse ? { eksternReferanse } : {}),
      ...(sporingsId ? { sporingsId } : {})
    }
  };
}

/**
 * Teksten mot kanalen den faktisk skal gå på.
 *
 * Grensen håndheves her, på sendeflaten, og ikke i prompten som skrev teksten. En
 * regel modellen blir bedt om å følge er en regel som holder mesteparten av tiden;
 * dette er stedet den kan holdes hver gang. Samme begrunnelse som at vilkårene
 * ligger i kode og ikke i en systemmelding.
 */
export function validateVarsellengde(tekst: string, kanal: Varselkanal): Varselfeil | null {
  if (kanal !== "SMS" || tekst.length <= SMS_MAKSLENGDE) return null;
  return {
    melding: `Teksten er ${tekst.length} tegn, og en SMS tar ${SMS_MAKSLENGDE}. `
      + "Kort ned teksten, eller send den til en mottaker som har e-post.",
    kode: "FOR_LANG_SMS"
  };
}
