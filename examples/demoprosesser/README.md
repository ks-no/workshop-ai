# Demo-prosesser

Fem publiserte prosesser og én mal ligger i `data/prosessdefinisjoner.json`
(`formatVersion: 0.2.0`). Malen ligger under `maler`, ikke `prosesser`, og vises bare
i API-et når du ber om den:

```bash
curl -s "http://localhost:8080/api/prosesser"                    # 5 publiserte
curl -s "http://localhost:8080/api/prosesser?inkluderMaler=true" # + mal-enkel-soknad
```

## Hva som finnes

| Prosess | Steg | Dekker |
|---|---|---|
| `redusert-foreldrebetaling-barnehage` | 7 | Flaggskip-caset. Samtykke → inntekt → deterministisk `SJEKK` → KI-oppsummering |
| `sfo-moderasjon` | 7 | Samme sekvens, annen ordning. Bruk `person-022` — `person-008` gir avslag |
| `stottekontakt-behov` | 6 | Korteste flyt, behovsavklaring |
| `fritidskort-stotte` | 7 | Den `process-agent` bruker i `pnpm test:agent` |
| `fartsdempende-tiltak` | 8 | Mest komplett: tre `QUESTION`, matrikkeloppslag, `SJEKK` og `{svar.<stegId>}`-substitusjon |
| `mal-enkel-soknad` | 6 | Kopi-mal. `redigering.mal: true` |

## Stegtyper motoren faktisk støtter

Sju, definert i `apps/sandbox-backend/src/types.ts` og håndtert i `prosess.ts`:

`INFO` · `QUESTION` · `DATA_FETCH` · `CONSENT_REQUEST` · `SJEKK` · `SUMMARY` · `SUBMIT`

Motoren er **lineær** — `stegIndex` teller oppover, det finnes ingen forgrening og
ingen betinget hopping. `SJEKK` kan avvise en økt, men flyten er ellers rett fram.
Det er et ærlig utgangspunkt å bygge videre på, ikke noe som må fikses først.

## Lag en ny case

Kopier `mal-enkel-soknad` fra `maler`-arrayet inn i `prosesser`-arrayet, gi den ny
`id`, og fjern `redigering`-blokka. Malen ser slik ut:

```json
{
  "id": "mal-enkel-soknad",
  "navn": "MAL: Enkel soknad med samtykke",
  "versjon": "0.1.0",
  "steg": [
    { "id": "intro", "type": "INFO", "tittel": "Velkommen",
      "tekst": "Vi hjelper deg med soknaden steg for steg." },

    { "id": "sporsmal-1", "type": "QUESTION", "tittel": "Hva trenger du hjelp til?",
      "felter": [
        { "id": "beskrivelse", "label": "Beskriv behov", "type": "tekst",
          "obligatorisk": true }
      ] },

    { "id": "samtykke", "type": "CONSENT_REQUEST",
      "tittel": "Kan vi hente relevante opplysninger?",
      "formaal": "Behandle soknaden", "dataKilder": ["inntekt"] },

    { "id": "hent-data", "type": "DATA_FETCH", "tittel": "Henter opplysninger",
      "kreverSamtykke": "inntekt",
      "api": { "method": "GET", "url": "/api/personer/{personId}/inntekt" } },

    { "id": "oppsummering", "type": "SUMMARY", "tittel": "Oppsummering" },
    { "id": "send-inn", "type": "SUBMIT", "tittel": "Send inn" }
  ]
}
```

Kjør den så gjennom med curl-kokeboken i `examples/curl/` — sekvensen er identisk,
bare `prosessId` er ny.

### `api.url` må finnes i ressurskatalogen

`DATA_FETCH` og `SJEKK` peker begge på en URL, og de URL-ene er ikke frittstående.
De må matche en oppføring i `apps/sandbox-backend/src/ressurser.ts`. Én oppføring der
er samtidig tre ting: et HTTP-endepunkt, et gyldig `DATA_FETCH`-mål og et gyldig
`SJEKK`-mål. Det er derfor samtykkesperren og revisjonsloggen håndheves likt uansett
hvilken vei du kommer inn.

Se hva som er tilgjengelig:

```bash
curl -s http://localhost:8080/api/katalog/ressurser
```

Trenger du et oppslag som ikke finnes, legg det til i katalogen først — ikke bare i
prosessdefinisjonen. `docs/prosessmodell.md` har en tabell med anslått kodemengde per
type endring.

## Substitusjon i tekst og URL-er

`fartsdempende-tiltak` er eksempelet å se på. Svaret fra et `QUESTION`-steg kan brukes
videre med `{svar.<stegId>}`, og `{personId}` fylles alltid inn fra økta:

```json
{ "id": "hent-gate", "type": "DATA_FETCH",
  "api": { "method": "GET", "url": "/api/matrikkel/gater?gate={svar.velg-gate}" } }
```

## Verifiser at det du la til er gyldig

```bash
pnpm test           # valider-data.js — referanseintegritet i alle datasett
pnpm test:kontrakt  # kjører alle flyter mot fersk state, deterministisk dump
```

`valider-data.js` fanger opp brutte referanser mellom prosesser, personer og ordninger.
Legger du til en case som peker på en person eller ordning som ikke finnes, feiler den der.
