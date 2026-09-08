import {
  erFortsettSignal,
  normalizeBrukersvar,
  parseSvarPrefiks,
  skalSvareFramfor,
  tolkLokaltSvar
} from "../apps/demo-gui/src/client/fallback-intent.ts";

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

check(
  "normalisering fjerner tegn og samler mellomrom",
  normalizeBrukersvar("  JA,\u00a0TAKK!  ") === "ja takk"
);

const prefiks = parseSvarPrefiks("  SVAR: ikke greit  ");
check("svar-prefiks finnes før normalisering", prefiks.harSvarPrefiks);
check("svar-prefiks fjernes uten kolon", prefiks.tekst === "ikke greit", prefiks.tekst);

for (const tekst of [
  "ja",
  "JAPP",
  "yes",
  "klart",
  "greit",
  "okei",
  "ok",
  "gjerne",
  "ja takk",
  "ja, gjerne",
  "ja da",
  "jada",
  "javisst",
  "ja, det stemmer",
  "send inn",
  "Ja, send inn!",
  "det går fint",
  "Ja, det går fint.",
  "det er greit"
]) {
  check(`eksplisitt ja-svar: «${tekst}»`, tolkLokaltSvar(tekst) === "ja");
}

for (const tekst of [
  "nei",
  "ikke",
  "stopp",
  "senere",
  "ikke nå",
  "nei takk",
  "Nei, ikke nå.",
  "ikke ennå",
  "Nei, ikke ennå!"
]) {
  check(`eksplisitt nei-svar: «${tekst}»`, tolkLokaltSvar(tekst) === "nei");
}

for (const tekst of ["ikke greit", "ikke ok"]) {
  check(`nektet ja-uttrykk blir nei: «${tekst}»`, tolkLokaltSvar(tekst) === "nei");
}

for (const tekst of ["ja, men nei", "greit, men ikke", "kanskje", "jo"]) {
  check(`tvetydig svar blir ukjent: «${tekst}»`, tolkLokaltSvar(tekst) === "ukjent");
}

for (const tekst of ["gå videre nå", "ja, kjør på", "fortsett takk"]) {
  check(`fortsettelse er ikke samtykke: «${tekst}»`, tolkLokaltSvar(tekst) === "ukjent");
}

const prefetchedSvar = ["Janaflaten 10", "Nikkelveien", "Jeg bor ved Jokerveien 7"];
for (const tekst of prefetchedSvar) {
  check(`svar med kort ja-token blir ukjent: «${tekst}»`, tolkLokaltSvar(tekst) === "ukjent");
  check(`svar med kort ja-token er ikke fortsettelse: «${tekst}»`, !erFortsettSignal(tekst));
  check(`svar med kort ja-token sendes til neste steg: «${tekst}»`, skalSvareFramfor(tekst, true));
}

const fortsettSvar = [
  "ja",
  "fortsett",
  "kjør på",
  "kjor pa",
  "gå videre",
  "ga videre",
  "gå videre nå",
  "ja, kjør på",
  "ja da",
  "fortsett takk"
];
for (const tekst of fortsettSvar) {
  check(`eksplisitt fortsettelse: «${tekst}»`, erFortsettSignal(tekst));
  check(`fortsettelse lagres ikke som neste svar: «${tekst}»`, !skalSvareFramfor(tekst, true));
}

check("INFO uten neste spørsmål lagrer ikke svar", !skalSvareFramfor("Janaflaten 10", false));

if (feil.length > 0) {
  console.error(`Chat-fallback: ${feil.length} av ${bestatt + feil.length} sjekker feilet:`);
  for (const melding of feil) console.error(`- ${melding}`);
  process.exit(1);
}

console.log(`Chat-fallback: ${bestatt} sjekker bestått.`);
