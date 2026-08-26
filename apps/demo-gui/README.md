# Demo GUI

**For deg som skal demonstrere en case, eller lurer på hvordan sidene på `:3001` henger
sammen.** Referansefrontenden: velg testbruker, kjør en flyt steg for steg, og se data,
samtykke og revisjonslogg underveis. Bygger du egen klient, er API-ene inngangen din -
ikke denne koden.

Nåværende MVP:

- statisk HTML og JavaScript, null avhengigheter
- prosessdrevet flyt fra `data/prosessdefinisjoner.json`
- prosessøkt-API via `sandbox-backend`
- støtte for alle sju stegtypene - listen bor i `docs/prosessmodell.md`

Sidene og hva de er til står i `docs/deltakerstart.md` §2 - den listen bor der, ikke her.
Én side skiller seg ut teknisk: `/ds-eksempel` laster med vilje **ikke** `felles.css` -
se `docs/designsystem.md`.

De øvrige sidene deler `apps/shared/felles.css` på `/assets/*` og `client/felles.ts` på
`/delt/felles.ts`. Hver side har i tillegg sitt eget script under `src/client/`,
servert på `/client/<side>.ts` og type-strippet ved servering.
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
siden sender med - satser, prosessdefinisjonen, hvor i flyten økten står, og det økten
allerede har hentet. Slår en sperre inn, vises svaret med egen markering og en linje om
hvorfor.

## Kjent svakhet

Backend-URL-ene er hardkodet til `http://localhost:...` i alle sidene, så de virker bare
når du åpner dem fra samme maskin.

Er du i tvil om modellen faktisk er koblet på, sier oversikten på `/` det direkte. Alle
sidene viser i tillegg en gul stripe når `modellNaaBar` er falsk.

