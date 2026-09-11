// Oppslaget i steg 0: noen få ord om hva attesten skal brukes til, ut kommer hjemlene
// den kan kreves etter. Tjenesten er apps/hjemmelsok, og radene den svarer med er
// politiets egen formålsoversikt, ordrett - modellen velger blant dem, den formulerer
// ingen hjemmel. Det er hele grunnen til at saksbehandleren slår opp her i stedet for å
// skrive lovhenvisningen selv i et tekstfelt.
//
// Flaten er åpen og svarer Access-Control-Allow-Origin: *, men klienten her ser bare
// same-origin-proxyer som resten av appen - se vite.config.ts.

import type { HjemmelTreff } from "../types";

const HJEMMELSOK_API = "/hjemmelsok-api";

// Modellkallet i hjemmelsok har 60 sekunders tidsavbrudd og degraderer til ordsøket
// etterpå, så klienten må vente litt lenger enn det for å få det svaret.
const TIDSAVBRUDD_MS = 70000;

export interface Hjemmelsvar {
  /** Beskrivelsen slik tjenesten leste den, trimmet og kappet. */
  beskrivelse: string;
  /** «modell» når modellen rangerte, «ordsøk» når den ikke gjorde det. */
  kilde: string;
  /** Modellen som rangerte. Står bare når kilde er «modell». */
  modell?: string;
  /** Står bare når svaret kom en annen vei enn den vanlige, og sier hvilken. */
  merknad?: string;
  treff: HjemmelTreff[];
}

function tekstfelt(rad: Record<string, unknown>, felt: string): string {
  const verdi = rad[felt];
  return typeof verdi === "string" ? verdi : "";
}

function treffFra(data: Record<string, unknown>): HjemmelTreff[] {
  const rader = Array.isArray(data.treff) ? data.treff : [];
  return rader
    .filter((rad): rad is Record<string, unknown> => typeof rad === "object" && rad !== null)
    .filter((rad) => typeof rad.id === "string" && rad.id.length > 0)
    .map((rad) => ({
      id: rad.id as string,
      kategori: tekstfelt(rad, "kategori"),
      formaal: tekstfelt(rad, "formaal"),
      beskrivelse: tekstfelt(rad, "beskrivelse"),
      hjemmel: tekstfelt(rad, "hjemmel"),
      attesttype: tekstfelt(rad, "attesttype"),
      bekreftelse: tekstfelt(rad, "bekreftelse"),
      begrunnelse: tekstfelt(rad, "begrunnelse")
    }));
}

export async function sokHjemler(beskrivelse: string, antall = 8): Promise<Hjemmelsvar> {
  let response: Response;
  try {
    response = await fetch(`${HJEMMELSOK_API}/hjemler`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ beskrivelse, antall }),
      signal: AbortSignal.timeout(TIDSAVBRUDD_MS)
    });
  } catch {
    throw new Error("Fikk ikke kontakt med hjemmelsok (port 8089).");
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  const body = data && typeof data === "object" ? (data as Record<string, unknown>) : null;

  if (!response.ok) {
    const melding = body?.feil;
    throw new Error(
      typeof melding === "string" ? melding : `Hjemmelsok svarte HTTP ${response.status}.`
    );
  }
  if (!body) {
    throw new Error("Hjemmelsok svarte uten en lesbar kropp.");
  }

  return {
    beskrivelse: tekstfelt(body, "beskrivelse") || beskrivelse,
    kilde: tekstfelt(body, "kilde"),
    modell: typeof body.modell === "string" ? body.modell : undefined,
    merknad: typeof body.merknad === "string" ? body.merknad : undefined,
    treff: treffFra(body)
  };
}
