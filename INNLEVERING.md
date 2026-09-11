# Team Oslo

**Medlemmer:** 181182, tai-truong-uke, eliasriise-uke, eirik-olav-uke, PetterMinne

## Hva vi lagde

«Søk én gang» — én samtale som forbereder flere kommunale tjenester samtidig, for
innbyggere som står i en livshendelse (mistet jobb, flytting, SFO) og i dag må finne og
fylle ut hvert skjema hver for seg.

Innbyggeren beskriver situasjonen sin i fritekst. En agentpipeline
(triage → draft → critic → polish) finner hvilke tjenester som er relevante, henter
syntetiske KS-data etter ett uttrykkelig samtykke, og forbereder neste steg: svar på det
som mangler, riktig kontaktperson, et e-postutkast du selv leser over og sender, eller et
skjema fylt fra bekreftede opplysninger. SFO-skjemaet sendes som testsøknad til
KS-sandkassen og får søknads-ID og saksbehandleroppgave.

Det som er nytt i forhold til sandkassen slik den kom:

- **Kritikersløyfe som faktisk gater svar.** En kritikeragent sjekker utkastet mot åtte
  konkrete signaler (ugrunnede tall, påstått vedtak, oversatte sitater, markedsføringsspråk)
  og sender det tilbake til omskriving ved REVISE. Hele kritikkteksten vises i UI, ikke bare
  verdikten.
- **Modellen anbefaler, appen kontrollerer, innbyggeren utfører.** Agenten kan foreslå en
  sluttaksjon, men Node validerer den mot hva tjenesten faktisk tilbyr. KI kan ikke bekrefte
  fakta, fatte vedtak eller sende en søknad.
- **Dataminimering som er håndhevet, ikke lovet.** Modellkontekst er merket
  privat/ubetrodd, og agentkjøringen stopper hvis den får en tool- eller handlingskapasitet
  utover analyse. Spesialistene ser offentlig veiledning og siterte faktautdrag; registersnapshot
  blir på serveren.
- **Forvaltningsinnsyn.** En innsynsfane viser hele behandlingskjeden per sporingsId:
  hvilken modell, hvilke kilder, hvilke felt som ble strippet.
- **Wallet Ready.** Moderasjonsbevis utstedt som W3C Verifiable Credential med QR og
  ekte Ed25519-signatur.
- **Klarspråkskontrast** av forskriftstekst, på norsk og vietnamesisk.
- **Observability.** Selvhostet Langfuse med én trace per assistentkjøring: modell, latens,
  tokens, finish_reason og antall skjemavalideringsforsøk. Ingen prompt- eller svartekst
  forlater prosessen — observasjonene bærer lengde og et forkortet sha256.
- **Leverandørbytte i drift** mellom Cloudflare Workers AI og Telenor AI Factory, per
  agentrolle, med preflight-sjekk før pipelinen starter.

## Slik kjører du det

Krav: Node.js 22.18+ og Python 3.11+.

```bash
git clone <dette repoet>
cd team-oslo-ks-hackathon
npm ci
npm run setup:backend
npm run setup:ks
cp .env.example .env.local
```

Fyll inn serverinnstillingene for AI-modellen i `.env.local`. Minimum for Cloudflare:
`CF_ACCOUNT_ID` og `CF_AI_GATEWAY_TOKEN`. For Telenor AI Factory: sett `AI_PROVIDER=telenor`
og fyll `TELENOR_AI_FACTORY_BASE_URL` og `TELENOR_AI_FACTORY_API_KEY`.

Start KS-tjenestene i én terminal:

```bash
npm run start:ks
```

Start appen i en annen:

```bash
npm run dev
```

| Hva | URL |
| --- | --- |
| Veiviseren «Søk én gang» | <http://127.0.0.1:3210/> |
| Samtaleassistenten (NO/EN) | <http://127.0.0.1:3210/assistent> |
| Dokumentasjon og diagrammer | <http://127.0.0.1:3210/dokumentasjon> |

**Testbruker:** `person-022` (standard). Kan endres med `KS_PERSON_ID`, men appen har ingen
testpersonvelger. KS-kildene er syntetiske workshopdata, ikke offentlige registre.

Verifisering:

```bash
npm run typecheck && npm run lint && npm test   # 245 tester
npm run test:backend                            # 43 Python-tester
```

