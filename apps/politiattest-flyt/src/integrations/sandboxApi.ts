import type { Person, VandelFormaal, Vandelvurdering } from "../types";
import { erPolitiattestRolle, type PolitiattestRolle } from "../utils/roller";

const SANDBOX_API = "/sandbox-api";

type BackendRecord = Record<string, unknown>;

async function requestBackend<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${SANDBOX_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const body = data && typeof data === "object" ? data as BackendRecord : null;
    const message = body?.feil || body?.melding || body?.error;
    throw new Error(typeof message === "string" ? message : `Sandbox-backend svarte HTTP ${response.status}.`);
  }
  return data as T;
}

function rolleFor(person: Person): PolitiattestRolle {
  const rolle = person.politiattest?.formaal || "";
  if (!erPolitiattestRolle(rolle)) {
    throw new Error(`Fant ikke en gyldig rolle på politiattesten: ${rolle || "mangler"}.`);
  }
  return rolle;
}

function resultatFra(response: BackendRecord): BackendRecord {
  const resultat = response.resultat;
  if (!resultat || typeof resultat !== "object") {
    throw new Error("Sandbox-backend svarte uten et regelutfall.");
  }
  return resultat as BackendRecord;
}

function formaalFra(value: BackendRecord, rolle: PolitiattestRolle): VandelFormaal {
  const requiredStrings = ["ordning", "formaal", "kilde", "hjemmel", "attesttype", "oppbevaring"];
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string") {
      throw new Error(`Sandbox-backend svarte uten formålsfeltet ${key}.`);
    }
  }
  if (typeof value.maksAlderMaaneder !== "number") {
    throw new Error("Sandbox-backend svarte uten maksimal alder på attesten.");
  }
  return {
    rolle,
    ordning: value.ordning as string,
    formaal: value.formaal as string,
    kilde: value.kilde as string,
    hjemmel: value.hjemmel as string,
    attesttype: value.attesttype as string,
    maksAlderMaaneder: value.maksAlderMaaneder as number,
    oppbevaring: value.oppbevaring as string
  };
}

function regelutfallFra(resultat: BackendRecord): string {
  const grunnlag = resultat.grunnlag;
  if (!grunnlag || typeof grunnlag !== "object" || typeof (grunnlag as BackendRecord).vandelsutfall !== "string") {
    throw new Error("Sandbox-backend svarte uten vandelsutfall i grunnlaget.");
  }
  return (grunnlag as BackendRecord).vandelsutfall as string;
}

function visningsutfall(regelutfall: string): Vandelvurdering["utfall"] {
  if (regelutfall === "godkjent") return "godkjent";
  if (regelutfall === "krever_manuell_vurdering") return "krever_manuell_vurdering";
  if (regelutfall === "absolutt_utelukkelse") return "avvist";
  throw new Error(`Ukjent vandelsutfall fra sandbox-backend: ${regelutfall}.`);
}

async function neste(oektsId: string, accessToken: string): Promise<void> {
  await requestBackend(`/api/prosessoekter/${encodeURIComponent(oektsId)}/neste`, accessToken, {
    method: "POST"
  });
}

async function handling(
  oektsId: string,
  accessToken: string,
  body: BackendRecord = {}
): Promise<BackendRecord> {
  return requestBackend<BackendRecord>(
    `/api/prosessoekter/${encodeURIComponent(oektsId)}/handling`,
    accessToken,
    { method: "POST", body: JSON.stringify(body) }
  );
}

async function svar(
  oektsId: string,
  accessToken: string,
  stegId: string,
  value: BackendRecord
): Promise<void> {
  await requestBackend(`/api/prosessoekter/${encodeURIComponent(oektsId)}/svar`, accessToken, {
    method: "POST",
    body: JSON.stringify({ stegId, svar: value })
  });
}

export async function hentVandelvurdering(
  person: Person,
  accessToken: string
): Promise<Vandelvurdering> {
  const rolle = rolleFor(person);
  const oekt = await requestBackend<BackendRecord>("/api/prosessoekter", accessToken, {
    method: "POST",
    body: JSON.stringify({
      personId: person.personId,
      prosessId: "politiattest-oppdrag"
    })
  });
  if (typeof oekt.oektsId !== "string") {
    throw new Error("Sandbox-backend opprettet ikke en prosessøkt.");
  }
  const oektsId = oekt.oektsId;

  await handling(oektsId, accessToken);
  await neste(oektsId, accessToken);
  await svar(oektsId, accessToken, "velg-rolle", { rolle });
  await neste(oektsId, accessToken);
  const formaal = formaalFra(resultatFra(await handling(oektsId, accessToken)), rolle);
  await neste(oektsId, accessToken);
  await svar(oektsId, accessToken, "bekreft-soknad", { harSoekt: "ja" });
  await neste(oektsId, accessToken);
  await handling(oektsId, accessToken, { handling: "opprett-samtykke" });
  await handling(oektsId, accessToken, { handling: "samtykkesvar", status: "SAMTYKKET" });
  await neste(oektsId, accessToken);
  await handling(oektsId, accessToken);
  await neste(oektsId, accessToken);
  const resultat = resultatFra(await handling(oektsId, accessToken));
  const regelutfall = regelutfallFra(resultat);

  if (typeof resultat.melding !== "string" || typeof resultat.godkjent !== "boolean") {
    throw new Error("Sandbox-backend svarte uten et komplett regelresultat.");
  }
  return {
    status: "hentet",
    utfall: visningsutfall(regelutfall),
    regelutfall,
    godkjent: resultat.godkjent as boolean,
    melding: resultat.melding as string,
    formaal,
    feil: null
  };
}
