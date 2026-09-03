// Sidescript for chat. Lastes som <script type="module">, så alt her har sitt
// eget scope - to sider kan bruke samme navn på hver sin `backendBase` uten å
// kollidere. felles.ts lastes som klassisk script foran denne, så funksjonene og
// typene derfra er globale og trenger ingen import.
export {};

renderTopNav("/chat");

const backendBase = "http://localhost:8080";
const aiBase = "http://localhost:8082";

/*
 * Formene chat-siden leser fra backend og ai-gateway.
 *
 * Løsere enn typene på serversiden med vilje: siden viser hva den fikk, den
 * håndhever ingenting. Alt som kan mangle er valgfritt, så en manglende nøkkel
 * gir en tom visning i stedet for en tom side.
 */

/** Resultatet av ett steg. Formen avhenger av stegtypen - derfor åpen. */
type Stegresultat = {
  godkjent?: boolean;
  melding?: string;
  status?: string;
  formaal?: string;
  dataKilder?: string[];
  tekst?: string;
  advarsel?: string;
  adressenavn?: string;
  kommune?: string;
  antallEiendommer?: number;
  antallBoligeiendommer?: number;
  beregningsbeloep?: number;
  inntektsaar?: number;
  stadie?: string;
  husstandId?: string;
  medlemmer?: unknown[];
  oppgave?: { oppgaveId?: string };
  // Kontaktinfo fra KRR (hent-kontaktinfo i stottekontakt-behov).
  reservert?: boolean;
  kanVarsles?: boolean;
  // SUBMIT svarer med soknadsraden, dokumentet og utfallet av kvitteringen.
  soknadId?: string;
  soknadsdokument?: string;
  forsendelseId?: string;
  forsendelse?: { advarsel?: string; detalj?: string };
};

/** GET /api/soknader/{soknadId}/forsendelse. Bare statusen leses her. */
type Forsendelsesstatussvar = { status?: string };

type Handlingsresultat = { oekt: Prosessoekt; resultat?: Stegresultat | unknown[] };

type Samtykke = { status: string; formaal?: string; dataKilder?: string[] };

/** POST /ai/sporsmaal. `sperre` settes når svaret ble erstattet. */
type SporsmaalSvar = {
  tekst?: string;
  sperre?: string;
  advarsel?: string;
  grunnlag?: Grunnlag;
  feil?: string;
};

/**
 * Hvor opplysningene faktisk kommer fra, per datakilde.
 *
 * Sto som «Skatteetaten, via KS Fiks» uansett hva steget spurte om, og det er
 * feil for alt annet enn inntekt: støttekontakt spør om kontaktinfo, som ligger
 * i Kontakt- og reservasjonsregisteret. Et samtykke som oppgir feil kilde er
 * ikke informert.
 *
 * Listen hører egentlig sammen med samtykkekodeverket i apps/shared/samtykke.ts.
 * Den står her så lenge den bare er tekst til innbyggeren.
 */
const kildePerDatakilde: Record<string, string> = {
  inntekt: "Skatteetaten, via KS Fiks",
  kontaktinfo: "Kontakt- og reservasjonsregisteret, via KS Fiks",
  tjenestebehov: "kommunens egne registre",
  helseopplysninger: "pasientjournalen hos den som ga helsehjelpen",
  politiattest: "politiattesten du har fått fra politiet, og som du framviser selv"
};

function kildeTekst(dataKilder: string[] | undefined): string {
  const kilder = [...new Set((dataKilder || []).map((k) => kildePerDatakilde[k]).filter(Boolean))];
  const hvor = kilder.length ? kilder.join(" og ") : "registeret som eier opplysningene";
  return `${hvor} - her simulert med syntetiske data`;
}

/** POST /ai/tolk-svar. */
type Tolkning = { intent?: string; confidence?: number; modell?: string; advarsel?: string };

type Revisjonsrad = {
  handling: string;
  ressurs?: string;
  aktor?: { type: string; id?: string; paaVegneAv?: string };
};

type Hurtigknapp = { label: string; onClick: () => void; secondary?: boolean };

type Samtalelinje = { rolle: string; tekst: string };

const personEl = krevEl<HTMLSelectElement>("person");
const prosessEl = krevEl<HTMLSelectElement>("prosess");
const chatEl = krevEl("chat");
const inputEl = krevEl<HTMLTextAreaElement>("input");
const quickActionsEl = krevEl("quickActions");
const sessionInfoEl = krevEl("sessionInfo");
const oektStatusEl = krevEl("oektStatus");

initChat(chatEl);

let prosesser: Prosess[] = [];
let oekt: Prosessoekt | null = null;
let aktivProsess: Prosess | null = null;
let aktivAutoHandling: string | null = null;

// Grunnlag for frie spørsmål. satser er offentlig og krever ikke samtykke;
// den hentes én gang og gjenbrukes.
let satser: unknown = null;
let sisteSamtykke: Samtykke | null = null;
let ventendeOppfolging: string[] = [];
const samtale: Samtalelinje[] = [];

