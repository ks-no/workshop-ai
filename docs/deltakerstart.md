# Deltakerstart

Denne siden er alt du trenger den første timen. Resten av dokumentasjonen kan vente.

**Lurer du på hva dere egentlig skal lage?** `docs/oppdraget.md` er én side om det, og
tar to minutter.

## 0. Hent repoet

Fork repoet på GitHub («Fork»-knappen øverst på repo-siden), og klon forken din
(krever `git`):

```bash
git clone https://github.com/<ditt-github-brukernavn>/workshop-ai.git
cd workshop-ai
```

Resten av denne siden antar at du står i den mappen.

## 1. Start sandboxen

Du trenger **Docker** installert og startet. Du trenger også **Node 22.18 eller
nyere** så snart du skal kalle et API selv — se avsnitt 4. Så:

```bash
./start.sh --mock
```

Fire til sju minutter. `--mock` kjører uten språkmodell, så KI-svarene er maltekst i
stedet for modellgenerert. Alt annet er ekte: flyten, samtykkesperren, revisjonsloggen
og alle API-ene. Dette er den riktige veien inn første gang, og den eneste som ikke
krever nedlasting av flere gigabyte.

Suksess ser slik ut: skriptet skriver `✅ Ready` (med `--mock` følger en advarsel om
at KI-svarene er maltekst — det er som forventet) — åpne da <http://localhost:3001>,
der alle tjenestene i tabellen skal vise grønt («oppe»).

Vil du ha den ekte modellen etterpå, kjør `./start.sh` uten flagg. Sett av 12–25
minutter til det, mer på delt konferansenett.

På Windows: kjør fra Git Bash eller WSL. `start.bat` finnes som nødløsning, men den
kjører alltid uten språkmodell — se «På Windows» i `README.md`.

Stopp alt med `./start.sh -d`.

## 2. Én URL du trenger, og seks du kommer til å bruke

Start på **<http://localhost:3001>**. Det er oversikten: den viser hvordan tjenestene
henger sammen, om alle kjører, om modellen er koblet på, og hvilken testbruker som
hører til hvilken case. Derfra kommer du til alt annet — hver tjeneste står i tabellen
med spesifikasjonen sin og en lenke rett inn i API-utforskeren. Går noe galt senere, er
det den siden du går tilbake til.

| URL | Hva det er |
|---|---|
| <http://localhost:3001> | **Oversikt** — arkitektur, helsestatus, modellstatus, casetabell |
| <http://localhost:3001/chat> | Chat. Du velger prosess, og kan stille spørsmål underveis. Sender du inn, vises søknadsdokumentet og statusen på SvarUt-kvitteringen mens den beveger seg |
| <http://localhost:3001/agent> | Agent i naturlig språk. Den velger prosess selv |
| <http://localhost:3001/stegvis> | Ett steg av gangen, med rå JSON og revisjonslogg synlig |
| <http://localhost:3001/utforsker> | **API-utforskeren** — alle endepunktene, med skjema per rute og en `curl` som virker når den limes inn. Tokenet velges ut fra hjemmelen ruta krever |
| <http://localhost:3000> | Prosessbygger — lag eller endre en flyt |
| <http://localhost:3001/ds-eksempel> | Designsystem-mal. Trenger du bare hvis du lager din egen frontend — se `docs/designsystem.md` |

De øvrige tjenestene (`:8080`–`:8086`) er API-er du kan bygge mot. Du trenger ikke åpne
noen av dem for å se sandboxen virke — og skal du bygge mot dem, er API-utforskeren
raskere enn å lese spesifikasjonene selv.

## 3. Hvilken bruker til hvilken case

Fem demo-case er publisert. Velg bruker etter case — **det er ikke én bruker som
passer alle:**

| Case | Bruk denne brukeren |
|---|---|
| Redusert foreldrebetaling (barnehage) | `person-001` **Maja Solberg** |
| Redusert betaling i SFO | `person-022` **Fatima Ali** |
| Behovsavklaring for støttekontakt | `person-001` **Maja Solberg** |
| Søknad om fritidskort-støtte | `person-028` **Nora Fjeld** |
| Søknad om fartsdempende tiltak | `person-001` |

Tabellen er pinnet i `data/deltakercaser.json` og sjekket av `pnpm test`, så et
innvilget utfall her er et innvilget utfall i sandkassen.

