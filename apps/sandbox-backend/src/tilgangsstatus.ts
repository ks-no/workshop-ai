// Den rene klassifiseringen bak GET /api/personer/:personId/tilganger. Ren og
// synkron av samme grunn som vilkaar.ts: et utfall skal kunne pinnes med et
// literal-objekt og ingen kjørende tjenester. I/O-halvparten - å finne fram til
// hvilken søknad, hvilket samtykke og hvilket regelresultat som gjelder - hører
// hjemme i tilgangsoversikt.ts, som denne modulen ikke importerer.
import type { Sjekkutfall } from "./types.ts";
import type { Datakilde } from "../../shared/samtykke.ts";

export const TILGANGSSTATUSER = [
  "allerede-godkjent",
  "allerede-avvist",
  "til-manuell-vurdering",
  "krever-samtykke",
  "ikke-aktuell",
  "tilgjengelig"
] as const;
export type Tilgangsstatus = (typeof TILGANGSSTATUSER)[number];

export type TilgangsstatusInput = {
  /** Utfallet på siste innsendte søknad for saken, om en finnes. */
  eksisterendeUtfall?: Sjekkutfall;
  /** Datakilder regelen trenger samtykke til, som mangler i dag. */
  manglerSamtykke?: Datakilde[];
  /**
   * Utfallet av en forhåndskjøring av regelen, gjort uten at noen søknad er
   * sendt inn ennå. `til_manuell` her er ikke det samme som en søknad som venter
   * på saksbehandling - det betyr bare at regelen selv ville sendt saken videre
   * til et menneske, og derfor teller det som at brukeren kan søke.
   */
  sjekkutfall?: Sjekkutfall;
};

/**
 * Rekkefølgen er bærende: en eksisterende søknad er den mest bestemte
 * informasjonen vi har, og skal aldri overstyres av at et samtykke siden er
 * trukket. Mangler samtykke kommer før selve regelkjøringen, fordi vi da ikke
 * har grunnlag for å kjøre den i det hele tatt.
 */
export function velgTilgangsstatus(input: TilgangsstatusInput): Tilgangsstatus {
  if (input.eksisterendeUtfall === "godkjent") return "allerede-godkjent";
  if (input.eksisterendeUtfall === "avvist") return "allerede-avvist";
  if (input.eksisterendeUtfall === "til_manuell") return "til-manuell-vurdering";

  if (input.manglerSamtykke && input.manglerSamtykke.length > 0) return "krever-samtykke";

  if (input.sjekkutfall === "avvist") return "ikke-aktuell";
  return "tilgjengelig";
}

/**
 * Når et SJEKK-steg avhenger av et spørsmålssvar med et lukket sett alternativer
 * (f.eks. hvilken rolle en vandelskontroll gjelder), prøves hvert alternativ for
 * seg - se tilgangsoversikt.ts. Denne slår sammen dem til én status for saken:
 * ett alternativ som virker skal ikke gjemmes bort fordi et annet ikke gjør det,
 * og saken skal ikke se tilgjengelig ut når intet alternativ faktisk fører fram.
 */
export function kombinerAlternativstatuser(statuser: Tilgangsstatus[]): Tilgangsstatus {
  if (statuser.length === 0) return "tilgjengelig";
  if (statuser.includes("tilgjengelig")) return "tilgjengelig";
  if (statuser.includes("krever-samtykke")) return "krever-samtykke";
  return "ikke-aktuell";
}
