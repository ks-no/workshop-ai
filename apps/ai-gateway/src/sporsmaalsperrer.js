/*
 * Guardrails for POST /ai/sporsmaal — the one endpoint where a citizen writes
 * free text and gets free text back.
 *
 * The process flow never had this exposure: every other reply either restates a
 * value sandbox-backend already decided, or is a classification validated
 * against a whitelist. Here the model composes, so prompt instructions alone are
 * not a guardrail. Everything in this file runs after the model, in code.
 *
 * Kept as its own module because server.js calls server.listen at the top level
 * and therefore cannot be imported by a test.
 */

/*
 * What actually happens to the data, stated by us rather than by the model.
 *
 * "Hva skjer med opplysningene mine" is a privacy claim. Without a source the
 * model answers from its own priors about GDPR — fluent, plausible and not
 * about this system — and no guardrail here can catch that, because such an
 * answer contains no numbers and takes no decision. So it gets a source.
 *
 * Facts mirror docs/sikkerhet-og-personvern.md. Change them together.
 */
export const PERSONVERN = {
  kilde: "docs/sikkerhet-og-personvern.md",
  punkter: [
    "Alle opplysninger i denne sandboxen er syntetiske. Ingen av dem gjelder en virkelig person.",
    "Ingenting du gjør her fører til et virkelig vedtak. Dette er en demo, ikke en kommunal tjeneste i drift.",
    "Inntektsopplysninger hentes bare hvis du samtykker, og sperren håndheves i tjenesten, ikke i grensesnittet.",
    "Du kan trekke et samtykke du har gitt.",
    "All datatilgang skrives til en revisjonslogg med tidspunkt, formål og hvilket grunnlag den bygde på.",
    "Spørsmål som besvares av språkmodellen lagres lokalt i et KI-spor, slik at det er mulig å se hva modellen fikk og hva den svarte."
  ]
};

const SAFE_ANSWER =
  "Det kan jeg ikke svare på her. Om du har rett til en ordning, og hvor mye du " +
  "eventuelt får, er det saksbehandlingen som avgjør — ikke jeg. Jeg kan forklare " +
  "hvilke opplysninger vi bruker og hvorfor, og hva som skjer i neste steg.";

/*
 * Whole-word matching, not substring. The same lesson as heuristicIntent in
 * server.js: with includes(), "uklart" matched "klar".
 */
