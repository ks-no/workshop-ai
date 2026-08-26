import { feilmelding } from "../../shared/errors.ts";
import { updateJson } from "../../shared/jsonstore.ts";
import { newId } from "./state.ts";

// This service is the only writer of the audit log - fiks-simulator posts its
// events to /api/revisjonslogg rather than touching the file.
//
// The read-modify-write runs inside the shared write queue, so concurrent
// requests cannot interleave and drop each other's events.

export async function addRevisjon(hendelse: Record<string, unknown>) {
  try {
    await updateJson("revisjonslogg.json", [], (revisjonslogg: Record<string, unknown>[]) => {
      revisjonslogg.push({
        hendelseId: newId("revisjon"),
        tidspunkt: new Date().toISOString(),
        syntetisk: true,
        ...hendelse
      });
    });
  } catch (feil) {
    // Swallowed on purpose, and the one writer that does: logging must never
    // break the operation it logs. Everything else lets the error reach the
    // caller - see updateJson.
    console.warn(`Kunne ikke skrive revisjonslogg: ${feilmelding(feil)}`);
  }
}
