/*
 * This service's SvarUt client: send the kvittering, and read back the status of
 * one forsendelse.
 *
 * SvarUt is behind its own Maskinporten scope — sending a letter to a citizen is
 * not the same authority as reading their income — so it gets its own token
 * config, like the register and dialog surfaces before it (see config.ts).
 *
 * Both calls hand their fetch to upstream.ts rather than reading `ok`
 * themselves. They read the result differently on purpose: sending is best
 * effort, because a søknad must never be lost to a downstream queue, while the
 * status read is an ordinary read and raises a 502 the same way the matrikkel
 * lookups do.
 */

import { maskinportenHeader } from "../../digdir-mock/src/client.ts";
import { fiksBaseUrl, fiksSvarutToken, svarutKontoId } from "./config.ts";
import { buildKvitteringKropp } from "./kvittering.ts";
import type { Person } from "../../shared/innbyggerdata.ts";
import { buildAdvarsel, callUpstream, tryUpstream, type Advarsel } from "./upstream.ts";

const forsendelserUrl = `${fiksBaseUrl}/svarut/api/v2/kontoer/${svarutKontoId}/forsendelser`;

/** What SvarUt answers a send with: the id, and nothing else. */
export type Kvitteringssvar = { id?: string; syntetisk?: boolean };

export type Kvitteringsutfall =
  | { ok: true; svar: Kvitteringssvar }
  | { ok: false; advarsel: Advarsel };

const KVITTERING_FEILET = "Kvitteringen ble ikke sendt på SvarUt. Søknaden er lagret.";

/**
 * Best effort, the same shape and for the same reason as the Fiks task in
 * createSoknad: the søknad is already recorded, and the citizen is not made to
 * send it again because a receipt could not go out. Every failure degrades the
 * one way — fiks down, a scope mistake, or a recipient SvarUt cannot reach on
 * any channel (a protected address with no digital channel is exactly that, and
 * lands here as a 400).
 */
export async function sendKvittering(
  person: Person | null,
  soknadId: string,
  prosessNavn?: string
): Promise<Kvitteringsutfall> {
  // A søknad whose person is not in state has no recipient, and that degrades
  // like every other failure rather than skipping the attempt silently. Leaving
  // the field off would make «we could not send it» indistinguishable from «no
  // kvittering was ever asked for» — the exact two-answers-for-one-failure the
  // Fiks task's comment in prosess.ts says must not come back.
  if (!person) {
    return {
      ok: false,
      advarsel: buildAdvarsel(
        KVITTERING_FEILET,
        "Fant ikke personen søknaden gjelder, så forsendelsen har ingen mottaker."
      )
    };
  }
  const svar = await tryUpstream<Kvitteringssvar>(
    { service: "Fiks-simulatoren", action: "Å sende kvitteringen på SvarUt" },
    async () => fetch(forsendelserUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await maskinportenHeader(fiksSvarutToken))
      },
      body: JSON.stringify(buildKvitteringKropp(person, soknadId, prosessNavn))
    })
  );
  if (!svar.ok) {
    return { ok: false, advarsel: buildAdvarsel(KVITTERING_FEILET, svar.error.message) };
  }
  // A body-less 200 cannot happen on this route, but `data` is T | null for every
  // upstream call — an empty answer is an answer — so it is read as no id rather
  // than asserted away.
  return { ok: true, svar: svar.data ?? {} };
}

/*
 * The record SvarUt answers with. Named for the whole answer rather than for the
 * status alone: `Forsendelsesstatus` is the six-value kodeverk in
 * fiks-simulator/src/forsendelse.ts, and the OpenAPI keeps the same two names
 * apart the same way.
 */
export type Forsendelsesstatussvar = { id: string; status: string; sisteStatusEndring: string };

/**
 * The status of one forsendelse. SvarUt' surface is a bulk lookup that omits ids
 * it does not know rather than answering for them, so an empty list is the
 * unknown-id case and becomes a null here — the route turns that into a 404.
 */
export async function readForsendelsesstatus(forsendelseId: string): Promise<Forsendelsesstatussvar | null> {
  const data = await callUpstream<{ statuser?: Forsendelsesstatussvar[] }>(
    { service: "Fiks-simulatoren", action: "Å hente forsendelsesstatus" },
    async () => fetch(`${forsendelserUrl}/status-sok`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await maskinportenHeader(fiksSvarutToken))
      },
      body: JSON.stringify({ forsendelseIds: [forsendelseId] })
    })
  );
  return data?.statuser?.[0] ?? null;
}