> **Den vanligste snublesteinen:** `person-001` har *ikke* barn i SFO, og heller
> ikke barn i fritidskortets aldersgruppe. Prøver du de casene med henne, får du et
> avslag som ser ut som en feil, men er riktig. Bruk `person-022` for SFO og
> `person-028` for fritidskort.

For **støttekontakt** avgjør alder og hvor søkeren bor, ikke inntekt — steget ber
derfor ikke om inntektssamtykke, men om samtykke til kontaktopplysningene, som
neste steg henter fra kontaktregisteret. `person-001` får innvilget, `person-003`
får «ingen ledige plasser», og `person-062` bor i en kommune uten registrert
tilbud.

For **fritidskort** avgjør husholdningens inntekt: `person-028` ligger på 158 000 og
får innvilget, mens `person-008` ligger på 653 000 og får avslag. Grensen er 360 000.

For **fartsdempende tiltak** avgjør gatenavnet utfallet: `Storgata` gir godkjent,
`Fjøsangerveien` gir avvist. `person-001` bor og eier i Storgata 3.

## 3b. Hvem kan logge inn

Ikke alle testpersonene kan brukes som innlogget bruker, og det er med vilje:

- **Under 13 år: ingen innlogging.** MinID kan bestilles fra det året man fyller 13,
  så en elektronisk ID finnes ikke før det. 65 av testpersonene er under 13, og de
  står ikke i velgeren på `:8086`.
- **13–17 år: kan logge inn, men er bare part i saken.** Å opptre på egen hånd
  overfor en kommune krever rettslig handleevne, altså 18 år. Prøver du å starte en
  prosess som en 15-åring, får du et 403 som navngir de foresatte som kan være
  avsender — og logger du inn som en av dem, går flyten gjennom.
- **Død, utflyttet eller D-nummer: ingen innlogging.** De finnes i registeret, og et
  barn med en død mor har fortsatt en mor — men de kan ikke være avsender.

`docs/testpersoner.md` har hele befolkningen med en `Logg inn`-kolonne som sier
`ja`, `part` eller `nei` for hver enkelt. `docs/syntetiske-data.md` forklarer
datagrunnlaget: hvor det kommer fra, hva som er forfattet, og hvor grensene går.

## 3c. Startpunkter, så demoene ikke kolliderer

Tabellen over anbefaler samme bruker til flere case, og `person-001` dekker tre av
dem. Er dere flere team, ender alle på henne — og alle demoene ser like ut.

Velg heller ett startpunkt hver herfra. Alle utfallene er pinnet i
`data/forventet-utfall.json` og sjekket av `pnpm test`, så det som står her er det du
faktisk får:

| Bruker | Kommune | Grunnlag | Hva husstanden viser |
|---|---|---:|---|
| `person-022` Fatima Ali | Ålesund | 152 000 | Bredest dekning: barnehage, SFO og fritidskort, alt innvilget |
| `person-024` Sofie Eide | Sandnes | 348 000 | Barnehage, gratis SFO på 1. trinn og fritidskort, alt innvilget |
| `person-028` Nora Fjeld | Trondheim | 158 000 | Blandet: gratis SFO og fritidskort ja, moderasjon på 2.–3. trinn nei |
| `person-033` Bjørn Haugen | Stavanger | 225 000 | Blandet på tvers av barnas alder — to ja, to nei |
| `person-035` Even Moen | Stavanger | 645 000 | Eneste med innvilget moderasjon på 4. trinn, men avslag på 6 %-regelen |
| `person-008` Ingrid Dahl | Stavanger | 653 000 | Tre barn og for høy inntekt: avslag nesten overalt. Avslagsveien er også en vei |
| `person-001` Maja Solberg | Bergen | 485 000 | Barnehage innvilget, og den eneste som også eier i Storgata 3 |

To kanttilfeller når dere vil ha noe vanskeligere: `person-026` Randi Ås har et
grunnlag på null fordi hun bare mottar ytelser som ikke medregnes, og `person-062`
bor i en kommune uten registrert tilbud.

> Vil du ha flere husstander med barnehage- eller SFO-plass enn de som finnes,
> trenger du ikke redigere `data/`. Se «Egne testdata» i `docs/bygg-selv.md`.

## 4. Ditt første eget kall

Klikker du bare i sidene, trenger du ingenting mer. Skal du kalle et API selv, må du
vite dette først: **alt som ikke er uttrykkelig åpent krever token.** Uten
`Authorization`-header får du `401`, og det ser ut som en feil i sandkassen. Det er
det ikke — det er hjemmelslaget, og det er en av tingene sandkassen finnes for å vise.

