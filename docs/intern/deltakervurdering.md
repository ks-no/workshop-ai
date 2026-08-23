# Deltakervurdering av sandkassen

> **Internt.** Dette dokumentet vurderer vår egen dokumentasjon og kodekvalitet, og
> hører derfor ikke i deltakernes løype. Er du deltaker, er `docs/deltakerstart.md`
> inngangen.

Gjennomgang av sandkassen sett fra en hackathon-deltakers side: en utvikler som
aldri har sett repoet før, og som skal ha bygget noe eget i løpet av to dager.

Grunnlaget er hele dokumentasjonsflaten, arkitekturen på tvers av alle appene, og
kommentarkulturen i `apps/` og `scripts/`. Alle filstier, linjenummer og tall er
verifisert mot `main` per 23.08.2026, etter `2a017ea` (Arkitekturopprydding, #10).

> **Status: funn 1–6 er utbedret.** Hva som ble gjort, og hva som bevisst ikke ble
> gjort, står i `docs/intern/handover-deltakervurdering.md`. Funnene under er beholdt
> slik de ble stilt, så begrunnelsen for endringene er lesbar i ettertid. Funn 7 og
> nedover står urørt.

---

## Kort fortalt

Sandkassen virker, og prosaen er usedvanlig god på setningsnivå — konkret, kausal,
uten fyll. Problemet er ikke kvalitet, men **adressat**: dokumentasjonen er skrevet
for dem som bygger sandkassen, ikke for dem som skal bygge *på* den. Omtrent fem
dokumenter henvender seg til deltakere; rundt tjuefem til vedlikeholdere.

Løypa tar deltakeren trygt fram til «demoen kjører» og slipper henne der. Det som
mangler er de neste tjue minuttene: første egne API-kall, og veien til noe eget.

To ting til er verdt å si rett ut:

**Repoet peker mot chat.** Det heter «Innbyggerdialog Sandbox», formålsteksten i
`README.md:3` og `:14` sier «dialogbaserte tjenester» og «dialogbasert flyt i stedet
for tradisjonelle skjemaer», `start.sh:474` lister `/chat` rett under «Start here»,
og de stedene ordet «hackathon-oppgave» faktisk står, handler alle om å rydde i
sandkassens egen kode. Ønsker vi at teamene skal tenke bredere enn en samtale, må
rammen sies — ikke antydes.

**Kommentarene er ikke problemet.** Det finnes ingen «Steg 1»/«Oppgave 3»/`TODO`-
kommentarer i repoet i det hele tatt. Grep etter alle vanlige varianter gir null
treff. Det som faktisk finnes, er én støylomme i én fil, pluss en sjangerforvirring
mellom kommentar og endringslogg. Se funn 13.

---

## Lukket siden gjennomgangen begynte

Fem commits landet midt i arbeidet. De tas med fordi de viser noe viktig: ting
rettes raskt her når en maskinell sjekk fanger dem. Det er begrunnelsen for funn 6.

| Var | Nå |
|---|---|
| `mcp-services` hevdet en protokoll tjenesten ikke snakker | Døpt om til `tools-api` (`5398771`), ryddet i kode, compose, tjenesteregister, OpenAPI og testskript |
| `MATRIKKEL_MODE` hadde ulik verdi i kode, compose og `.env.example` | Én verdi alle tre steder (`188084c`) |
| `AGENTS.md` sa «eight» der det skal stå ni, og oppga CI-lista for kort | Begge rettet |
| `type State = any` skygget den ekte typen i fire filer | `state.ts:8` importerer nå `State` fra `types.ts:179` |
| Dokumentasjonsgaten matchet bare «kjører», så engelsk prosa slapp forbi | `check-dokumentasjon.ts:231` matcher nå også `runs` — og fanget straks `AGENTS.md` |
| Samtykke- og oppgaveflatene i `fiks-simulator` sto åpne | Bak Maskinporten, ett scope per flate (`07d29dd`) |

---

# HØY — koster deltakertid på dag 1

## 1. Hackathonet er ikke beskrevet noe sted, og repoet peker mot chat

Det finnes ingen fil som sier hva et team skal bygge, hva som er et godt utfall,
eller at grensesnittsformen er teamets eget valg. Sandkassen er dokumentert;
hackathonet er ikke.

Samtidig sier fem steder at hackathon-oppgaven er å forbedre sandkassen:

| Sted | Tekst |
|---|---|
| `docs/prosessmodell.md:93` | «Å rydde det opp er en hackathon-oppgave» |
| `apps/process-agent/README.md:29` | «is a hackathon task, not a bug to fix first» |
| `apps/ai-gateway/README.md:248` | «førsteoppgave for et team som vil inn i KI-laget» |
| `docs/intern/veien-videre.md:70` | «Å slå den er hackathon-oppgaven» |
| `AGENTS.md:294` | samme formulering |

`docs/prosessmodell.md` er anbefalt lesning fra `deltakerstart.md:141`. En deltaker
som følger den anbefalte løypa får altså vite at oppgaven er å rydde i
`process-agent`. Det er stikk motsatt av «lag noe nyttig for innbyggerne».

**Tiltak.** Ett kort deltakerdokument som setter rammen: innbyggere i en kommune,
syntetiske data, og at formen — samtale, kart, varsling, oversikt, noe helt annet —
er teamets valg. **Uten idéliste.** Et dokument som lister forslag, får alle
teamene til å bygge de samme forslagene, og ville motvirket hele hensikten.

Fjern eller omformuler de tre setningene som står i deltakervendt tekst
(`prosessmodell.md`, de to app-README-ene). De to i `AGENTS.md` og under `intern/`
kan bli stående — de har riktig leser.

Bytt rekkefølgen i `start.sh:473-481` så chat ikke er den første lenken etter
oversikten, og legg inn en linje som peker til deltakerstart.

*Lite arbeid, størst utslag av alt i denne lista.*

## 2. Deltakerstart stopper rett før første egne API-kall

`docs/deltakerstart.md` nevner verken token, 401 eller `scripts/token.ts`.
`AUTH_ENFORCE=true` er default, så alt som ikke er uttrykkelig åpent svarer 401.

Linje 7 sier at Docker er alt man trenger. `README.md:53-60` krever i tillegg
Node 22.18 eller nyere, og pnpm.

Konsekvensen: første gang en deltaker gjør noe utover å klikke i GUI-et, er hun
utenfor det dokumentet hun ble bedt om å lese, og møter en 401 uten forklaring.
Dokumentet lover «alt du trenger den første timen», og det stemmer helt til hun
åpner en terminal.

**Tiltak.** Et avsnitt «Ditt første eget kall» i deltakerstart:
`node scripts/token.ts --innbygger person-001`, ett `curl` som virker, forskjellen
på 401 og 403, og lenke til API-utforskeren som velger token selv. Rett
forutsetningene i samme fil så Node og pnpm står der.

## 3. Ingen vei fra «demoen kjører» til «jeg bygger noe eget»

`deltakerstart.md:141` sender byggeren til `docs/architecture.md`. Det dokumentet
er i praksis en liste over avvik mellom hvordan sandkassen presenterer seg og hva
den faktisk gjør — nyttig for en vedlikeholder, feil sted å begynne for en som
skal bygge.

De faktiske utvidelsespunktene står i `apps/sandbox-backend/README.md:36-45`
(«Utvidelsespunkter») og `docs/prosessmodell.md:101-131`. Ingen deltakerløype
peker dit.

Verre: **ingenting dokumenterer at et team kan kjøre sin egen frontend på sin egen
port.** CORS er `*` med `Authorization` i `Allow-Headers` (`http.ts:6-10`), så en
React- eller Vite-app på `:5173` snakker rett med `:8080` uten proxy. Det virker —
men det står ingen steder, og `AGENTS.md:129` («Do not reach for the React or
Angular packages here») gjelder sandkassens egne sider, mens det leses som et
generelt forbud.

For et hackathon der «vi bruker React» ofte er teamets første beslutning, er dette
den dyreste enkeltmangelen i dokumentasjonen.

**Tiltak.** Ett nytt deltakerdokument — «bygg ditt eget» — som samler:

- de fire utvidelsespunktene fra backend-README-en
- oppskriften på egen frontend på egen port: CORS er åpen, `felles.ts` løser
  innlogging og tokenhåndtering, `ds-eksempel.html` er malen
- det frosne wire-formatet, så ingen døper om et svarfelt
- katalogendepunktene (`GET /api/katalog/ressurser` med `tilgang` og
  `kreverSamtykke` per rute), som gjør kontrakten selv-oppdagbar

*Mest praktisk nytte per side i hele lista.*

## 4. Windows-løypa er brutt

`start.bat:62` setter `WATCH_POLL=1`, som får `scripts/dev.sh:22-28` til å kjøre
`node_modules/.bin/nodemon`. Den fila finnes bare etter `pnpm install`.

Verken `start.bat`, `README.md:93-100` eller `docs/deltakerstart.md:21` nevner
det — og `README.md:60` sier eksplisitt at pnpm trengs «bare testskriptene».

Feilen er usynlig for oss: utviklingstrærne våre har nodemon installert. En fersk
klone på Windows treffer den.

**Tiltak.** Verifiser på en Windows-maskin først. Deretter enten `pnpm install`
inn i `start.bat`, eller en fallback i `dev.sh` når nodemon mangler. Det siste er
tryggest, siden det også dekker den som starter containere manuelt.

## 5. Tjenestens egen README er systematisk den minst korrekte kilden om tjenesten

Det er der en deltaker leter først. To levende tilfeller, begge i tjenester
deltakerne vil bruke:

| Sted | Påstand | Virkelighet |
|---|---|---|
| `apps/tools-api/README.md` | 18 rader i verktøytabellen | Koden har 25 `inputSchema` |
| `apps/fiks-simulator/README.md:16` | samtykke-, oppgave- og meldingsflatene er «foreløpig åpne» | `07d29dd` lukket dem. `docs/architecture.md` er oppdatert; README-en er ikke |

Og to til, i tekst deltakerne blir vist til:

| `README.md:97-99` | `start.bat` venter 15 sekunder og «tar ingen flagg» | `start.bat:73` venter 20; `:8-10` tar `--reload`, `-d` og `--down` |
| `docs/intern/veien-videre.md:71-72` | `start.bat --reload` utelater `digdir-mock` | `start.bat:48` lister den. Advarselen skremmer uten grunn |

Mønsteret er verdt å merke seg: alle fire er *kopier* som har drevet fra kilden.
Ingen av dem er skrivefeil.

**Tiltak.** Rett alle fire. Verktøytabellen bør enten genereres fra `GET /mcp/tools`
eller erstattes av en peker dit — den er en femte kopi av en liste som allerede
finnes i koden, i OpenAPI-spesifikasjonen og i `docs/api-oversikt.md`.

## 6. Dokumentasjonsgaten er fortsatt språkbundet — og det er derfor funn 5 lever

`check-dokumentasjon.ts` finnes nettopp for å fange kopier som driver. Den ble
akkurat utvidet til å matche engelsk `runs` i CI-lister, og fanget straks
`AGENTS.md`. Det virket.

To hull står igjen.

**Det ene er språk.** Substantivtabellen `NOUNS` er bare norsk: `tjenester`,
`spesifikasjoner`, `verktøy`, `ordninger`, `personer`, `husstander`, `datasett`. En
engelsk påstand om ni tjenester eller 394 personer i `AGENTS.md` eller en av de fire
engelske app-README-ene ville gått rett gjennom.

**Det andre er formen på påstanden, og det er det som faktisk slapp avviket i funn 5
forbi.** Verktøylista i `apps/tools-api/README.md` er ikke et tall — det er en tabell
med navn. Gaten sjekker tall mot kilden, og et tall som aldri blir skrevet, kan ikke
sjekkes. Ingen språkutvidelse ville fanget den. *Dette retter en feilslutning i en
tidligere versjon av denne rapporten, som la hele skylden på språk.*

**Tiltak.** Begge deler: engelske former i `NOUNS`, med en vakt som gjør at et
utskrevet tallord bare leses som et antall foran et norsk substantiv — «proxies to
services» skal ikke bli lest som tallet 2 foran «tjenester». Og en ny sjekk som sammenligner
navn, ikke tall: en fil som nevner ti eller flere verktøynavn, hevder å være lista og
må nevne alle.

Dette er tiltaket som faktisk holder over tid. Alt annet i denne rapporten er
tekst noen må huske å oppdatere; dette er en sjekk som husker for oss.

---

# MEDIUM — koster tid på dag 2, eller senker kvaliteten på det som lages

## 7. Byggerprosa i deltakervendte dokumenter

Seks dokumenter bruker plass på å forklare hvorfor de *ikke* inneholder det leseren
lette etter:

`README.md:224-228` · `docs/architecture.md:5-9` · `docs/api-oversikt.md:3-9` ·
`examples/curl/README.md:3-6` · `examples/postman/README.md:3-5` ·
`apps/shared-ui/README.md:17-18`

Argumentet er riktig — fire håndholdte kopier av samme tabell driver fra hverandre.
Men det er en redaksjonell begrunnelse, og deltakeren så aldri den gamle tabellen.
Hun leter etter porttabellen og får i stedet en forklaring på hvorfor den ikke
finnes.

Navnebyttet la til en ny variant av samme sjanger: fem dokumenter bærer nå en
datert note om et navn deltakerne aldri kjente — `README.md:239`,
`docs/architecture.md:105`, `AGENTS.md:16`, `apps/tools-api/README.md:6-12` og
`docs/intern/veien-videre.md:59`.

Beslektet: udefinert prosjektsjargong («Del B» i `apps/fiks-simulator/README.md:55`),
changelog-språk frosset som dokumentasjon (`docs/prosessmodell.md:161-176` — «støtter
nå», uten at leseren vet hva det er «nå» i forhold til), og notater om hva som sto
der før (`docs/prosessmodell.md:150-152`).

**Tiltak.** Behold én setning der begrunnelsen har verdi for leseren, flytt resten
til `docs/intern/`. Grep-liste for gjennomgangen: `står ikke her`,
`ville vært en kopi`, `fram til 23.08`, `Del [AB]`, `sto her før`, `støtter nå`.

## 8. Duplisering som allerede har drevet

Anti-duplisering-doktrinen er anvendt på tabeller, ikke på prosa. Målt på tvers av
repoet står `felles.css`-regelen sju steder, «ikke MCP-protokollen» sju,
`digdir-mock`-fella seks, forklaringen av KI-sporet seks, stegtypene fem, og
«motoren er lineær» fem.

Dupliseringen er defensiv — samme fallgruve gjentatt der leseren måtte være — og
det er et forsvarlig valg. Men kopiene er *omskrevet* hver gang, ikke transkludert,
og det er nettopp derfor verktøytallet i funn 5 kunne drive fra kilden.

**Tiltak.** Én eier per fakta, resten peker dit. Der en advarsel må gjentas, gjenta
den ordrett, så et diff avslører drift. Se ellers funn 6.

## 9. Sjargong uten forklaring

Brukt udefinert i deltakervendt tekst: matrikkel, gnr+bnr, grunnbok kontra
matrikkel, hjemmel, kode 6, Fiks, rolleId, Tenor, Maskinporten-scope, rettslig
handleevne, «Del B».

En kommunalt erfaren utvikler klarer seg. En senior uten offentlig-sektor-bakgrunn
gjør det ikke, og en designer slett ikke. Det er nøyaktig den blandingen et
hackathon-team har.

**Tiltak.** En ordliste på rundt tjue linjer, lenket fra deltakerstart. Ett kort
avsnitt per begrep, ikke en fagartikkel.

## 10. Designerinngangen går bare gjennom terminalen

`docs/designsystem.md` er substansielt: Figma-biblioteket ligger på `:56`,
Storybook på `:50-53`, tokens, komponentoppskrifter og fallgruver videre nedover.
Men dokumentet er merket «For deg som bygger frontend» (`:3`) og består av
`@layer`-kaskade, npm-versjoner og HTML-markup.

Den levende komponentsiden `ds-eksempel` krever `./start.sh --mock` — altså Docker,
terminal, og på Windows Git Bash. Det finnes ingen skjermbilder i noen `.md`-fil i
repoet. Alt må kjøres for å ses.

Og i en sandkasse som handler om dialog finnes ingen retningslinjer for klarspråk,
tone eller dialogmønstre. Søk på «klarspråk» gir tre treff, alle om API-endepunktet
`/ai/klarsprak`.

**Tiltak, avgrenset til det som rekkes.** Løft Figma- og Storybook-lenkene ut av
tabellen og opp i deltakerstart, med én setning om at begge virker uten å kjøre
noe. Resten hører etter hackathonet.

## 11. Prosjektkoder i kode deltakerne skal lese

Seksten forekomster av `Del A`, `Del B`, `WP2`, `A2` og `Issue #8` brukt som
forklaring — blant annet `autentisering.ts:7` og `:132`, `handleevne.ts:19`,
`ressurser.ts:504` og `:525`, `fiks-simulator/src/samtykke.ts:76`,
`felles.ts:198`, `digdir-mock/src/client.ts:239`, `valider-data.ts:582`.

Ingen av kodene er definert noe sted i repoet. `autentisering.ts:7` sier at
skillet er «the whole pedagogical point of Del B» — til en leser som ikke vet hva
Del B er, sier den setningen ingenting.

Innholdet i kommentarene er godt. Det er etikettene som er ubrukelige utenfor
teamet.

**Tiltak.** Behold forklaringene, bytt etikettene mot funksjons- eller filnavn.
`A2` blir «adressebeskyttelsesmaskeringen i `skjerming.ts`», `Del B` blir
«autentiseringslaget». Ren grep-og-erstatt.

## 12. Ingen mal for en ny tjeneste

Å legge til en tjeneste er seks manuelle steg: mappe under `apps/`, en
`package.json` på sju linjer, en server, en blokk i `docker-compose.yml` med
healthcheck, en linje i `apps/shared-ui/tjenester.json`, og en fil i `openapi/`.
Glemmer man ett av de to siste, feiler `pnpm test:openapi` eller `pnpm test:docs`.

Nærmeste levende eksempel er `matrikkel-mock` på over tolv hundre linjer. Minste
mal er `process-builder/src/server.ts` på seksti.

**Tiltak.** En oppskrift på rundt tretti linjer i «bygg ditt eget» (funn 3). Et
scaffold-skript er riktig, men hører etter hackathonet.

---

# LAV — etter hackathonet

## 13. Kommentarene — motsatt av forventningen

**Det finnes ingen oppgave- eller steg-kommentarer i repoet.** Grep etter
`Steg N`, `Oppgave N`, `Task N`, `Fase N`, `PR #`, `TODO`, `FIXME`, `HACK`, `XXX`
og `WIP` i `apps/` og `scripts/` gir null treff. Kommentarkulturen er disiplinert,
forankret i husregelen i `AGENTS.md:112-113`, og gjennomgående av høy kvalitet.

Det som faktisk finnes, i fallende alvorlighet:

**Én støylomme.** `apps/process-agent/src/server.ts` har 22 kommentarer som bare
gjentar linjen under. `:1555` sier «// Store answer to the current question» over
`state.guidedInterviewAnswers[...] = text;`. Fila skiller seg også stilistisk fra
resten av repoet — den bruker en-dash der alt annet bruker em-dash — og har død
kode på `:816` (`findProcessStepById`, aldri kalt) og en `handleMessage` på 481
linjer fra `:1193`. Det er her AI-støyen den som leser repoet reagerer på,
faktisk sitter.

**Rundt 116 endringslogg-kommentarer** som forteller hva koden pleide å være:
`felles.ts:98-102`, `ai-gateway/src/server.ts:1282-1298`,
`fiks-simulator/src/state.ts:4-16`. I valideringsskript er dette forsvarlig — «her
er buggen denne testen finnes for» er testens eksistensberettigelse. I
produksjonskode er det git-historikk på avveie.

**172 norske kommentarlinjer** mot husregelen «Comments are English». Verst er
filer som bytter språk midt i samme blokk: `shared-ui/openapi.ts:1-23` starter
norsk, går til engelsk, og tilbake til norsk i siste avsnitt.

**Fire utdaterte `fil.ts:NNN`-referanser** som har drevet.
`matrikkel-mock/src/server.ts:1088` peker på to linjer i `ressurser.ts` som ikke er
det den sier de er.

**Tiltak.** Rydd `apps/process-agent/src/server.ts` først — det alene fjerner rundt
60 prosent av den ekte støyen. Innfør regelen «aldri `fil.ts:NNN` i en kommentar,
bruk funksjonsnavn», som ikke kan drive.

**Ikke rør dette.** Kommentarkulturen her er verdt å forsvare. Eksempler på
kommentarer som betaler for seg:

- `handleevne.ts:9-16` — de to aldersgrensene med juridisk begrunnelse. Umulig å
  utlede fra `if (alder < 13)`.
- `autentisering.ts:209-211` — «Never returns a boolean — a caller that forgets to
  check a boolean fails open, and this must fail closed.»
- `ai-gateway/src/server.ts:73-82` — hvorfor Bedrock-variablene ikke heter `AWS_*`.
  En fallgruve som ellers koster en dag.

Og: `scripts/dev.sh` ser ubrukt ut fordi den ikke står i `package.json`, men
`docker-compose.yml` kaller den ni ganger. Den er bærende — ikke rydd den bort.

## 14. Typesikkerheten er delvis gjenopprettet, delvis fortsatt av

`type State = any` er rettet. Men 74 `: any`-annotasjoner står igjen i
`sandbox-backend/src/` — flest i `ressurser.ts`, `state.ts`, `routes.ts` og
`regler.ts` — så `person`, `oekt` og `steg` flyter fortsatt utypet gjennom
rutelaget, samtidig som `types.ts` definerer ordentlige typer for dem.

Og `checkJs: false` (`tsconfig.json:25`) holder rundt sju tusen linjer JavaScript
helt utenfor `pnpm lint`: `ai-gateway`, `process-agent`, `tools-api` og
`matrikkel-mock`. Typesjekken er avskrudd nøyaktig der koden er størst.

## 15. Appgrensene håndheves ikke, og er brutt

`AGENTS.md:5` sier tjenestene «communicate over HTTP, not shared internal
libraries». Nitten relative fil-importer krysser appgrensen, og
`sandbox-backend ↔ fiks-simulator` er gjensidig — en syklisk avhengighet mellom to
tjenester som skal være uavhengige.

pnpm-workspacen er nominell: app-`package.json`-ene er sju–åtte linjer uten
`exports`, så ingenting i verktøykjeden håndhever en grense. Et team som bygger en
ny tjeneste har derfor ingen regel å følge for hva det har lov til å importere.

Deler av dette er et ekte delt lag (`shared-ui/openapi.ts`, `digdir-mock/client.ts`)
og helt legitimt. Poenget er at ingenting skiller det fra tilfeldig gjenbruk.

## 16. Duplisert infrastruktur

Ni `normalize()`-implementasjoner uten delt kilde — to av dem heter begge
`normalizeText` og lever i samme tjeneste. Skrivekøen finnes i tre kopier, noe
`state.ts` selv innrømmer i en kommentar. `jsonResponse`, `newId`, `escapeHtml`,
`docsHtml` og `readBody` finnes i fire til seks varianter hver, selv om
`sandbox-backend/src/http.ts` allerede er en delt modul.

Dette er delvis en bevisst kopierbarhetsstrategi i et repo uten avhengigheter, der
hver tjeneste skal kunne leses alene. Verdt å ta stilling til bevisst, ikke
automatisk rydde bort.

## 17. Ytelse og opprydding

`readState()` (`state.ts:146`) laster hele datagrunnlaget med `Promise.all` på hvert
eneste request, uten caching — i praksis rundt 700 kB JSON-parsing per kall.
Uproblematisk på hackathon-skala, men en skjult kostnad.

Videre: `matrikkel-mock/src/server.ts:410` (`gateTreffSomListe`) er død kode,
`.idea/` er sjekket inn i git, og de tre `aws-bedrock-*.sh` er ikke referert fra
`package.json` eller CI — bare fra en kommentar.

---

## Det som ikke skal røres

Denne lista er lang fordi den er en gjennomgang av mangler. Den sier lite om det
som er bra, og det meste er bra. Det som særlig bør bevares:

- **`docs/deltakerstart.md`.** Én kommando, én URL, tabell over hvilken testbruker
  som hører til hvilken case, og tre feilsjekker. Én fil å lese før noe kjører.
  Tabellen er pinnet i `data/deltakercaser.json` og verifisert av `pnpm test`, så
  et innvilget utfall der er et innvilget utfall i sandkassen.
- **Lagdelingen i `apps/sandbox-backend/src/`.** Rute → hjemmel → domene → data,
  med fail-closed som default. Ressurskatalogen gjør én deklarasjon til
  HTTP-endepunkt, `DATA_FETCH`-mål og `SJEKK`-mål samtidig, så de to inngangsveiene
  ikke kan drive fra hverandre. Det er et ekte arkitekturgrep, ikke et navn på en
  mappe.
- **`vilkaar.ts`.** Ren og synkron, med privat `regelHandlers` og `evaluateVilkaar`
  som eneste inngang. Vedtaket kan pinnes med literaler, uten kjørende tjenester.
- **`sporsmaalsperrer.ts`.** Skilt ut fra `server.js` nettopp fordi sperrene skal
  kunne importeres av en test. Den beste enkeltavgjørelsen i KI-laget.
- **CI-fila.** Hvert steg har en kommentar som navngir buggen steget fanger. Den er
  det nærmeste repoet kommer en arkitekturbegrunnelse, og den er kjørbar.
- **`.env.example`.** Tungt kommentert, forklarer 401 mot 403, hvorfor
  Bedrock-variablene heter som de gjør, og hva som overstyrer hva. Reelt sett et
  dokument, ikke en konfigfil.
