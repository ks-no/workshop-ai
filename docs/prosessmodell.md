# Prosessmodell

## MVP-stegtyper

- `INFO`
- `QUESTION`
- `DATA_FETCH`
- `CONSENT_REQUEST`
- `CONFIRMATION`
- `SUMMARY`
- `SUBMIT`

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
