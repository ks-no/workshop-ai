import { maskinportenHeader } from "../../digdir-mock/src/client.ts";
import { pasientjournalBaseUrl, pasientjournalToken } from "./config.ts";
import { HttpError } from "./errors.ts";
import { findPerson } from "./state.ts";
import type { State } from "./types.ts";
import { callUpstream } from "./upstream.ts";
import {
  velgGjeldendeLegeerklaering,
  type Legeerklaering
} from "../../shared/legeerklaering.ts";

// PASIENTJOURNAL CLIENT
//
// One journal in the sandbox: pasientjournal-mock is the only reader of
// data/legeerklaeringer.json, and this backend reaches it over HTTP - the same
// arrangement as the matrikkel, and for the same reason.
//
// The integration is fiction, and apps/pasientjournal-mock/README.md says so. What
// is not fiction is the order it enforces here: the consent gate in runRessurs()
// runs before anything in this file, because a legeerklæring is a særlig kategori.

/**
 * Den gjeldende legeerklæringen til en person, eller null.
 *
 * `emptyOn: [404]` er der for en mock som svarer 404 framfor tom liste - da blir det
 * «ingen erklæring» og ikke «journalen er nede». Ingen `relayStatus`: en journal som
 * avviser maskintokenet vårt er vår infrastruktur, ikke en dom å gi innbyggeren.
 */
export async function finnGjeldendeLegeerklaering(
  tilstand: State,
  personId: string,
  paaDato: string
): Promise<Legeerklaering | null> {
  const person = findPerson(tilstand, personId);
  if (!person) {
    throw new HttpError("Fant ikke person.", 404);
  }
  const sti = `/journal/legeerklaeringer?fnr=${encodeURIComponent(person.syntetiskFodselsnummer)}`;
  const svar = await callUpstream<{ legeerklaeringer?: Legeerklaering[] }>(
    {
      service: "pasientjournalen",
      action: `Oppslaget mot ${sti}`,
      emptyOn: [404],
      hintWhenDown: `Kjører pasientjournal-mock på ${pasientjournalBaseUrl}?`
    },
    async () => fetch(`${pasientjournalBaseUrl}${sti}`, {
      headers: { ...(await maskinportenHeader(pasientjournalToken)) }
    })
  );
  return velgGjeldendeLegeerklaering(svar?.legeerklaeringer || [], paaDato);
}
