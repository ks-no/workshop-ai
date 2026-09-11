export type PolitiattestRolle = "stottekontakt" | "barnehage" | "skole";

const ROLLE_NAVN: Record<PolitiattestRolle, string> = {
  stottekontakt: "støttekontakt",
  barnehage: "barnehage",
  skole: "skole eller SFO"
};

const STILLING_NAVN: Record<PolitiattestRolle, string> = {
  stottekontakt: "Støttekontakt",
  barnehage: "Ansatt i barnehage",
  skole: "Skoleassistent"
};

export function erPolitiattestRolle(rolle: string): rolle is PolitiattestRolle {
  return rolle in ROLLE_NAVN;
}

export function navnForRolle(rolle: string): string {
  return erPolitiattestRolle(rolle) ? ROLLE_NAVN[rolle] : rolle;
}

export function stillingForRolle(rolle: string): string {
  return erPolitiattestRolle(rolle) ? STILLING_NAVN[rolle] : "Stilling med politiattest";
}