function summarizeResult(steg: ProsessSteg | null | undefined, result: Stegresultat | unknown[] | null | undefined): string {
  if (!result) {
    return "";
  }

  // En liste er sitt eget utfall og har ingen av feltene under. Sjekket her,
  // ikke nede i DATA_FETCH, så resten kan lese felter uten omveier.
  if (Array.isArray(result)) {
    if (steg?.type !== "DATA_FETCH") return "Steget ble gjennomført.";
    return result.length === 0
      ? "Jeg fant ingen registrerte opplysninger for dette steget."
      : `Jeg hentet ${result.length} registrerte oppføringer for dette steget.`;
  }

  if (steg?.type === "SJEKK") {
    if (result.godkjent === false) {
      return result.melding || "Sjekken feilet.";
    }
    return result.melding || "Sjekk fullført.";
  }

  if (steg?.type === "CONSENT_REQUEST") {
    if (result.status === "SAMTYKKET") {
      return "Takk. Samtykket er registrert, så da kan vi gå videre.";
    }
    if (result.status === "IKKE_SAMTYKKET") {
      return "Skjønner. Jeg har registrert at du ikke vil samtykke akkurat nå.";
    }
    return "Samtykkevalget ditt er registrert.";
  }

  if (steg?.type === "DATA_FETCH") {
    if (result.adressenavn && result.antallEiendommer !== undefined) {
      return `Jeg fant gaten ${result.adressenavn} i ${result.kommune}. Matrikkelen viser ${result.antallBoligeiendommer} boligeiendommer og ${result.antallEiendommer} eiendommer totalt.`;
    }
    if (result.beregningsbeloep !== undefined) {
      const utkast = result.stadie === "UTKAST" ? " Skatteoppgjoret er ikke ferdig, sa tallet kan endre seg." : "";
      return `Jeg har hentet inntektsopplysningene. Husholdningens inntektsgrunnlag for ${result.inntektsaar} er ${formatNumber(result.beregningsbeloep)} kroner.${utkast}`;
    }
    if (result.husstandId && Array.isArray(result.medlemmer)) {
      return `Jeg har hentet husstandsopplysninger for ${result.husstandId}. Husstanden har ${result.medlemmer.length} registrerte medlemmer.`;
    }
    /*
     * Kontaktinfo fra KRR. Teksten sier hva kontaktregisteret svarte, ikke
     * hvilken kanal kvitteringen faktisk går på: kanalvalget tas av SvarUt
     * (chooseKanal i fiks-simulator), og en kopi av regelen her ville vært en
     * andre implementasjon som kan gli fra den ekte. Predikatet er derfor
     * SvarUt sitt eget første trinn - kan varsles og ikke reservert - og
     * statuslinja etter innsending navngir kanalen som ble valgt.
     */
    if (typeof result.reservert === "boolean") {
      return result.kanVarsles && !result.reservert
        ? "Jeg har hentet kontaktopplysningene dine. Kontaktregisteret sier at du kan varsles digitalt, så post fra kommunen kan gå til din digitale postkasse."
        : "Jeg har hentet kontaktopplysningene dine. Kontaktregisteret sier at du ikke skal varsles digitalt, så kommunen kan ikke sende deg post i en digital postkasse.";
    }
  }

  if (steg?.type === "SUMMARY") {
    if (result.tekst) {
      return result.tekst;
    }
    return "Jeg har laget en oppsummering av opplysningene dine.";
  }

  if (steg?.type === "SUBMIT") {
    const oppgave = result.oppgave?.oppgaveId ? " Det er også opprettet en oppgave for videre behandling." : "";
    return `Søknaden er sendt inn.${oppgave}`.trim();
  }

  if (typeof result.tekst === "string" && result.tekst.trim()) {
    return result.tekst.trim();
  }

  return "Steget ble gjennomført.";
}

function promptForStep(steg: ProsessSteg | null | undefined): string {
  if (!steg) {
    return "Vi er ferdige med prosessen.";
  }

  if (steg.type === "INFO") {
    return steg.tekst || `Hei ${valgtPerson()}, jeg hjelper deg med ${aktivProsess?.navn || "prosessen"}. Når du er klar, kan vi starte.`;
  }

  if (steg.type === "QUESTION") {
    const intro = steg.tekst || steg.tittel;
    return `${intro}\n\n${buildSporsmaalsHjelp(steg)}`;
  }

  /*
   * Samtykketeksten er deterministisk og skal forbli det. Et samtykke må
   * være informert og utvetydig, så modellen får ikke skrive om selve
   * spørsmålet - bare svare på oppfølgingsspørsmål om det, gjennom
   * /ai/sporsmaal med sine sperrer.
   *
   * Det som er nytt her er ikke tonen, men at spørsmålet faktisk sier
   * hva et informert samtykke krever: hva, hvorfor, hvor fra, hva om du
   * sier nei, og at du kan ombestemme deg.
   */
  if (steg.type === "CONSENT_REQUEST") {
    const dataKilder = (steg.dataKilder || []).join(", ") || "nødvendige opplysninger";
    const raatt = String(steg.formaal || "behandle saken");
    // Bare første bokstav ned. Formålet er forfatterens tekst og kan bære
    // egennavn, og hele strengen i småbokstaver gjorde «TT-ordninga» til
    // «tt-ordninga».
    const formaal = raatt.charAt(0).toLowerCase() + raatt.slice(1);
    return [
      `For å komme videre trenger jeg samtykke fra deg til å hente ${dataKilder}.`,
      "",
      `• Hva vi henter: ${dataKilder}`,
      `• Hvorfor: for å ${formaal}`,
      `• Hvor fra: ${kildeTekst(steg.dataKilder)}`,
      "• Sier du nei: da henter vi ingenting, og vi kan ikke vurdere saken videre nå",
      "• Du kan ombestemme deg og trekke samtykket etterpå",
      "",
      "Er det greit for deg? Spør gjerne først hvis noe er uklart."
    ].join("\n");
  }

  if (steg.type === "DATA_FETCH") {
    return steg.tekst || (steg.tittel ? `Takk. ${steg.tittel}.` : "Takk. Da henter jeg de opplysningene vi trenger nå.");
  }

  if (steg.type === "SJEKK") {
    return steg.tekst || (steg.tittel ? `${steg.tittel}.` : "Nå gjør jeg en sjekk av opplysningene.");
  }

  if (steg.type === "SUMMARY") {
    return "Flott. Nå lager jeg en kort oppsummering av det vi har gått gjennom.";
  }

  if (steg.type === "SUBMIT") {
    return "Da er vi klare til å sende inn. Vil du at jeg skal sende søknaden nå?";
  }

  return steg.tittel || "Neste steg er klart.";
}

function updateSessionInfo(): void {
  if (!oekt) {
    sessionInfoEl.textContent = "Ingen aktiv prosess.";
    oektStatusEl.textContent = "";
    return;
  }
  sessionInfoEl.textContent = `Du er i ${aktivProsess?.navn || oekt.prosessId}. Steg ${oekt.stegIndex + 1} av ${oekt.totaltAntallSteg}.`;
  renderOektStatus();
}

/*
 * Samtykkestatus, syntetisk-merking og sporet, synlig hele veien.
 * Ligger de bare i API-svaret, ser ingen dem under en demo.
 */
