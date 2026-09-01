# shared

Det delte laget, og det ligger **under** tjenestene: frontend, spesifikasjonslesing,
tilstands-I/O og de domenenøytrale bladene mer enn én tjeneste trenger. Ingen server,
ingen port, ingen `package.json` - filene serveres på `/assets/*` av både `demo-gui` og
`process-builder`, resten importeres direkte.

Navnet er `shared`, ikke `shared-ui`, fordi laget holder langt mer enn frontend:
`http.ts`, `errors.ts`, `openapi.ts`, `registerdata.ts`, `jsonstore.ts`, maskering,
fødselsnummer og samtykkets kodeverk.

| Fil | Hva | Lest av |
|---|---|---|
| `tjenester.json` | **Tjenestelista.** Navn, port, rolle, om den har spesifikasjon | dashboardet, API-utforskeren, `pnpm test:openapi`, `pnpm test:docs` |
| `openapi.ts` | Leser en OpenAPI-fil uten YAML-parser og gir rutene som JSON | alle åtte API-tjenestene, på `/openapi-ruter.json` |
| `client/felles.ts` | Innlogging, tokenhåndtering, helsestatus, felles DOM-hjelpere | alle sidene i `demo-gui` og `process-builder`, på `/delt/felles.ts` |
| `assets.ts` | Serverer statiske filer, og type-stripper `.ts` på vei ut | `demo-gui`, `process-builder` |
| `http.ts`, `errors.ts` | CORS, JSON- og tekstsvar, innsnevring av fanget feil | alle tjenestene |
| `jsonstore.ts` | `state/`-før-`data/`-lesing, og **den ene skrivekøen** | `sandbox-backend`, `fiks-simulator` |
| `registerdata.ts` | Formene i `brreg.seed.json` og `folkeregister.seed.json` | `tools-api`, `fiks-simulator`, `matrikkel-mock`, `skjerming.ts` |
| `innbyggerdata.ts` | Formene i `personer.json`, `husstander.json`, plass-datasettene og `samtykker.json` | `sandbox-backend`, `fiks-simulator` |
| `alder.ts` | `alderVed` - alder på en gitt dato, ikke i dag | reglene, porten, importøren |
| `foedselsnummer.ts` | Modulus 11 og Skatteetatens +80-markør | `sandbox-backend`, `fiks-simulator`, `process-agent`, porten |
| `skjerming.ts` | Maskering av adressebeskyttede personer | `sandbox-backend`, `fiks-simulator` |
| `handleevne.ts` | Hvem som kan opptre, og på hvems vegne | `sandbox-backend`, `digdir-mock` |
| `samtykke.ts`, `statemachine.ts` | Samtykkets kodeverk, tilstandsmaskin og utløp | `sandbox-backend`, `fiks-simulator` |
| `felles.css` | Stilen `demo-gui` og `process-builder` faktisk bruker | samme |
| `ds-base.css`, `ds-ksdigital.css` | KS Digital designsystem, vendoret som ren CSS | `ds-eksempel.html` |

## `tjenester.json` er sannhetskilden for tjenestelista

Den filen er grunnen til at det ikke finnes en tjenestetabell i `README.md` - en
håndholdt kopi driver. Legger du til en tjeneste, er dette filen du endrer -
dashboardet, API-utforskeren og to porter følger etter av seg selv.

## Pilene peker én vei, og `pnpm test:imports` feller det

`sandbox-backend` og `fiks-simulator` importerte hverandre: motoren hentet samtykkets
kodeverk fra fiks, mens fiks hentet maskering, fødselsnummervalidering og sin egen
`Person`-type fra motoren. `sandbox-backend` og `digdir-mock` hadde samme knute, ett
blad bred. **Hver enkelt pil var lokalt riktig** - å importere regelen slår å ha en kopi
til av den - og feilen fantes bare i summen: et par ingen kunne lese, teste eller flytte
hver for seg. Det er nettopp den feilen ingen fanger i en diff, så den sjekkes i stedet
for å huskes.

