/*
 * Unit tests for the pure classifier in apps/sandbox-backend/src/tilgangsstatus.ts,
 * the logic behind GET /api/personer/:personId/tilganger.
 *
 * Pure and synchronous, so every branch is pinned with a literal input object and
 * no running services - the I/O half that resolves those inputs (finnSisteSoknad,
 * hasGyldigSamtykke, evaluateVilkaar via runRessurs) lives in
 * tilgangsoversikt.ts and is deliberately not exercised here.
 */

import { kombinerAlternativstatuser, velgTilgangsstatus } from "../apps/sandbox-backend/src/tilgangsstatus.ts";

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

// --- de seks statusene, hver for seg -----------------------------------------

check("godkjent søknad gir allerede-godkjent",
  velgTilgangsstatus({ eksisterendeUtfall: "godkjent" }) === "allerede-godkjent");

check("avvist søknad gir allerede-avvist",
  velgTilgangsstatus({ eksisterendeUtfall: "avvist" }) === "allerede-avvist");

check("søknad til manuell gir til-manuell-vurdering",
  velgTilgangsstatus({ eksisterendeUtfall: "til_manuell" }) === "til-manuell-vurdering");

check("manglende samtykke gir krever-samtykke",
  velgTilgangsstatus({ manglerSamtykke: ["inntekt"] }) === "krever-samtykke");

check("forhåndskjørt regel som avslår gir ikke-aktuell",
  velgTilgangsstatus({ sjekkutfall: "avvist" }) === "ikke-aktuell");

check("forhåndskjørt regel som godkjenner gir tilgjengelig",
  velgTilgangsstatus({ sjekkutfall: "godkjent" }) === "tilgjengelig");

check("ingen informasjon i det hele tatt gir tilgjengelig - vi utelukker ikke uten grunnlag",
  velgTilgangsstatus({}) === "tilgjengelig");

// --- til_manuell betyr noe annet før en søknad finnes ------------------------
// En regel som selv ville sagt "krever_manuell_vurdering" har fortsatt sluppet
// søknaden gjennom (se SLIPPER_GJENNOM i vilkaar.ts) - før noen har søkt er det
// altså fortsatt noe å gå videre med, ikke det samme som en søknad som venter.

check("regel som ville krevd manuell vurdering, uten søknad ennå, gir tilgjengelig",
  velgTilgangsstatus({ sjekkutfall: "til_manuell" }) === "tilgjengelig");

// --- prioritetsrekkefølgen, ikke bare enkeltverdier --------------------------

check("eksisterende søknad slår manglende samtykke",
  velgTilgangsstatus({ eksisterendeUtfall: "godkjent", manglerSamtykke: ["inntekt"] }) === "allerede-godkjent",
  "en søknad som alt er avgjort skal ikke bli krever-samtykke fordi et samtykke siden er trukket");

check("eksisterende avvist søknad slår et positivt forhåndsresultat",
  velgTilgangsstatus({ eksisterendeUtfall: "avvist", sjekkutfall: "godkjent" }) === "allerede-avvist");

check("manglende samtykke slår et forhåndsresultat",
  velgTilgangsstatus({ manglerSamtykke: ["politiattest"], sjekkutfall: "avvist" }) === "krever-samtykke",
  "uten samtykke er sjekkutfall ikke noe å stole på i utgangspunktet");

check("tom liste med manglende samtykker teller ikke som manglende samtykke",
  velgTilgangsstatus({ manglerSamtykke: [], sjekkutfall: "avvist" }) === "ikke-aktuell");

// --- kombinerAlternativstatuser: politiattest-oppdrags rollevalg -------------
// Vandelskontrollen avhenger av hvilken rolle innbyggeren velger (rolle er ikke
// kjent før søknaden er påbegynt), så tilgangsoversikt.ts prøver alle rollene
// og slår sammen resultatene med denne funksjonen.

check("ett tilgjengelig alternativ holder, selv om et annet er utelukket",
  kombinerAlternativstatuser(["ikke-aktuell", "tilgjengelig", "ikke-aktuell"]) === "tilgjengelig",
  "person-137: utelukket for barnehage, men ikke for stottekontakt - skal ikke se stengt ute");

check("alle alternativer ikke-aktuell gir ikke-aktuell",
  kombinerAlternativstatuser(["ikke-aktuell", "ikke-aktuell", "ikke-aktuell"]) === "ikke-aktuell");

check("krever-samtykke slår ikke-aktuell når intet alternativ er tilgjengelig",
  kombinerAlternativstatuser(["krever-samtykke", "ikke-aktuell"]) === "krever-samtykke",
  "samtykket mangler for alle roller siden datakilden er den samme uansett rolle");

check("tilgjengelig slår krever-samtykke",
  kombinerAlternativstatuser(["krever-samtykke", "tilgjengelig"]) === "tilgjengelig");

check("ingen alternativer å prøve gir tilgjengelig - vi utelukker ikke uten grunnlag",
  kombinerAlternativstatuser([]) === "tilgjengelig");

// --- report -------------------------------------------------------------------
if (feil.length > 0) {
  console.error(`test-tilgangsstatus: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-tilgangsstatus ok. ${bestatt} sjekker, uten stack og uten modell.`);