Uten modellnøkler kjører appen fortsatt: `/assistent` viser at modellen ikke er konfigurert,
og veiviseren og KS-integrasjonene virker som normalt.

Valgfritt — Langfuse-sporing (av som standard):

```bash
LANGFUSE_ENCRYPTION_KEY=$(openssl rand -hex 32) LANGFUSE_SALT=$(openssl rand -hex 32) \
  docker compose -f docker-compose.langfuse.yml up -d
```

Sett så `LANGFUSE_ENABLED=true` i `.env.local`.

## Andre repoer og lenker

Ingen. Alt ligger i dette repoet, frontend inkludert.

- Demomanus: `docs/demo-script.md`
- Arkitektur: `docs/agentic-architecture.md` og `docs/architecture.md`
- Dommerspørsmål: `docs/judge-questions.md`
- Integrasjoner mot KS-sandkassen: `docs/integrations.md`

## Slik brukte vi KI

**Verktøy:** Claude Code (Opus/Sonnet) som hovedverktøy gjennom hele hackathonet, med
Codex og GitHub Copilot i perioder. Cloudflare Workers AI og Telenor AI Factory er
modellene produktet selv kjører på.

**Til hva:** Vi kjørte issue-drevet — hvert trekk i produktet ble et issue, og agenten
jobbet i egen git-worktree per oppgave og leverte pull request. Modellen skrev det meste
av implementasjonen, testene og dokumentasjonen, og gjorde konfliktopprydding når parallelle
grener kolliderte. Diagrammene og demomanus er også modellskrevet, men lest gjennom.

**Hva vi ikke lot modellen gjøre:**

- **Ikke merge sin egen kode.** Alt gikk gjennom pull request med et menneske på
  merge-knappen. Vi kjørte harde guards som blokkerte agenten fra å pushe til `main`,
  force-pushe eller merge selv.
- **Ikke røre produksjon.** Agenten hadde ingen tilgang til produksjonsmiljø eller
  ekte persondata. Alt er syntetiske workshopdata.
- **Ikke bestemme sikkerhetsgrensene.** At KI ikke kan bekrefte fakta, fatte vedtak
  eller sende en søknad er en menneskelig beslutning kodet som invarianter i Node og
  håndhevet i `analysis_only_middleware` — ikke noe modellen fikk lov til å myke opp
  når det ble upraktisk.
- **Ikke godkjenne sine egne svar.** Kritikersløyfen er en egen modell med et eget
  mandat, og terskelen for REVISE er skrevet av oss.

Vi har også latt KI-en dokumentere det den ikke fikk til — se neste seksjon.

## Det som ikke ble ferdig

- **CI er ikke fullført (issue #3).** Repoet har bare hemmelighetsskanning (gitleaks).
  Typecheck, lint, test og build kjøres lokalt og er grønne, men ikke automatisk på PR.
  Kjør kommandoene over for å verifisere selv.
- **Tak på modellkall, tokens og latens (issue #8) er delvis.** Logging av modellkall
  finnes (`src/server/model-call-log.ts`) og Langfuse måler forbruket, men det er ingen
  håndhevet grense per forespørsel som faktisk avbryter en kjøring.
- **Designsystemet vs. Punkt (issue #9) er halvveis.** Forsiden er migrert til
  Designsystemet; `/assistent` bruker fortsatt Oslo kommunes Punkt. De to
  designsystemene lever side om side, og det synes i overgangen mellom flatene.
- **Verktøykatalogen (issue #17) er ikke ferdig koblet.** Rammeverket for at modellen
  kan nominere verktøy og at Node gater dem på samtykke er på plass og testet, men
  katalogen dekker bare SFO-løpet.
- **Evalsuiten gater ikke i CI.** Gullsettet i `scripts/eval-assistant-goldset.mts`
  finnes og kan kjøres, men siden CI ikke er fullført, stopper ikke en regresjon en PR
  automatisk.
- **Kun én testperson.** `person-022` er hardkodet som standard, og det finnes ingen
  velger i grensesnittet for å bytte.
- **E-post sendes aldri.** Utboksen er en tydelig merket lokal mock. Det er med vilje
  for demoen, men betyr at siste ledd i e-postaksjonen er usimulert.
