# Feilsøking

Finn symptomet som passer, og følg løsningen. Hvert avsnitt står for seg - du trenger
ikke lese filen fra toppen.

Første stopp er alltid <http://localhost:3001>: den viser om alle tjenestene kjører og
om modellen er koblet på. De tre raskeste sjekkene står i
[`docs/deltakerstart.md`](deltakerstart.md) §5; denne filen tar resten.

## Innhold

| Symptom | Det du ser |
|---|---|
| [Alt svarer 401](#alt-svarer-401) | Hvert autentisert kall svarer `401`, også kall som virket i går |
| [401 etter at `state/` ble tømt](#401-etter-at-state-ble-tømt) | Alt virket, du nullstilte, og nå er alt `401` igjen |
| [«fetch failed» på matrikkel-oppslag](#fetch-failed-på-matrikkel-oppslag) | Gate- eller eiendomsoppslag feiler, gjerne uten nett |
| [Maltekst du ikke ba om](#maltekst-du-ikke-ba-om) | KI-svarene er generiske, selv om du har valgt en modell |
| [Modellkall henger eller tar lang tid](#modellkall-henger-eller-tar-lang-tid) | Et steg står og spinner |
| [Gammel Ollama-container etter oppdatering](#gammel-ollama-container-etter-oppdatering) | Compose advarer om «orphan containers», eller KI-en ble maltekst etter en `git pull` |
| [Port opptatt](#port-opptatt) | Oppstart stopper med at en port er i bruk |
| [Container som ikke blir healthy](#container-som-ikke-blir-healthy) | `docker compose ps` viser noe annet enn `healthy` |
| [«Cannot find module» i en container](#cannot-find-module-i-en-container) | En tjeneste krasjer ved oppstart |
| [Windows-oppstart](#windows-oppstart) | `./start.sh` eller `start.bat` oppfører seg rart på Windows |
| [Kodeendringer slår ikke gjennom](#kodeendringer-slår-ikke-gjennom) | Tjenesten kjører fortsatt gammel kode eller konfigurasjon |
| [Nullstille](#nullstille) | Du vil bare begynne på nytt |
| [Neste steg](#neste-steg) | Du fant ikke symptomet her |

## Alt svarer 401

**Symptom:** Hvert autentisert kall svarer `401` - også kall som virket tidligere.

**Årsak:** `401` betyr «vi vet ikke hvem du er». Tre vanlige grunner:

- `Authorization`-headeren mangler i kallet.
- Tokenet er utløpt. I standardoppsettet lever et token i en time
  (`DIGDIR_TOKEN_TTL` i `docker-compose.yml`) - lenge nok for en økt, kort nok til
  at gårsdagens token er dødt.
- `digdir-mock` (`:8086`) er nede. Den utsteder alle tokens, og tokenfeilen svelges i
  klienten - den synes bare i en containerlogg. Typisk ved manuell oppstart der den
  ikke ble med i listen.

**Løsning:** Hent et ferskt token, og sjekk at utstederen lever:

```bash
export TOKEN=$(node scripts/token.ts --innbygger person-001)
curl -s http://localhost:8086/helse
```

Svarer ikke `:8086`, start den: `docker compose up -d digdir-mock`.

> [!IMPORTANT]
> Får du `403` i stedet, er du forbi autentiseringen - da er det hjemmelslaget som virker,
> ikke en feil i seg selv. Tokenkontroll gjelder `sandbox-backend` (`:8080`),
> `fiks-simulator` (`:8081`), `pasientjournal-mock` (`:8087`) og
> `politiattest-mock` (`:8088`). Journal- og politiattestmocken krever maskintoken med
> riktig scope; backend og Fiks kontrollerer også hjemmel. En `401` fra
> `:8082`–`:8085` er noe annet. Se
> [`docs/deltakerstart.md`](deltakerstart.md) §4 og
> [`examples/curl/README.md`](../examples/curl/README.md) §3.

## 401 etter at `state/` ble tømt

**Symptom:** Alt virket; etter at `state/` ble tømt eller `state/digdir-nokkel.json`
slettet for hånd, svarer autentiserte kall `401` selv med ferskt token.

**Årsak:** `digdir-mock` lager ny signeringsnøkkel når `state/digdir-nokkel.json`
mangler, og de andre tjenestene cacher fortsatt et maskintoken signert med den gamle.
En ren omstart utløser ikke dette - nøkkelen overlever restart nettopp for at tokens
skal forbli gyldige. `./start.sh --reset` starter alt på nytt og treffer det heller
ikke.

**Løsning:** Gjenskap alle Node-containerne, også tokenutstederen og leserne av
signeringsnøkkelen:

```bash
./start.sh --reload
export TOKEN=$(node scripts/token.ts --innbygger person-001)
```

Hent nytt token i egne klienter også.
Nullstilling den trygge veien: se «Nullstille» nederst i denne filen.

## «fetch failed» på matrikkel-oppslag

**Symptom:** Alle `matrikkel_*`-verktøy og hele `fartsdempende-tiltak`-casen feiler
med «fetch failed», mens alt annet ser normalt ut.

**Årsak:** `matrikkel-mock` (`:8085`) er ikke oppe. Den ser valgfri ut, men er kjerne
for matrikkelcasen - og den glemmes lett ved manuell oppstart.

**Løsning:**

```bash
docker compose up -d matrikkel-mock
curl -s http://localhost:8085/helse
```

Er den oppe, men adressen finnes ikke: utenfor seed-filen prøver `matrikkel-mock` et
live Geonorge-oppslag, og uten nett degraderer det til `404` («Fant ikke …») i stedet
for en serverfeil. Hold deg til adresser i seedet (f.eks. `Storgata`), eller kom deg
på nett. Se «Manuell oppstart» i [`README.md`](../README.md) for hele tjenestelisten.

## Maltekst du ikke ba om

**Symptom:** KI-svarene er maltekst selv om du har valgt en modell - eller motsatt: en
oppstart med `--mock` stopper fordi admin-valget overstyrer den.

**Årsak:** To muligheter, i denne rekkefølgen:

1. **Admin-valget vinner.** Har du klikket i <http://localhost:8082/admin> én gang,
   vinner det valget over både flagg og `.env`. Det lagres i
   `state/ai-provider-override.json` og overlever omstart.
2. **Modellen er nede.** Da faller `ai-gateway` tilbake til maltekst og setter et
   `advarsel`-felt; `/chat` og `/agent` viser en gul stripe.

**Løsning:** Les statusen:

```bash
curl -s http://localhost:8082/helse
```

Er `modellNaaBar` `false`, sier et `feil`-felt hvorfor. Velg riktig provider i
<http://localhost:8082/admin> - byttet gjelder umiddelbart, uten omstart. Vil du
fjerne admin-valget helt, nullstiller `./start.sh --reset` filen - se
«Nullstille» nederst.

## Modellkall henger eller tar lang tid

**Symptom:** Et steg som kaller modellen står og venter.

**Årsak:** Modellen jobber, eller er borte. Et modellkall avbrytes etter
`AI_TIMEOUT_MS` (180 sekunder som standard) og faller til maltekst med `advarsel`
i stedet for å henge evig.

**Løsning:** Vent - opptil et minutt på et oppsummeringssteg er normalt på en liten
maskin. Se hva modellen faktisk fikk og svarte på <http://localhost:8082/trace>.
Går det alltid til timeout: sjekk `modellNaaBar` på `:8082/helse`, eller velg en
mindre modell med `./start.sh --ollama -m qwen2.5:0.5b` - se
[«Lokal modell med Ollama»](../apps/ai-gateway/README.md#lokal-modell-med-ollama).

## Gammel Ollama-container etter oppdatering

**Symptom:** `docker compose` advarer om «orphan containers», eller KI-svarene ble
maltekst etter at du hentet en ny versjon av repoet.

**Årsak:** Sandkassen startet før Ollama i en container og satte `AI_PROVIDER=ollama`
i `.env`. Nå kjører Ollama bare på maskinen, og bare med `./start.sh --ollama`.
Standarden er `mock`. Den gamle containeren og den gamle `.env`-en blir liggende.

**Løsning:** `./start.sh` fjerner den gamle containeren selv ved neste start. Starter du
med `start.bat` eller `docker compose` selv, gjør `docker compose down --remove-orphans`
det samme. Modellene den lastet ned blir liggende i et volum, og de kan være over 10 GB:

```bash
docker volume rm workshop-ai_ollama-data    # docker volume ls viser navnet hvis mappen heter noe annet
```

Står det fortsatt `OLLAMA_BASE_URL=http://ollama:11434` i `.env`, peker den på
containeren du nettopp fjernet. `./start.sh --ollama` retter den og bruker Ollama på
maskinen i stedet - se
[«Lokal modell med Ollama»](../apps/ai-gateway/README.md#lokal-modell-med-ollama).
Vil du heller ha maltekst, sett `AI_PROVIDER=mock`. Kjørte du Ollama på macOS, virker
den som før.

## Port opptatt

**Symptom:** Oppstart feiler med «port is already allocated» eller «address already
in use».

**Årsak:** Noe annet lytter på en av portene sandkassen bruker: `3000`, `3001`,
`8080`–`8088`. Ofte er det en
gammel kjøring av sandkassen selv, eller en annen utviklingsserver på `3000`/`3001`.

**Løsning:** Stopp en gammel kjøring først:

```bash
./start.sh -d
```

Hjelper ikke det, finn prosessen som holder porten - `lsof -i :3000` på macOS og
Linux, `netstat -ano | findstr :3000` på Windows - og stopp den. Portene per
tjeneste står i tjenestetabellen i [`README.md`](../README.md).

## Container som ikke blir healthy

**Symptom:** `docker compose ps` viser `unhealthy` eller `Restarting`, eller
`tools-api`/`process-agent` starter aldri fordi de venter på at andre skal bli
`healthy`.

**Årsak:** Tjenesten svarer ikke på `/helse`. Vanligste grunn etter en kodeendring er
en TypeScript-feil som får Node-prosessen til å dø i loop - watcheren restarter ved
hver lagring, men prosessen dør like fort igjen.

**Løsning:** Les loggen - den sier nøyaktig hva som er galt:

```bash
docker compose logs -f <tjeneste>
```

Rett feilen og lagre; watcheren plukker den opp. `pnpm lint` finner samme feil uten
å gå veien om containeren. Henger en frisk tjeneste likevel:
`docker compose restart <tjeneste>`. Hvordan tjenestene overvåkes står i
«Hva skriptet gjør for deg» i [`README.md`](../README.md).

## «Cannot find module» i en container

**Symptom:** En tjeneste stopper med `ERR_MODULE_NOT_FOUND` og et pakkenavn, typisk
`@aws-sdk/client-bedrock-runtime` eller `nodemon`.

**Årsak:** Tjenestene bruker `node_modules` fra arbeidstreet ditt gjennom
`./:/workspace`. pnpm lenker pakker i stedet for å kopiere dem, og på Windows blir
lenkene NTFS-junctions, som Docker Desktop ikke oversetter inn i Linux-VM-en. Pakken
er da borte inne i containeren selv om `pnpm install` gikk fint på verten.

**Løsning:** `.npmrc` setter `node-linker=hoisted` nettopp for dette. Kjørte du
`pnpm install` før den filen kom, kjør `pnpm install` på nytt. `ai-gateway` trenger
ikke SDK-en for å starte - ser du pakkenavnet derfra, er provideren satt til
`bedrock`, og `/helse` sier det samme.

## Windows-oppstart

**Symptom:** `./start.sh` virker ikke i PowerShell eller cmd.

**Årsak:** Skriptet er bash.

**Løsning:** Kjør det fra Git Bash eller WSL - da får du `--ollama` og en sjekk av at
modellen svarer. `start.bat` finnes som nødløsning:
den sjekker porter og venter til tjenestene svarer på `/helse`, men den kjører alltid
uten språkmodell. Den setter `WATCH_POLL=1`, slik at kodeendringer plukkes opp med polling -
filsystemhendelser når ikke gjennom Docker Desktops volummontering fra
Windows-filsystemet. Detaljene står i «På Windows» i [`README.md`](../README.md).

## Kodeendringer slår ikke gjennom

Vanlige kildeendringer plukkes opp av watcheren. På Windows må `pnpm install`
være kjørt for at polling skal virke; den følger hele `apps/`, inkludert felles kode
og tokenklienten, og `data/`. Uten nodemon varsler loggen om at polling mangler.

Ved Compose-endringer, eller dersom watcheren ikke oppdager en lagring:

```bash
./start.sh --reload
```

I cmd: `start.bat --reload`. Dette bruker `--force-recreate`, så også en container
med uendret konfigurasjon får en ny prosess. `state/` og signeringsnøkkelen beholdes;
agentøkter som bare lå i minnet blir borte.

## Nullstille

**Symptom:** Gamle demokjøringer henger igjen, eller tilstanden er blitt rar og du
vil begynne på nytt.

**Årsak:** Alt tjenestene endrer under kjøring ligger i `state/` (gitignorert);
`data/` skrives aldri til. Å nullstille er å tømme `state/`.

**Løsning:**

```bash
./start.sh --reset
```

Nullstillingen stopper alle Node-tjenestene før den leser sikkerhetskopien, og
gjenskaper containerne etter sletting. Den fjerner også admin-valget
(`state/ai-provider-override.json`), KI-sporet (`state/ai-trace.jsonl`) og
signeringsnøkkelen fra `state/`, og tømmer minnebufferne. Hent et nytt token etterpå.
Sikkerhetskopien i `_backup/` inneholder ikke signeringsnøkkelen. Feiler stopp eller
kopiering, slettes ikke `state/`, og skriptet melder feil. Ved feil etter sletting
ligger sikkerhetskopien fortsatt der; rett feilen og start igjen.

Stopp egne skrivende tjenester utenfor Compose før nullstilling. På Windows gjør
`start.bat --reset` det samme for Compose-tjenestene, alltid uten modell.

---

**Fant du ikke symptomet ditt?** `docker compose logs -f <tjeneste>` og
<http://localhost:8082/trace> er de to beste kildene til hva som faktisk skjedde.
[`docs/deltakerstart.md`](deltakerstart.md) §5 har de tre raske sjekkene, og
[`README.md`](../README.md) har manuell oppstart under «Hvordan starte den».

---

## Neste steg

**Fant du ikke symptomet her?** [`README.md`](../README.md) har hele bildet: alle flagg,
alle porter, manuell oppstart og kjente begrensninger.

**Usikker på om det du ser er en feil i det hele tatt?** Et `403` er hjemmelslaget som
virker. [`docs/deltakerstart.md`](deltakerstart.md#4-ditt-første-eget-kall) forklarer
forskjellen fra `401`.

**Tilbake til kartet:** [`docs/README.md`](README.md).
