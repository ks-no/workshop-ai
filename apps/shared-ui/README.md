# shared-ui

Det delte laget: frontend, spesifikasjonslesing og tilstands-I/O. Ingen server, ingen
port, ingen `package.json` — filene serveres på `/assets/*` av både `demo-gui` og
`process-builder`, og `openapi.ts` og `jsonstore.ts` importeres direkte av tjenestene.

| Fil | Hva | Lest av |
|---|---|---|
| `tjenester.json` | **Tjenestelista.** Navn, port, rolle, om den har spesifikasjon | dashboardet, API-utforskeren, `pnpm test:openapi`, `pnpm test:docs` |
| `openapi.ts` | Leser en OpenAPI-fil uten YAML-parser og gir rutene som JSON | alle sju API-tjenestene, på `/openapi-ruter.json` |
| `client/felles.ts` | Innlogging, tokenhåndtering, helsestatus, felles DOM-hjelpere | alle sidene i `demo-gui` og `process-builder`, på `/delt/felles.ts` |
| `assets.ts` | Serverer statiske filer, og type-stripper `.ts` på vei ut | `demo-gui`, `process-builder` |
| `http.ts`, `errors.ts` | CORS, JSON- og tekstsvar, innsnevring av fanget feil | alle tjenestene |
| `jsonstore.ts` | `state/`-før-`data/`-lesing, og **den ene skrivekøen** | `sandbox-backend`, `fiks-simulator` |
| `registerdata.ts` | Formene i `brreg.seed.json` og `folkeregister.seed.json` | `brreg-mcp`, `folkeregister-mcp`, `tools-api` |
| `felles.css` | Stilen `demo-gui` og `process-builder` faktisk bruker | samme |
| `ds-base.css`, `ds-ksdigital.css` | KS Digital designsystem, vendoret som ren CSS | `ds-eksempel.html` |

## `tjenester.json` er sannhetskilden for tjenestelista

Den fila er grunnen til at det ikke finnes en tjenestetabell i `README.md` lenger. Fire
håndholdte kopier hadde drevet fra hverandre, og tre av dem manglet `digdir-mock`.
Legger du til en tjeneste, er dette fila du endrer — dashboardet, API-utforskeren og to
porter følger etter av seg selv.

## Reglene som gjelder her

- **Aldri `felles.css` og ds-CSS på samme side.** `felles.css` har ingen `@layer`, og
  ulagde regler slår hver layer i kaskaden, så den overstyrer designsystemet stille:
  Inter forsvinner og alle knappevarianter blir like blå. Det ser ut som stilarket ikke
  lastet. Det gjorde det — det ble overstyrt. Skal du overstyre med vilje, deklarér
  `@layer side;` og legg reglene der.
- **Aldri rediger `ds-base.css` eller `ds-ksdigital.css`.** `pnpm ds:hent` overskriver
  dem.
- **All skriving til delte filer i `state/` går gjennom `updateJson` i `jsonstore.ts`.**
  Den gjør hele read-modify-write inne i køen, og den rene skriveren er privat med
  vilje: å skrive en kopi requesten leste tidligere er nettopp lost update-en som
  kostet repoet en søknad, en prosess og et deltakersteg — på fire steder, hvorav ett
  hadde kø. En sperre som må huskes, er ingen sperre. `pnpm test:concurrency` og
  `pnpm test:samtykke` pinner det. `ai-gateway` og `digdir-mock` skriver fortsatt hver
  sin egen fil i `state/` utenfor lageret; de har én skriver hver, så det finnes ingen
  andre å miste en oppdatering til.
- **Nettleserkoden ligger i `client/`, og er `.ts` som alt annet.** Den kompileres
  ikke: `assets.ts` kjører den gjennom `module.stripTypeScriptTypes()` når den
  serveres, så typene forsvinner og linjenumrene står. Katalognavnet er ikke pynt —
  rot-`tsconfig.json` ekskluderer `**/client/**`, og hver `client/`-katalog har sin
  egen `tsconfig.json` som utvider `tsconfig.client-base.json`, med DOM-typer og uten
  `@types/node`. Legger du en nettleserfil utenfor `client/`, blir den sjekket mot
  feil miljø.
- **`felles.ts` er et klassisk skript, sidescriptene er moduler.** Derfor er
  funksjonene og typene i `felles.ts` globale, mens hver side har sitt eget scope og
  kan gjenbruke navn. Det er `moduleDetection: "legacy"` i klient-configene som gjør
  at tsc ser det slik.
- **Hver `client/`-katalog må ha en fil som heter nøyaktig `tsconfig.json`.** Editorer
  finner en fils prosjekt ved å gå oppover og lete etter det navnet — en config med et
  annet navn blir aldri funnet, og da lyser hele fila rødt med «Cannot find name
  renderTopNav». Configen må også inkludere `felles.ts`, ellers er ikke de globale
  funksjonene i samme program.

Lager du din egen frontend: ny fil, ikke endringer i `demo-gui`. De to eksisterende er
det andre team leser for å forstå sandkassen, og de skal fortsatt virke.
Se `docs/designsystem.md` og <http://localhost:3001/ds-eksempel>.
