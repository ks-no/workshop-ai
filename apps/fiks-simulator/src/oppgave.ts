/**
 * Oppgavens tilstandsmaskin.
 *
 * Same shape as samtykke, and for the same reason: an oppgave is a piece of
 * casework, and "ferdig" is not something that should be revocable by a second
 * PUT. No case in the sandbox drives an oppgave past OPPRETTET yet, so this is
 * mostly a surface for the workshop to build a saksbehandlerflate against.
 */

import { lagTilstandsmaskin } from "./tilstandsmaskin.ts";

export type Oppgavestatus = "OPPRETTET" | "UNDER_BEHANDLING" | "FERDIG" | "AVVIST";

// A case is rejected after someone has looked at it, not before — so AVVIST is
// reachable from UNDER_BEHANDLING only.
export const OPPGAVEOVERGANGER: Record<Oppgavestatus, Oppgavestatus[]> = {
  OPPRETTET: ["UNDER_BEHANDLING"],
  UNDER_BEHANDLING: ["FERDIG", "AVVIST"],
  FERDIG: [],
  AVVIST: []
};

const maskin = lagTilstandsmaskin<Oppgavestatus>("Oppgaven", OPPGAVEOVERGANGER);

export const OPPGAVESTATUSER = maskin.statuser;
export const erOppgavestatus = maskin.erStatus;
export const validerOppgaveovergang = maskin.validerOvergang;
