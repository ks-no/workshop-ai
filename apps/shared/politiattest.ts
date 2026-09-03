// Politiattesten: formen, kodeverkene, og valget av hvilken attest som gjelder.
//
// Her fordi tre lesere trenger den. politiattest-mock serverer attestene,
// sandbox-backend vurderer dem, og scripts/valider-data.ts pinner utfallene.
//
// Rent og synkront, som legeerklaering.ts og alder.ts: utfallet skal kunne pinnes
// med literal-data og ingen tjenester i gang.

/**
 * Attesttypene politiregisterloven skiller mellom, pluss den ene sandkassen må
 * navngi selv.
 *
 * `helse-og-omsorgsattest` har ikke noe eget navn i loven: attesten etter
 * helse- og omsorgstjenesteloven § 5-4 er satt sammen av lovbruddene i
 * politiregisterloven § 41 nr. 1 og § 40, og politiet identifiserer den gjennom
 * formålet framfor et navn. En regel må ha en verdi å sammenligne mot, så her får
 * den et navn - se README-en i apps/politiattest-mock.
 */
export const ATTESTTYPER = [
  "barneomsorgsattest",
  "helse-og-omsorgsattest",
  "ordinaer",
  "uttoemmende",
  "utvidet"
] as const;
export type Attesttype = (typeof ATTESTTYPER)[number];

/**
 * Formålene sandkassen dekker. Dette er rollen innbyggeren skal tre inn i, og den
 * bestemmer både hjemmelen og attesttypen - derfor er det formålet, og ikke
 * personen, som avgjør hvilken attest som er den riktige.
 */
export const ATTESTFORMAAL = ["stottekontakt", "barnehage", "skole"] as const;
export type Attestformaal = (typeof ATTESTFORMAAL)[number];

/**
 * De fire ordene politiregisterloven § 39 bruker om hva som anmerkes: siktet,
 * tiltalt, vedtatt forelegg eller dømt. En anmerkning er ikke det samme som en dom,
 * og skillet er hele grunnen til at vurderingen er skjønn.
 */
export const REAKSJONER = ["siktet", "tiltalt", "forelegg", "dom"] as const;
export type Reaksjon = (typeof REAKSJONER)[number];

/**
 * Lovbruddsgruppene, grovt nok til at en regel kan lese dem. Unioner og ikke
 * `string`: en skrivefeil i «seksuallovbrudd-mot-mindreaarig» ville gjort et
 * absolutt yrkesforbud til en skjønnsvurdering uten at noe ble rødt.
 */
export const ANMERKNINGSKATEGORIER = [
  "seksuallovbrudd-mot-mindreaarig",
  "seksuallovbrudd-mot-voksen",
  "voldslovbrudd",
  "narkotikalovbrudd",
  "vinningslovbrudd",
  "bedrageri-eller-underslag"
] as const;
export type Anmerkningskategori = (typeof ANMERKNINGSKATEGORIER)[number];

export type Anmerkning = {
  kategori: Anmerkningskategori;
  /** Straffebudet, slik det står på attesten. */
  hjemmel: string;
  reaksjon: Reaksjon;
  dato: string;
};

/**
 * Tremånedersgrensen. Den er mottakerens regel og ikke politiets, og den enkelte
 * ordningen i data/satser.json eier tallet - dette er bare det beviset skriver.
 */
export const TREMAANEDSGRENSEN = 3;

/**
 * Beviset, formet som et Verifiable Credential. Feltnavnene er engelske fordi de
 * tilhører W3C-modellen og ikke denne sandkassen, på samme måte som `erverv` og
 * `innehaver` i data/brreg.seed.json tilhører BRREG.
 *
 * `expirationDate` er utstedelsesdato pluss tre måneder. Selve attesten har ingen
 * utløpsdato - tremånedersgrensen er mottakerens regel, ikke politiets - og beviset
 * gjør den grensen synlig for den som verifiserer.
 */
export type Attestbevis = {
  type: string[];
  issuer: string;
  credentialSubject: { id: string; formaal: string; attesttype: string; anmerkninger: number };
  issuanceDate: string;
  expirationDate: string;
};

/**
 * En attest, slik politiattest-mock svarer med den. Hele raden, ikke bare feltene
 * en vurdering leser: en trimmet kopi ville latt et feltnavn endre seg i seeden uten
 * at noen av leserne stoppet på kompilering.
 */
export type Politiattest = {
  attestId: string;
  dokumenttype: string;
  fnr: string;
  personId: string;
  formaal: Attestformaal;
  /** Hjemmelen kontrollen er gjort etter, slik den står i bekreftelsen på formål. */
  hjemmel: string;
  attesttype: Attesttype;
  utstedt: string;
  utsteder: { navn: string; enhet: string; organisasjonsnummer: string };
  anmerkninger: Anmerkning[];
  bevis: Attestbevis;
  syntetisk: true;
};

/**
 * Attesten en vurdering skal bygge på: den nyeste for formålet. Datoene er ISO, så
 * strengsammenlikning er datosammenlikning.
 *
 * Den nyeste kommer tilbake selv om den er for gammel til å brukes. Da kan vedtaket
 * si «attesten din er fra 10. februar» i stedet for «vi fant ingenting», og
 * tremånedersgrensen hører i regelen framfor i oppslaget.
 */
export function velgGjeldendeAttest<T extends { formaal: string; utstedt: string }>(
  alle: T[],
  formaal: string
): T | null {
  let nyeste: T | null = null;
  for (const attest of alle) {
    if (attest.formaal !== formaal) continue;
    if (!nyeste || attest.utstedt > nyeste.utstedt) nyeste = attest;
  }
  return nyeste;
}

/**
 * Beviset, bygget av attesten framfor skrevet ved siden av den.
 *
 * Hvert felt er en funksjon av attesten, så en håndskrevet kopi i seeden kunne
 * bare gå ut av takt - og gjorde det i testfiksturen før dette. politiattest-mock
 * fletter beviset inn ved innlasting, slik matrikkel-mock fletter inn eierforhold.
 */
export function byggAttestbevis(attest: Omit<Politiattest, "bevis">): Attestbevis {
  const gaarUt = new Date(attest.utstedt);
  gaarUt.setMonth(gaarUt.getMonth() + TREMAANEDSGRENSEN);
  return {
    type: ["VerifiableCredential", "Politiattest"],
    issuer: "did:web:politiet.no",
    credentialSubject: {
      id: `did:sandkasse:${attest.personId}`,
      formaal: attest.formaal,
      attesttype: attest.attesttype,
      anmerkninger: attest.anmerkninger.length
    },
    issuanceDate: `${attest.utstedt}T09:00:00Z`,
    expirationDate: `${gaarUt.toISOString().slice(0, 10)}T09:00:00Z`
  };
}
