# Bygg noe eget

Sandkassen kommer med to ferdige klienter og en prosessbygger. **Ingen av dem er en
tvungen måte å bygge på.** De er der for å spare deg tid hvis de passer, og for å vise
hvordan API-ene brukes hvis de ikke gjør det.

Denne siden er veien fra «demoen kjører» til noe du har laget selv. Har du ikke kjørt
sandkassen ennå, start med `docs/deltakerstart.md`.

---

## Egen frontend, egen port

Du trenger ikke røre `demo-gui`. Kjør din egen app på din egen port — React, Vue, Svelte,
Vite, hva du vil — og snakk rett med API-ene.

**Det virker uten proxy.** Alle tjenestene svarer med `Access-Control-Allow-Origin: *`
og har `Authorization` i `Access-Control-Allow-Headers`, så en app på `:5173` kan kalle
`:8080` direkte fra nettleseren.

```js
const svar = await fetch("http://localhost:8080/api/prosesser");
const prosesser = await svar.json();
```

Ruter som krever token, trenger headeren:

```js
const svar = await fetch(`http://localhost:8080/api/personer/${personId}/husstand`, {
  headers: { Authorization: `Bearer ${token}` }
});
```

Hvordan du får tak i tokenet, står under.

### Vil du slippe å skrive innlogging selv

`apps/shared-ui/felles.js` løser ID-porten-runden, lagrer tokenet per audience og
sjekker at det er gyldig. Fila serveres på `/assets/felles.js` av både `demo-gui` og
prosessbyggeren, og et `<script>`-tag henter den på tvers av porter:

```html
<script src="http://localhost:3001/assets/felles.js"></script>
```

Den er et vanlig skript, ikke en modul, så funksjonene ligger globalt:

| Funksjon | Gjør |
|---|---|
| `requireLogin()` | Sender brukeren til ID-porten hvis hun ikke er logget inn |
| `completeLogin()` | Kalles på `redirect_uri`-siden og veksler koden inn i et token |
| `tokenValid(audience)` | Har vi et gyldig token for denne tjenesten |
| `withToken(ekstra, audience)` | Bygger `headers`-objektet med `Authorization` |
| `loggedInPid(audience)` | Hvem er innlogget |
| `switchUser()` | Bytt testbruker |
| `checkModell(aiBase)` | Er språkmodellen koblet på |

Vil du heller skrive det selv, er hele runden dokumentert i
`apps/digdir-mock/README.md`.

### Stil

`http://localhost:3001/ds-eksempel` viser KS Digital-designsystemet med markupen under
hver komponent, lest ut av DOM-en. Kopier derfra. Hele referansen står i
`docs/designsystem.md`, og komponentkatalogen ligger på <https://design.ksdigital.no>
med et Figma-bibliotek — begge virker uten at sandkassen kjører.

Designsystemet er ren CSS, uten byggesteg. Har du allerede en bundler, finnes
komponentene også som React- og Angular-pakker.

> **Én hard regel:** last aldri `/assets/felles.css` og designsystemets CSS på samme
> side. `felles.css` har ingen `@layer`, og ulagde regler slår hver layer i kaskaden, så
> designsystemet blir stille overstyrt — Inter forsvinner og alle knapper blir like blå.
> Det ser ut som stilarket ikke lastet. Det gjorde det. Skal du overstyre med vilje,
> deklarér `@layer side;` og legg reglene der.

---

## Token, kort fortalt

`AUTH_ENFORCE` er på. Alt som ikke er uttrykkelig åpent svarer `401` uten
`Authorization`-header.

```bash
export TOKEN=$(node scripts/token.ts --innbygger person-001)
```

Ett token er én person: `person-001`s token åpner ikke `person-031`s data, det gir
`403`. En maskin får sitt eget, med et scope i stedet for en person:

```bash
node scripts/token.ts --maskinporten ks:fiks:samtykke --resource fiks-simulator
```

Åpne ruter trenger ingenting: `/helse`, `/docs`, `/openapi.yaml`, `/api/prosesser`,
`/api/katalog/*` og `/api/regler/satser`.

---

## Finn ut hva som finnes, uten å lese spesifikasjonene

