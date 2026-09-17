#!/usr/bin/env node

/*
 * Påkrevde spørreparametere på de to mockene, rute for rute.
 *
 * `fnr` er påkrevd fordi flaten aldri skal svare på et bulkoppslag, og `formaal`
 * fordi en attest gjelder for det formålet den ble utstedt til. Begge påstandene
 * sto i AGENTS.md og i README-ene, og ingen av dem hadde en sjekk: kravet manglet
 * en gang på id-ruten i begge tjenestene, og #68 rettet de to rutene uten å pinne
 * dem. Fjerner du `krevFnr` igjen, er `pnpm test`, `test:openapi`, `test:docs` og
 * `test:kontrakt` alle grønne.
 *
 * Rutelisten står ikke her. Den leses av spesifikasjonene, som er den listen
 * AGENTS.md sier eier feltnavnene - så en ny rute med et påkrevd parameter blir
 * dekket idet den dokumenteres, og en rute som slutter å kreve det blir rød.
 *
 * Kaller med gyldig Maskinporten-token hele veien: det som prøves her er
 * parametervakten, ikke tokenvakten, og et 401 ville sett ut som et bestått krav.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { maskinportenHeader } from "../apps/digdir-mock/src/client.ts";
import { routeOverview } from "../apps/shared/openapi.ts";
import { feilkode } from "../apps/shared/errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digdirPort = Number(process.env.PARAM_DIGDIR_PORT) || 18097;
const digdirUrl = `http://127.0.0.1:${digdirPort}`;

type Tjeneste = {
  navn: string;
  fil: string;
  spesifikasjon: string;
  port: number;
  portVariabel: string;
  scope: string;
  /*
   * Rutene som skal ha et påkrevd spørreparameter, pinnet.
   *
   * Uten dette er spesifikasjonen både orakel og fasit: snur du `required: true`
   * til `false` på én rute, faller den ut av det testen dekker, søskenruten holder
   * `dekkedeRuter > 0` i live, og testen svarer «ok» med et lavere tall. Det er
   * nøyaktig regresjonen filen finnes for - #68 rørte både kode og spesifikasjon.
   */
  dekkerRuter: string[];
};

const tjenester: Tjeneste[] = [
  {
    navn: "pasientjournal-mock",
    fil: "apps/pasientjournal-mock/src/server.ts",
    spesifikasjon: "openapi/pasientjournal-mock.yaml",
    port: Number(process.env.PARAM_JOURNAL_PORT) || 18098,
    portVariabel: "PARAM_JOURNAL_PORT",
    scope: "pasientjournal:legeerklaering.read",
    dekkerRuter: [
      "/journal/legeerklaeringer",
      "/journal/legeerklaeringer/{erklaeringId}"
    ]
  },
  {
    navn: "politiattest-mock",
    fil: "apps/politiattest-mock/src/server.ts",
    spesifikasjon: "openapi/politiattest-mock.yaml",
    port: Number(process.env.PARAM_ATTEST_PORT) || 18099,
    portVariabel: "PARAM_ATTEST_PORT",
    scope: "politiattest:attest.read",
    dekkerRuter: ["/attester", "/attester/{attestId}"]
  },
  {
    navn: "fiks-simulator",
    fil: "apps/fiks-simulator/src/server.ts",
    spesifikasjon: "openapi/fiks-simulator.yaml",
    port: Number(process.env.PARAM_FIKS_PORT) || 18101,
    portVariabel: "PARAM_FIKS_PORT",
    scope: "ks:fiks:varsel",
    dekkerRuter: ["/fiks/varselkanal"]
  }
];

/*
 * Tjenestene som ikke er med, og hvorfor. Erklært framfor utelatt: en flate med
 * påkrevde parametere som bare mangler fra listen over ville vært en usjekket
 * flate ingen la merke til, og det er den feilformen denne testen finnes for.
 */
const utenfor: Record<string, string> = {
  "digdir-mock.yaml": "client_id og redirect_uri på /idporten/authorize er OAuth-protokoll, "
    + "ikke en vakt mot bulkoppslag.",
  "matrikkel-mock.yaml": "wsdl er en SOAP-konvensjon, og adresse er selve oppslagsnøkkelen. "
    + "Matrikkelen er ikke persondata bak et token.",
  "sandbox-backend.yaml": "Krever fiks, digdir og begge mockene oppe, med ekte personId-er og "
    + "et ID-porten-token - altså kontraktstestens vekt. formaal på "
    + "/api/personer/{personId}/politiattest er påkrevd av samme grunn som her, "
    + "og hører hjemme i en av de to testene. Se TODO.md."
};