To regler, og de er ikke samme regel:

- **Ingen sykler mellom apper.** Ikke «ingen kryssimport»: `digdir-mock` eier
  tokenprotokollen, og alle som trenger et token henter klienten sin derfra. Det er én
  pil som peker én vei, og det er hva en tjenestegrense er til for. Det som er forbudt,
  er pila tilbake.
- **`apps/shared` importerer ingenting fra en app.** Et delt lag som strekker seg
  tilbake i en tjeneste ligger ikke under tjenestene, det ligger ved siden av - og drar
  med seg den tjenesten inn i hver test som importerer laget.

Hva som hører hjemme her: en regel mer enn én tjeneste trenger. Ikke symmetri.
`oppgave.ts` ble værende i `fiks-simulator` selv om `samtykke.ts` flyttet, fordi
oppgaven har én leser og samtykket har to - `sandbox-backend` svarer også for det.

## Reglene som gjelder her

- **Aldri `felles.css` og ds-CSS på samme side.** `felles.css` har ingen `@layer`, og
  ulagde regler slår hver layer i kaskaden, så den overstyrer designsystemet stille:
  Inter forsvinner og alle knappevarianter blir like blå. Det ser ut som stilarket ikke
  lastet. Det gjorde det - det ble overstyrt. Skal du overstyre med vilje, deklarér
  `@layer side;` og legg reglene der.
- **Aldri rediger `ds-base.css` eller `ds-ksdigital.css`.** `pnpm ds:hent` overskriver
  dem.
- **All skriving til delte filer i `state/` går gjennom `updateJson` i `jsonstore.ts`.**
  Den gjør hele read-modify-write inne i køen, og den rene skriveren er privat med
  vilje: å skrive en kopi requesten leste tidligere er nettopp lost update-en som
  kostet repoet en søknad, en prosess og et deltakersteg - på fire steder, hvorav ett
  hadde kø. En sperre som må huskes, er ingen sperre. `pnpm test:concurrency` og
  `pnpm test:samtykke` pinner det. `ai-gateway` og `digdir-mock` skriver fortsatt hver
  sin egen fil i `state/` utenfor lageret; de har én skriver hver, så det finnes ingen
  andre å miste en oppdatering til.
- **Nettleserkoden ligger i `client/`, og er `.ts` som alt annet.** Den kompileres
  ikke: `assets.ts` kjører den gjennom `module.stripTypeScriptTypes()` når den
  serveres, så typene forsvinner og linjenumrene står. Katalognavnet er ikke pynt -
  rot-`tsconfig.json` ekskluderer `**/client/**`, og hver `client/`-katalog har sin
  egen `tsconfig.json` som utvider `tsconfig.client-base.json`, med DOM-typer og uten
  `@types/node`. Legger du en nettleserfil utenfor `client/`, blir den sjekket mot
  feil miljø.
- **`felles.ts` er et klassisk skript, sidescriptene er moduler.** Derfor er
  funksjonene og typene i `felles.ts` globale, mens hver side har sitt eget scope og
  kan gjenbruke navn. Det er `moduleDetection: "legacy"` i klient-configene som gjør
  at tsc ser det slik.
- **Hver `client/`-katalog må ha en fil som heter nøyaktig `tsconfig.json`.** Editorer
  finner en fils prosjekt ved å gå oppover og lete etter det navnet - en config med et
  annet navn blir aldri funnet, og da lyser hele filen rødt med «Cannot find name
  renderTopNav». Configen må også inkludere `felles.ts`, ellers er ikke de globale
  funksjonene i samme program.

Lager du din egen frontend: ny fil, ikke endringer i `demo-gui`. De to eksisterende er
det andre team leser for å forstå sandkassen, og de skal fortsatt virke.
Se `docs/designsystem.md` og <http://localhost:3001/ds-eksempel>.
