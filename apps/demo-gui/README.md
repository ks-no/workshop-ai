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

- `http://localhost:3001/` klassisk stegvis demo
- `http://localhost:3001/chat` chatdrevet prosessgrensesnitt
- `http://localhost:3001/agent` mot `process-agent` i naturlig språk

Dette er en **referanseimplementasjon, ikke en tvungen klient.** Bygg gjerne din egen
mot de dokumenterte API-ene.

## Kjent svakhet

**Den klassiske siden (`/`, `index.html`) varsler ikke om at modellen er nede.** Den
sjekker verken `modellNaaBar` eller `advarsel`, så når modellen er borte får du
maltekst som ser helt normal ut, uten noe varsel i grensesnittet.

`/chat` og `/agent` gjør det derimot: begge henter `ai-gateway /helse` ved sidelast og
viser en gul stripe når `modellNaaBar` er falsk (`chat.html:128-142`,
`agent.html:254-271`). `/chat` viser i tillegg `advarsel` per svar
(`chat.html:147-150`) — men bare for resultater som kommer via backend, i praksis
`SUMMARY`. `advarsel` fra `/ai/tolk-svar` vises ikke.

Er du i tvil om modellen faktisk er koblet på, sjekk `GET /helse` på `ai-gateway`, eller
`POST /ai/klarsprak` — se `apps/ai-gateway/README.md`.

Backend-URL-ene er dessuten hardkodet til `http://localhost:...` i alle tre sidene
(`index.html`, `chat.html` og `agent.html`), så de virker bare når du åpner dem fra
samme maskin.

