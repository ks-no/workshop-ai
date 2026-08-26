# Prosessmodell

## MVP-stegtyper

Sju typer, definert i `apps/sandbox-backend/src/types.ts` og håndtert i `prosess.ts`:

- `INFO`
- `QUESTION`
- `DATA_FETCH`
- `CONSENT_REQUEST`
- `SJEKK`
- `SUMMARY`
- `SUBMIT`

Motoren er lineær: `stegIndex` teller oppover, og det finnes ingen forgrening eller
betinget hopping. `SJEKK` kan avvise en økt, men flyten er ellers rett fram.

## `SJEKK`

`SJEKK` gjør en deterministisk vurdering og kan avvise prosessøkten. Steget
kaller et internt endepunkt, og håndtereren returnerer `godkjent`, `melding`
og eventuelt et `grunnlag` som forklarer utfallet. Er `godkjent` false, får
økten status `AVVIST` og `avvistMelding` settes.

```json
{
  "id": "sjekk-rett",
  "type": "SJEKK",
  "tittel": "Vurderer om du har rett til redusert foreldrebetaling",
  "feilmelding": "Ut fra husholdningens inntektsgrunnlag har du ikke rett til redusert foreldrebetaling.",
  "api": {
    "method": "GET",
    "url": "/api/regler/sjekk/foreldrebetaling?personId={personId}&ordning=redusert-foreldrebetaling-barnehage"
  }
}
```

Tilgjengelige sjekker:

| Sti | Vurderer |
|---|---|
| `/api/regler/sjekk/foreldrebetaling` | Rett til en moderasjonsordning i `data/satser.json` |
| `/api/regler/sjekk/ordning` | Rett til en navngitt ordning, eller den ordningen barnets trinn peker på når bare `tjeneste` er oppgitt. Tre av fem demo-case bruker denne |
| `/api/matrikkel/sjekk/eierforhold` | Om søker eier eiendom i en gitt gate |

Nye sjekker legges til i ressurskatalogen i
`apps/sandbox-backend/src/ressurser.ts`. Stegutførelsen slår opp på sti og
trenger ingen endring. `GET /api/katalog/ressurser` lister alt som finnes, så du
slipper å gjette URL-er.

Beregningen skjer alltid i backend. `ai-gateway` forklarer utfallet, men
avgjør det aldri - se regelen `ai-no-decisions` i `policies/ai-policy.yaml`.

## Ressurskatalogen

`DATA_FETCH` og `SJEKK` peker begge på en URL. De URL-ene er ikke frittstående
kode - de er oppføringer i ressurskatalogen, og **én oppføring blir samtidig tre
ting**: et HTTP-endepunkt, et gyldig `DATA_FETCH`-mål og et gyldig `SJEKK`-mål.

Det er dette som gjør at kallet oppfører seg likt uansett hvilken vei det kommer
inn. Katalogen er også stedet to policyer håndheves, i stedet for én gang per
kallevei:

- `consent-before-income` - via feltet `kreverSamtykke`
- `revisjon-av-all-datatilgang` - via feltene `ressurs` og `formaal`

En sjekk er ikke en egen mekanisme. Det er bare en ressurs hvis svar inneholder
`godkjent`.

## Dynamisk agentassistanse for `QUESTION`

Når `process-agent` møter et `QUESTION`-steg kaller den `suggest_step_tools`-verktøyet
i `tools-api`. Dette kallet sender stegdefinisjonens tekst, tittel og feltlabeler
til `ai-gateway POST /ai/velg-verktoy`, som bruker heuristikk (og LLM-fallback) til å
avgjøre hvilke MCP-verktøy som er relevante.

Hvert forslag har ett av tre brukstyper:

| Brukstype | Hva agenten gjør |
|---|---|
| `kontekst` | Kall verktøyet proaktivt og vis resultatet som hint i spørsmålet |
| `validering` | Kall verktøyet når brukeren svarer, og normaliser/valider svaret |
| `kontekst_og_validering` | Begge deler |

Eksempel: et `QUESTION`-steg med feltlabel «Gatenavn» gir forslaget
`matrikkel_finn_veger` med brukstype `kontekst_og_validering`. Agenten
viser da tilgjengelige testgater som hint, og normaliserer brukerens svar
(f.eks. «storg») til kanonisk «Storgata» fra matrikkelen.

Den dynamiske veien er reell, men den er ikke den eneste: `process-agent`
har i tillegg hardkodede snarveier for `fartsdempende-tiltak` - steg-ID-ene
`velg-gate`, `hent-gate`, `boliger-bekreft` og `begrunnelse`, pluss
verktøynavnet `matrikkel_finn_veger`. Snarveiene er der fordi de var raskeste vei
til en fungerende demo, ikke fordi de er riktige.

Ny funksjonalitet kobles inn ved å legge til heuristikk i
`apps/ai-gateway/src/server.ts` - `TOOL_HEURISTICS`-arrayen, som ligger lokalt inne
i funksjonen `heuristicToolChoice` og ikke på toppnivå - og/eller et nytt verktøy i
`tools-api`.

## Slik legger du til en ny case

De fleste caser krever ingen kode i det hele tatt.

