#!/usr/bin/env node

/*
 * Unit tests for apps/sandbox-backend/src/upstream.ts - the one reading of what a
 * non-ok answer from an upstream service means.
 *
 * Pure, and that is the point: `send` is a callback, so a Response can be handed
 * in as a literal. No port, no stack, no model, and no crypto - upstream.ts
 * imports only errors.ts, unlike regler.ts, which builds an RSA keypair at module
 * load.
 *
 * What this covers that nothing else can:
 *
 *  1. The failure paths themselves. `pnpm test:kontrakt` records the flows where
 *     upstream answers ok, so its dump is byte-identical across this refactor
 *     precisely because it never sees a 409, a 403 or an unreachable service.
 *     Every case below is a case the dump cannot reach.
 *  2. The two failure modes of one call being one answer. «Fiks said 403» and
 *     «Fiks is down» were two different things in createSoknad - one of them
 *     silence - and the shape of that fix is only visible here.
 *  3. Bodies that are not JSON. A gateway answering HTML made `svar.json()` throw
 *     a SyntaxError from inside the failure path, so the status the upstream
 *     actually sent never reached the caller. No seed data produces that.
 *  4. That the engine hands its fetches to the helper rather than reading a
 *     status itself. That is the structural half of the fix, and a text check is
 *     the only thing that can hold it.
 */

import { readFile } from "node:fs/promises";
import { callUpstream, tryUpstream } from "../apps/sandbox-backend/src/upstream.ts";
import { HttpError } from "../apps/sandbox-backend/src/errors.ts";

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

// The samtykke calls: the citizen's own request, so the upstream's verdict is
// their answer. Everything else in the engine is a consumer call.
const FIKS = { service: "Fiks-simulatoren", action: "Å opprette samtykke", relayStatus: true };
const BEREGNING = { service: "Fiks-simulatoren", action: "Beregningen av inntektsgrunnlaget" };

// `null` and not "" for a body-less status: the Response constructor rejects a
// body on 204, so an empty string would fail the fixture rather than the code.
function responds(status: number, body: string, contentType = "application/json") {
  return () => Promise.resolve(new Response(body || null, {
    status,
    headers: { "Content-Type": contentType }
  }));
}

function rejects(message: string) {
  return () => Promise.reject(Object.assign(new Error(message), { code: "ECONNREFUSED" }));
}

/** The HttpError callUpstream threw, or null if it returned. */
async function errorFrom(
  call: Parameters<typeof callUpstream>[0],
  send: Parameters<typeof callUpstream>[1]
) {
  try {
    await callUpstream(call, send);
    return null;
  } catch (thrown) {
    return thrown instanceof HttpError ? thrown : null;
  }
}

// --- the answer -------------------------------------------------------------
{
  const data = await callUpstream<any>(FIKS, responds(201, JSON.stringify({ samtykkeId: "samtykke-1" })));
  check("ok-svar gir kroppen", data?.samtykkeId === "samtykke-1", JSON.stringify(data));

  // 204 is an answer. Treating an empty body as a parse failure would turn a
  // successful call into a 502.
  const tomt = await callUpstream<any>(FIKS, responds(204, ""));
  check("tom kropp gir null, ikke feil", tomt === null, JSON.stringify(tomt));
}

// --- the upstream's verdict is passed through -------------------------------
{
  // The regression fiksSvar was written for: the samtykke state machine answers
  // 409 to a replayed svar, and that used to be stored as the step's result.
  const konflikt = await errorFrom(
    { service: "Fiks-simulatoren", action: "Å svare på samtykket", relayStatus: true },
    responds(409, JSON.stringify({ feil: "Samtykket er allerede besvart." }))
  );
  check("409 blir 409", konflikt?.status === 409, String(konflikt?.status));
  check("409 beholder Fiks sin melding", konflikt?.message === "Samtykket er allerede besvart.", konflikt?.message);
  check("feilkroppen er merket syntetisk", konflikt?.extra.syntetisk === true, JSON.stringify(konflikt?.extra));

  const uten = await errorFrom(FIKS, responds(403, JSON.stringify({ grunn: "mangler_hjemmel" })));
  check(
    "uten feil-felt får vi en melding som navngir tjenesten og forsøket",
    uten?.message === "Å opprette samtykke feilet i Fiks-simulatoren (status 403).",
    uten?.message
  );

  // Fiks answers a rejected beregning with a list; clients read it.
  const medListe = await errorFrom(FIKS, responds(400, JSON.stringify({
    feil: "Ugyldig forespørsel.",
    feilmeldinger: [{ kode: "MANGLER_AAR", melding: "inntektsaar mangler" }]
  })));
  check("feilmeldinger følger med", Array.isArray(medListe?.extra.feilmeldinger),
    JSON.stringify(medListe?.extra));
}