Sandkassen beskriver seg selv. Tre kall er nok til å kartlegge den:

| Kall | Svarer med |
|---|---|
| `GET /api/katalog/ressurser` | Hver datakilde og sjekk, med `tilgang` og `kreverSamtykke` per rute |
| `GET /api/katalog/datasett` | Hvilke syntetiske datasett som finnes |
| `GET /api/katalog/informasjonsmodeller` | Feltene og betydningen deres |

I tillegg serverer hver API-tjeneste sin egen spesifikasjon på `/openapi.yaml`, det
samme lest som JSON på `/openapi-ruter.json`, og en lesbar side på `/docs`.

Skal du bare prøve et enkeltkall, er **<http://localhost:3001/utforsker>** raskere enn
alt dette: den velger riktig token for ruta og skriver ut en `curl` som virker.

---

## Ting du ikke skal døpe om

**Wire-formatet er frosset.** Feltnavn i JSON-svar og stier er kontrakten alle bygger
mot, og de er norske: `melding`, `feil`, `grunnlag`, `svar`, `steg`, `stegId`,
`stegIndex`, `sporingsId`, `godkjent`, `advarsel`, `syntetisk`, `/api/personer`.

En lokal variabel hos deg kan hete hva som helst. Svarnøkkelen heter `melding`.

---

## Utvide sandkassen innenfra

Vil du heller bygge videre på prosessmotoren enn ved siden av den, er det nesten alltid
ett av disse fire stedene. Hele oppskriften står i `docs/prosessmodell.md`.

| Du vil | Endre |
|---|---|
| Ny flyt | `data/prosessdefinisjoner.json`, eller lag den i prosessbyggeren på `:3000` |
| Ny ordning eller sats | `data/satser.json` |
| Ny datakilde eller sjekk | `ressurser.ts` i `apps/sandbox-backend/src/` |
| Ny regeltype | `regelHandlers` i `vilkaar.ts` (`evaluateVilkaar` er inngangen) |

Prosessmotoren har sju stegtyper — `INFO`, `QUESTION`, `DATA_FETCH`,
`CONSENT_REQUEST`, `SJEKK`, `SUMMARY`, `SUBMIT` — og er lineær: `stegIndex` teller
oppover, uten forgrening. Det er et enkelt utgangspunkt, ikke en grense du må
respektere. Trenger du noe annet, bygg det.

> **Én felle å kjenne:** `state/` skygger `data/`. Lagrer du én gang i
> prosessbyggeren, oppstår `state/prosessdefinisjoner.json`, og alle senere
> håndredigeringer i `data/` blir ignorert uten et eneste varsel. `./start.sh --reset`
> tømmer `state/`.

---

## Helt ny tjeneste

Seks steg, og de to siste er de som gjør at CI feiler hvis du glemmer dem:

1. `apps/<navn>/` med en `package.json` på sju linjer — kopier en eksisterende
2. `apps/<navn>/src/server.js` — `createServer` fra `node:http`, ingen rammeverk.
   `apps/process-builder/src/server.js` er den minste å kopiere fra
3. Svar på `GET /helse`
4. En blokk i `docker-compose.yml` — kopier en eksisterende, inkludert `healthcheck`
5. En linje i `apps/shared-ui/tjenester.json`, ellers står den ikke i oversikten
6. `openapi/<navn>.yaml`, ellers feiler `pnpm test:openapi`

Repoet har ingen runtime-avhengigheter og ikke noe byggesteg. Node type-stripper
`.ts`-filer selv, så `node src/server.ts` kjører direkte.

---

## Sjekker du kan kjøre underveis

```bash
pnpm lint            # typesjekk
pnpm test            # datasettene henger sammen
pnpm test:kontrakt   # normalisert dump av alle endepunkter
```

`pnpm test:kontrakt` gir bit-identisk resultat for samme kode, så den er nyttig rundt
en refaktorering:

```bash
pnpm test:kontrakt --ut state/foer.json
# ...endre noe...
pnpm test:kontrakt --ut state/etter.json
diff state/foer.json state/etter.json
```

Endrer du en prompt, kjør `pnpm test:eval`. Den krever en kjørende modell og nekter å
score maltekst.
