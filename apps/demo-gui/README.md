# Demo GUI

Ansvar:

- velge testbruker
- kjøre ulike demo-flyter steg for steg
- vise hentede data og samtykke
- sende inn søknad og vise revisjonslogg
- lese steg direkte fra prosessdefinisjoner

Nåværende MVP:

- statisk HTML og JavaScript, null avhengigheter
- prosessdrevet flyt fra `data/prosessdefinisjoner.json`
- prosessøkt-API via `sandbox-backend`
- støtte for alle sju stegtypene: `INFO`, `QUESTION`, `DATA_FETCH`, `CONSENT_REQUEST`,
  `SJEKK`, `SUMMARY` og `SUBMIT`

Tilgjengelige sider:

- `http://localhost:3001/` oversikt: arkitektur, helsestatus per tjeneste,
  modellstatus og hvilken testbruker som hører til hvilken case
- `http://localhost:3001/chat` chatdrevet prosessgrensesnitt
- `http://localhost:3001/agent` mot `process-agent` i naturlig språk
- `http://localhost:3001/stegvis` klassisk stegvis demo
- `http://localhost:3001/utforsker` API-utforskeren
- `http://localhost:3001/ds-eksempel` mal for KS Digital sitt designsystem. Denne siden
  laster med vilje **ikke** `felles.css` — se `docs/designsystem.md`

De øvrige deler `apps/shared-ui/felles.css` og `felles.js`, servert på `/assets/*`.
Prosessbyggeren på `:3000` serverer de samme filene fra sin egen `/assets/*`.

Dette er en **referanseimplementasjon, ikke en tvungen klient.** Bygg gjerne din egen
mot de dokumenterte API-ene.

## Sidespørsmål i `/chat`

Innbygger kan stille et fritt spørsmål når som helst uten å miste flyten. Ruten er
**tilstandsfri**: den kaller aldri `/svar`, `/handling` eller `/neste`, og `stegIndex`
røres ikke. Etter svaret vises gjeldende steg på nytt.

Terskelen er ulik per stegtype, fordi kostnaden er det. På `DATA_FETCH`, `SJEKK`,
`SUMMARY`, `INFO`, `CONSENT_REQUEST` og `SUBMIT` kan innbygger uansett bare si ja eller
nei, så et spørsmålstegn eller et spørreord er nok. På `QUESTION` bærer teksten en verdi
som går tapt ved feilruting, så der kreves spørreord *og* spørsmålstegn *og* et ord fra
en lukket temaliste.

To rømningsveier når rutingen likevel bommer: knappen «Nei, dette var svaret mitt», og
prefikset `svar:` som sender teksten inn som svar uansett.

Svarene kommer fra `POST /ai/sporsmaal`, som svarer utelukkende fra grunnlaget denne
siden sender med — satser, prosessdefinisjonen, hvor i flyten økten står, og det økten
allerede har hentet. Slår en sperre inn, vises svaret med egen markering og en linje om
hvorfor.

## Kjent svakhet

Backend-URL-ene er hardkodet til `http://localhost:...` i alle sidene, så de virker bare
når du åpner dem fra samme maskin.

Er du i tvil om modellen faktisk er koblet på, sier oversikten på `/` det direkte. Alle
sidene viser i tillegg en gul stripe når `modellNaaBar` er falsk.

