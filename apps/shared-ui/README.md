# shared-ui

Det delte laget for frontend og spesifikasjonslesing. Ingen server, ingen port, ingen
`package.json` — filene serveres på `/assets/*` av både `demo-gui` og `process-builder`,
og `openapi.ts` importeres direkte av tjenestene.

| Fil | Hva | Lest av |
|---|---|---|
| `tjenester.json` | **Tjenestelista.** Navn, port, rolle, om den har spesifikasjon | dashboardet, API-utforskeren, `pnpm test:openapi`, `pnpm test:docs` |
| `openapi.ts` | Leser en OpenAPI-fil uten YAML-parser og gir rutene som JSON | alle sju API-tjenestene, på `/openapi-ruter.json` |
| `felles.js` | Innlogging, tokenhåndtering, helsestatus, felles DOM-hjelpere | alle sidene i `demo-gui` og `process-builder` |
| `felles.css` | Stilen `demo-gui` og `process-builder` faktisk bruker | samme |
| `ds-base.css`, `ds-ksdigital.css` | KS Digital designsystem, vendoret som ren CSS | `ds-eksempel.html` |

## `tjenester.json` er sannhetskilden for tjenestelista

Den fila er grunnen til at det ikke finnes en tjenestetabell i `README.md` lenger. Fire
håndholdte kopier hadde drevet fra hverandre, og tre av dem manglet `digdir-mock`.
Legger du til en tjeneste, er dette fila du endrer — dashboardet, API-utforskeren og to
porter følger etter av seg selv.

## Reglene som gjelder her

- **Aldri `felles.css` og ds-CSS på samme side.** `felles.css` har ingen `@layer`, og
  ulagde regler slår hver layer i kaskaden, så den overstyrer designsystemet stille:
  Inter forsvinner og alle knappevarianter blir like blå. Det ser ut som stilarket ikke
  lastet. Det gjorde det — det ble overstyrt. Skal du overstyre med vilje, deklarér
  `@layer side;` og legg reglene der.
- **Aldri rediger `ds-base.css` eller `ds-ksdigital.css`.** `pnpm ds:hent` overskriver
  dem.
- **`felles.js` og sidene lastes direkte av nettleseren**, så de er `.js` og ikke `.ts`.
  `openapi.ts` er ikke det, og er derfor typet.

Lager du din egen frontend: ny fil, ikke endringer i `demo-gui`. De to eksisterende er
det andre team leser for å forstå sandkassen, og de skal fortsatt virke.
Se `docs/designsystem.md` og <http://localhost:3001/ds-eksempel>.
