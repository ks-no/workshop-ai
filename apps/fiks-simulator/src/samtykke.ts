/**
 * Samtykkets kodeverk, tilstandsmaskin og utløp.
 *
 * Samtykke as rettslig grunnlag is what the sandbox exists to teach, so it cannot
 * at the same time be the loosest thing in the stack. Before this the status was
 * whatever string the caller happened to send: a TRUKKET samtykke could be
 * revived by answering it again, and `utloper` was written 30 days ahead and then
 * never read by anyone.
 *
 * The kodeverk was also split in three. `IKKE_SAMTYKKET` lived in tools-api
 * and demo-gui, `data/informasjonsmodeller.json` documented only three of the
 * statuses and never mentioned `UTLOEPT`. This module is the one kodeverk;
 * scripts/valider-data.js fails if the informasjonsmodell drifts from it.
 */

import { createTilstandsmaskin } from "./statemachine.ts";

export type Samtykkestatus =
  | "VENTER_PAA_SVAR"
  | "SAMTYKKET"
  | "IKKE_SAMTYKKET"
  | "TRUKKET"
  | "UTLOEPT";

/**
 * The only authority on what may follow what. Three of the five are final, and
 * that is the whole point: a samtykke the citizen said no to, withdrew, or let
 * expire is not a row you edit back into force — the municipality has to ask
 * again, and the new request gets its own id and its own trail.
 *
 * A VENTER_PAA_SVAR request deliberately does not expire: an unanswered request
 * grants nothing, so letting it lapse would only take away the citizen's chance
 * to answer late.
 */
export const SAMTYKKEOVERGANGER: Record<Samtykkestatus, Samtykkestatus[]> = {
  VENTER_PAA_SVAR: ["SAMTYKKET", "IKKE_SAMTYKKET"],
  SAMTYKKET: ["TRUKKET", "UTLOEPT"],
  IKKE_SAMTYKKET: [],
  TRUKKET: [],
  UTLOEPT: []
};

const maskin = createTilstandsmaskin<Samtykkestatus>("Samtykket", SAMTYKKEOVERGANGER);

export const SAMTYKKESTATUSER = maskin.statuses;
export const isSamtykkestatus = maskin.isStatus;
export const validateSamtykkeovergang = maskin.validateOvergang;

type Samtykkelignende = { status?: unknown; utloper?: unknown } | null | undefined;

/**
 * Whether `utloper` has passed. Says nothing about the status — see
 * `effektivStatus` for the two combined.
 *
 * `now` is a parameter so a test can pin the clock. It is not pinned in
 * production the way `alderVed()` pins age against `satser.gjelderFra`: a consent
 * really does expire in wall-clock time, and pinning that would be a lie. What
 * keeps `pnpm test:kontrakt` byte-identical instead is that every samtykke
 * created at runtime gets `utloper` 30 days out, so the dump never contains an
 * expired row at all.
 *
 * Parsed rather than compared as strings: a hand-written fixture may carry an
 * offset (`+02:00`) where toISOString() always produces `Z`, and those two do not
 * sort against each other.
 */
export function isUtloept(samtykke: Samtykkelignende, now: number = Date.now()): boolean {
  const utloper = Date.parse(String(samtykke?.utloper ?? ""));
  return Number.isFinite(utloper) && utloper <= now;
}

/**
 * The status the samtykke actually has now, with expiry applied.
 *
 * UTLOEPT is derived, not written: nothing runs on a timer here, so a stored
 * SAMTYKKET whose `utloper` has passed reads as UTLOEPT everywhere it is
 * answered for — the same way A2's masking is applied on the way out rather than
 * baked into the seed. The stored row and its `historikk` stay a factual record
 * of what the citizen did; expiry is something that happened to the consent, not
 * something anybody did.
 *
 * Every reader must go through this. Comparing `samtykke.status === "SAMTYKKET"`
 * directly is the bug this function exists to prevent.
 */
export function effektivStatus(samtykke: Samtykkelignende, now: number = Date.now()): string {
  const stored = String(samtykke?.status ?? "");
  return stored === "SAMTYKKET" && isUtloept(samtykke, now) ? "UTLOEPT" : stored;
}
