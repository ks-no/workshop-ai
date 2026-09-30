<p align="center">
  <img src="docs/assets/ks-digital-logo.png" alt="KS Digital" width="360">
</p>

# Innbyggerdialog Sandbox

En samarbeidsvennlig sandkasse for hackathon og utforskning av moderne innbyggerdialog i kommunal sektor.

Målet er å gjøre det enkelt for interne og eksterne utviklingsteam å prototype kommunale tjenester med syntetiske data, tydelige API-er, sporbarhet og mockede integrasjoner. Hvilken form tjenesten får - dialog, skjema, oversikt, varsling eller noe annet - er teamets valg.

## Innhold

<details>
<summary>Alle seksjonene</summary>

- [Før du begynner](#før-du-begynner)
- [Hva sandkassen er](#hva-sandkassen-er)
- [Designprinsipp for hackathon](#designprinsipp-for-hackathon)
- [Status](#status)
- [Hva som logges](#hva-som-logges)
- [Hvordan starte den](#hvordan-starte-den)
- [Hvordan stoppe den](#hvordan-stoppe-den)
- [Oversikt over tjenester og porter](#oversikt-over-tjenester-og-porter)
- [Demo-brukere](#demo-brukere)
- [Demo-flyt](#demo-flyt)
- [Eksempel på API-kall](#eksempel-på-api-kall)
- [Sjekker du kan kjøre](#sjekker-du-kan-kjøre)
- [Hvor syntetiske data ligger](#hvor-syntetiske-data-ligger)
- [Hvordan legge til nye prosesser](#hvordan-legge-til-nye-prosesser)
- [Hvordan legge til nye syntetiske datasett](#hvordan-legge-til-nye-syntetiske-datasett)
- [Samarbeid](#samarbeid)
- [Lisens](#lisens)
- [Kjente begrensninger](#kjente-begrensninger)
- [Viktige filer](#viktige-filer)

</details>

## Før du begynner

Dette må du ha installert på maskinen din:

| Hva                               | Trengs til | Hent den |
|-----------------------------------|---|---|
| **Docker**, installert og startet | å kjøre sandkassen. Det eneste kravet for `./start.sh` | [docs.docker.com](https://docs.docker.com/get-docker/) |
| **git**                           | å hente repoet | [git-scm.com](https://git-scm.com/downloads) |
| **Node 22.18 eller nyere**        | å hente et token (`node scripts/token.ts`), og å kjøre testskriptene. **Nesten alle API-kall krever token**, så i praksis trenger du Node så snart du gjør noe selv | [nodejs.org](https://nodejs.org/en/download) |
| **pnpm**                          | å kjøre `pnpm <skript>` i det hele tatt. `pnpm install` i tillegg bare til `pnpm lint`, live reload på Windows, og Bedrock-provideren - verken sandkassen eller de andre testskriptene trenger et `pnpm install` | [pnpm.io](https://pnpm.io/installation) |

Har du allerede Node, er `corepack enable` som regel nok til å få pnpm - `package.json`
sier hvilken versjon som skal brukes. Følger ikke Corepack med din Node-versjon, tar
lenken over de andre veiene.

Sjekk at du har det:

```bash
docker --version && node --version && git --version
```

**Portene `3000`, `3001` og `8080`–`8088` må være ledige.** Er en av dem
opptatt, står det i `docs/feilsoking.md` hvordan du finner ut hvilken.

**Sett av tid første gang: 4-7 minutter**, og mer med `--ollama` eller på delt
konferansenett. Senere oppstarter tar sekunder.

**Plass på disk.** Repoet, rundt 65 MB med git-historikken, pluss ett delt
`node:24-alpine`-image som alle elleve tjenestene kjører fra. Med `--ollama` kommer
Ollama og modellen i tillegg: 0,4 GB for den minste og 9 GB for den største.

På Windows: kjør fra Git Bash (følger med Git for Windows) eller [WSL](https://learn.microsoft.com/windows/wsl/install) - se [«På Windows»](#på-windows) lenger ned.

> [!NOTE]
> **Deltaker på hackathon? Denne filen er ikke inngangen din.** Fire sider, i rekkefølge:
>
> 1. [`docs/oppdraget.md`](docs/oppdraget.md) - hva dere skal lage, og hva som er fritt
> 2. [`docs/deltakerstart.md`](docs/deltakerstart.md) - én kommando, URL-ene, hvilken
>    demobruker som hører til hvilken case, første eget API-kall, og feilsøking
> 3. [`docs/bygg-selv.md`](docs/bygg-selv.md) - egen frontend på egen port, egne
>    tjenester, og hva som er frosset
> 4. [`docs/innlevering.md`](docs/innlevering.md) - hva som må ligge i forken før fristen,
>    og hvordan dere registrerer teamet
>
> Og før du begynner: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) gjelder alle, i lokalet og i repoet.
>
> Kom tilbake hit når du vil ha hele bildet: alle flagg, porter og kjente begrensninger.
>
> [`docs/README.md`](docs/README.md) er kartet over all dokumentasjonen.

## Hva sandkassen er

Sandkassen er en lokal utviklingsarena for å utforske hvordan innbyggere kan møte kommunen. Demoene her er dialogbaserte fordi en samtale var raskeste vei til å ta i bruk alle API-ene samtidig - ikke fordi dialog er svaret. Se `docs/oppdraget.md`.

Sju demo-case er publisert; `Redusert foreldrebetaling i barnehage` er
flaggskipet og det eneste som er dekket av en informasjonsmodell. Casene og hvilken
testbruker som hører til hver, står i `docs/deltakerstart.md`.

Arkitekturen er lagt opp for samarbeid mellom flere team, med tydelige grenser mellom frontend, backend, simulatorer, policyer og datasett.

**Den er ikke bundet til ett arrangement.** Sandkassen ble laget til et hackathon, og
det som bare gjelder det arrangementet står i [`docs/hackathon-2026.md`](docs/hackathon-2026.md).
Resten virker like godt for en kommune eller en leverandør som vil prøve noe på egen
hånd: klon, kjør `./start.sh`, og bygg mot API-ene. Den er fortsatt en sandkasse
og ikke et produkt - [«Kjente begrensninger»](#kjente-begrensninger) sier hva det betyr.

## Designprinsipp for hackathon

Høy autonomi, og nok støtte til at teamene faktisk rekker å levere: felles API-er og enkle integrasjonsflater, uten å låse noen til én bestemt frontend, ett bestemt prosessformat eller ett bestemt verktøy. Referanseimplementasjonene i repoet, som `process-builder` og `demo-gui`, er hjelpemidler og eksempler - ikke tvungne måter å bygge løsningene på.

## Status

Elleve kjørende tjenester, én valgfri avhengighet i kjøretid, sju komplette demo-case. På plass:

- samtykkeflyt med sperre på inntektsdata uten samtykke, håndhevet ett sted
- revisjonslogg over all datatilgang
- deterministisk vilkårsvurdering mot satser (`SJEKK`) - utenfor modellen, med vilje
- syntetiske data forankret i Folkeregisterets informasjonsmodell og KS Fiks beregnings-API
- KI-spor: hvert modellkall lagres med prompt og svar, lesbart på `GET /trace`
- evals av KI-laget: `pnpm test:eval`
- OpenAPI for alle ni API-tjenestene, komplett og holdt i takt med koden av
  `pnpm test:openapi`: hver rute dokumentert, med `security:` per rute

## Hva som logges

**Loggene sier hva sandkassen gjorde, ikke hvem som kjørte den.** Ingen brukerkonto,
ingen tilgangslogg, ingen bruksmålinger, og ingenting sendes til KS Digital. To ting
lagres med vilje, begge i `state/` på din egen maskin:

- **Revisjonsloggen** (`state/revisjonslogg.json`) - én hendelse hver gang sandkassen
  leser data, endrer et samtykke, tar et prosessteg eller kaller modellen.
- **KI-sporet** (`state/ai-trace.jsonl`) - full prompt og fullt svar per modellkall.

Kjører du mot en KI-provider som ikke er lokal, går hele prompten ut av maskinen. Og
`./start.sh --reset` legger en kopi av `state/` i `_backup/` før den sletter.
[`docs/hva-logges.md`](docs/hva-logges.md) har hele bildet.

## Hvordan starte den

Kravene til maskinen står under [«Før du begynner»](#før-du-begynner).

```bash
./start.sh
```

Fire til sju minutter første gang. KI-leverandøren er mock til du velger noe annet, så
KI-svarene er maltekst i stedet for modellgenerert - flyten, samtykkesperren,
revisjonsloggen og alle API-ene er de samme. Skriptet sjekker portene, lager `.env`
hvis den mangler, starter tjenestene og venter til alle svarer.

**Vil du ha en lokal modell:**

```bash
./start.sh --ollama
```

Da kjører Ollama på maskinen din, ikke i Docker. Skriptet henter en modell som passer
minnet, 0,4-9 GB, sjekker at den svarer og husker valget i `.env`. På macOS installerer
det Ollama med brew hvis den mangler, og spør først. På Linux og Windows må Ollama være
installert fra <https://ollama.com/download>. Detaljene, og hvorfor Ollama ikke ligger
i Docker, står i
[«Lokal modell med Ollama»](apps/ai-gateway/README.md#lokal-modell-med-ollama). Andre
leverandører velger du på <http://localhost:8082/admin>.

Stopp med `./start.sh -d`.

### På Windows

Kjør skriptet fra Git Bash eller WSL. Da får du `--ollama` og en sjekk av at modellen
svarer. Med Ollama for Windows er det Git Bash som ser `ollama`-kommandoen.

`start.bat` og `stop.bat` finnes i repoet, men de er et nødløsningsalternativ, ikke en
ekvivalent. `start.bat` sjekker portene, lager `.env` hvis den mangler, og venter til alle
elleve tjenestene svarer på `/helse`. Den tar `--reset`, `--reload`, `-d`, `--down` og
`--help`, men ingen modellflagg. **Den kjører alltid med mock** - den sjekker ikke om en
modell svarer, så alt annet enn maltekst ville vært en tom lovnad. Den krever også
`curl`, og stopper med en beskjed hvis den mangler, siden den ikke kan sjekke oppstarten
uten. Vil du ha en ekte modell, bruk Git Bash eller WSL og `./start.sh`. Foretrekk
uansett den veien hvis du har valget.

Windows-stien er dessuten den vi kjører minst selv. Sjekkene som verken trenger stack
eller modell kjøres nå på Windows og macOS i en egen arbeidsflyt
(`.github/workflows/plattform.yml`), så et plattformavvik blir funnet av en rød sjekk
og ikke av deg. Selve oppstarten er fortsatt ikke dekket av noen automatisk sjekk på
Windows.

### Valg

Du skal normalt ikke trenge noen av disse.

| Flagg | |
|---|---|
| `--ollama` | Bruk en lokal modell i Ollama på maskinen, og husk valget i `.env` |
| `-m, --model MODEL` | Sammen med `--ollama`: en bestemt modell i stedet for den automatisk valgte |
| `-y, --yes` | Ikke spør før Ollama installeres eller en modell lastes ned |
| `--mock` | Bruk mock denne gangen, uansett hva `.env` sier |
| `--reload` | Gjenskap Node-containerne, også når konfigurasjonen er uendret. Tar inn kode og Compose-endringer uten å slette `state/` |
| `--reset` | Stopp Node-tjenestene, kopier `state/` til `_backup/`, tøm den, og gjenskap containerne fra kildedataene |
| `-d, --down` | Stopp alt |
| `-h, --help` | Hjelp |

`--reset`, `--reload` og `--down` er separate operasjoner og kan ikke kombineres.
Et lagret valg i KI-admin overstyrer `.env`. Dersom det hindrer
`--mock`, stopper skriptet med en forklaring i stedet for å melde at alt er klart.

### Kildedata og kjøringstilstand

`data/` er kildedata og skrives aldri til. Alt tjenestene endrer under kjøring havner i `state/`, som er gitignorert. En demokjøring skitner derfor ikke til arbeidstreet - kjører du en flyt og deretter `git status`, skal den være ren.

`./start.sh --reset` stopper først alle Node-tjenestene, tar en sikkerhetskopi uten
signeringsnøkkelen og sletter så `state/`. Feiler stopp eller kopiering, slettes
ingenting. Containerne gjenskapes etterpå, slik at lagret KI-valg, tokenbuffer og
agentøkter i minnet også nullstilles.
Stopp eventuelle tjenester du har startet utenfor Compose selv før du nullstiller.
Se `docs/syntetiske-data.md`, også for hvordan du deler en prosess du har laget i byggeren.

### Hvis noe ikke virker

Kontroller at modellen er koblet på:

```bash
curl -s http://localhost:8082/helse
```

`"modellNaaBar": true` betyr at provideren svarer og modellen er lastet ned. Er den `false`, følger et `feil`-felt som sier hvorfor. Merk at status alltid er 200 - tjenesten lever selv om modellen ikke gjør det, så det er `modellNaaBar` du skal lese.

Er modellen nede, faller `ai-gateway` tilbake til maltekst og setter et `advarsel`-felt. `/chat` og `/agent` viser en gul stripe når det skjer, og `./start.sh` advarer ved oppstart - men svarene i seg selv ser normale ut, så det er verdt å vite hvor du sjekker.

Kontroller at alle tjenestene kjører:

```bash
docker compose ps
```

Alle skal stå som `healthy`.

Alt annet - `401` på alt, «fetch failed» på matrikkel-oppslag, maltekst du ikke ba
om, port opptatt, en container som ikke blir `healthy`, en gammel Ollama-container og
hvordan du nullstiller - står i `docs/feilsoking.md`: ett symptom per avsnitt, med
årsak og løsning.

### Se hva modellen faktisk gjorde

```
http://localhost:8082/trace
```

Ett kall per linje, nyeste øverst, med full prompt og fullt svar før heuristikk og validering har vært innom - pluss varighet, modell og om det feilet. Samme data som JSON på `GET /trace.json`, med `?sporingsId=`, `?task=` og `?limit=`.

Sporet ligger i `state/ai-trace.jsonl` og nullstilles av `./start.sh --reset`.

Logger: `docker compose logs -f ai-gateway`.

### Manuell oppstart

<details>
<summary>Kommandoene</summary>

`./start.sh` gjør dette for deg. Les skriptet hvis du vil se detaljene - det er kommentert.

```bash
cp .env.example .env
docker compose up -d
```

Det starter alle elleve tjenestene, og Compose venter på helsesjekkene der én tjeneste
avhenger av en annen. Starter du bare noen av dem, må `digdir-mock` og `matrikkel-mock`
være med - de svikter stille når de mangler. Hvordan de feiler står i punktlisten under
[tjenesteoversikten](#oversikt-over-tjenester-og-porter).

</details>

## Hvordan stoppe den

```bash
./start.sh -d
```

Eller direkte med `docker compose down`.

## Oversikt over tjenester og porter

`./start.sh` starter alle sammen, så du trenger ikke velge.

Tjenestene, portene og rollene deres ligger i `apps/shared/tjenester.json`, og
<http://localhost:3001> viser dem med levende helsestatus og en lenke rett inn i
API-utforskeren for hver.

To ting tabellen ikke sier, og som er verdt å vite før noe feiler:

- **`digdir-mock` (`8086`) utsteder alle tokens.** Er den nede, svarer hvert autentisert
  kall 401 mens `docker compose ps` ser helt frisk ut, fordi tokenfeilen svelges i
  klienten. Den skal alltid med når du starter tjenester manuelt.
- **`matrikkel-mock` (`8085`) er kjerne, selv om den ser valgfri ut.** Uten den feiler
  alle `matrikkel_*`-verktøy og hele `fartsdempende-tiltak`-casen med «fetch failed»,
  mens alt annet ser normalt ut.

Hver API-tjeneste serverer sin egen spesifikasjon på `/openapi.yaml`, samme spesifikasjon
lest som JSON på `/openapi-ruter.json`, og en lesbar side på `/docs`. Den midterste er det
API-utforskeren rendrer, og `pnpm test:openapi` holder alle tre i takt med koden.


## Demo-brukere

Det finnes ikke én demo-bruker som passer alle casene - velg bruker etter case i
tabellen i `docs/deltakerstart.md` §3, som er pinnet i `data/deltakercaser.json`.
Til flaggskipcaset *Redusert foreldrebetaling (barnehage)* passer `person-001`
`Maja Solberg`; i flere av de andre casene gir hun korrekt avslag, så der velger
du bruker fra tabellen.

Data finnes i `data/personer.json`. **`docs/testpersoner.md` er den genererte
oversikten over hele befolkningen** - 394 personer med alder, status, husstand og
en kolonne som sier om personen kan logge inn, bare være part, eller ingen av
delene. `docs/syntetiske-data.md` forklarer datagrunnlaget.

## Demo-flyt

Flaggskipcaset *Redusert foreldrebetaling (barnehage)* kjører hele kjeden i én økt:
husstanden hentes og vises, samtykke innhentes før inntektsdata leses, vilkårene
vurderes deterministisk i backend, KI-laget oppsummerer i klarspråk, innbyggeren
bekrefter, søknaden sendes inn og oppretter en oppgave i Fiks-simulatoren - og
revisjonsloggen viser hver datatilgang underveis.

Demo-GUI-en er prosessdrevet: stegene leses fra valgt prosessdefinisjon, og flyten
kjøres via prosessøkt-API-et i backend. Alle sju casene, og hvilken testbruker som
hører til hver, står i tabellen i `docs/deltakerstart.md` §3, pinnet i
`data/deltakercaser.json`.

## Eksempel på API-kall

**Kall krever token.** `AUTH_ENFORCE` er på som standard, og alt som ikke er uttrykkelig
åpent svarer `401` uten `Authorization`-header.

```bash
export TOKEN=$(node scripts/token.ts --innbygger person-001)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/personer/person-001/husstand
```

Ett token er én person: `person-001`s token åpner ikke `person-031`s data - det gir
`403`. `pnpm token` treffer pnpms egen innebygde kommando, så kall skriptet direkte.

Åpne ruter trenger ingenting: `/helse`, `/docs`, `/openapi.yaml`, `/api/prosesser`,
`/api/katalog/*`, `/api/regler/satser`. `GET /api/katalog/ressurser` oppgir `tilgang` og
`kreverSamtykke` per rute, så du kan lese ut av API-et selv hva som krever hva.

**Videre:**

- <http://localhost:3001/utforsker> - hver rute med skjema, riktig token valgt
  automatisk, og en `curl` som virker når den limes inn. Raskeste vei til et enkeltkall.
- `examples/curl/README.md` - flytene: hele barnehagesøknaden i rekkefølge, og de tre
  ulike svarene samme URL gir avhengig av token og samtykke. `pnpm test:kokebok` kjører
  hvert kall i filen, så et eksempel som ikke virker er en reell feil.


## Sjekker du kan kjøre

Disse krever ingen kjørende tjenester og ingen modell:

```bash
pnpm lint            # tsc --noEmit
pnpm test            # referanseintegritet og scenariodekning i datasettene
pnpm test:kontrakt   # starter egen backend + fiks og skriver en deterministisk dump
```

`pnpm test:kontrakt` normaliserer id-er og tidsstempler, så to kjøringer av samme
kode gir bit-identisk resultat. Bruk den som regresjonsport rundt refaktoreringer:

```bash
pnpm test:kontrakt --ut state/foer.json
# ...endre noe...
pnpm test:kontrakt --ut state/etter.json
diff state/foer.json state/etter.json
```

**Endrer du en prompt, kjør evalene.** `pnpm test:eval` scorer KI-laget mot
datasettene i `evals/`, med terskel per datasett og exit≠0 under. Den krever en
kjørende modell og nekter å score maltekst. Ta en baseline før du endrer, og
sammenlign etterpå - se `evals/README.md`.

Disse krever at stacken kjører: `pnpm test:agent` og `test:agent:nl`.
`test:agent:dialog` starter egne tjenester med KI-mock og kjører de to
agenttestene helt til lagret søknad. `test:matrikkel-mock`, `test:tools-matrikkel`,
`test:agent:matrikkel` og `test:bergen-matrikkel` starter også sine egne tjenester.

Bulk-smoketesten mot matrikkel-mocken plukker stikkprøver fra `data/matrikkel.seed.json`
og slår dem opp:

```bash
pnpm test:bergen-matrikkel
```

Den starter sin egen `matrikkel-mock` uten `MATRIKKEL_DATA_FILE`, så mocken laster hele
`data/matrikkel.json`. Alle gatene i stikkprøven finnes der, og testen trenger derfor
ikke nett. Bommer et oppslag likevel, faller mocken tilbake på et live Geonorge-oppslag,
og uten nett svarer den `404` - ikke `500`.

## Hvor syntetiske data ligger

Syntetiske data ligger under `data/`, og [`data/README.md`](data/README.md) sier hvor de
kommer fra og hva som gjelder for å bruke dem videre:

- `data/personer.json` - 394 personer
- `data/husstander.json` - 200 husstander
- `data/tenor/` - rå uttrekk fra Tenor, kilden importen bygger på
- `data/forventet-utfall.json` - hva hver husstand er ment å demonstrere, pinnet for `pnpm test`
- `data/inntekter.json`
- `data/barnehageplasser.json`
- `data/sfoplasser.json`
- `data/satser.json`
- `data/fritidsaktiviteter.json` og `data/fritidsdeltakelse.json` - grunnlaget for fritidskort
- `data/tjenestetilbud.json` - kommunale tilbud med målgruppe og kapasitet, grunnlaget for støttekontakt
- `data/legeerklaeringer.json` - legeerklæringer til TT-kort, lest av `pasientjournal-mock`
- `data/politiattester.json` - politiattester til vandelskontroll, lest av `politiattest-mock`
- `data/matrikkel.json` - 388 gater og 18 349 eiendommer i 97 kommuner, lest av `matrikkel-mock`
- `data/eierforhold.json` - tinglyst eierskap per matrikkelenhet, slått sammen av `matrikkel-mock` ved innlasting
- `data/matrikkel.seed.json` - liten firegaters fixture for mockens egne tester
- `data/prosessdefinisjoner.json`
- `data/informasjonsmodeller.json`

`matrikkel-mock` er eneste leser av matrikkeldataene. `sandbox-backend` kaller den over
HTTP, så det finnes bare én matrikkel i sandkassen - den som også snakker SOAP.

Søknader, samtykker, oppgaver, meldinger, prosessøkter og revisjonslogg har **ingen**
fil i `data/`. De oppstår først under kjøring og finnes bare i `state/`, som er
gitignorert. Se `docs/syntetiske-data.md`.

## Hvordan legge til nye prosesser

1. Legg ny prosessdefinisjon i `data/prosessdefinisjoner.json`
2. Eller opprett den direkte i prosessbyggeren på `http://localhost:3000`
3. Oppdater eksempel eller dokumentasjon i `examples/demoprosesser/`
4. Dokumenter nødvendig API-bruk i `docs/prosessmodell.md`
5. Hvis prosessen krever nye regler, oppdater relevante filer i `policies/`

## Hvordan legge til nye syntetiske datasett

1. Legg til ny JSON-fil i `data/`
2. Beskriv datasettet i `docs/syntetiske-data.md`
3. Oppdater katalog- eller API-dokumentasjon i `docs/api-oversikt.md`
4. Marker alle poster med `syntetisk: true` der det er relevant
5. Lagre filer som UTF-8 (Unicode) slik at norske tegn bevares korrekt

## Samarbeid

Dette repoet er lagt opp for flere team. Se:

- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- [`SECURITY.md`](SECURITY.md)
- `CONTRIBUTING.md`
- `openapi/README.md`
- `docs/architecture.md`
- `docs/api-oversikt.md`
- `docs/designsystem.md`

## Lisens

Sandkassen er lisensiert under **MIT** ([`LICENSE`](LICENSE)). Du kan bruke, endre og
bygge videre på den, også kommersielt, så lenge opphavsnotisen følger med.

[`NOTICE.md`](NOTICE.md) dekker det som har egne vilkår: designsystemet vi har hentet
inn som CSS, adressedataene fra Geonorge, Tenor-uttrekkene, kommunevåpnene i
eksempelsiden og språkmodellene `./start.sh` laster ned.

## Kjente begrensninger

- Tjenestene er bygget som en enkel MVP uten byggesteg, ikke som produksjonsklar
  applikasjon. Én avhengighet finnes i kjøretid - AWS-SDK-en `ai-gateway` bruker til
  Bedrock - og den lastes først når den provideren brukes, så `docker compose up`
  klarer seg uten `pnpm install`
- CI kjører sjekkene som verken trenger modell eller kjørende stack. Listen står i
  `.github/workflows/ci.yml`, med en kommentar per steg om hva det fanger - den er
  kilden, og `pnpm test:docs` feiler hvis en doc gjengir den feil. Evalene og
  stack-testene er bevisst utenfor: de krever en modell eller en oppe stack
- Ingen persistensstrategi utover flate JSON-filer. `process-agent` holder sesjoner i
  minnet og mister dem ved restart
- Datasett og policyer er laget for demo og hackathon, ikke produksjon
- Ingen ekte integrasjoner mot Altinn eller Fiks. ID-porten og Maskinporten er
  mocket i `digdir-mock`, og **håndhevingen er ekte**: `AUTH_ENFORCE` er på, tokener
  verifiseres mot utstederens nøkler, og pid-bindingen holder. Det som er forenklet er
  klientassertionen - den valideres på form, ikke signatur. Se
  `apps/digdir-mock/README.md`

## Viktige filer

- [`docs/README.md`](docs/README.md) - kartet over all dokumentasjonen
- `docs/deltakerstart.md` - start her hvis du er deltaker
- `docs/ordliste.md` - forvaltningstermene forklart slik de brukes i sandkassen
- `apps/shared/tjenester.json` - tjenestene, portene, rollene. Sannhetskilden
- `data/` - de syntetiske datasettene. `docs/syntetiske-data.md` forklarer dem
- `openapi/` - én spesifikasjon per API-tjeneste, holdt i takt av `pnpm test:openapi`
- `policies/` - datapolicy, KI-policy, tilgangspolicy
- [`LICENSE`](LICENSE) og [`NOTICE.md`](NOTICE.md) - MIT, og vilkårene til det vi har hentet inn
- `docker-compose.yml`, `package.json`, `tsconfig.json`
