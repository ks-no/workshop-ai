/**
 * Rangeringen som gjør ordsøket om til et svar.
 *
 * Modellen får ikke lov til å skrive en hjemmel. Den får kandidatene fra ordsøket og
 * velger blant dem, ved id - så det som kommer ut er alltid en hjemmel som står i
 * politiets oversikt, ordrett. En språkmodell som formulerer lovhenvisninger fritt er
 * nettopp det en hjemmel ikke tåler.
 *
 * Modellen kjører i Telenor AI Factory, som snakker OpenAI-dialekten gjennom LiteLLM.
 * Kallet går rett dit og ikke via `ai-gateway`, som ellers eier modellkallene i
 * sandkassen: gatewayens endepunkter er ett per oppgave, med hver sin maltekst, og
 * denne oppgaven er ikke ett av dem. Prisen er at rangeringen ikke havner i KI-sporet -
 * se «Videre herfra» i README-en. Miljøvariablene er med vilje de samme som gatewayens
 * `telenor-ai-factory`-provider bruker, så nøkkelen settes ett sted.
 */

import { randomUUID } from "node:crypto";

import type { Kandidat } from "./formaal.ts";

const BASE_URL = (
  process.env.TELENOR_AI_FACTORY_BASE_URL || "https://litellm.apps.s99ct03.aifactory.telenor.com"
).replace(/\/+$/, "");
const API_NØKKEL = process.env.TELENOR_AI_FACTORY_API_KEY || "";
const MODELL = process.env.TELENOR_AI_FACTORY_MODEL || "NVIDIA-Nemotron-3-Super-120B-A12B-FP8";
const TIDSAVBRUDD = Number(process.env.TELENOR_AI_FACTORY_TIMEOUT_MS) || 60000;

/**
 * AI Factory anbefaler et salt på hvert kall, så denne tjenesten ikke deler KV-cache med
 * andre som treffer det samme endepunktet. Uten en verdi i miljøet lager vi ett ved
 * oppstart: en tilfeldig verdi er tryggere enn ingen, og den holder seg lik så lenge
 * prosessen lever, slik at cachen faktisk får virke innenfor én kjøring.
 */
const CACHE_SALT = process.env.TELENOR_AI_FACTORY_CACHE_SALT || randomUUID();

const SYSTEM = `Du er saksbehandler i en norsk kommune og skal finne hjemmelen en politiattest
kreves etter. Du får en kort beskrivelse av hva attesten skal brukes til, og en nummerert
liste over formål fra politiets offisielle oversikt.

Velg de formålene som faktisk passer beskrivelsen, høyest relevans først. Svar bare med
id-er fra lista. Finner du ingen som passer, svarer du med en tom liste - det er et bedre
svar enn et formål som ikke stemmer. Begrunnelsen skal være én kort setning på norsk.

Svar med JSON og ingenting annet, på formen:
{"treff": [{"id": "<id fra lista>", "begrunnelse": "<én setning>"}]}`;

/**
 * Struktur på svaret.
 *
 * Skjemaet sendes som `response_format` slik OpenAI-dialekten vil ha det. `strict` krever
 * at hvert objekt har `additionalProperties: false` og at alle felt står i `required` -
 * ellers avviser tjenesten skjemaet i stedet for å håndheve det.
 */
const SKJEMA = {
  type: "object",
  properties: {
    treff: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          begrunnelse: { type: "string" },
        },
        required: ["id", "begrunnelse"],
        additionalProperties: false,
      },
    },
  },
  required: ["treff"],
  additionalProperties: false,
};

/**
 * Over dette antallet kandidater faller «gjelder» ut av lista.
 *
 * Den lange beskrivelsen er det som skiller to formål som ligner, så den skal være med
 * når ordsøket har snevret inn. Men når hele oversikten sendes - fordi ordsøket ikke fant
 * noe - ville 164 beskrivelser gjort ledeteksten fem ganger så lang uten å hjelpe: da er
 * oppgaven å finne riktig område, ikke å skille to naboer.
 */
const MED_BESKRIVELSE_OPPTIL = 30;

function ledetekst(beskrivelse: string, kandidater: Kandidat[]): string {
  const kort = kandidater.length > MED_BESKRIVELSE_OPPTIL;
  const liste = kandidater
    .map(({ formaal: f }) =>
      [
        `id: ${f.id}`,
        `formål: ${f.formaal}`,
        `kategori: ${f.kategori}`,
        ...(kort ? [] : [`gjelder: ${f.beskrivelse}`]),
      ].join("\n"),
    )
    .join(kort ? "\n" : "\n\n");

  return `Beskrivelse fra saksbehandleren:\n"""${beskrivelse}"""\n\nFormål å velge mellom:\n\n${liste}`;
}

