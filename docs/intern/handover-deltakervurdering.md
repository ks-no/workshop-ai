# Handover: utbedring av funn 1–6

> **Internt.** Hva som ble gjort i gjennomgangen av deltakeropplevelsen, hvorfor, og
> hva som bevisst ble stående. Diagnosen er `docs/intern/deltakervurdering.md`.

Utgangspunkt: `main` etter `2a017ea` (Arkitekturopprydding, #10). Alle tolv
CI-sjekkene er grønne etter endringene.

---

## Nye filer

| Fil | Hva | Leser |
|---|---|---|
| `docs/oppdraget.md` | Én side om hva teamene skal lage, og hva som er fritt | Deltakere |
| `docs/bygg-selv.md` | Egen frontend på egen port, tokens, katalogendepunkter, ny tjeneste | Deltakere |
| `docs/intern/deltakervurdering.md` | Diagnosen, prioritert høy til lav | Oss |
| `docs/intern/handover-deltakervurdering.md` | Denne fila | Oss |

## Endrede filer

| Fil | Endring | Funn |
|---|---|---|
| `README.md` | Ny inngang med tre sider i rekkefølge; formålsteksten gjort formnøytral; `start.bat` beskrevet riktig | 1, 3, 5 |
| `docs/deltakerstart.md` | Nytt avsnitt 4, «Ditt første eget kall»; Node lagt til i forutsetningene; sluttpekeren går til `bygg-selv.md` | 2, 3 |
| `docs/prosessmodell.md` | «hackathon-oppgave» fjernet | 1 |
| `docs/intern/veien-videre.md` | Utdatert `start.bat --reload`-advarsel fjernet | 5 |
| `apps/process-agent/README.md` | «hackathon task» fjernet | 1 |
| `apps/ai-gateway/README.md` | «førsteoppgave for et team» fjernet | 1 |
| `apps/tools-api/README.md` | Verktøytabellen slettet, erstattet med peker til `GET /mcp/tools` | 5 |
| `apps/fiks-simulator/README.md` | Flatene er bak Maskinporten, ikke «foreløpig åpne» | 5 |
| `scripts/check-dokumentasjon.ts` | Engelske substantiv med tallordvakt; ny sjekk for verktøylister | 6 |
| `scripts/dev.sh` | Fallback når `nodemon` mangler | 4 |
| `start.sh` | Sluttskjermen omstrukturert | 1 |

---

## Funn 1 — rammen, og chat-slagsiden

Tre grep, fordi problemet lå tre steder.

**Rammen manglet.** `docs/oppdraget.md` sier hva som er gitt (data, samtykke, hjemmel,
regler, revisjon, KI-lag med sperrer) og hva som er fritt (alt over det laget).
Femti linjer.

Den **lister ikke idéer**, og det er et bevisst valg, ikke en forglemmelse. Et
dokument som foreslår sju ting, får sju team til å bygge de sju tingene. Den sier i
stedet rett ut hvorfor demoene er chat-formede — en samtale var raskeste vei til å ta
i bruk alle API-ene samtidig — og lar spørsmålet om hva innbyggeren faktisk trenger
stå åpent.

**Deltakervendt tekst pekte mot feil oppgave.** Tre steder sa at hackathon-oppgaven
var å rydde i sandkassens egen kode: `docs/prosessmodell.md` (anbefalt lesning fra
deltakerstart), `apps/process-agent/README.md` og `apps/ai-gateway/README.md`.
Setningene er omskrevet til å forklare *hvorfor* snarveiene finnes, uten å dele ut
oppgaver.

De to tilsvarende i `AGENTS.md:294` og `docs/intern/veien-videre.md:70` står
urørt — de har riktig leser.

**Sluttskjermen ledet med chat.** `start.sh` skrev ni URL-er i én bolk, med `/chat`
rett under «Start here», og pekte ikke på noe dokument. Den er nå delt i fire med
overskrifter, leder med hva man skal lage, og merker referanseklientene som
«examples, not the answer».

Formålsteksten i `README.md` sa «dialogbaserte tjenester» og «dialogbasert flyt i
stedet for tradisjonelle skjemaer». Begge er gjort formnøytrale. **Repoet er ikke
døpt om** — navnet står i `package.json`, compose, docs og lenker, og et navnebytte er
en større avgjørelse enn denne gjennomgangen skal ta alene.

## Funn 2 — deltakerstart stoppet før første API-kall

Nytt avsnitt 4, «Ditt første eget kall»: token, ett `curl` som virker, tabellen som
skiller `401` fra `403`, at ett token er én person, hvilke ruter som er åpne, og
`/utforsker` som snarvei. Node er lagt til i forutsetningene i avsnitt 1.

Overskriften i avsnitt 2 lovet «fem» URL-er mens tabellen hadde sju rader. Rettet til
seks — én er hovedinngangen, resten er de du bruker.

## Funn 3 — ingen vei til noe eget

`docs/bygg-selv.md` dekker det deltakerstart slapp:

- **Egen frontend på egen port.** CORS er `*` med `Authorization` i
  `Allow-Headers`, så en app på `:5173` snakker rett med `:8080` uten proxy. Det
  virket allerede; det sto bare ingen steder.
- `felles.ts` som gjenbrukbart innloggingslag, med tabell over funksjonene. Den er et
  klassisk skript, ikke en modul, så et `<script src="http://localhost:3001/delt/felles.ts">`
  virker på tvers av porter.
- Kaskadefella med `felles.css` gjentatt, fordi den koster en time hver gang.
- Token, `401` mot `403`, og de tre katalogendepunktene som gjør sandkassen
  selv-beskrivende.
- Det frosne wire-formatet.
- De fire utvidelsespunktene i prosessmotoren, som før bare sto i
  `apps/sandbox-backend/README.md`.
- Oppskrift på en helt ny tjeneste i seks steg, med de to som får CI til å feile
  markert.

Sluttpekeren i deltakerstart går nå hit i stedet for til `docs/architecture.md`, som
er en avviksliste for vedlikeholdere.

## Funn 4 — Windows

`start.bat` setter `WATCH_POLL=1` uansett, og `dev.sh` kjørte da
`node_modules/.bin/nodemon` — en fil som bare finnes etter `pnpm install`. På en fersk
klone døde containeren med «not found», og tjenesten så bare død ut.

`dev.sh` faller nå tilbake til `node --watch` med en forklarende melding på stderr.
Sandkassen kjører; det man mister er live reload av egne endringer.

**Ikke verifisert på Windows.** Fallbacken er testet ved å flytte `nodemon` bort
lokalt — meldingen kommer og skriptet fortsetter — men selve `start.bat`-løypa er lest,
ikke kjørt. Det bør gjøres på en Windows-maskin før hackathonet.

## Funn 5 — fire feil der deltakeren leter først

| Fil | Var | Nå |
|---|---|---|
| `apps/tools-api/README.md` | Tabell med 18 av 25 verktøy | Tabellen slettet; peker på `GET /mcp/tools` og `docs/api-oversikt.md` |
| `apps/fiks-simulator/README.md` | «foreløpig åpne» | Alle fire flatene bak Maskinporten, med scope per flate, verifisert mot `server.js` |
| `README.md` | `start.bat` venter 15 s, «tar ingen flagg» | 20 s; tar `--reload`, `-d`, `--down`, men ikke `--mock` |
| `docs/intern/veien-videre.md` | `start.bat --reload` utelater `digdir-mock` | Advarselen fjernet — `start.bat` lister den |

Verktøytabellen ble **slettet, ikke rettet**. Den var den femte kopien av en liste som
allerede finnes i koden, i OpenAPI-spesifikasjonen, i `docs/api-oversikt.md` og på
`GET /mcp/tools`. En femte kopi driver igjen.

## Funn 6 — gaten

Her lå det en feilslutning i den første rapporten, og den er rettet der: at
verktøyavviket sto fordi gaten var norskbundet. Det stemmer ikke.
`apps/tools-api/README.md` skrev aldri et tall — den hadde en tabell med navn. Gaten
sjekket tall. **Ingen språkutvidelse ville fanget den.**

To endringer i `scripts/check-dokumentasjon.ts`:

**Engelske substantiv i `NOUNS`** — `services`, `tools`, `people`, `households`,
`schemes`, `datasets`, `specifications` — med en vakt: et utskrevet tallord leses bare
som et antall foran et *norsk* substantiv. «to» og «fire» er vanlige engelske ord, så
«proxies to services» ville ellers blitt lest som tallet 2 foran «tjenester». Engelsk
prosa skriver disse tallene med siffer, og siffer er entydige.

**Ny sjekk 3: verktøylister.** En fil som nevner ti eller flere verktøynavn, hevder å
være lista og må nevne alle. Terskelen er ti fordi fordelingen er todelt — de to
filene som mener å være lista nevnte 25 og 19, og enhver fil som bare nevner et
verktøy i forbifarten, nevner fire eller færre.

Sjekken ble kjørt før fiksen og feilet med de seks manglende navnene, så den er
verifisert mot en feil den var ment å fange.

---

## Hva som bevisst ikke ble gjort

- **Funn 7 og nedover.** Byggerprosa, duplisering, ordliste, designerinngang,
  prosjektkoder i kode, tjenestemal, kommentaropprydding, typesikkerhet,
  appgrenser. Ingen av dem blokkerer en deltaker på dag 1.
- **Repoet er ikke døpt om.** «Innbyggerdialog Sandbox» sier fortsatt dialog i
  navnet. Formålstekstene er nøytralisert, men navnet er en større avgjørelse.
- **`process-agent` er urørt.** Støylomma, den døde funksjonen og `handleMessage` på
  481 linjer står. Det er funn 13, lav prioritet.
- **Ingen idéliste i `oppdraget.md`.** Se funn 1.

## Å verifisere før hackathonet

1. **Kjør `start.bat` på en Windows-maskin uten `pnpm install`.** Det er det eneste
   funnet som er lest og ikke kjørt.
2. **Les `docs/oppdraget.md` med friske øyne** og vurder om rammen er åpen nok, eller
   for åpen.
3. **Kjør hele veien gjennom `docs/bygg-selv.md`** med stacken oppe — særlig
   `felles.ts` fra en annen port, som er dokumentert ut fra koden og ikke prøvd.
