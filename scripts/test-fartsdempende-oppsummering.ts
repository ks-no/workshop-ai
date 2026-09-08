import { buildFartsdempendeOppsummering } from "../apps/ai-gateway/src/fartsdempende-oppsummering.ts";

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

const tjeneste = "Søknad om fartsdempende tiltak";
const data = {
  "hent-gate": {
    adressenavn: "Storgata", kommune: "Bergen", antallBoligeiendommer: 18, antallEiendommer: 24
  },
  "sjekk-eier": { godkjent: true, melding: "Eierforhold kontrollert." }
};
const ja = "Søker opplyser at gaten har mer enn 20 boliger.";
const nei = "Søker opplyser at gaten ikke har mer enn 20 boliger.";
const ukjent = "Det er ikke avklart om gaten har mer enn 20 boliger.";

function oppsummer(bekreftelse: unknown, begrunnelse: unknown = undefined): string {
  return buildFartsdempendeOppsummering(tjeneste, data, {
    "boliger-bekreft": bekreftelse, begrunnelse
  }) || "";
}

// Both clients' shapes: /stegvis submits named fields, chat/agent can submit text.
for (const [verdi, forventet] of [
  ["Ja", ja], ["  JA!  ", ja], ["Japp", ja], ["Det stemmer", ja], ["Riktig", ja],
  ["Ja, det er mer enn 20 boliger", ja],
  ["Ja, det stemmer.", ja], ["Ja, det er riktig!", ja],
  ["Ja, det er mer enn 20 boliger i gaten.", ja],
  ["Nei", nei], ["Nei, det er ikke riktig", nei], ["Nei, ikke mer enn 20 boliger", nei],
  ["Nei, det stemmer ikke.", nei], ["Nei, det er ikke mer enn 20 boliger i gaten.", nei],
  ["Det stemmer ikke", nei], ["Ikke riktig", nei],
  [true, ja], [false, nei],
  ["Vet ikke", ukjent], ["Kanskje", ukjent], ["Det er nok riktig", ukjent],
  ["Det er ikke sikkert at det stemmer", ukjent],
  ["Ja, kanskje, jeg vet ikke sikkert.", ukjent],
  ["Nei, jeg vet ikke om det er mer enn20 boliger.", ukjent],
  ["Ja, det er ikke mer enn20 boliger.", ukjent],
  ["Ja, det er ikke mer enn 20 boliger.", ukjent],
  ["Nei, det er mer enn 20 boliger.", ukjent],
  ["Ja, det stemmer ikke.", ukjent], ["Nei, det stemmer.", ukjent],
  ["Ja, det er mer enn 20 boliger, tror jeg.", ukjent],
  ["Nei, det er ikke riktig, tror jeg.", ukjent],
  ["Ja, det stemmer. Eller kanskje ikke.", ukjent],
  ["Nei, det stemmer ikke. Jeg er usikker.", ukjent],
  ["Ja! Jeg vet ikke.", ukjent], ["Nei. Kanskje.", ukjent],
  ["Ja, nei.", ukjent], ["Nei, ja.", ukjent],
  ["Ikke mer enn 20, tror jeg", ukjent],
  ["20", ukjent], ["25", ukjent], [20, ukjent], [25, ukjent], [0, ukjent],
  ["", ukjent], [null, ukjent], [undefined, ukjent], [{}, ukjent], [[], ukjent],
  [["Ja"], ukjent], [{ uventet: "Ja" }, ukjent]
] as const) {
  for (const bekreftelse of [verdi, { merEnn20Boliger: verdi }]) {
    const tekst = oppsummer(bekreftelse);
    check(`boligsvar ${JSON.stringify(bekreftelse)} gjengis uten gjetting`,
      tekst.includes(forventet) && [ja, nei, ukjent].filter((setning) => tekst.includes(setning)).length === 1,
      tekst);
  }
}

const trafikkproblem = "Høy fart ved skoleveien, særlig i rushtiden.";
const tekst = oppsummer({ merEnn20Boliger: "Ja" }, { trafikkproblem, oensketTiltak: "Fartshumper" });
check("skjemaets trafikkproblem bevares", tekst.includes(`Begrunnelse fra søker: ${trafikkproblem}`), tekst);
check("skjemaets tiltak bevares", tekst.includes("Ønsket tiltak: Fartshumper"), tekst);
check("skjemasvar blir ikke objekttekst", !tekst.includes("[object Object]"), tekst);
check("registerets tall holdes atskilt fra søkerens svar",
  tekst.includes("18 boligeiendommer og 24 eiendommer totalt") && tekst.includes(ja), tekst);
check("kontrollert eierforhold bevares", tekst.includes("Eierforholdet er kontrollert"), tekst);
check("fritekstbegrunnelse bevares", oppsummer("Ja", trafikkproblem).includes(trafikkproblem));
check("valgfritt tiltak kan stå alene",
  oppsummer("Ja", { oensketTiltak: "Sone med 30 km/t" }).includes("Ønsket tiltak: Sone med 30 km/t"));
check("tomt tiltak finner ikke på et ønske",
  !oppsummer("Ja", { trafikkproblem, oensketTiltak: "" }).includes("Ønsket tiltak:"));

for (const begrunnelse of [undefined, null, 42, true, [], ["Høy fart"], {}, { trafikkproblem: {}, oensketTiltak: ["Fartshumper"] }]) {
  const resultat = oppsummer("Ja", begrunnelse);
  check(`ugyldig begrunnelse ${JSON.stringify(begrunnelse)} blir ikke prosa`,
    !resultat.includes("Begrunnelse fra søker:") && !resultat.includes("Ønsket tiltak:") && !resultat.includes("[object Object]"),
    resultat);
}
check("andre tjenester bruker ikke trafikkmalen",
  buildFartsdempendeOppsummering("Barnehage", data, {}) === null);
check("uten gategrunnlag velges ikke trafikkmalen",
  buildFartsdempendeOppsummering(tjeneste, {}, {}) === null);
check("et avvist eierforhold blir ikke bekreftet",
  !buildFartsdempendeOppsummering(tjeneste, {
    ...data, "sjekk-eier": { godkjent: false, melding: "Eier ikke." }
  }, {})?.includes("Eierforholdet er kontrollert"));

console.log(`Fartsdempende oppsummering: ${bestatt} bestått, ${feil.length} feil.`);
for (const melding of feil) console.error(`  FEIL: ${melding}`);
if (feil.length) process.exitCode = 1;
