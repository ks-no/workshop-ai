# Feilsøking

Finn symptomet som passer, og følg løsningen. Hvert avsnitt står for seg — du trenger
ikke lese fila fra toppen.

Første stopp er alltid <http://localhost:3001>: den viser om alle tjenestene kjører og
om modellen er koblet på. De tre raskeste sjekkene står i `docs/deltakerstart.md` §5;
denne fila tar resten.

## Alt svarer 401

**Symptom:** Hvert autentisert kall svarer `401` — også kall som virket tidligere.

**Årsak:** `401` betyr «vi vet ikke hvem du er». Tre vanlige grunner:

- `Authorization`-headeren mangler i kallet.
- Tokenet er utløpt. I standardoppsettet lever et token i en time
  (`DIGDIR_TOKEN_TTL` i `docker-compose.yml`) — lenge nok for en økt, kort nok til
  at gårsdagens token er dødt.
- `digdir-mock` (`:8086`) er nede. Den utsteder alle tokens, og tokenfeilen svelges i
  klienten — den synes bare i en containerlogg. Typisk ved manuell oppstart der den
  ikke ble med i lista.

**Løsning:** Hent et ferskt token, og sjekk at utstederen lever:

```bash
export TOKEN=$(node scripts/token.ts --innbygger person-001)
curl -s http://localhost:8086/helse
```

Svarer ikke `:8086`, start den: `docker compose up -d digdir-mock`.

Får du `403` i stedet, er du forbi autentiseringen — da er det hjemmelslaget som
virker, ikke en feil. Og bare `sandbox-backend` (`:8080`) og `fiks-simulator`
(`:8081`) håndhever hjemmel — en `401` fra `:8082`–`:8085` er noe annet.
Se `docs/deltakerstart.md` §4 og `examples/curl/README.md` §3.

## 401 etter omstart eller nullstilling

**Symptom:** Alt virket; etter `docker compose up -d` eller en nullstilling svarer
autentiserte kall `401` selv med ferskt token.

**Årsak:** `digdir-mock` fikk nye signeringsnøkler — de ligger i
`state/digdir-nokkel.json`, så en tømt `state/` gir nye — og andre tjenester cacher
fortsatt et maskintoken signert med de gamle.

**Løsning:** Restart tjenestene som cacher:

```bash
docker compose restart tools-api process-agent sandbox-backend fiks-simulator
```

## «fetch failed» på matrikkel-oppslag

**Symptom:** Alle `matrikkel_*`-verktøy og hele `fartsdempende-tiltak`-casen feiler
med «fetch failed», mens alt annet ser normalt ut.

**Årsak:** `matrikkel-mock` (`:8085`) er ikke oppe. Den ser valgfri ut, men er kjerne
for matrikkelcasen — og den glemmes lett ved manuell oppstart.

**Løsning:**

```bash
docker compose up -d matrikkel-mock
curl -s http://localhost:8085/helse
```

Er den oppe, men oppslaget svarer `500`: uten nett svarer `matrikkel-mock` `500` —
ikke `404` — på adresser utenfor seed-fila, fordi den da prøver et live
Geonorge-oppslag. Hold deg til adresser i seedet (f.eks. `Storgata`), eller kom deg
på nett. Se «Manuell oppstart» i `README.md` for hele tjenestelista.

## Maltekst du ikke ba om

**Symptom:** KI-svarene er maltekst selv om du startet med modell — eller motsatt: en
modell svarer selv om du startet med `--mock`.

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
<http://localhost:8082/admin> — byttet gjelder umiddelbart, uten omstart. Vil du
fjerne admin-valget helt, nullstiller `./start.sh --mock --reset` fila — se
«Nullstille» nederst.

## Modellkall henger eller tar lang tid

**Symptom:** Et steg som kaller modellen står og venter.

**Årsak:** Modellen jobber, eller er borte. Et modellkall avbrytes etter
`AI_TIMEOUT_MS` (180 sekunder som standard) og faller til maltekst med `advarsel`
i stedet for å henge evig.

**Løsning:** Vent — opptil et minutt på et oppsummeringssteg er normalt på en liten
maskin. Se hva modellen faktisk fikk og svarte på <http://localhost:8082/trace>.
Går det alltid til timeout: sjekk `modellNaaBar` på `:8082/helse`, eller velg en
mindre modell med `./start.sh -m qwen2.5:0.5b`.

