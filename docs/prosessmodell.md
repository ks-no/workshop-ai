# Prosessmodell

## MVP-stegtyper

- `INFO`
- `QUESTION`
- `DATA_FETCH`
- `CONSENT_REQUEST`
- `CONFIRMATION`
- `SJEKK`
- `SUMMARY`
- `SUBMIT`

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
| `/api/matrikkel/sjekk/eierforhold` | Om søker eier eiendom i en gitt gate |

Nye sjekker legges til i `sjekkHandtere` i `apps/sandbox-backend/src/server.js`.
Stegutførelsen slår opp på sti og trenger ingen endring.

Beregningen skjer alltid i backend. `ai-gateway` forklarer utfallet, men
avgjør det aldri — se regelen `ai-no-decisions` i `policies/ai-policy.yaml`.

## Dynamisk agentassistanse for `QUESTION`

Når `process-agent` møter et `QUESTION`-steg kaller den `suggest_step_tools`-verktøyet
i `mcp-services`. Dette kallet sender stegdefinisjonens tekst, tittel og feltlabeler
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

Ingen steg-ID-er er hardkodet i agenten. Ny funksjonalitet kobles inn
ved å legge til heuristikk i `ai-gateway/src/server.js` (`VERKTOY_HEURISTIKK`-arrayen)
og/eller et nytt verktøy i `mcp-services`.

## Første demo-prosess

Prosessen `reduced-kindergarten-payment` er definert i `data/prosessdefinisjoner.json`.

Formålet er å demonstrere:

- datahenting
- samtykkeflyt
- policyhåndheving
- AI-støttet oppsummering
- innsending og revisjonsspor

## Flere demo-case

Repoet inneholder også:

- `sfo-moderasjon`
- `stottekontakt-behov`

## Redigering i prosessbygger

Prosessbyggeren støtter nå:

- hente prosesser fra backend
- velge eksisterende prosess
- opprette ny prosess
- redigere navn, beskrivelse og versjon
- redigere steg som JSON
- lagre prosess til backend

Demo-GUI-en støtter nå:

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