function renderOektStatus(): void {
  oektStatusEl.innerHTML = "";
  if (!oekt) return;

  // Samtykkeobjektet opprettes først når innbygger svarer, så statusen må
  // også lese hvilket steg vi står på. Ellers står det «ikke spurt om
  // samtykke ennå» midt i samtykkespørsmålet.
  const isOnSamtykke = oekt.aktivtSteg?.type === "CONSENT_REQUEST";
  const samtykketekst: string | null = ({
    SAMTYKKET: "samtykke gitt",
    IKKE_SAMTYKKET: "samtykke ikke gitt",
    TRUKKET: "samtykke trukket",
    UTLOEPT: "samtykket er utløpt",
    VENTER_PAA_SVAR: "venter på ditt samtykke"
  } as Record<string, string | undefined>)[sisteSamtykke?.status ?? ""]
    || (isOnSamtykke ? "venter på ditt samtykke" : null)
    || (oekt.aktivtSamtykkeId ? "samtykke opprettet" : "ikke spurt om samtykke ennå");

  const merker = [`🔒 ${samtykketekst}`, "🧪 syntetiske data"];
  for (const merke of merker) {
    const span = document.createElement("span");
    span.textContent = merke;
    oektStatusEl.appendChild(span);
  }

  if (oekt.sporingsId) {
    // KI-sporet er ugradert og kan fortsatt åpnes i ny fane.
    const spor = document.createElement("a");
    spor.href = `${aiBase}/trace?sporingsId=${encodeURIComponent(oekt.sporingsId)}`;
    spor.target = "_blank";
    spor.rel = "noopener";
    spor.textContent = "KI-spor";
    oektStatusEl.appendChild(spor);

    // Revisjonsloggen rendres i siden, ikke som lenke i ny fane. En <a href>
    // kan ikke bære en Authorization-header, så under håndhevelse ville
    // lenken blitt en 401-side - og loggen er den mest personsensitive
    // flaten vi har. Den skal ikke være den ene uten port.
    const knapp = document.createElement("a");
    knapp.href = "#";
    knapp.textContent = "revisjonslogg";
    knapp.onclick = (hendelse) => {
      hendelse.preventDefault();
      showRevisjonslogg(oekt!.sporingsId);
    };
    oektStatusEl.appendChild(knapp);
  }
}

async function showRevisjonslogg(sporingsId: string): Promise<void> {
  try {
    const rader = await req<Revisjonsrad[]>(`/api/revisjonslogg/${encodeURIComponent(sporingsId)}`);
    if (rader.length === 0) {
      addMsg("system", "Revisjonsloggen er tom for dette sporet ennå.");
      return;
    }
    const linjer = rader.map((rad) => {
      const aktor = rad.aktor
        ? `${rad.aktor.type}${rad.aktor.id ? ` ${rad.aktor.id}` : ""}${rad.aktor.paaVegneAv ? ` på vegne av ${rad.aktor.paaVegneAv}` : ""}`
        : "ukjent";
      return `${rad.handling} - ${rad.ressurs || "?"} - ${aktor}`;
    });
    addMsg("system", `Revisjonslogg (${rader.length} hendelser):\n${linjer.join("\n")}`);
  } catch (feil) {
    addMsg("error", `Kunne ikke hente revisjonsloggen: ${feilmelding(feil)}`);
  }
}

// «Takk, det har jeg notert» sa ingenting om hva som ble notert.
function acknowledgeSvar(steg: ProsessSteg, tekst: string): string {
  const kort = tekst.length > 90 ? `${tekst.slice(0, 90).trim()}…` : tekst;
  if (Array.isArray(steg.felter) && steg.felter.length > 0) {
    return `Takk. Jeg har notert svaret ditt på «${steg.tittel || steg.id}».`;
  }
  return `Takk. Jeg har notert: «${kort}»`;
}

function setQuickActions(buttons: Hurtigknapp[] = []): void {
  quickActionsEl.innerHTML = "";
  for (const button of buttons) {
    const node = document.createElement("button");
    node.textContent = button.label;
    if (button.secondary) {
      node.className = "secondary";
    }
    node.onclick = button.onClick;
    quickActionsEl.appendChild(node);
  }
}

function valgtPerson(): string {
  return personEl.selectedOptions?.[0]?.textContent || "deg";
}

/* ── Sidespørsmål ──────────────────────────────────────────────────────
 *
 * Flyten er ryggraden, men et spørsmål underveis skal sette den på pause
 * i stedet for å bli avvist. Ruten er tilstandsfri med vilje: den kaller
 * aldri /svar, /handling eller /neste. Motoren er lineær, så et svar som
 * feilaktig ble lest som spørsmål koster én tur - mens et spørsmål som
 * ble lagret som svar er stille og ugjenkallelig.
 */

const SPORREORD = ["hva", "hvorfor", "hvordan", "hvem", "hvor", "når", "nar", "kan jeg", "må jeg", "ma jeg", "får jeg", "far jeg", "hvilke", "hvilken"];

// Lukket liste. Brukes bare på QUESTION-steg, der terskelen må være høy.
const SIDESPORSMAALSTEMA = ["inntektsgrense", "grense", "sats", "samtykke", "opplysning", "data", "personvern", "lagre", "slette", "hvem ser", "hvor lenge", "skatt", "prosent", "avslag", "vedtak", "syntetisk", "ekte"];

function isSidesporsmaal(text: string, steg: ProsessSteg | null | undefined): boolean {
  const lower = normalize(text);
  if (!lower) return false;

  // startsWith, ikke includes: «jeg lurte på hva du mente med Storgata»
  // er et svar med et spørreord midt inni.
  const startsWithSporreord = SPORREORD.some((ord) => lower === ord || lower.startsWith(`${ord} `));
  const hasQuestionMark = text.includes("?");

  // På QUESTION bærer teksten en verdi vi mister ved feilruting, så her
  // kreves alle tre. Ellers kan innbygger uansett bare si ja eller nei.
  if (steg?.type === "QUESTION") {
    return startsWithSporreord && hasQuestionMark && SIDESPORSMAALSTEMA.some((tema) => lower.includes(tema));
  }

  return startsWithSporreord || hasQuestionMark;
}

/*
 * Flyt-blokken er ikke pynt. Uten den leste modellen stegnavnet «Send
 * søknad» i prosessdefinisjonen og svarte «nå har søknaden blitt sendt
 * inn» mens vi fortsatt sto og ventet på bekreftelse. Grunnlaget må si
 * hva som *ikke* har skjedd, ikke bare hva som finnes.
 */