| Jeg vil… | Rediger | Kode? |
|---|---|---|
| lage en ny flyt av eksisterende byggeklosser | `data/prosessdefinisjoner.json` | nei |
| legge til en ny inntektsgrense eller ordning | `data/satser.json` → `ordninger[]` | nei |
| hente en ny datakilde, eller lage en ny sjekk | `apps/sandbox-backend/src/ressurser.ts` | ~10 linjer |
| innføre en ny regeltype | `apps/sandbox-backend/src/vilkaar.ts` → `regelHandlers` | ~20 linjer |
| innføre en ny stegtype | `apps/sandbox-backend/src/prosess.ts` → `stegHandlers` | ~20 linjer |
| gi agenten et nytt verktøy for `QUESTION`-steg | `tools-api` + `TOOL_HEURISTICS` i `apps/ai-gateway/src/server.ts` | ~20 linjer |

Start med malen `mal-enkel-soknad` i `data/prosessdefinisjoner.json`: kopier den fra
`maler`-arrayet inn i `prosesser`-arrayet, gi den ny `id`, og fjern `redigering`-blokka.
`pnpm test` validerer at dataene henger sammen, og `pnpm lint` klager hvis
du legger til en steg- eller regeltype uten håndterer. Kjør den nye casen gjennom med
curl-kokeboken i `examples/curl/` - sekvensen er identisk, bare `prosessId` er ny.

En ny ressurs ser slik ut:

```ts
{
  metode: "GET",
  sti: "/api/personer/:personId/bibliotek",
  ressurs: "bibliotekslaan",          // navnet i revisjonsloggen
  beskrivelse: "Aktive lån for personen.",
  kreverSamtykke: null,               // eller en datakilde, f.eks. "inntekt"
  handter: ({ tilstand, personId }) => hentLaan(tilstand, personId)
}
```

## Substitusjon i tekst og URL-er

Svaret fra et `QUESTION`-steg kan brukes videre med `{svar.<stegId>}`, og `{personId}`
fylles alltid inn fra økta. `fartsdempende-tiltak` er eksempelet å se på:

```json
{ "id": "hent-gate", "type": "DATA_FETCH",
  "api": { "method": "GET", "url": "/api/matrikkel/gater?gate={svar.velg-gate}" } }
```

## Demo-casene

Fem publiserte prosesser og én mal ligger i `data/prosessdefinisjoner.json`. Malen
ligger under `maler`, ikke `prosesser`, og vises bare i API-et når du ber om den -
`examples/demoprosesser/README.md` har curl-kallene for å liste og kjøre dem.

| Prosess | Steg | Dekker |
|---|---|---|
| `redusert-foreldrebetaling-barnehage` | 7 | Flaggskip-caset: datahenting, samtykke, inntekt, deterministisk `SJEKK`, KI-oppsummering, innsending og revisjonsspor |
| `sfo-moderasjon` | 7 | Samme sekvens, annen ordning. Bruk `person-022`, som har et barn på 2. trinn og et grunnlag på 152 000 mot grensen 154 917 - demo-brukeren `person-001` har ikke barn i SFO |
| `stottekontakt-behov` | 7 | Ingen inntektshenting. Samtykket gjelder kontaktinformasjon, og `hent-kontaktinfo` henter den fra kontaktregisteret (KRR). `SJEKK` leser `data/tjenestetilbud.json`; alder og kommune avgjør, ikke inntekt |
| `fritidskort-stotte` | 7 | Spørsmål, samtykke og inntektshenting. Den `process-agent` bruker i `pnpm test:agent` |
| `fartsdempende-tiltak` | 8 | Mest komplett: tre `QUESTION`, matrikkeloppslag, `SJEKK` og `{svar.<stegId>}`-substitusjon. Bruk `Storgata` for et godkjent utfall og `Fjøsangerveien` for et avvist |
| `mal-enkel-soknad` | 6 | Kopi-malen fra oppskriften over. `redigering.mal: true` |

## Redigering i prosessbygger

Prosessbyggeren kan:

- hente prosesser fra backend
- velge eksisterende prosess
- opprette ny prosess
- redigere navn, beskrivelse og versjon
- redigere steg som JSON
- lagre prosess til backend

Demo-GUI-en kan:

- å velge mellom flere prosesser
- å drive flyten direkte fra stegdefinisjonen
- å hente data, håndtere samtykke, lage oppsummering og sende inn søknad uten hardkodede case-knapper

## Struktur for `QUESTION`

`QUESTION` kan enten være:

- et enkelt fritekstspørsmål med `tekst`
- eller et strukturert spørsmål med `felter`

Eksempel:

```json
{
  "id": "situasjon",
  "type": "QUESTION",
  "tittel": "Hva trenger du hjelp til?",
  "felter": [
    {
      "id": "beskrivelse",
      "label": "Beskriv behovet ditt",
      "type": "tekst",
      "obligatorisk": true
    },
    {
      "id": "onskerKontakt",
      "label": "Ønsker du kontakt?",
      "type": "ja-nei",
      "obligatorisk": true
    },
    {
      "id": "kontaktkanal",
      "label": "Foretrukket kontaktkanal",
      "type": "valg",
      "alternativer": ["Telefon", "E-post", "Digital melding"]
    }
  ]
}
```

Støttede felttyper i første versjon:

- `tekst`
- `ja-nei`
- `valg`