export interface Rangert {
  id: string;
  begrunnelse: string;
}

export class ModellUtilgjengelig extends Error {}

interface Praten {
  choices?: { message?: { content?: string } }[];
}

/**
 * Ett kall til chat-endepunktet. `medSkjema` er skrudd av på det andre forsøket - se
 * `rangér`.
 */
async function kall(
  beskrivelse: string,
  kandidater: Kandidat[],
  medSkjema: boolean,
): Promise<Response> {
  return fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_NØKKEL}`,
    },
    body: JSON.stringify({
      model: MODELL,
      // Oppgaven er å gjenfinne, ikke å dikte. Null temperatur gir også samme svar
      // på samme spørsmål, som er greit å kunne stole på i en demo.
      temperature: 0,
      cache_salt: CACHE_SALT,
      ...(medSkjema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: { name: "hjemler", strict: true, schema: SKJEMA },
            },
          }
        : {}),
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: ledetekst(beskrivelse, kandidater) },
      ],
    }),
    signal: AbortSignal.timeout(TIDSAVBRUDD),
  });
}

/**
 * Plukker JSON-objektet ut av svarteksten.
 *
 * Med `response_format` er innholdet ren JSON og dette er en no-op. Uten - og med en
 * resonnerende modell som Nemotron, som gjerne legger ved tankerekka eller pakker svaret
 * i en kodeblokk - er det første balanserte `{...}` det vi er ute etter.
 */
function jsonFraTekst(tekst: string): string | null {
  const uten = tekst.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = uten.indexOf("{");
  if (start === -1) return null;

  let dybde = 0;
  let iTekst = false;
  let escaped = false;
  for (let i = start; i < uten.length; i++) {
    const tegn = uten[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (tegn === "\\") {
      escaped = true;
      continue;
    }
    if (tegn === '"') iTekst = !iTekst;
    if (iTekst) continue;
    if (tegn === "{") dybde++;
    if (tegn === "}" && --dybde === 0) return uten.slice(start, i + 1);
  }
  return null;
}

/**
 * Ber modellen rangere kandidatene. Kaster `ModellUtilgjengelig` hvis AI Factory ikke
 * svarer, mangler nøkkel eller ikke har modellen - da er ordsøket svaret, og tjenesten
 * sier fra hvilken vei svaret tok i stedet for å feile.
 */
export async function rangér(beskrivelse: string, kandidater: Kandidat[]): Promise<Rangert[]> {
  if (!API_NØKKEL) {
    throw new ModellUtilgjengelig(
      "TELENOR_AI_FACTORY_API_KEY mangler, så modellen ble ikke spurt.",
    );
  }

  let svar: Response;
  try {
    svar = await kall(beskrivelse, kandidater, true);

    // Ikke alle modeller bak LiteLLM tar imot et json_schema, og de som ikke gjør det
    // avviser hele kallet på skjemaet alene. Ledeteksten ber uansett om den samme
    // JSON-en, så et forsøk til uten skjema er verdt det før vi gir opp - da er
    // `jsonFraTekst` det som holder svaret på formen.
    if ((svar.status === 400 || svar.status === 422) && (await svar.clone().text()).includes("response_format")) {
      svar = await kall(beskrivelse, kandidater, false);
    }
  } catch (feil) {
    throw new ModellUtilgjengelig(
      `Fikk ikke kontakt med Telenor AI Factory på ${BASE_URL}: ${feil instanceof Error ? feil.message : feil}`,
    );
  }

  if (!svar.ok) {
    const kropp = await svar.text();
    throw new ModellUtilgjengelig(
      `Telenor AI Factory svarte ${svar.status}: ${kropp.slice(0, 200)}`,
    );
  }

  const kropp = (await svar.json()) as Praten;
  const innhold = kropp.choices?.[0]?.message?.content ?? "";
  const json = jsonFraTekst(innhold);
  let tolket: { treff?: Rangert[] };
  try {
    if (json === null) throw new Error("ingen JSON i svaret");
    tolket = JSON.parse(json);
  } catch {
    throw new ModellUtilgjengelig("Telenor AI Factory svarte noe som ikke var JSON");
  }

  // Modellen kan finne på en id som ikke fantes i lista. Da er den ikke et treff.
  const kjente = new Map(kandidater.map((k) => [k.formaal.id, k.formaal]));
  const sett = new Set<string>();
  return (tolket.treff ?? [])
    .filter((t) => t?.id && kjente.has(t.id) && !sett.has(t.id) && sett.add(t.id))
    .map((t) => ({ id: t.id, begrunnelse: String(t.begrunnelse ?? "").trim() }));
}

export const modellnavn = MODELL;
export const modellUrl = BASE_URL;
