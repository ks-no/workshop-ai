/*
 * Hvilke oppgaver som er verdt en reasoning-modell, og hvilke providere som kan.
 *
 * Reasoning er en egenskap ved oppgaven, ikke en innstilling for tjenesten: en global
 * innstilling ville gjort de fleste kallene dårligere for å hjelpe ett. Hvilken vei
 * hver oppgave falt, og hva som ble målt, står i tabellen under.
 *
 * Modulen ligger her og ikke i `server.ts` av samme grunn som `sporsmaalsperrer.ts`:
 * `server.ts` kaller `server.listen` på toppnivå og kan ikke importeres av en test.
 * Den har ingen avhengigheter, så `pnpm test:reasoning` kjører uten modell og uten
 * tjenester.
 *
 * Fra team/bergen, trimmet til oppgavene denne sandkassen faktisk har.
 */

/**
 * Oppgavene, og om hver av dem tenker, med målingen som er grunnen.
 *
 * Én tabell og ikke to lister, av samme form som `PROVIDER_REASONING` under: et «av»
 * skal være et valg noen har tatt og begrunnet, ikke en oppgave noen glemte, og med
 * to tabeller måtte en test i tillegg passe på at ingen oppgave sto i begge. En
 * oppgave som mangler her er en oppgave ingen har vurdert, og `pnpm test:reasoning`
 * sier hvilken.
 */
export const OPPGAVE_REASONING: Record<string, { tenker: boolean; grunn: string }> = {
  oppsummering: {
    tenker: false,
    grunn: "Skal gjengi tall og utfall uendret. Med reasoning skrev Nemotron «innvilgt» der utfallet var «innvilget», og GLM la på overskrifter."
  },
  "tolk-svar": {
    tenker: false,
    grunn: "Samme treffsikkerhet med og uten, men opptil 12 ganger latensen. Oppgaven står midt i en dialog der noen venter."
  },
  "velg-prosess": {
    tenker: false,
    grunn: "Kort valg fra en hviteliste. Heuristikken tar de fleste, og modellen trenger ikke tenke på resten."
  },
  "velg-verktoy": {
    tenker: false,
    grunn: "Samme som velg-prosess: et valg fra en hviteliste, ikke en syntese."
  },
  sporsmaal: {
    tenker: false,
    grunn: "Innbyggeren venter mens flyten står stille, og svaret skal komme fra grunnlaget i stedet for fra en utledning."
  },
  dommer: {
    tenker: false,
    grunn: "Utviklerverktøy for evalene. Reasoning ga samme score på de fire prøvesakene, og en dommer som er tre ganger tregere gjør et helt datasett tregere."
  },
  dialogforslag: { tenker: false, grunn: "Kort formulering, ingen syntese." },
  "forklar-databruk": { tenker: false, grunn: "Kort formulering av noe som allerede står i katalogen." },
  klarsprak: { tenker: false, grunn: "Skriver om en tekst som allerede finnes." },
  risikosjekk: { tenker: false, grunn: "Kort formulering, og ingen avgjørelse ligger hos modellen." }
};

/** Om oppgaven ber om reasoning. En ukjent oppgave gjør det ikke. */
export function reasoningForOppgave(task?: string | null): boolean {
  return OPPGAVE_REASONING[String(task)]?.tenker === true;
}

/** Oppgaver ingen har vurdert. `pnpm test:reasoning` bruker denne. */
export function uvurderteOppgaver(alleOppgaver: readonly string[]): string[] {
  return alleOppgaver.filter(oppgave => !Object.hasOwn(OPPGAVE_REASONING, oppgave));
}

/**
 * Hvilke providere som faktisk kan tenke.
 *
 * `false` her betyr ikke at modellen bak provideren ikke kan tenke - det betyr at
 * *denne* gatewayen ikke har en målt måte å be om det på. En reasoning-oppgave kjører
 * da uten tenking, og svaret sier `tenkte: false` i stedet for å late som. Å påstå
 * støtte vi ikke har prøvd er verre enn å mangle den: da ser en oppgave ut som den
 * tenker uten å gjøre det.
 */