function normalizeText(tekst) {
  return String(tekst || "")
    .toLowerCase()
    .replace(/ /g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(ord, uttrykk) {
  const chunks = uttrykk.split(" ");
  for (let i = 0; i <= ord.length - chunks.length; i += 1) {
    if (chunks.every((del, forskyvning) => ord[i + forskyvning] === del)) {
      return true;
    }
  }
  return false;
}

/* ── 1. Beslutningsspråk ──────────────────────────────────────────────────
 *
 * ai-no-decisions in policies/ai-policy.yaml: the model phrases, it does not
 * decide. Restating an outcome sandbox-backend already reached is fine — that
 * is why the carve-out below checks the grounding text.
 */

const BESLUTNINGSMONSTRE = [
  "du har rett til",
  "du har ikke rett til",
  "du far innvilget",
  "du far avslag",
  "jeg innvilger",
  "jeg avslar",
  "vi innvilger",
  "vi avslar",
  "soknaden din er innvilget",
  "soknaden din er avslatt",
  "du kvalifiserer",
  "du kvalifiserer ikke",
  "du oppfyller vilkarene",
  "du oppfyller ikke vilkarene",
  "dette er et vedtak"
];

/*
 * Norwegian å/æ/ø fold to a/ae/o so one pattern covers "avslår" and "avslar".
 */
function foldNorwegian(tekst) {
  return tekst
    .replace(/[æ]/g, "ae")
    .replace(/[øö]/g, "o")
    .replace(/[åä]/g, "a");
}

/* ── 1b. Påstand om at noe er gjort ───────────────────────────────────────
 *
 * Nabofeilen til beslutningsspråk, og like alvorlig: spurt «hva skjer videre
 * nå?» mens flyten står på SUBMIT, svarte modellen «nå har søknaden blitt sendt
 * inn». Den leste stegnavnet «Send søknad» i grunnlaget og antok at det hadde
 * skjedd. Ingen tall, ingen beslutning — usynlig for alle sperrene over.
 *
 * Derfor sier kontekstens flyt-blokk eksplisitt hva som *ikke* har skjedd, og
 * denne sjekken håndhever det.
 */

/*
 * Past tense only. "søknaden blir sendt inn når du bekrefter" is a correct
 * answer and must pass; "søknaden er sendt inn" must not.
 */
const UTFORTMONSTRE = [
  "er sendt inn",
  "blitt sendt",
  "ble sendt",
  "har sendt inn",
  "er registrert",
  "er levert",
  "er mottatt",
  "er behandlet",
  "vi behandler soknaden",
  "soknaden din er sendt"
];

function findFalseCompletionClaims(tekst, kontekst) {
  if (kontekst?.flyt?.soknadSendt !== false) return [];
  const ord = foldNorwegian(normalizeText(tekst)).split(" ").filter(Boolean);
  return UTFORTMONSTRE.filter((monster) => containsPhrase(ord, foldNorwegian(monster)));
}

function findDecisionLanguage(tekst, grunnlagstekst) {
  const ord = foldNorwegian(normalizeText(tekst)).split(" ").filter(Boolean);
  const grunnlagOrd = foldNorwegian(normalizeText(grunnlagstekst));

  return BESLUTNINGSMONSTRE.filter((monster) => {
    if (!containsPhrase(ord, monster)) return false;
    // Quoting an outcome the backend already reached is allowed.
    return !grunnlagOrd.includes(monster);
  });
}

/* ── 2. Tall som ikke finnes i grunnlaget ─────────────────────────────────
 *
 * A hallucinated amount is the most damaging thing this endpoint can produce,
 * and the naive version of this check drowns in false positives. Two decisions
 * keep it usable: build an index of every legal *derived* form of each number
 * in the grounding, and only check numbers large enough or unit-marked enough
 * to matter.
 */

function collectNumbers(verdi, ut = new Set()) {
  if (verdi === null || verdi === undefined) return ut;

  if (typeof verdi === "number" && Number.isFinite(verdi)) {
    ut.add(verdi);
    return ut;
  }

  if (Array.isArray(verdi)) {
    for (const element of verdi) collectNumbers(element, ut);
    return ut;
  }

  if (typeof verdi === "object") {
    for (const element of Object.values(verdi)) collectNumbers(element, ut);
    return ut;
  }

  if (typeof verdi === "string") {
    // Amounts inside strings count too — SJEKK messages are pre-formatted text.
    for (const treff of verdi.replace(/[\s ]/g, "").matchAll(/\d+(?:[.,]\d+)?/g)) {
      const tall = Number(treff[0].replace(",", "."));
      if (Number.isFinite(tall)) ut.add(tall);
    }
  }

  return ut;
}

export function byggGrunnlagsIndeks(kontekst) {
  const raa = collectNumbers(kontekst);
  const lovlige = new Set();

  for (const tall of raa) {
    lovlige.add(tall);
    lovlige.add(Math.round(tall));
    lovlige.add(Math.floor(tall));
    lovlige.add(Math.ceil(tall));
    // regler.ts renders maksAndelAvInntekt 0.06 as "6 %", so the percent form
    // of any fraction below 1 is a legal way to state it.
    if (tall > 0 && tall < 1) {
      lovlige.add(Math.round(tall * 100));
    }
  }

  return lovlige;
}

const AARSTALL_MIN = 1900;
const AARSTALL_MAX = 2100;

/*
 * Returns the numbers in `tekst` that could mislead and are not in the index.
 * Small unmarked numbers (step counts, ages, school years) are skipped on
 * purpose — checking them buys nothing and costs a false positive on every
 * sentence.
 */
export function findUngroundedNumbers(tekst, indeks) {
  const normalisert = String(tekst || "").replace(/ /g, " ");
  const funn = [];

  for (const treff of normalisert.matchAll(/(\d[\d  .]*\d|\d)(\s*(?:kr|kroner|%|prosent))?/gi)) {
    const raatall = treff[1].replace(/[\s.]/g, "");
    const enhet = (treff[2] || "").trim().toLowerCase();
    const tall = Number(raatall);
    if (!Number.isFinite(tall)) continue;

    const erMarkert = enhet.length > 0;
    if (!erMarkert && Math.abs(tall) < 1000) continue;

    // A bare year is prose, not a claim about money.
    if (!erMarkert && raatall.length === 4 && tall >= AARSTALL_MIN && tall <= AARSTALL_MAX) continue;

    if (!indeks.has(tall)) {
      funn.push(erMarkert ? `${tall} ${enhet}` : String(tall));
    }
  }

  return [...new Set(funn)];
}

/* ── 3. Fødselsnummer og promptlekkasje ──────────────────────────────────── */

const PROMPTETIKETTER = ["Oppgavetype:", "Anbefalt innhold:", "Kontekst JSON:", "Grunnlag JSON:"];
const MAKS_SVARLENGDE = 800;

function findLeakedIdentifiers(tekst, kontekstTekst) {
  const funn = [];
  for (const treff of String(tekst || "").matchAll(/\b\d{9}\b|\b\d{11}\b/g)) {
    if (!kontekstTekst.includes(treff[0])) {
      funn.push(treff[0]);
    }
  }
  return [...new Set(funn)];
}

/* ── 4. Prompt injection ──────────────────────────────────────────────────
 *
 * The citizen's text is untrusted input. Caught here it costs nothing; caught
 * after the model call it has already been read as instructions.
 */

const INJEKSJONSMONSTRE = [
  "ignorer instruksjonene",
  "ignorer alle instruksjoner",
  "ignorer det over",
  "glem alt",
  "glem instruksjonene",
  "du er na",
  "fra na av er du",
  "lat som du er",
  "system",
  "systemmelding",
  "ignore previous",
  "ignore all previous",
  "disregard",
  "you are now",
  "new instructions"
];

export function harInjeksjonsmarkorer(tekst) {
  const raa = String(tekst || "");
  if (raa.length > 500) return true;
  if (raa.includes("```")) return true;

  const ord = foldNorwegian(normalizeText(raa)).split(" ").filter(Boolean);
  return INJEKSJONSMONSTRE.some((monster) => containsPhrase(ord, foldNorwegian(monster)));
}

/* ── 5. Grunnlagsdekning ──────────────────────────────────────────────────
 *
 * The number check is blind to an answer with no numbers in it: "Ja, du kan
 * søke selv med høy inntekt" passes everything above. If the question is about
 * a topic the grounding has no source for, refuse before calling the model.
 */

const TEMAKRAV = [
  { tema: "inntektsgrense", ord: ["inntektsgrense", "grense", "sats"], kilde: "satser" },
  { tema: "frist", ord: ["frist", "nar ma jeg soke"], kilde: "frister" }
];

/*
 * Substring matching here, unlike everywhere else in this file. Norwegian
 * compounds mean "søknadsfristen" contains "frist" but shares no whole word
 * with it, and topic detection only decides whether to answer at all — the
 * expensive direction is missing a topic we have no source for, not refusing
 * one question too many.
 */
export function manglendeGrunnlagFor(sporsmaal, kontekst) {
  const tekst = foldNorwegian(normalizeText(sporsmaal));
  for (const krav of TEMAKRAV) {
    const spurt = krav.ord.some((uttrykk) => tekst.includes(foldNorwegian(uttrykk)));
    if (spurt && !kontekst?.[krav.kilde]) {
      return krav.tema;
    }
  }
  return null;
}

/* ── Personvernspørsmål besvares fast ─────────────────────────────────────
 *
 * The only topic answered without asking the model at all.
 *
 * Every other guardrail in this file catches something structural: a number
 * that is not in the grounding, a decision, an identifier. An invented privacy
 * claim has none of those tells — "opplysningene lagres ikke uten samtykke" is
 * fluent, plausible, contains no number, decides nothing, and is not true of
 * this system. Measured against that, a fixed answer is the honest trade.
 */

const PERSONVERNTEMA = [
  "hva skjer med opplysningene",
  "hva skjer med dataene",
  "hvem ser",
  "hvem far se",
  "hvem har tilgang",
  "hvem kan se",
  "hvor lenge",
  "lagres",
  "lagret",
  "slettet",
  "slettes",
  "personvern",
  "gdpr",
  "deles",
  "delt videre",
  "ekte data",
  "virkelige data",
  "syntetisk"
];

export function erPersonvernSporsmaal(sporsmaal) {
  const tekst = foldNorwegian(normalizeText(sporsmaal));
  return PERSONVERNTEMA.some((tema) => tekst.includes(foldNorwegian(tema)));
}

export function byggPersonvernSvar(kontekst) {
  const tjeneste = kontekst?.tjeneste;
  const samtykke = kontekst?.samtykke?.status;

  const linjer = [
    "Kort om opplysningene dine her:",
    "",
    ...PERSONVERN.punkter.map((punkt) => `• ${punkt}`)
  ];

  if (tjeneste) {
    linjer.push("", `I ${tjeneste} er det inntektsopplysningene som er de sensitive, og det er dem samtykket gjelder.`);
  }
  if (samtykke === "SAMTYKKET") {
    linjer.push("Du har allerede samtykket, og du kan trekke det når som helst.");
  }

  return linjer.join("\n");
}

/* ── Trygge svar ──────────────────────────────────────────────────────────── */

export function byggTryggSvar(kontekst, aarsak) {
  if (aarsak === "ikke-utfort") {
    const staarPaa = kontekst?.flyt?.staarPaa;
    return staarPaa
      ? `Vi står fortsatt på «${staarPaa}», og ingenting er sendt inn ennå. Det skjer først når du sier fra at du vil sende.`
      : "Ingenting er sendt inn ennå. Det skjer først når du sier fra at du vil sende.";
  }

  if (aarsak === "injeksjon") {
    return (
      "Jeg holder meg til det denne tjenesten handler om: søknaden din og " +
      "opplysningene vi bruker i den. Spør gjerne om noe av det."
    );
  }

  if (typeof aarsak === "string" && aarsak.startsWith("manglende-grunnlag")) {
    const tema = aarsak.slice("manglende-grunnlag".length).replace(/^:/, "");
    const hva = tema === "frist" ? "søknadsfrister" : tema === "inntektsgrense" ? "satsene og inntektsgrensene" : "det";
    return (
      `Det har jeg ikke grunnlag for å svare på her, og da vil jeg heller si det ` +
      `enn å gjette. Informasjon om ${hva} finner du hos kommunen din.`
    );
  }

  const tjeneste = kontekst?.tjeneste;
  if (tjeneste) {
    return `${SAFE_ANSWER} Vi holder på med ${tjeneste}.`;
  }
  return SAFE_ANSWER;
}

/*
 * Validates a model answer against the grounding it was given.
 *
 * Returns { ok: true, tekst } or { ok: false, tekst, advarsel, sperre }.
 * The caller keeps the real model id and appends "(sperret)", so the trace
 * still shows that the model ran and what it actually said — a guardrail that
 * hides the evidence is worse than none.
 */
export function validateAnswer(tekst, kontekst) {
  const svar = String(tekst || "").trim();
  const kontekstTekst = JSON.stringify(kontekst ?? {});
  const grunnlagstekst = kontekstTekst;

  if (!svar) {
    return { ok: false, sperre: "tomt", advarsel: "Modellen svarte tomt.", tekst: byggTryggSvar(kontekst) };
  }

  if (svar.length > MAKS_SVARLENGDE) {
    return {
      ok: false,
      sperre: "lengde",
      advarsel: `Svaret var ${svar.length} tegn, over taket på ${MAKS_SVARLENGDE}.`,
      tekst: byggTryggSvar(kontekst)
    };
  }

  const lekkasje = PROMPTETIKETTER.filter((etikett) => svar.includes(etikett));
  if (lekkasje.length > 0) {
    return {
      ok: false,
      sperre: "promptlekkasje",
      advarsel: `Svaret gjenga promptstrukturen: ${lekkasje.join(", ")}.`,
      tekst: byggTryggSvar(kontekst)
    };
  }

  const identifikatorer = findLeakedIdentifiers(svar, kontekstTekst);
  if (identifikatorer.length > 0) {
    return {
      ok: false,
      sperre: "identifikator",
      advarsel: `Svaret inneholdt identifikatorer som ikke står i grunnlaget: ${identifikatorer.join(", ")}.`,
      tekst: byggTryggSvar(kontekst)
    };
  }

  const beslutninger = findDecisionLanguage(svar, grunnlagstekst);
  if (beslutninger.length > 0) {
    return {
      ok: false,
      sperre: "beslutning",
      advarsel: `Svaret avgjorde saken selv: «${beslutninger.join("», «")}». KI skal formulere, ikke vedta.`,
      tekst: byggTryggSvar(kontekst)
    };
  }

  const paastander = findFalseCompletionClaims(svar, kontekst);
  if (paastander.length > 0) {
    return {
      ok: false,
      sperre: "ikke-utfort",
      advarsel: `Svaret påstod at noe var gjort som ikke er gjort: «${paastander.join("», «")}». Søknaden er ikke sendt inn.`,
      tekst: byggTryggSvar(kontekst, "ikke-utfort")
    };
  }

  const udekkede = findUngroundedNumbers(svar, byggGrunnlagsIndeks(kontekst));
  if (udekkede.length > 0) {
    return {
      ok: false,
      sperre: "tall",
      advarsel: `Svaret oppga tall som ikke finnes i grunnlaget: ${udekkede.join(", ")}.`,
      tekst: byggTryggSvar(kontekst)
    };
  }

  return { ok: true, tekst: svar };
}

/* ── Projeksjon av konteksten ─────────────────────────────────────────────
 *
 * The caller sends the session it already holds, which contains synthetic
 * national identity numbers, addresses and income lines. Minimising here rather
 * than in each client means there is one implementation, and it is what makes
 * the identifier check above meaningful.
 *
 * docs/sikkerhet-og-personvern.md is explicit that sending the whole context to
 * a model is fine on synthetic data but not a pattern to copy. This is the one
 * endpoint where we do not copy it.
 */
export function sanitizeSporsmaalKontekst(kontekst) {
  const inn = kontekst || {};
  const ut = {};

  if (inn.tjeneste) ut.tjeneste = String(inn.tjeneste);
  if (inn.satser) ut.satser = inn.satser;
  // Always present, never taken from the caller: this is the sandbox's own
  // statement about itself, and it must not be something a client can rewrite.
  ut.personvern = PERSONVERN;

  if (inn.prosess) {
    ut.prosess = {
      navn: inn.prosess.navn,
      beskrivelse: inn.prosess.beskrivelse,
      steg: (inn.prosess.steg || []).map((steg) => ({
        id: steg.id,
        type: steg.type,
        tittel: steg.tittel,
        formaal: steg.formaal,
        dataKilder: steg.dataKilder
      }))
    };
  }

  if (inn.steg) {
    ut.steg = {
      id: inn.steg.id,
      type: inn.steg.type,
      tittel: inn.steg.tittel,
      formaal: inn.steg.formaal,
      dataKilder: inn.steg.dataKilder
    };
  }

  if (inn.samtykke) {
    ut.samtykke = {
      status: inn.samtykke.status,
      formaal: inn.samtykke.formaal,
      dataKilder: inn.samtykke.dataKilder
    };
  }

  // Uten dette leser modellen stegnavnet «Send søknad» i prosessdefinisjonen og
  // antar at det har skjedd. Flyten må si hva som ikke har skjedd, ikke bare
  // hva som finnes.
  if (inn.flyt) {
    ut.flyt = {
      staarPaa: inn.flyt.staarPaa,
      stegNummer: inn.flyt.stegNummer,
      avTotalt: inn.flyt.avTotalt,
      status: inn.flyt.status,
      fullforteSteg: inn.flyt.fullforteSteg,
      gjenstaaendeSteg: inn.flyt.gjenstaaendeSteg,
      soknadSendt: inn.flyt.soknadSendt === true
    };
  }

  // Only the outcome of each finished step, never the payload it was built from.
  if (inn.resultater && typeof inn.resultater === "object") {
    const resultater = {};
    for (const [stegId, resultat] of Object.entries(inn.resultater)) {
      if (!resultat || typeof resultat !== "object") continue;
      const projeksjon = {};
      if (resultat.godkjent !== undefined) projeksjon.godkjent = resultat.godkjent;
      if (typeof resultat.melding === "string") projeksjon.melding = resultat.melding;
      if (resultat.grunnlag && typeof resultat.grunnlag === "object") projeksjon.grunnlag = resultat.grunnlag;
      if (typeof resultat.tekst === "string") projeksjon.tekst = resultat.tekst;
      if (resultat.status) projeksjon.status = resultat.status;
      if (Object.keys(projeksjon).length > 0) {
        resultater[stegId] = projeksjon;
      }
    }
    if (Object.keys(resultater).length > 0) {
      ut.resultater = resultater;
    }
  }

  if (Array.isArray(inn.samtale)) {
    ut.samtale = inn.samtale
      .slice(-6)
      .filter((tur) => tur && typeof tur.tekst === "string")
      .map((tur) => ({ rolle: tur.rolle === "assistent" ? "assistent" : "innbygger", tekst: tur.tekst.slice(0, 400) }));
  }

  // Property ownership data fetched by the caller and included for grounding.
  // Project to address + type only — never expose personIds of other owners.
  if (inn.mineEiendommer?.eiendommer && Array.isArray(inn.mineEiendommer.eiendommer)) {
    ut.mineEiendommer = {
      eiendommer: inn.mineEiendommer.eiendommer.map((e) => ({
        adresse: e.adresse,
        gate: e.gate,
        bruksenhetstype: e.bruksenhetstype,
        kommune: e.kommune
      }))
    };
  }

  return ut;
}

/*
 * Which sources an answer stands on. Shown to the citizen, so it is part of the
 * contract rather than debug output.
 */
export function byggGrunnlag(kontekst) {
  const kilder = [];
  if (kontekst.satser) {
    kilder.push(`Satser${kontekst.satser.gjelderFra ? ` ${kontekst.satser.gjelderFra}` : ""}`);
  }
  if (kontekst.prosess) kilder.push("Prosessdefinisjon");
  if (kontekst.resultater) kilder.push("Din prosessøkt");
  if (kontekst.samtykke) kilder.push("Samtykkestatus");
  if (kontekst.personvern) kilder.push("Personvernerklæring");
  if (kontekst.mineEiendommer) kilder.push("Dine eiendommer (matrikkel)");

  return { kilder, verdier: kontekst };
}
