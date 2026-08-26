// The shapes of the citizen datasets, for the services that read them.
//
// Sibling of registerdata.ts, and there for the same reason: personer.json,
// husstander.json, the two plass-datasets and samtykker.json are read off the same
// disk by more than one service, so their shapes belong to neither of them -
// housed in one service, the other has to import from a peer.
//
// What stays in sandbox-backend/src/types.ts is the process engine: steg, oekt,
// katalog, State, and the rules and rates only vilkaar.ts and regler.ts read. Those
// have one reader, and one reader is not a shared layer.
//
// Ambition is deliberately low where the data is synthetic and loosely shaped. We
// model the fields the code actually reads and leave the rest open.
export type MedFelter = { [key: string]: any };

// FREG grades address protection: kode 7 (FORTROLIG) and kode 6
// (STRENGT_FORTROLIG), plus the ungraded majority. Closed, so the masking rules in
// skjerming.ts must cover every grade the compiler knows about. The boolean
// `skjermet` is derived from this field and never the other way round - the same
// invariant scripts/valider-data.ts enforces on the seed.
export type Adressegradering = "UGRADERT" | "FORTROLIG" | "STRENGT_FORTROLIG";

// mellomnavn is null rather than absent throughout the seed, and masking writes
// null too. Typing it as string only would reject both.
export type Personnavn = { fornavn: string; mellomnavn?: string | null; etternavn: string };

export type Person = MedFelter & {
  personId: string;
  husstandId: string;
  syntetiskFodselsnummer: string;
  foedselsdato?: string;
  navn: Personnavn;
  adressebeskyttelse: Adressegradering;
  skjermet: boolean;
};

export type Husstandsmedlem = { personId: string; rolle: "foresatt" | "barn" | string };

export type Husstand = MedFelter & {
  husstandId: string;
  medlemmer: Husstandsmedlem[];
};

export type Plass = MedFelter & {
  personId: string;
  manedspris: number;
  trinn?: number;
};

export type Samtykke = MedFelter & {
  samtykkeId: string;
  personId: string;
  status: string;
  dataKilder: string[];
};

// One row in data/krr.json, mirroring Fiks' KrrDefinisjon. Keyed on fnr like
// inntekter.json, because that is what the real KRR looks people up by. epost
// and tlf are null - not absent - when the person has no contact info, so the
// key set stays the same for every row.
export type KrrEpost = { adresse: string; sistOppdatert: string; sistVerifisert: string };

export type KrrTelefon = { nummer: string; sistOppdatert: string; sistVerifisert: string };

export type Krr = MedFelter & {
  fnr: string;
  epost: KrrEpost | null;
  tlf: KrrTelefon | null;
  status: string;
  reservert: boolean;
  kanVarsles: boolean;
  spraak: string;
};