## Treg eller manglende modellnedlasting

**Symptom:** `./start.sh` står lenge på nedlasting, eller kommer aldri i mål.

**Årsak:** Språkmodellen er fra 400 MB til 9 GB, og delt konferansenett gjør det
verre.

**Løsning:** `./start.sh --mock` er redningen: alt annet enn KI-teksten er ekte, og
ingenting lastes ned. Andre utveier:

- Velg en liten modell: `./start.sh -m qwen2.5:0.5b`.
- Forhåndslast alle anbefalte modeller mens nettet er godt:
  `docker compose --profile models up ollama-pull-all`.
- På macOS kjører Ollama nativt, så `ollama pull qwen2.5:14b` fungerer også direkte.

Se «Hvordan starte den» i `README.md` for modellvalget og tidsbruken.

## Port opptatt

**Symptom:** Oppstart feiler med «port is already allocated» eller «address already
in use».

**Årsak:** Noe annet lytter på en av portene sandkassen bruker: `3000`, `3001`,
`8080`–`8086`, og `11434` når Ollama kjører i container (Linux/WSL). Ofte er det en
gammel kjøring av sandkassen selv, eller en annen utviklingsserver på `3000`/`3001`.

**Løsning:** Stopp en gammel kjøring først:

```bash
./start.sh -d
```

Hjelper ikke det, finn prosessen som holder porten — `lsof -i :3000` på macOS og
Linux, `netstat -ano | findstr :3000` på Windows — og stopp den.

## Container som ikke blir healthy

**Symptom:** `docker compose ps` viser `unhealthy` eller `Restarting`, eller
`tools-api`/`process-agent` starter aldri fordi de venter på at andre skal bli
`healthy`.

**Årsak:** Tjenesten svarer ikke på `/helse`. Vanligste grunn etter en kodeendring er
en TypeScript-feil som får Node-prosessen til å dø i loop — watcheren restarter ved
hver lagring, men prosessen dør like fort igjen.

**Løsning:** Les loggen — den sier nøyaktig hva som er galt:

```bash
docker compose logs -f <tjeneste>
```

Rett feilen og lagre; watcheren plukker den opp. `pnpm lint` finner samme feil uten
å gå veien om containeren. Henger en frisk tjeneste likevel:
`docker compose restart <tjeneste>`.

## Windows-oppstart

**Symptom:** `./start.sh` virker ikke i PowerShell eller cmd.

**Årsak:** Skriptet er bash.

**Løsning:** Kjør det fra Git Bash eller WSL — da får du plattformdeteksjon,
modellvalg og verifisering av at modellen svarer. `start.bat` finnes som nødløsning,
men kjører alltid uten språkmodell og venter i blinde i stedet for å sjekke at noe
kom opp. Den setter `WATCH_POLL=1`, slik at kodeendringer plukkes opp med polling —
filsystemhendelser når ikke gjennom Docker Desktops volummontering fra
Windows-filsystemet. Detaljene står i «På Windows» i `README.md`.

## Nullstille

**Symptom:** Gamle demokjøringer henger igjen, eller tilstanden er blitt rar og du
vil begynne på nytt.

**Årsak:** Alt tjenestene endrer under kjøring ligger i `state/` (gitignorert);
`data/` skrives aldri til. Å nullstille er å tømme `state/`.

**Løsning:**

```bash
./start.sh --mock --reset      # kjørte du --mock
./start.sh --reset             # kjørte du med modell
```

**Fella:** `--reset` er ikke bare en reset — den tømmer `state/` og starter deretter
alt på vanlig måte, *inkludert modellnedlasting*. Ta derfor med `--mock` hvis du
kjørte med `--mock`, ellers begynner den å laste ned flere gigabyte. Se «Valg» i
`README.md`.

Nullstillingen fjerner også admin-valget (`state/ai-provider-override.json`) og
KI-sporet (`state/ai-trace.jsonl`).

---

**Fant du ikke symptomet ditt?** `docker compose logs -f <tjeneste>` og
<http://localhost:8082/trace> er de to beste kildene til hva som faktisk skjedde.
`docs/deltakerstart.md` §5 har de tre raske sjekkene, og `README.md` har manuell
oppstart og modellvalg under «Hvordan starte den».
