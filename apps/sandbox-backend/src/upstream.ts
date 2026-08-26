import { feilkode, feilmelding } from "../../shared/errors.ts";
import { HttpError } from "./errors.ts";

/*
 * WHAT AN UPSTREAM SERVICE'S NON-OK ANSWER MEANS
 *
 * The process engine calls the Fiks simulator, the AI gateway and the matrikkel
 * mock over HTTP, and this module is the one place that decides what a failure
 * is. Every fetch out of the engine goes through it, and what a call site may
 * still declare is *which upstream relationship it is in* — never a second
 * reading of the same status.
 */

export type UpstreamCall = {
  /** The upstream, named the way a Norwegian message should name it: "Fiks-simulatoren". */
  service: string;
  /** What the call was for, as the subject of that message: "Å opprette samtykke". */
  action: string;
  /**
   * Whether the upstream's own verdict on this request is our caller's answer.
   *
   * On the samtykke calls it is: the citizen asked to create or answer a samtykke,
   * and the state machine's 409 or 403 is the response to *their* request. On the
   * beregning and the matrikkel lookups it is not: there we are the consumer,
   * fetching data to make our own decision, and Fiks refusing our machine token
   * is our infrastructure problem rather than the citizen's verdict. Answering
   * 403 for it would collide with the 403 this backend already uses for
   * «samtykke mangler» — two meanings, one status.
   */
  relayStatus?: boolean;
  /** Statuses that are an answer rather than a failure. Each of them yields null. */
  emptyOn?: number[];
  /** Set as `hint` on the error body when the service could not be reached at all. */
  hintWhenDown?: string;
};

export type UpstreamResult<T> =
  | { ok: true; data: T | null }
  | { ok: false; error: HttpError };

/**
 * The one shape a best-effort call degrades into. What a failure *means* is
 * decided here, so what a caller that survives it *answers* belongs here too.
 * Only `advarsel` is the caller's, because only the caller knows what was
 * attempted; `detalj` is the reason and `syntetisk` is never anything else.
 */
export type Advarsel = { advarsel: string; detalj: string; syntetisk: true };

export function buildAdvarsel(melding: string, detalj: string): Advarsel {
  return { advarsel: melding, detalj, syntetisk: true };
}

/**
 * Call an upstream service and get its answer, or an HttpError describing why
 * there is none. Nothing is thrown: the caller decides whether a failure ends the
 * request (`callUpstream`) or degrades into an advarsel.
 *
 * `send` is a callback rather than a URL and a RequestInit because building the
 * request can fail too — every Fiks call fetches a Maskinporten token first, and a
 * token that is refused must not be reported as the Fiks call itself failing.
 *
 * `data` is `T | null` and not `T`: an empty body is an answer, and so is every
 * status listed in `emptyOn`.
 */
export async function tryUpstream<T>(
  call: UpstreamCall,
  send: () => Promise<Response>
): Promise<UpstreamResult<T>> {
  let response: Response;
  try {
    response = await send();
  } catch (error) {
    return { ok: false, error: sendFailed(call, error) };
  }

  if (call.emptyOn?.includes(response.status)) {
    return { ok: true, data: null };
  }

  const body = await readBody(response);

  if (!response.ok) {
    return {
      ok: false,
      error: new HttpError(
        (body.json && body.data?.feil) || defaultMessage(call, response.status),
        mapStatus(call, response.status),
        {
          // Fiks answers a rejected request with a list of feilmeldinger, and
          // clients already read it. Passed through when it is there.
          ...(body.json && body.data?.feilmeldinger ? { feilmeldinger: body.data.feilmeldinger } : {}),
          ...(body.json ? {} : { detalj: shortened(body.text) }),
          syntetisk: true
        }
      )
    };
  }

  if (!body.json) {
    return {
      ok: false,
      error: new HttpError(
        `${call.service} svarte ${response.status} med noe annet enn JSON. ${call.action} kan ikke tolkes.`,
        502,
        { detalj: shortened(body.text), syntetisk: true }
      )
    };
  }

  return { ok: true, data: body.data as T };
}

/** The upstream's answer, or its failure raised as ours. */
export async function callUpstream<T>(
  call: UpstreamCall,
  send: () => Promise<Response>
): Promise<T | null> {
  const result = await tryUpstream<T>(call, send);
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
}

/*
 * Nothing came back. Two different things reach here, and only one of them is the
 * service being unreachable: `send` also builds the request, and a Maskinporten
 * token that is refused throws from in there. Claiming lost contact with Fiks for
 * a 403 from the token endpoint would name the wrong service, so only a
 * network-level error code gets that sentence. Anything else reports the attempt
 * and hands the reason on.
 */
function sendFailed(call: UpstreamCall, error: unknown) {
  const nettverksfeil = feilkode(error) !== undefined;
  return new HttpError(
    nettverksfeil
      ? `Fikk ikke kontakt med ${call.service}. ${call.action} ble ikke utført.`
      : `${call.action} ble ikke utført: ${feilmelding(error)}`,
    502,
    {
      detalj: feilmelding(error),
      ...(nettverksfeil && call.hintWhenDown ? { hint: call.hintWhenDown } : {}),
      syntetisk: true
    }
  );
}

function defaultMessage(call: UpstreamCall, status: number) {
  return `${call.action} feilet i ${call.service} (status ${status}).`;
}

/*
 * A 4xx is passed through where the call declared that the upstream's verdict is
 * our caller's answer; everything else is 502. A 5xx is the upstream itself
 * failing, and answering 500 for it would name the wrong service: 502 says the
 * call *out of* here is what broke.
 */
function mapStatus(call: UpstreamCall, status: number) {
  return call.relayStatus && status >= 400 && status < 500 ? status : 502;
}

/*
 * Read the body once, then decide. `response.json()` on a body that is not JSON —
 * a gateway answering HTML, a proxy answering nothing — throws a SyntaxError from
 * inside the failure path, so the status the upstream actually sent never reaches
 * the caller. An empty body counts as JSON null: 204 is an answer.
 */
type Body = { json: true; data: any } | { json: false; text: string };

async function readBody(response: Response): Promise<Body> {
  const text = await response.text();
  if (!text.trim()) {
    return { json: true, data: null };
  }
  try {
    return { json: true, data: JSON.parse(text) };
  } catch {
    return { json: false, text };
  }
}

// An upstream that answers HTML answers a whole page of it, and the error body is
// read by a human in a browser.
function shortened(text: string) {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}