export const PROVIDER_REASONING: Record<string, { stotter: boolean; grunn: string }> = {
  mock: { stotter: false, grunn: "Maltekst, ingen modell." },
  ollama: {
    stotter: false,
    grunn: "Gatewayen setter ikke Ollamas `think`-felt. Reasoning-støtte er ikke verifisert for denne providerintegrasjonen; dette sier ikke om den valgte modellen kan tenke."
  },
  openrouter: {
    stotter: false,
    grunn: "OpenRouter har et `reasoning`-felt. Det er ikke prøvd mot denne sandkassen, så støtten er ikke målt."
  },
  "telenor-ai-factory": {
    stotter: true,
    grunn: "Målt: `chat_template_kwargs.enable_thinking` styrer tenkingen, og tenkedelen kommer tilbake i `reasoning_content`."
  },
  bedrock: {
    stotter: false,
    grunn: "Claude har extended thinking, men kallet her setter ingen `thinking`-blokk, og støtten er ikke målt mot en konto."
  }
};

export function providerKanReasoning(provider: string): boolean {
  return PROVIDER_REASONING[provider]?.stotter === true;
}

/** `reasoning` er om modellen kan tenke, `reasoningAnbefalt` om den er best til det. */
export type Reasoningmodell = { id: string; reasoning?: boolean; reasoningAnbefalt?: boolean };

/**
 * Modellene nøkkelen gir tilgang til, med `label` og `merknad` til /admin.
 *
 * Kuratert og ikke hentet: endepunktet svarer ikke på `/v1/models`. `reasoning` er
 * målt mot endepunktet, ikke lest av et modellkort - begge de to første svarer med
 * `reasoning_content`, og Qwen3-Coder-Next svarer likt med og uten
 * `enable_thinking`. Første oppføring er standarden når `TELENOR_AI_FACTORY_MODEL`
 * er helt usatt; hold den lik det `.env.example` og `docker-compose.yml`
 * dokumenterer, så de tre ikke sier ulike ting.
 */
export const AI_FACTORY_MODELS: readonly (Reasoningmodell & { label: string; merknad: string })[] = [
  { id: "GLM-5.2-FP8", label: "GLM-5.2-FP8", reasoning: true, merknad: "Tenker, men ble kuttet av taket på en tung oppgave i tre av tre forsøk." },
  { id: "NVIDIA-Nemotron-3-Super-120B-A12B-FP8", label: "NVIDIA-Nemotron-3-Super-120B-A12B-FP8", reasoning: true, reasoningAnbefalt: true, merknad: "Tenker, og rakk den tunge oppgaven på 8,4 sekunder." },
  { id: "Qwen3-Coder-Next-FP8", label: "Qwen3-Coder-Next-FP8", reasoning: false, merknad: "Ingen tenkemodus: svarer likt med og uten enable_thinking." }
];

/**
 * Modellen en reasoning-oppgave skal kjøre på.
 *
 * Den er skilt fra modellvalget ellers fordi hvilken modell som rekker gjennom en
 * tung oppgave er målt: GLM-5.2 med reasoning ble kuttet av taket i tre av tre
 * forsøk, mens Nemotron svarte på 8,4 sekunder. En ønsket modell uten tenkemodus -
 * Qwen3-Coder-Next har ingen - kan ikke stå her, og blir byttet ut med en advarsel i
 * stedet for å svare uten å tenke.
 */
export function velgReasoningModell(
  modeller: readonly Reasoningmodell[],
  oensket?: string | null
): { modell: string | null; advarsel?: string } {
  const kandidater = modeller.filter(modell => modell.reasoning === true);
  if (kandidater.length === 0) {
    return { modell: null, advarsel: "Ingen av de tilgjengelige modellene har en tenkemodus." };
  }
  // Den anbefalte, ikke den første som kan: GLM-5.2 kan tenke og er likevel gal som
  // standard, fordi den ble kuttet av taket i tre av tre forsøk. Rekkefølgen i listen
  // styres av hvilken modell som er standard ellers.
  const standard = kandidater.find(modell => modell.reasoningAnbefalt === true) ?? kandidater[0];
  // Et uttrykt ønske om en modell som kan tenke respekteres, også når en annen er
  // anbefalt: den som setter variabelen vet noe om oppgaven vi ikke vet.
  if (!oensket || kandidater.some(modell => modell.id === oensket)) {
    return { modell: oensket || standard.id };
  }
  const hvorfor = modeller.some(modell => modell.id === oensket) ? "har ingen tenkemodus" : "er ikke en kjent modell";
  return { modell: standard.id, advarsel: `${oensket} ${hvorfor}. Reasoning-oppgaver bruker ${standard.id} i stedet.` };
}