// --- without relayStatus the upstream's verdict stays upstream's ------------
{
  /*
   * The beregning is a consumer call: Fiks refusing our machine token is our
   * infrastructure problem, not the citizen's. Answering 403 for it would collide
   * with the 403 this backend already uses for «samtykke mangler» - the one status
   * on these routes that a client is documented to branch on.
   */
  const avvist = await errorFrom(BEREGNING, responds(403, JSON.stringify({ feil: "Mangler scope." })));
  check("403 uten relayStatus blir 502", avvist?.status === 502, String(avvist?.status));
  check("meldingen fra oppstrøms beholdes likevel", avvist?.message === "Mangler scope.", avvist?.message);

  const konflikt = await errorFrom(BEREGNING, responds(409, "{}"));
  check("409 uten relayStatus blir 502", konflikt?.status === 502, String(konflikt?.status));
}

// --- a 5xx upstream is our 502, not our 500 --------------------------------
{
  // «Intern feil i sandbox-backend» for a Fiks that broke named the wrong service.
  const nede = await errorFrom(FIKS, responds(500, JSON.stringify({ feil: "Databasen svarer ikke." })));
  check("500 fra oppstrøms blir 502", nede?.status === 502, String(nede?.status));
  check("meldingen er oppstrøms sin", nede?.message === "Databasen svarer ikke.", nede?.message);

  const nedeUtenKropp = await errorFrom(FIKS, responds(503, ""));
  check("503 uten kropp blir 502", nedeUtenKropp?.status === 502, String(nedeUtenKropp?.status));
}

// --- bodies that are not JSON ----------------------------------------------
{
  const html = `<!doctype html><title>502</title>${"x".repeat(400)}`;
  const proxy = await errorFrom(FIKS, responds(502, html, "text/html"));
  check("HTML-feilkropp gir 502 og ikke en SyntaxError", proxy?.status === 502, String(proxy?.status));
  check("HTML-feilkropp gir standardmeldingen",
    proxy?.message === "Å opprette samtykke feilet i Fiks-simulatoren (status 502).", proxy?.message);
  check("HTML-feilkropp forkortes i detalj",
    typeof proxy?.extra.detalj === "string" && (proxy.extra.detalj as string).length <= 201,
    String((proxy?.extra.detalj as string)?.length));

  // 200 with a body we cannot read is a broken upstream, not a step result.
  const rart = await errorFrom(FIKS, responds(200, "<html>ok?</html>", "text/html"));
  check("ok-svar som ikke er JSON blir 502", rart?.status === 502, String(rart?.status));
}

// --- no contact at all ------------------------------------------------------
{
  const borte = await errorFrom(
    { ...FIKS, hintWhenDown: "Kjører fiks-simulator?" },
    rejects("connect ECONNREFUSED 127.0.0.1:8081")
  );
  check("nede tjeneste blir 502", borte?.status === 502, String(borte?.status));
  check("meldingen sier at kontakten manglet",
    borte?.message === "Fikk ikke kontakt med Fiks-simulatoren. Å opprette samtykke ble ikke utført.",
    borte?.message);
  check("den underliggende feilen ligger i detalj",
    String(borte?.extra.detalj).includes("ECONNREFUSED"), String(borte?.extra.detalj));
  check("hintWhenDown blir hint", borte?.extra.hint === "Kjører fiks-simulator?",
    String(borte?.extra.hint));

  /*
   * `send` builds the request too, so a Maskinporten token that is refused throws
   * from in there. It is still a 502, but it must not claim we failed to reach
   * Fiks - naming the wrong service is the defect this module removed from
   * regler.ts, and it would be silly to reintroduce it one layer up. Only a
   * network-level error code gets the lost-contact sentence; maskinportenHeader
   * throws a plain Error with no `code`.
   */
  const utenToken = await errorFrom({ ...FIKS, hintWhenDown: "Kjører fiks-simulator?" }, async () => {
    throw new Error("Maskinporten ga 403: mangler scope ks:fiks:samtykke.");
  });
  check("avvist token er også 502", utenToken?.status === 502, String(utenToken?.status));
  check(
    "avvist token navngir ikke Fiks som utilgjengelig",
    utenToken?.message === "Å opprette samtykke ble ikke utført: Maskinporten ga 403: mangler scope ks:fiks:samtykke.",
    utenToken?.message
  );
  check("avvist token får ikke et hint om å starte Fiks", !("hint" in (utenToken?.extra || {})),
    JSON.stringify(utenToken?.extra));

  const utenHint = await errorFrom(FIKS, rejects("boom"));
  check("uten hintWhenDown er det ingen hint-nøkkel", !("hint" in (utenHint?.extra || {})),
    JSON.stringify(utenHint?.extra));
}