Hent et token og bruk det:

```bash
export TOKEN=$(node scripts/token.ts --innbygger person-001)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/personer/person-001/husstand
```

To feil er verdt å kjenne fra hverandre:

| | Betyr |
|---|---|
| `401` | Vi vet ikke hvem du er. Du glemte headeren, eller tokenet er utløpt |
| `403` | Vi vet hvem du er, og du får det likevel ikke — feil hjemmel, eller manglende samtykke |

**Ett token er én person.** `person-001`s token åpner ikke `person-031`s data; det
gir `403`. Skal du bruke en annen testbruker, hent et nytt token.

Disse rutene trenger ingenting: `/helse`, `/docs`, `/openapi.yaml`,
`/openapi-ruter.json`, `/api/prosesser`, `/api/katalog/*` og `/api/regler/satser`.
`GET /api/katalog/ressurser` sier selv hvilken tilgang og hvilket samtykke hver
*dataressurs* krever, så du kan lese det ut av API-et.

**Token gjelder bare `sandbox-backend` (`:8080`) og `fiks-simulator` (`:8081`).**
De er de eneste som håndhever hjemmel. `ai-gateway` (`:8082`), `tools-api`
(`:8083`), `process-agent` (`:8084`) og `matrikkel-mock` (`:8085`) svarer uten
`Authorization`. Får du 401 fra en av de fire, er det ikke hjemmelslaget — se etter noe
annet.

Raskeste vei uten å tenke på noe av dette: **<http://localhost:3001/utforsker>** velger
riktig token for ruta og skriver ut en `curl` som virker når du limer den inn.

> `pnpm token` treffer pnpms egen innebygde kommando. Kall skriptet direkte, som over.

## 5. Tre sjekker når noe ser rart ut

**Er modellen koblet på?**

```bash
curl -s http://localhost:8082/helse
```

Les `modellNaaBar`. Er den `false`, forklarer et `feil`-felt hvorfor. Merk at status
alltid er 200 — tjenesten lever selv om modellen ikke gjør det. Kjørte du med
`--mock`, skal den være `false`, og det er som forventet.

> **Har du klikket i <http://localhost:8082/admin> én gang, vinner det valget over
> `--mock` og over `.env`.** Det lagres i `state/ai-provider-override.json` og overlever
> omstart. Får du maltekst du ikke ba om — eller en modell du trodde du hadde skrudd av
> — er det den fila. `./start.sh --mock --reset` nullstiller den.

**Hva fikk modellen egentlig?**

<http://localhost:8082/trace>

Ett kall per linje, nyeste øverst, med full prompt og fullt svar før heuristikk og
validering har vært innom. Dette er raskeste vei til å forstå et rart KI-svar.

**Kjører alle tjenestene?**

```bash
docker compose ps
```

Ser du «fetch failed» på matrikkel-oppslag eller i `fartsdempende-tiltak`-casen, er
det nesten alltid `matrikkel-mock` som ikke er oppe.

## 6. Nullstille

```bash
./start.sh --mock --reset
```

`--reset` tømmer `state/` og starter deretter alt på vanlig måte. **Ta med `--mock` hvis
du kjørte med `--mock`** — uten det begynner den å laste ned språkmodellen.

`data/` er kildedata og skrives aldri til. Alt tjenestene endrer under kjøring havner
i `state/`, som er gitignorert — en demokjøring skitner ikke til arbeidstreet.

---

**Vil du vite mer?** `README.md` har hele bildet: alle flagg, porter, API-eksempler og
kjente begrensninger.

**Skal du bygge noe eget?** `docs/bygg-selv.md` er veien videre: egen frontend på egen
port, hvordan du finner ut hva som finnes, og hva som er frosset. `examples/curl/README.md`
har ferdige kall for hele flyten, og `docs/prosessmodell.md` hvis du vil lage en ny case
inne i prosessmotoren.

**Vil du forstå hvordan sandkassen henger sammen?** `docs/architecture.md` — men den er
skrevet for den som vedlikeholder sandkassen, ikke for den som bygger på den.

**Støter du på et forvaltningsord du ikke kjenner?** `docs/ordliste.md` forklarer termene —
hjemmel, matrikkel, KRR, SvarUt og resten — slik de brukes i sandkassen.
