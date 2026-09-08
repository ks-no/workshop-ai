import {
  erEksaktFortsettSignal,
  normalizeBrukersvar,
  parseSvarPrefiks,
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

for (const tekst of ["ja, men nei", "greit, men ikke", "kanskje"]) {
  check(`tvetydig svar blir ukjent: «${tekst}»`, tolkLokaltSvar(tekst) === "ukjent");
}

for (const tekst of ["Janaflaten 10", "Jeg bor ved Jokerveien 7"]) {
  check(`svar med kort ja-token blir ukjent: «${tekst}»`, tolkLokaltSvar(tekst) === "ukjent");
  check(`svar med kort ja-token er ikke fortsettelse: «${tekst}»`, !erEksaktFortsettSignal(tekst));
}

for (const tekst of ["ja", "fortsett", "kjør på", "kjor pa", "gå videre", "ga videre"]) {
  check(`eksplisitt fortsettelse: «${tekst}»`, erEksaktFortsettSignal(tekst));
}

if (feil.length > 0) {
  console.error(`Chat-fallback: ${feil.length} av ${bestatt + feil.length} sjekker feilet:`);
  for (const melding of feil) console.error(`- ${melding}`);
  process.exit(1);
}

console.log(`Chat-fallback: ${bestatt} sjekker bestått.`);