function buildFlyt(): Record<string, unknown> | null {
  if (!oekt) return null;
  const steg: ProsessSteg[] = aktivProsess?.steg || [];
  const submitSteg = steg.find((s) => s.type === "SUBMIT");
  return {
    staarPaa: oekt.aktivtSteg?.tittel || oekt.aktivtSteg?.type || null,
    stegNummer: oekt.stegIndex + 1,
    avTotalt: oekt.totaltAntallSteg,
    status: oekt.status,
    fullforteSteg: steg.slice(0, oekt.stegIndex).map((s) => s.tittel || s.id),
    gjenstaaendeSteg: steg.slice(oekt.stegIndex).map((s) => s.tittel || s.id),
    soknadSendt: Boolean(submitSteg && oekt.resultater?.[submitSteg.id])
  };
}

/**
 * Om prosessen i det hele tatt slår opp i matrikkelen.
 *
 * Definisjonen sier det selv, så dette trenger ingen liste over case-ider. Uten
 * sjekken hentet hvert frie spørsmål i hver sak innbyggerens eiendommer, og
 * svaret oppga dem som kilde - i en sak om TT-kort er begge deler feil.
 */
function prosessBrukerMatrikkel(): boolean {
  return (aktivProsess?.steg || []).some(
    (s) => (s.api?.url || "").includes("/api/matrikkel/")
  );
}

async function buildSporsmaalsKontekst(): Promise<Record<string, unknown>> {
  let mineEiendommer: unknown = null;
  if (oekt?.personId && prosessBrukerMatrikkel()) {
    try {
      // req(), not a bare fetch: the lookup is egne-data, so it needs the
      // ID-porten token. Without it AUTH_ENFORCE answers 401 and the field
      // would silently stay null - a lookup that looks like it works.
      mineEiendommer = await req<unknown>(
        `/api/matrikkel/mine-eiendommer?personId=${encodeURIComponent(oekt.personId)}`
      );
    } catch (_) {
      // Best-effort - answer without ownership data if lookup fails
    }
  }
  return {
    tjeneste: aktivProsess?.navn || "ukjent prosess",
    prosess: aktivProsess || null,
    steg: oekt?.aktivtSteg || null,
    flyt: buildFlyt(),
    satser: satser,
    // Står vi på samtykkesteget uten svar ennå, er «venter» sannere enn
    // ingenting - og det er nettopp da innbygger spør hvorfor.
    samtykke: sisteSamtykke || (oekt?.aktivtSteg?.type === "CONSENT_REQUEST"
      ? {
          status: "VENTER_PAA_SVAR",
          formaal: oekt.aktivtSteg.formaal,
          dataKilder: oekt.aktivtSteg.dataKilder
        }
      : null),
    resultater: oekt?.resultater || null,
    mineEiendommer: mineEiendommer,
    samtale: samtale.slice(-6)
  };
}

// fraKnapp: et forslag innbygger trykket på var aldri et feilrutet svar,
// så da skal rømningsknappen ikke tilbys.
async function answerSidesporsmaal(text: string, fraKnapp = false): Promise<void> {
  addTyping();
  try {
    const res = await fetch(`${aiBase}/ai/sporsmaal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tekst: text,
        sporingsId: oekt?.sporingsId,
        kontekst: await buildSporsmaalsKontekst(),
        sprak: "nb"
      })
    });
    const data = (await res.json()) as SporsmaalSvar;
    removeTyping();
    if (!res.ok) {
      throw new Error(data.feil || `Feil ${res.status}`);
    }

    // En sperre som ikke synes, er ikke demonstrerbar.
    addMsg(data.sperre ? "guardrail" : "assistant", data.tekst ?? "");
    addGrunnlagsfot(data.grunnlag);
    samtale.push({ rolle: "assistent", tekst: data.tekst ?? "" });

    if (data.sperre) {
      addMsg("system", `Sperre «${data.sperre}»: ${data.advarsel || "svaret ble erstattet."}`);
    } else if (data.advarsel) {
      addMsg("system", `⚠️ ${data.advarsel}`);
    }
  } catch (error) {
    removeTyping();
    addMsg("error", `Fikk ikke svar på spørsmålet: ${feilmelding(error)}`);
  }

  resumeFlyt(fraKnapp ? null : text);
}

// Flyten gjenopptas eksplisitt. stegIndex er ikke rørt - vi viser bare
// hvor vi står, og gir en vei ut av en feilruting.
function resumeFlyt(opprinneligTekst: string | null): void {
  const steg = oekt?.aktivtSteg;
  if (!steg) return;
  addMsg("system", `Sidespørsmål - flyten står på pause. Tilbake til: ${steg.tittel || steg.type}`);
  addMsg("assistant", promptForStep(steg));
  renderQuickActionsFor(steg, opprinneligTekst);
}

// Generisk over svarformen, så hvert kallsted navngir hva det venter seg.
async function req<T>(
  path: string,
  options: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}
): Promise<T> {
  const res = await fetch(`${backendBase}${path}`, {
    ...options,
    headers: withToken({ "Content-Type": "application/json", ...(options.headers || {}) })
  });
  const data = (await res.json()) as { feil?: string };
  if (!res.ok) {
    throw new Error(data.feil || `Feil ${res.status}`);
  }
  return data as T;
}

function isJaSvar(text: string): boolean {
  const lower = normalize(text);
  return ["ja", "japp", "yes", "klart", "greit", "okei", "ok", "gjerne", "ja takk", "send inn", "det går fint", "det er greit"].some((match) => lower.includes(match));
}

function isNeiSvar(text: string): boolean {
  const lower = normalize(text);
  return ["nei", "ikke", "stopp", "senere", "ikke nå", "nei takk"].some((match) => lower.includes(match));
}

// Tekst som bare betyr «gå videre». Sammenlignes mot rå input, så ordene står
// både med og uten norske tegn.
function erFortsettSignal(text: string): boolean {
  const lower = normalize(text);
  return isJaSvar(text)
    || ["start", "fortsett", "neste", "klar", "kjør på", "kjor pa", "gå videre", "ga videre"].some((match) => lower.includes(match));
}

function enesteValgfelt(steg: ProsessSteg | null | undefined): SpoersmaalsFelt | null {
  const felter = steg?.felter || [];
  if (felter.length !== 1) return null;
  const felt = felter[0];
  return felt.type === "valg" && (felt.alternativer || []).length > 0 ? felt : null;
}

function buildSporsmaalsHjelp(steg: ProsessSteg | null | undefined): string {
  const felter = steg?.felter || [];
  if (felter.length === 0) {
    return "Fortell gjerne med dine egne ord.";
  }
  // Et lukket alternativsett skal vises. Uten det måtte innbyggeren gjette
  // ordet, og en gjetning som ikke treffer, avvises.
  const valgfelt = enesteValgfelt(steg);
  if (valgfelt) {
    const liste = (valgfelt.alternativer || []).map((alternativ) => `- ${alternativLabel(alternativ)}`).join("\n");
    return `${valgfelt.label}\n${liste}`;
  }
  if (felter.length === 1) {
    return `Fortell gjerne litt om dette: ${felter[0].label}`;
  }
  // Etikettene er ferdige spørsmål med sitt eget spørsmålstegn. Ble de føyd inn i
  // en setning, kom de ut som «hva gjelder søknaden?, kan du …?.» - så de står
  // som en liste og beholder store bokstaver.
  const liste = felter.map((felt) => `- ${felt.label}`).join("\n");
  return `Du kan gjerne svare på alt i én melding:\n${liste}`;
}

function vent(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function interpretBrukersvar(
  text: string,
  intents: { ja: string; nei: string; ukjent: string },
  kontekst: Record<string, unknown> = {}
): Promise<Tolkning> {
  try {
    const res = await fetch(`${aiBase}/ai/tolk-svar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tekst: text,
        jaIntent: intents.ja,
        neiIntent: intents.nei,
        ukjentIntent: intents.ukjent,
        sporingsId: oekt?.sporingsId,
        kontekst: {
          tjeneste: aktivProsess?.navn || "ukjent prosess",
          steg: oekt?.aktivtSteg,
          ...kontekst
        }
      })
    });
    const data = (await res.json()) as Tolkning & { feil?: string };
    if (!res.ok) {
      throw new Error(data.feil || `Feil ${res.status}`);
    }
    return data;
  } catch {
    if (isJaSvar(text)) {
      return { intent: intents.ja, confidence: 0.6, modell: "lokal-fallback" };
    }
    if (isNeiSvar(text)) {
      return { intent: intents.nei, confidence: 0.6, modell: "lokal-fallback" };
    }
    return { intent: intents.ukjent, confidence: 0.1, modell: "lokal-fallback" };
  }
}

