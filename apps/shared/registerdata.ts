// Formene i data/brreg.seed.json og data/folkeregister.seed.json.
//
// Tre tjenester leser de to filene: brreg-mcp og folkeregister-mcp over MCP, og
// tools-api over REST. Det er en kjent duplisering av *kode* — se tjenestekartet
// i AGENTS.md — men typene trenger ikke dupliseres med den. Endres et felt i
// seeden, endres det her, og alle tre stopper på kompilering.
//
// Verdiene er dels `unknown`: dette er datasett hentet utenfra, og leserne
// tvinger hver verdi gjennom String(), Boolean() eller Array.isArray() før bruk.
// Typen sier det samme som koden gjør.

// --- Enhetsregisteret (Tenor-uttrekk) --------------------------------------

export type Adresse = { kommune?: unknown; poststed?: unknown };

export type Organisasjonsform = { kode?: unknown; beskrivelse?: unknown };

export type TenorEnhet = {
  organisasjonsnummer?: unknown;
  navn?: unknown;
  naeringKode?: unknown;
  naeringBeskrivelse?: unknown;
  registrertIForetaksregisteret?: unknown;
  registrertIMvaregisteret?: unknown;
  antallUnderenheter?: unknown;
  forretningsadresse?: Adresse | null;
  postadresse?: Adresse | null;
  telefonnummer?: unknown;
  hjemmeside?: unknown;
  /** kildedata er en JSON-streng inne i JSON-en, med samme form som ytterdokumentet. */
  tenorMetadata?: { kildedata?: unknown };
  /** Bare i det innbakte kildedata-dokumentet, ikke på ytterste nivå. */
  organisasjonsform?: Organisasjonsform;
};

/** Organisasjonen slik leserne bygger den ut. `_search` strippes før svar. */
export type Organisasjon = {
  organisasjonsnummer: string;
  navn: string;
  organisasjonsform: { kode: string | null; beskrivelse: string | null };
  naeringKode: string[];
  naeringBeskrivelse: string[];
  registrertIForetaksregisteret: boolean;
  registrertIMvaregisteret: boolean;
  antallUnderenheter: unknown;
  forretningsadresse: Adresse | null;
  postadresse: Adresse | null;
  telefonnummer: string | null;
  nettside: string | null;
  _search: string;
};

// --- Folkeregisteret -------------------------------------------------------

export type Personnavn = { fornavn?: string; mellomnavn?: string; etternavn?: string };

export type Bostedsadresse = { kommune?: string; poststed?: string; postnummer?: string };

export type Forelderbarnrelasjon = {
  relatertPersonsIdent?: string | null;
  _sandboxRelatertPersonId?: string;
  [felt: string]: unknown;
};

export type FolkeregisterPerson = {
  foedselsEllerDNummer?: string;
  personnavn?: Personnavn;
  foedselsdato?: string;
  kjoenn?: string;
  sivilstand?: unknown;
  bostedsadresse?: Bostedsadresse;
  skjermet?: boolean;
  forelderbarnrelasjon?: Forelderbarnrelasjon[];
  /** Sandkassens egne felt i seeden, ikke Folkeregisterets. */
  _sandbox?: { personId?: string; husstandId?: string; rolle?: string };
  /** Bygget ved oppstart av leseren, strippet før svar. */
  _searchIndex?: string;
};

// --- Geonorge adresse-API --------------------------------------------------

/**
 * En adresse fra https://ws.geonorge.no/adresser/v1.
 *
 * Feltene her er de sandkassen leser, ikke hele svaret. Både matrikkel-mock og
 * tools-api kaller API-et — den dupliseringen er kjent, se tjenestekartet i
 * AGENTS.md — men de leser samme form, så formen står ett sted.
 */
export type GeonorgeAdresse = {
  adressenavn?: string;
  adressetekst?: string;
  nummer?: number;
  bokstav?: string;
  kommunenummer?: string;
  kommunenavn?: string;
  postnummer?: string;
  poststed?: string;
  gardsnummer?: number;
  bruksnummer?: number;
  festenummer?: number;
  undernummer?: number;
  adressekode?: number;
  adressetilleggsnavn?: string;
  objtype?: string;
  representasjonspunkt?: { lat?: number; lon?: number; epsg?: string };
};