let bestatt = 0;
const feil: string[] = [];

function check(navn: string, betingelse: unknown, detalj = ""): void {
  if (betingelse) {
    bestatt += 1;
    return;
  }
  feil.push(`${navn}${detalj ? ` - ${detalj}` : ""}`);
}

async function requireFreePort(portnummer: number, variabel: string) {
  await new Promise((klar, avvis) => {
    const proeve = createServer();
    proeve.once("error", (aarsak: unknown) => avvis(
      feilkode(aarsak) === "EADDRINUSE"
        ? new Error(`Port ${portnummer} er opptatt. Sett ${variabel} til en ledig port.`)
        : aarsak
    ));
    proeve.listen(portnummer, "127.0.0.1", () => proeve.close(klar));
  });
}

async function waitForHealth(url: string, navn: string, tidsfrist = 15000) {
  const innen = Date.now() + tidsfrist;
  while (Date.now() < innen) {
    try {
      const svar = await fetch(`${url}/helse`);
      if (svar.ok) return;
    } catch {
      // Tjenesten er ikke oppe ennå. Prøv igjen.
    }
    await new Promise((klar) => setTimeout(klar, 150));
  }
  throw new Error(`${navn} ble ikke klar innen ${tidsfrist} ms.`);
}

function start(navn: string, fil: string, port: number, stateDir: string) {
  const prosess = spawn(process.execPath, [path.join(repoRoot, fil)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      STATE_DIR: stateDir,
      DIGDIR_BASE_URL: digdirUrl,
      DIGDIR_ISSUER: digdirUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  prosess.stdout.on("data", () => {});
  prosess.stderr.on("data", (chunk) => process.stderr.write(`[${navn}] ${chunk}`));
  return prosess;
}

/** Stien med path-parameterne fylt ut, og de oppgitte spørreparameterne på. */
function byggSti(sti: string, path: Record<string, string>, spoerring: Record<string, string>) {
  const utfylt = Object.entries(path)
    .reduce((sti, [navn, verdi]) => sti.replace(`{${navn}}`, encodeURIComponent(verdi)), sti);
  const sok = new URLSearchParams(spoerring).toString();
  return sok ? `${utfylt}?${sok}` : utfylt;
}

async function proevTjeneste(tjeneste: Tjeneste) {
  const basis = `http://127.0.0.1:${tjeneste.port}`;
  const header = await maskinportenHeader({
    digdirBaseUrl: digdirUrl,
    issuer: digdirUrl,
    clientId: "test-paakrevde-parametere",
    scope: tjeneste.scope,
    resource: tjeneste.navn
  });

  const oversikt = await routeOverview(path.join(repoRoot, tjeneste.spesifikasjon));
  const dekkedeRuter: string[] = [];

  for (const rute of oversikt.ruter) {
    const paakrevde = (rute.parametere || []).filter((parameter) => parameter.paakrevd);
    if (!paakrevde.some((parameter) => parameter.plassering === "query")) continue;
    dekkedeRuter.push(rute.sti);

    // Verdiene er `example:` fra spesifikasjonen, ikke en kopi her. Et påkrevd
    // parameter uten eksempel er en spesifikasjon utforskeren heller ikke kan
    // skrive en curl av, så det er en feil og ikke noe å hoppe over.
    const manglerEksempel = paakrevde.filter((parameter) => !parameter.eksempel);
    for (const parameter of manglerEksempel) {
      check(`${tjeneste.spesifikasjon} ${rute.sti} har example for ${parameter.navn}`, false,
        "påkrevd parameter uten example");
    }
    if (manglerEksempel.length > 0) continue;

    const iSti = Object.fromEntries(paakrevde
      .filter((parameter) => parameter.plassering === "path")
      .map((parameter) => [parameter.navn, parameter.eksempel!]));
    const alle = Object.fromEntries(paakrevde
      .filter((parameter) => parameter.plassering === "query")
      .map((parameter) => [parameter.navn, parameter.eksempel!]));

    for (const navn of Object.keys(alle)) {
      const { [navn]: _utelatt, ...mangler } = alle;
      const svar = await fetch(`${basis}${byggSti(rute.sti, iSti, mangler)}`, { headers: header });
      check(
        `${tjeneste.navn} ${rute.metode} ${rute.sti} uten ${navn} svarer 400`,
        svar.status === 400,
        `status ${svar.status}`
      );
    }

    // Med alle eksemplene på plass skal ruten svare, ikke bare komme forbi vakten.
    // 200 og ikke «ikke 400»: eksempelverdiene er det API-utforskeren fyller inn og
    // det README-ene curler, og et fnr som tilhørte feil datasett ga en tom liste og
    // en 404 uten at noe sa fra.
    const helt = await fetch(`${basis}${byggSti(rute.sti, iSti, alle)}`, { headers: header });
    const kropp = await helt.text();
    check(
      `${tjeneste.navn} ${rute.metode} ${rute.sti} svarer på sine egne eksempelverdier`,
      helt.status === 200,
      `status ${helt.status}: ${kropp.slice(0, 120)}`
    );
    // Bare på samleruter, og bare listene på toppnivå. En id-rute svarer med objektet
    // selv, og en tom `anmerkninger` der er riktig svar for en person uten merknad -
    // mens en tom trefliste betyr at eksempelverdien ikke finnes i datasettet, som var
    // nettopp feilen her: attestflatens eksempel-fnr tilhørte journalmocken.
    if (helt.status === 200 && Object.keys(iSti).length === 0) {
      const tomme = Object.entries(JSON.parse(kropp) as Record<string, unknown>)
        .filter(([, verdi]) => Array.isArray(verdi) && verdi.length === 0)
        .map(([navn]) => navn);
      check(
        `${tjeneste.navn} ${rute.metode} ${rute.sti} finner noe med sine egne eksempelverdier`,
        tomme.length === 0,
        `tom: ${tomme.join(", ")}`
      );
    }
  }

  // Settet, ikke tellingen: en rute som mister `required: true` forsvinner ellers
  // stille ut av dekningen mens søskenruten holder tallet over null.
  const forventet = [...tjeneste.dekkerRuter].sort().join(", ");
  check(
    `${tjeneste.navn} dekker de rutene den skal`,
    [...dekkedeRuter].sort().join(", ") === forventet,
    `dekket: ${[...dekkedeRuter].sort().join(", ") || "(ingen)"} | forventet: ${forventet}`
  );
}

/*
 * Hver spesifikasjon med et påkrevd spørreparameter er enten dekket over eller
 * erklært i `utenfor`. Uten dette sier testen ingenting om flatene den ikke kjenner.
 */
async function krevAlleFlaterVurdert() {
  const dekket = new Set(tjenester.map((tjeneste) => path.basename(tjeneste.spesifikasjon)));
  for (const fil of (await readdir(path.join(repoRoot, "openapi"))).filter((f) => f.endsWith(".yaml"))) {
    if (dekket.has(fil) || utenfor[fil]) continue;
    const oversikt = await routeOverview(path.join(repoRoot, "openapi", fil));
    const harPaakrevd = oversikt.ruter.some((rute) =>
      (rute.parametere || []).some((p) => p.paakrevd && p.plassering === "query"));
    check(`${fil} er enten dekket eller erklært utenfor`, !harPaakrevd,
      "spesifikasjonen har påkrevde spørreparametere som ingen test kaller uten");
  }
}

// --- kjør --------------------------------------------------------------------

await requireFreePort(digdirPort, "PARAM_DIGDIR_PORT");
for (const tjeneste of tjenester) {
  await requireFreePort(tjeneste.port, tjeneste.portVariabel);
}

const stateDir = await mkdtemp(path.join(tmpdir(), "param-test-"));
const prosesser = [
  start("digdir-mock", "apps/digdir-mock/src/server.ts", digdirPort, stateDir),
  ...tjenester.map((tjeneste) => start(tjeneste.navn, tjeneste.fil, tjeneste.port, stateDir))
];

try {
  await waitForHealth(digdirUrl, "digdir-mock");
  for (const tjeneste of tjenester) {
    await waitForHealth(`http://127.0.0.1:${tjeneste.port}`, tjeneste.navn);
    await proevTjeneste(tjeneste);
  }
  await krevAlleFlaterVurdert();
} finally {
  for (const prosess of prosesser) prosess.kill("SIGTERM");
  await rm(stateDir, { recursive: true, force: true });
}

if (feil.length > 0) {
  console.error(`test-paakrevde-parametere: ${feil.length} av ${bestatt + feil.length} sjekker feilet.`);
  for (const linje of feil) console.error(`  - ${linje}`);
  process.exit(1);
}
console.log(`test-paakrevde-parametere ok. ${bestatt} sjekker mot spesifikasjonene, uten stack.`);