async function aiExplain(promptType: string, context: Record<string, unknown> = {}): Promise<string> {
  try {
    const res = await fetch(`${aiBase}/ai/${promptType}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sporingsId: oekt?.sporingsId,
        kontekst: {
          tjeneste: aktivProsess?.navn || "ukjent prosess",
          steg: oekt?.aktivtSteg,
          ...context
        },
        sprak: "nb"
      })
    });
    const data = (await res.json()) as { tekst?: string };
    if (res.ok && data.tekst) {
      return data.tekst;
    }
  } catch {
    // Fallback text below.
  }
  return "";
}

async function goNext(valg: { tegnSteg?: boolean } = {}): Promise<void> {
  if (!oekt || oekt.status === "FULLFORT" || oekt.status === "AVVIST") return;
  if (oekt.stegIndex >= ((oekt.totaltAntallSteg ?? 0) - 1)) return;
  oekt = await req<Prosessoekt>(`/api/prosessoekter/${oekt.oektsId}/neste`, { method: "POST", body: "{}" });
  updateSessionInfo();
  if (valg.tegnSteg !== false) {
    await renderStep();
  }
}

/* ── Innsendingen ──────────────────────────────────────────────────────
 *
 * Fram til nå endte en fullført prosess i én linje: «Søknaden er sendt inn».
 * Alt den faktisk produserte - dokumentet kommunen mottok, og kvitteringen på
 * vei ut til innbyggeren - lå usynlig i JSON. Her vises begge, og bare på
 * chat-siden: stegvis-siden er et rå-JSON-verktøy og skal forbli det.
 */

// Kodeverket ligger i apps/fiks-simulator/src/forsendelse.ts. Gjengitt som tekst
// her fordi det er denne siden som skal si det på norsk. Ingenting pinner denne
// tabellen mot kodeverket, så en ny status faller ut som «har status X» -
// synlig nok å oppdage, tomt nok å ikke lyve.
const FORSENDELSESTEKST: Record<string, string> = {
  MOTTATT: "Kvitteringen er mottatt hos SvarUt.",
  SENDT_DIGITALT: "Kvitteringen er sendt til din digitale postkasse.",
  SENDT_PRINT: "Kvitteringen er sendt til print og legges i posten.",
  LEST: "Kvitteringen er lest i den digitale postkassen.",
  PRINTET: "Kvitteringen er printet og sendt i posten.",
  IKKE_LEVERT: "Kvitteringen kunne ikke leveres - verken digitalt eller på papir."
};

// Sluttilstandene. Der slutter pollingen, fordi statusen ikke kan endre seg mer.
const FORSENDELSE_SLUTTSTATUSER = ["LEST", "PRINTET", "IKKE_LEVERT"];

// Simulatoren utleder SENDT etter 10 s og LEVERT etter 60 s, så tre sekunder
// mellom hvert oppslag viser hele progresjonen uten å hamre på ruten.
const FORSENDELSE_POLL_MS = 3000;

// Uten en frist blir en forsendelse som aldri når en sluttilstand en linje som
// spinner til fanen lukkes. 60 s er nok for simulatoren; fristen er romslig.
const FORSENDELSE_FRIST_MS = 180_000;

// Tre forsøk, altså rundt seks sekunder: nok til å ri av et enkelt glipp, kort
// nok at en linje ikke står og spinner på et svar som ikke kommer.
const FORSENDELSE_MAKS_FEIL = 3;

/*
 * Pollingen lever på tvers av turer i chatten, så den må kunne stoppes utenfra
 * - «Start chat» og «Nullstill» tømmer chatEl, og en runde som fortsatt skrev
 * til den gamle boblen ville skrevet til et element ingen ser.
 *
 * Et løpenummer, ikke et flagg: en ny runde kan starte med én gang, uten å
 * vente på at den forrige våkner av sin egen vent().
 */
let forsendelsesloep = 0;

function stopForsendelsespolling(): void {
  forsendelsesloep += 1;
}

/*
 * Søknadsdokumentet, som egen boble med sin egen form. Bygget her i stedet for
 * med addMsg fordi boblen har to deler - en overskrift og selve dokumentet -
 * og fordi teksten er formatert på serversiden og skal leses slik den er.
 */
function addDokumentboble(dokument: string): void {
  const rad = document.createElement("div");
  rad.className = "msg dokument";
  const boble = document.createElement("div");
  boble.className = "bubble";
  const overskrift = document.createElement("div");
  overskrift.className = "dokumenttittel";
  overskrift.textContent = "Søknaden som ble sendt inn";
  const tekst = document.createElement("pre");
  tekst.textContent = dokument;
  boble.appendChild(overskrift);
  boble.appendChild(tekst);
  rad.appendChild(boble);
  chatEl.appendChild(rad);
  chatEl.scrollTop = chatEl.scrollHeight;
}

/*
 * Statuslinja skrives om i stedet for å få en ny boble per runde: seks linjer
 * sier ingenting mer enn den siste, og MOTTATT → SENDT → LEST er en bevegelse
 * man skal se, ikke lese seg gjennom. Spinneren står så lenge det kan komme
 * mer, og forsvinner når statusen er endelig - ellers spinner den for alltid.
 *
 * En runde som fant samme status som forrige gang skriver ingenting, og det er
 * ikke bare sparte DOM-operasjoner: #chat er aria-live="polite", så en
 * uendret tekst skrevet på nytt hvert tredje sekund leses opp på nytt hvert
 * tredje sekund - tjue ganger mens forsendelsen står i MOTTATT. Av samme grunn
 * ruller siden bare når linjen faktisk sa noe nytt: dokumentboblen over er høy,
 * og en leser som bla oppover i den skal ikke rykkes ned igjen mens hen leser.
 */
function setForsendelsestekst(boble: HTMLElement, tekst: string, ferdig: boolean): void {
  if (boble.dataset.tekst === tekst && boble.dataset.ferdig === String(ferdig)) {
    return;
  }
  boble.dataset.tekst = tekst;
  boble.dataset.ferdig = String(ferdig);
  boble.textContent = "";
  if (!ferdig) {
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    boble.appendChild(spinner);
  }
  boble.appendChild(document.createTextNode(tekst));
  chatEl.scrollTop = chatEl.scrollHeight;
}

async function followForsendelse(soknadId: string): Promise<void> {
  stopForsendelsespolling();
  const loep = forsendelsesloep;
  const rad = addMsg("forsendelse", "");
  const boble = rad?.querySelector<HTMLElement>(".bubble");
  if (!boble) return;
  setForsendelsestekst(boble, "Følger kvitteringen hos SvarUt …", false);

  const frist = Date.now() + FORSENDELSE_FRIST_MS;
  let feil = 0;
  while (loep === forsendelsesloep) {
    try {
      const svar = await req<Forsendelsesstatussvar>(
        `/api/soknader/${encodeURIComponent(soknadId)}/forsendelse`
      );
      if (loep !== forsendelsesloep) return;
      feil = 0;
      const kode = svar.status || "";
      const ferdig = FORSENDELSE_SLUTTSTATUSER.includes(kode);
      setForsendelsestekst(boble, FORSENDELSESTEKST[kode] || `Kvitteringen har status ${kode}.`, ferdig);
      if (ferdig) return;
    } catch (error) {
      if (loep !== forsendelsesloep) return;
      feil += 1;
      if (feil >= FORSENDELSE_MAKS_FEIL) {
        setForsendelsestekst(boble, `Fikk ikke status på kvitteringen: ${feilmelding(error)}`, true);
        return;
      }
    }
    if (Date.now() >= frist) {
      setForsendelsestekst(boble, "Kvitteringen har ikke nådd en sluttilstand ennå. Start chatten på nytt for å følge en ny.", true);
      return;
    }
    await vent(FORSENDELSE_POLL_MS);
  }
}

/*
 * Kanalen navngis ikke her. Den avgjøres av SvarUt ut fra kontaktregisteret, og
 * statuslinja leser den avgjørelsen - SENDT_DIGITALT/LEST mot SENDT_PRINT/
 * PRINTET er kanalvalget, sett fra utsiden.
 *
 * Kvitteringen er best effort, så en søknad kan være lagret uten at noe ble
 * sendt. Da finnes det ingen status å polle, og det skal stå her i stedet for
 * at linjen spinner på en forsendelse som aldri ble opprettet.
 */
function showInnsending(resultat: Stegresultat): void {
  if (resultat.soknadsdokument) {
    addDokumentboble(resultat.soknadsdokument);
  }
  const advarsel = resultat.forsendelse?.advarsel;
  if (advarsel) {
    const detalj = resultat.forsendelse?.detalj;
    addMsg("system", `⚠️ ${advarsel}${detalj ? ` (${detalj})` : ""}`);
    return;
  }
  if (!resultat.soknadId || !resultat.forsendelseId) {
    addMsg("system", "Det ble ikke sendt noen SvarUt-kvittering for denne søknaden.");
    return;
  }
  // Ikke await-et: pollingen skal gå videre mens chatten er brukbar.
  followForsendelse(resultat.soknadId);
}

async function runHandling(payload: Record<string, unknown>, successText: string): Promise<void> {
  const steg = oekt?.aktivtSteg;
  addTyping();
  let result: Handlingsresultat;
  try {
    result = await req<Handlingsresultat>(`/api/prosessoekter/${oekt!.oektsId}/handling`, {
      method: "POST",
      body: JSON.stringify(payload || {})
    });
  } finally {
    removeTyping();
  }
  oekt = result.oekt;

  // Samtykkestatus vises i statusstripa og sendes med som grunnlag når
  // innbygger spør om databruk.
  const resultat = Array.isArray(result.resultat) ? null : result.resultat;
  if (steg?.type === "CONSENT_REQUEST" && resultat?.status) {
    sisteSamtykke = {
      status: resultat.status,
      formaal: resultat.formaal,
      dataKilder: resultat.dataKilder
    };
  }

  updateSessionInfo();
  addMsg("system", successText);
  const summary = summarizeResult(steg, result.resultat);
  if (summary) {
    addMsg("assistant", summary);
    samtale.push({ rolle: "assistent", tekst: summary });
  }
  warnAboutFallback(resultat);

  if (steg?.type === "SUBMIT" && resultat) {
    showInnsending(resultat);
  }

  // Et utfall reiser spørsmål. Å tilby dem er billigere enn å håpe at
  // innbygger vet at de kan spørre. Settes her, men tegnes av
  // renderQuickActionsFor - goNext() tegner knappene på nytt rett etter.
  if (steg?.type === "SJEKK") {
    ventendeOppfolging = ["Hvorfor ble det slik?", "Hvilke opplysninger brukte dere?", "Hva skjer med opplysningene mine?"];
  } else if (steg?.type === "SUMMARY") {
    ventendeOppfolging = ["Hva skjer videre nå?", "Hvilke opplysninger brukte dere?"];
  }

  await goNext();
}

async function ensureConsentDecision(status: string, successText: string): Promise<void> {
  if (!oekt?.aktivtSamtykkeId) {
    addMsg("system", "Jeg oppretter samtykkeforespørselen nå.");
    const opprettet = await req<Handlingsresultat>(`/api/prosessoekter/${oekt!.oektsId}/handling`, {
      method: "POST",
      body: JSON.stringify({ handling: "opprett-samtykke" })
    });
    oekt = opprettet.oekt;
    updateSessionInfo();
  }
  await runHandling({ handling: "samtykkesvar", status }, successText);
}

async function autoRunStep(steg: ProsessSteg, successText: string): Promise<void> {
  if (!oekt || aktivAutoHandling === steg.id) {
    return;
  }
  aktivAutoHandling = steg.id;
  try {
    await vent(250);
    await runHandling({}, successText);
  } finally {
    aktivAutoHandling = null;
  }
}

async function renderStep(): Promise<void> {
  setQuickActions([]);
  const steg = oekt?.aktivtSteg;
  if (!steg || !oekt) {
    addMsg("system", "Ingen aktivt steg.");
    return;
  }
  if (oekt.status === "AVVIST") {
    addMsg("error", oekt.avvistMelding || oekt.resultater?.[steg.id]?.melding || "Søknaden ble avvist.");
    return;
  }
  if (oekt.status === "FULLFORT") {
    addMsg("assistant", "Da er vi ferdige. Takk for at du gikk gjennom dette sammen med meg.");
    return;
  }

  addMsg("assistant", promptForStep(steg));
  renderQuickActionsFor(steg);

  if (steg.type === "DATA_FETCH") {
    await autoRunStep(steg, "Jeg henter opplysningene nå.");
    return;
  }

  if (steg.type === "SJEKK") {
    await autoRunStep(steg, "Jeg sjekker opplysningene nå.");
    return;
  }

  if (steg.type === "SUMMARY") {
    await autoRunStep(steg, "Jeg lager oppsummeringen nå.");
    return;
  }

  if (!["INFO", "QUESTION", "CONSENT_REQUEST", "SUBMIT"].includes(steg.type)) {
    addMsg("error", `Ukjent stegtype: ${steg.type}`);
  }
}

/*
 * Knappene for et steg. Egen funksjon fordi et sidespørsmål må kunne
 * tegne dem på nytt uten å kjøre steget om igjen.
 *
 * feilrutetTekst er rømningsveien: ble en melding lest som spørsmål når
 * den var et svar, sender knappen den inn som svar med ett trykk.
 */
function renderQuickActionsFor(steg: ProsessSteg, feilrutetTekst: string | null = null): void {
  const knapper: Hurtigknapp[] = [];

  if (steg.type === "INFO") {
    knapper.push({ label: "Start", onClick: () => goNext() });
  }

  const valgfelt = enesteValgfelt(steg);
  if (steg.type === "QUESTION" && valgfelt) {
    for (const alternativ of valgfelt.alternativer || []) {
      const verdi = alternativVerdi(alternativ);
      knapper.push({
        label: alternativLabel(alternativ),
        // hoppOverSporsmaalsruting: et trykk er aldri et spørsmål, og verdien
        // skal inn uendret.
        onClick: () => sendMessage(verdi, { hoppOverSporsmaalsruting: true })
      });
    }
  }

  if (steg.type === "CONSENT_REQUEST") {
    knapper.push(
      { label: "Ja, det går fint", onClick: () => ensureConsentDecision("SAMTYKKET", "Takk, jeg ordner det.") },
      { label: "Nei, ikke nå", onClick: () => ensureConsentDecision("IKKE_SAMTYKKET", "Helt i orden."), secondary: true }
    );
  }

  if (steg.type === "SUBMIT") {
    knapper.push(
      { label: "Ja, send inn", onClick: () => runHandling({}, "Da sender jeg inn søknaden.") },
      { label: "Ikke ennå", onClick: () => addMsg("assistant", "Helt i orden. Gi beskjed når du vil sende den inn."), secondary: true }
    );
  }

  for (const sporsmaal of ventendeOppfolging) {
    knapper.push({
      label: sporsmaal,
      secondary: true,
      onClick: () => {
        addMsg("user", sporsmaal);
        samtale.push({ rolle: "innbygger", tekst: sporsmaal });
        answerSidesporsmaal(sporsmaal, true);
      }
    });
  }

  if (feilrutetTekst) {
    knapper.push({
      label: "Nei, dette var svaret mitt",
      secondary: true,
      onClick: () => sendMessage(feilrutetTekst, { hoppOverSporsmaalsruting: true })
    });
  }

  setQuickActions(knapper);
}

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

// Egen funksjon framfor et nytt sendMessage-kall: sendMessage skriver
// innbyggerens melding i loggen øverst, så en runde til dobler den.
async function svarPaaSpoersmaal(steg: ProsessSteg, tekst: string): Promise<void> {
  if (!oekt) return;
  oekt = await req<Prosessoekt>(`/api/prosessoekter/${oekt.oektsId}/svar`, {
    method: "POST",
    body: JSON.stringify({ stegId: steg.id, svar: tekst })
  });
  addMsg("assistant", acknowledgeSvar(steg, tekst));
  updateSessionInfo();
  await goNext();
}

async function sendMessage(
  overstyrtTekst: string | null = null,
  valg: { hoppOverSporsmaalsruting?: boolean } = {}
): Promise<void> {
  const text = typeof overstyrtTekst === "string" ? overstyrtTekst : inputEl.value.trim();
  if (!text) return;
  if (typeof overstyrtTekst !== "string") {
    inputEl.value = "";
  }
  addMsg("user", text);
  samtale.push({ rolle: "innbygger", tekst: text });

  if (!oekt || !oekt.aktivtSteg) {
    addMsg("error", "Start en prosess først.");
    return;
  }

  if (oekt?.status === "AVVIST") {
    addMsg("error", "Søknaden ble avvist. Start en ny søknad om du vil prøve igjen.");
    return;
  }

  const steg = oekt.aktivtSteg;
  const lower = normalize(text);

  // Eksplisitt rømningsvei begge veier: «svar:» tvinger teksten inn som
  // svar på steget, og knappen fra gjenopptaFlyt setter samme flagg.
  const tvungetSvar = valg.hoppOverSporsmaalsruting || lower.startsWith("svar:");
  const reellTekst = lower.startsWith("svar:") ? text.slice(4).trim() : text;

  if (!tvungetSvar && isSidesporsmaal(text, steg)) {
    await answerSidesporsmaal(text);
    return;
  }

  try {
    if (steg.type === "INFO") {
      // Any input at an info step means the user has read the information
      // and wants to move on - whether they say "fortsett", name a street,
      // or anything else that is not a side-question.
      //
      // Men var teksten mer enn et «gå videre», var den svaret på spørsmålet
      // som kommer. Da sendes den inn i stedet for å kastes.
      const nesteSteg = (aktivProsess?.steg || [])[oekt.stegIndex + 1];
      const svarerFramfor = nesteSteg?.type === "QUESTION" && !erFortsettSignal(reellTekst);
      await goNext({ tegnSteg: !svarerFramfor });
      const nyttSteg = oekt?.aktivtSteg;
      if (svarerFramfor && nyttSteg?.type === "QUESTION") {
        await svarPaaSpoersmaal(nyttSteg, reellTekst);
      }
      return;
    }

    if (steg.type === "QUESTION") {
      await svarPaaSpoersmaal(steg, reellTekst);
      return;
    }

    if (steg.type === "CONSENT_REQUEST") {
      const tolkning = await interpretBrukersvar(reellTekst, { ja: "samtykke-ja", nei: "samtykke-nei", ukjent: "ukjent" }, { handling: "consent" });
      warnAboutFallback(tolkning);
      if (tolkning.intent === "samtykke-ja") {
        await ensureConsentDecision("SAMTYKKET", "Takk, jeg ordner det.");
        return;
      }
      if (tolkning.intent === "samtykke-nei") {
        await ensureConsentDecision("IKKE_SAMTYKKET", "Helt i orden.");
        return;
      }
      // Uklart svar på et samtykkespørsmål skal aldri gjettes på. Var det
      // egentlig et spørsmål, svarer vi på det i stedet for å mase.
      if (!tvungetSvar) {
        await answerSidesporsmaal(reellTekst);
        return;
      }
      addMsg("assistant", "Jeg vil være sikker på at jeg forstod deg riktig. Svar gjerne «ja» eller «nei» - samtykke må være utvetydig.");
      return;
    }

    if (steg.type === "DATA_FETCH" || steg.type === "SJEKK" || steg.type === "SUMMARY") {
      addMsg("assistant", "Jeg holder på med dette steget nå - men spør gjerne om noe imens.");
      return;
    }

    if (steg.type === "SUBMIT") {
      const tolkning = await interpretBrukersvar(reellTekst, { ja: "send-ja", nei: "send-nei", ukjent: "ukjent" }, { handling: "submit" });
      warnAboutFallback(tolkning);
      if (tolkning.intent === "send-ja") {
        await runHandling({}, "Da sender jeg inn søknaden.");
        return;
      }
      if (tolkning.intent === "send-nei") {
        addMsg("assistant", "Helt i orden. Vi kan vente med innsendingen til du er klar.");
        return;
      }
      if (!tvungetSvar) {
        await answerSidesporsmaal(reellTekst);
        return;
      }
      addMsg("assistant", "Du kan for eksempel svare «ja, send inn» eller «nei, ikke ennå».");
      return;
    }

    addMsg("error", `Ukjent stegtype: ${steg.type}`);
  } catch (error) {
    addMsg("error", `Feil: ${feilmelding(error)}`);
  }
}

async function startChat(): Promise<void> {
  try {
    const personId = personEl.value;
    const prosessId = prosessEl.value;
    aktivProsess = prosesser.find((p) => p.id === prosessId) || null;
    stopForsendelsespolling();
    sisteSamtykke = null;
    ventendeOppfolging = [];
    samtale.length = 0;
    oekt = await req<Prosessoekt>("/api/prosessoekter", {
      method: "POST",
      body: JSON.stringify({ personId, prosessId, sporingsId: `flyt-${Date.now()}` })
    });
    chatEl.innerHTML = "";
    updateSessionInfo();
    addMsg("assistant", `Hei ${valgtPerson()}! Jeg kan hjelpe deg med ${aktivProsess?.navn || prosessId}.`);
    await renderStep();
  } catch (error) {
    addMsg("error", `Kunne ikke starte chat: ${feilmelding(error)}`);
  }
}

async function loadOptions(): Promise<Person[]> {
  const personer = await req<Person[]>("/api/personer");
  const prosessData = await req<Prosess[] | { prosesser?: Prosess[] }>("/api/prosesser");
  // Offentlig ressurs, ingen samtykke. Dette er grunnlaget frie spørsmål
  // om satser og inntektsgrenser besvares fra.
  satser = await req<unknown>("/api/regler/satser").catch(() => null);
  prosesser = Array.isArray(prosessData) ? prosessData : (prosessData?.prosesser || []);
  // ID-porten decided who you are, so the person selector reports it rather
  // than offering a choice. See showLoggedInPerson in felles.ts.
  showLoggedInPerson(personEl, personer);
  prosessEl.innerHTML = prosesser.map((p) => `<option value="${htmlEscape(p.id)}">${htmlEscape(p.navn)}</option>`).join("");
  return personer;
}

krevEl("start").onclick = () => startChat();
krevEl("send").onclick = () => sendMessage();
krevEl("reset").onclick = () => {
  stopForsendelsespolling();
  oekt = null;
  aktivProsess = null;
  sisteSamtykke = null;
  ventendeOppfolging = [];
  samtale.length = 0;
  chatEl.innerHTML = "";
  setQuickActions([]);
  updateSessionInfo();
  addMsg("system", "Chat nullstilt.");
};
inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

checkModell(aiBase, {
  konsekvens: "Svarene under kommer fra maler, ikke fra en modell."
});

requireLogin()
  .then((innlogget) => {
    // requireLogin() gir false når nettleseren allerede er på vei til ID-porten.
    if (innlogget) return loadOptions();
    return null;
  })
  .then((personer) => {
    if (!personer) return;
    addMsg("assistant", "Velg en prosess, så kan vi starte når du vil.");
  })
  .catch((error: unknown) => addMsg("error", `Kunne ikke laste grunnlag: ${feilmelding(error)}`));