// --- emptyOn: a status that is an answer -----------------------------------
{
  const MATRIKKEL = {
    service: "matrikkeltjenesten",
    action: "Oppslaget mot /mock/matrikkel/gater?gate=Finnesikkegata",
    emptyOn: [404]
  };
  const ingenGate = await callUpstream<any>(MATRIKKEL, responds(404, JSON.stringify({ feil: "Fant ikke gaten." })));
  check("404 med emptyOn gir null", ingenGate === null, JSON.stringify(ingenGate));

  // Without emptyOn the same 404 is a failure. «No such street» and «the matrikkel
  // does not have that route» must not be the same answer.
  const uventet404 = await errorFrom(FIKS, responds(404, JSON.stringify({ feil: "Fant ikke ruten." })));
  check("404 uten emptyOn er en feil", uventet404?.status === 404, String(uventet404?.status));

  const nedeMedEmptyOn = await errorFrom(MATRIKKEL, rejects("ECONNREFUSED"));
  check("emptyOn skjuler ikke en nede tjeneste", nedeMedEmptyOn?.status === 502,
    String(nedeMedEmptyOn?.status));
}

// --- tryUpstream: best effort, one shape of degrading ----------------------
{
  // createSoknad's contract. Both failure modes must be *visible*, and neither
  // may throw: the søknad is already written when this runs.
  const OPPGAVE = { service: "Fiks-simulatoren", action: "Å opprette oppgave" };
  const avvist = await tryUpstream<unknown>(OPPGAVE, responds(403, JSON.stringify({ feil: "Mangler scope." })));
  const nede = await tryUpstream<unknown>(OPPGAVE, rejects("ECONNREFUSED"));
  check("403 gir et ikke-ok resultat i stedet for stillhet", avvist.ok === false, JSON.stringify(avvist));
  check("nede tjeneste gir et ikke-ok resultat", nede.ok === false, JSON.stringify(nede));
  check("begge feilmodene bærer en melding",
    !avvist.ok && !nede.ok && avvist.error.message.length > 0 && nede.error.message.length > 0);

  const ok = await tryUpstream<any>(OPPGAVE, responds(201, JSON.stringify({ oppgaveId: "oppgave-1" })));
  check("ok-resultat bærer dataene", ok.ok === true && ok.data.oppgaveId === "oppgave-1",
    JSON.stringify(ok));
}

// --- the structural half: no local variants left --------------------------
/*
 * Every fetch in the process engine is handed to upstream.ts, never awaited in
 * place. The four readings this replaced were each locally reasonable; the defect was
 * that there were four, and a diff is the wrong place to see that. The call
 * sites all read `() => fetch(...)` or `async () => fetch(...)`, so requiring the
 * arrow ahead of the call is enough to catch a fourth one being added.
 */
{
  const files = [
    "apps/sandbox-backend/src/prosess.ts",
    "apps/sandbox-backend/src/regler.ts",
    "apps/sandbox-backend/src/matrikkel.ts"
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const calls = [...source.matchAll(/fetch\(/g)];
    check(`${file.split("/").pop()} kaller fetch`, calls.length > 0, "ingen fetch - er kallet flyttet?");
    const readLocally = calls.filter((hit) => !/=>\s*$/.test(source.slice(0, hit.index)));
    check(
      `${file.split("/").pop()} gir hver fetch til upstream.ts`,
      readLocally.length === 0,
      `${readLocally.length} fetch-kall leses lokalt`
    );
    check(
      `${file.split("/").pop()} importerer upstream.ts`,
      /from "\.\/upstream\.ts"/.test(source)
    );
  }
}

// --- report ----------------------------------------------------------------
if (feil.length > 0) {
  console.error(`test-upstream: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-upstream ok. ${bestatt} sjekker, uten stack og uten modell.`);
