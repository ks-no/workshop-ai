// The shapes of the citizen datasets, for the services that read them.
//
// Sibling of registerdata.ts, and there for the same reason: personer.json,
// husstander.json, the two plass-datasets and samtykker.json are read off the same
// disk by more than one service, so their shapes belong to neither of them. They
// used to live in sandbox-backend/src/types.ts, which meant fiks-simulator imported
// its Person from the backend while the backend imported its samtykke kodeverk from
// fiks — a two-way service dependency built entirely out of leaves.
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
// `skjermet` is derived from this field and never the other way round — the same
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
