# Søk én gang · Team Oslo

**Norsk bokmål** · [English](README.en.md)

Hackathondemo for én samtale som kan forberede familie/SFO, bolig og flytting. Bruk bare testopplysninger. Ingen søknad sendes.

## Arkitektur

- Next.js/React. Forsiden er en veiviser bygget med Designsystemet (designsystemet.no); samtaleassistenten på `/assistent` bruker Oslo kommunes Punkt-designsystem og har NO/EN-grensesnitt.
- Python og Microsoft Agent Framework: en AI-modell koordinerer og kjører faglige delanalyser gjennom spesialistagenter.
- SQLite-minne i 24 timer, kildeutdrag, revisjoner og eksplisitt bekreftelse av fakta.
- Agenten finner relevante tjenester fra friteksten. Generelle spørsmål besvares uten personoppslag; når en personlig SFO-vurdering trenger KS-data, vises et samtykke som neste steg i samtalen.
- Offisielle KS workshop-API-er kjøres lokalt. Ett uttrykkelig ja henter syntetisk husstand, SFO, inntekt og regelvurdering og fortsetter analysen automatisk. Et nei åpner manuelle spørsmål.
- KI kan forklare og foreslå. Den kan ikke bekrefte fakta, gi vedtak eller sende en søknad.
- Hver tjeneste ender i en sluttaksjon: svar på det som mangler, kontakt riktig person, e-postutkast du leser over og sender selv, eller et skjema fylt fra bekreftede opplysninger. SFO-skjemaet sendes som testsøknad til KS-sandkassen og får søknads-ID og saksbehandleroppgave. Agenten anbefaler, appen kontrollerer, du utfører.
- Modellkontekst er dataminimert og merket privat/ubetrodd; agentkjøringen stopper dersom den får en tool- eller handlingskapasitet utover analyse.

## Kjør lokalt

Krav: Node.js 22.18 eller nyere og Python 3.11 eller nyere.

```bash
npm ci
npm run setup:backend
npm run setup:ks
```

Kopier `.env.example` til `.env.local` og fyll inn serverinnstillingene for AI-modellen. Start KS-tjenestene i én terminal:

```bash
npm run start:ks
```

Start appen i en annen:

```bash
npm run dev
```

Åpne <http://127.0.0.1:3210/> for veiviseren «Søk én gang» (grensesnittet fra Figma-prototypen). Samtaleassistenten ligger på <http://127.0.0.1:3210/assistent>. Dokumentasjonen og de fem diagrammene ligger på <http://127.0.0.1:3210/dokumentasjon>.

For å dele demoen med en tester på samme VPN, bygg appen og bind den til alle lokale nettverksgrensesnitt:

```bash
npm run build
npm run start:vpn
```

Testeren åpner `http://<VPN-IP>:3210`. Tillat innkommende Node.js-trafikk dersom macOS spør. Bruk bare syntetiske testopplysninger; tilgangen varer bare mens prosessen kjører og forutsetter at VPN-et tillater direkte trafikk mellom klienter.

Standard testperson er `person-022`. Dette kan endres med `KS_PERSON_ID`, men appen tilbyr ingen testpersonvelger. KS-kildene er syntetiske workshopdata, ikke offentlige registre.

## Verifisering

```bash
npm test
npm run test:backend
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

## Dokumentasjon

- [Demo-veiledning / Demo guide (NO/EN)](docs/demo-guide.md)
- [Diagrammer på GitHub / Diagrams on GitHub (NO/EN)](docs/diagrams/README.md)
- [Arkitektur og grenser (norsk)](docs/agentic-architecture.md)
