# Demo GUI

Ansvar:

- velge testbruker
- kjøre ulike demo-flyter steg for steg
- vise hentede data og samtykke
- sende inn søknad og vise revisjonslogg
- lese steg direkte fra prosessdefinisjoner

Nåværende MVP:

- statisk HTML og JavaScript
- prosessdrevet flyt fra `data/prosessdefinisjoner.json`
- prosessøkt-API via `sandbox-backend`
- støtte for `INFO`, `QUESTION`, `DATA_FETCH`, `CONSENT_REQUEST`, `SUMMARY` og `SUBMIT`

Tilgjengelige sider:

- `http://localhost:3001/` klassisk stegvis demo
- `http://localhost:3001/chat` chatdrevet prosessgrensesnitt

