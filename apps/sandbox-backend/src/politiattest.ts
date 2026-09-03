import { maskinportenHeader } from "../../digdir-mock/src/client.ts";
import { politiattestBaseUrl, politiattestToken } from "./config.ts";
import { HttpError } from "./errors.ts";
import { findPerson } from "./state.ts";
import type { State } from "./types.ts";
import { callUpstream } from "./upstream.ts";
import { velgGjeldendeAttest, type Politiattest } from "../../shared/politiattest.ts";

// POLITIATTEST CLIENT
//
// politiattest-mock is the only reader of data/politiattester.json, and this
// backend reaches it over HTTP - the same arrangement as the matrikkel and the
// journal, and for the same reason.
//
// The integration is fiction, and apps/politiattest-mock/README.md says so. What
// is not fiction is the order it enforces: the consent gate in runRessurs() runs
// before anything in this file, because a straffedom is an artikkel 10-opplysning.

/**
 * Den gjeldende attesten for et formål, eller null.
 *
 * `emptyOn: [404]` gir «ingen attest» framfor «tjenesten er nede». Ingen
 * `relayStatus`: en attestflate som avviser maskintokenet vårt er vår
 * infrastruktur, ikke en dom å gi innbyggeren.
 */
export async function finnGjeldendeAttest(
  tilstand: State,
  personId: string,
  formaal: string
): Promise<Politiattest | null> {
  const person = findPerson(tilstand, personId);
  if (!person) {
    throw new HttpError("Fant ikke person.", 404);
  }
  const sti = `/attester?fnr=${encodeURIComponent(person.syntetiskFodselsnummer)}`
    + `&formaal=${encodeURIComponent(formaal)}`;
  const svar = await callUpstream<{ attester?: Politiattest[] }>(
    {
      service: "politiattestflaten",
      action: `Oppslaget mot ${sti}`,
      emptyOn: [404],
      hintWhenDown: `Kjører politiattest-mock på ${politiattestBaseUrl}?`
    },
    async () => fetch(`${politiattestBaseUrl}${sti}`, {
      headers: { ...(await maskinportenHeader(politiattestToken)) }
    })
  );
  return velgGjeldendeAttest(svar?.attester || [], formaal);
}

/**
 * Attesten slik en flate utenfor regelen får se den: at den finnes, hvilken type
 * den er, når den ble utstedt, og hvor mange anmerkninger den har - aldri hva de
 * gjelder.
 *
 * Skillet er ikke pedanteri. Svaret fra `DATA_FETCH` lagres på økten og går inn i
 * oppsummeringen, og oppsummeringen går til modellen og til state/ai-trace.jsonl.
 * En straffedom trenger ikke gjennom en modell for å bli formulert, og innbyggeren
 * har attesten selv. Regelen leser hele attesten; alle andre leser denne.
 */
export type Attestvisning = {
  attestId: string;
  formaal: string;
  attesttype: string;
  utstedt: string;
  antallAnmerkninger: number;
};

export function minimerAttest(attest: Politiattest | null): Attestvisning | null {
  if (!attest) return null;
  return {
    attestId: attest.attestId,
    formaal: attest.formaal,
    attesttype: attest.attesttype,
    utstedt: attest.utstedt,
    antallAnmerkninger: attest.anmerkninger.length
  };
}
