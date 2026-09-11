import type { Hjemmelvalg, Person } from "../types";
import {
  byggFormalsbevisClaims,
  byggPolitiattestClaims
} from "./credentialDefinitions";
import { stillingForRolle } from "../utils/roller";

export interface MetadataRad {
  label: string;
  verdi: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asText(value: unknown, fallback = "Ikke oppgitt"): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function personName(value: unknown): string {
  const person = asRecord(value);
  const name = [person["fornavn"], person["etternavn"]]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ");
  return name || "Ikke oppgitt";
}

export function formalsbevisRader(
  person: Person,
  hjemmelvalg?: Hjemmelvalg | null
): MetadataRad[] {
  return formalsbevisRaderFraClaims(byggFormalsbevisClaims(person, hjemmelvalg));
}

export function formalsbevisRaderFraClaims(
  claims: Record<string, unknown>
): MetadataRad[] {
  const holder = asRecord(claims["person"]);
  const rettsligGrunnlag = asRecord(claims["rettslig_grunnlag"]);
  return [
    { label: "Mottaker", verdi: personName(holder) },
    { label: "Fødselsnummer", verdi: asText(holder["foedselsnummer"]) },
    { label: "Formål i saken", verdi: asText(claims["rolle"]) },
    { label: "Stilling", verdi: stillingForRolle(asText(claims["rolle"], "")) },
    // Raden fra politiets formålsoversikt, slått opp i steg 0. Den er en annen ting enn
    // rollen over: rollen er sakens egen, denne er hjemmelen attesten kan kreves etter.
    { label: "Formål i politiets oversikt", verdi: asText(rettsligGrunnlag["formaal"]) },
    { label: "Attesttype", verdi: asText(rettsligGrunnlag["attesttype"]) },
    { label: "Hjemmel", verdi: asText(rettsligGrunnlag["hjemmel"]) }
  ];
}

export function politiattestRader(person: Person): MetadataRad[] {
  return politiattestRaderFraClaims(byggPolitiattestClaims(person));
}

export function politiattestInnholdRader(person: Person): MetadataRad[] {
  const claims = byggPolitiattestClaims(person);
  const rows = politiattestRaderFraClaims(claims);
  const count = Number(claims["antall_anmerkninger"]);
  return [
    ...rows.filter((row) => row.label !== "Detaljer om anmerkninger"),
    {
      label: "Anmerkninger i beviset",
      verdi: count === 0 ? "Ingen" : `${count} registrert`
    }
  ];
}

export function politiattestRaderFraClaims(
  claims: Record<string, unknown>
): MetadataRad[] {
  const holder = asRecord(claims["innehaver"]);
  return [
    { label: "Attest-ID", verdi: asText(claims["attest_id"]) },
    { label: "Mottaker", verdi: personName(holder) },
    { label: "Fødselsnummer", verdi: asText(holder["foedselsnummer"]) },
    { label: "Attesttype", verdi: asText(claims["attesttype"]) },
    { label: "Formål", verdi: asText(claims["formaal"]) },
    { label: "Utstedt", verdi: asText(claims["issuance_date"]) },
    { label: "Gyldig til", verdi: asText(claims["expiry_date"]) },
    { label: "Antall anmerkninger", verdi: asText(claims["antall_anmerkninger"]) },
    { label: "Detaljer om anmerkninger", verdi: "Deles ikke" }
  ];
}
