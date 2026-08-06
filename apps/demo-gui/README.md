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

Sidene viser **ikke** `advarsel`-feltet fra `ai-gateway`. Når modellen er nede får du
maltekst som ser helt normal ut, uten noe varsel i grensesnittet. Sjekk med
`POST /ai/klarsprak` hvis du er i tvil om modellen faktisk er koblet på — se
`apps/ai-gateway/README.md`.

Backend-URL-ene er dessuten hardkodet til `http://localhost:...` i `chat.html` og
`agent.html`, så sidene virker bare når du åpner dem fra samme maskin.

