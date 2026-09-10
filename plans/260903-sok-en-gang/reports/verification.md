# Verifikasjon: Søk én gang

Kontrollert 3. september 2026. Arbeidsmiljø: macOS, Node 24.16.0, Next.js 16.3.4,
React 19.2.8, Google Chrome via Playwright 1.62.1.

## Resultat

- `npm test`: 22 tester passert, ingen feil.
- `npm run typecheck`: passert.
- `npm run lint`: passert uten feil eller advarsler.
- `npm run build`: produksjonsbygg passert.
- `npm run test:e2e`: 9 tester passert, inkludert faktiske nettleserflyter og HTTP-kall.

Kontrollerte nettflyt-tilfeller: start, kildeinnsyn, husholdningsspørsmål, regelresultat,
forklaring, eksplisitt bekreftelse, nedlasting av kvittering, gjenopptak etter reload og
2027-visjon. Separate tester for endret inntekt, manglende/ugyldig inntekt, nullinntekt,
høy inntekt og utilgjengelig datakilde.
Hovedflyten er også kontrollert for eksterne nettverkskall: ingen ble gjort.

## Sikkerhets- og domenegrenser

Tester bekrefter at registerdata bevares ved korrigering, at innbyggeroppgitt inntekt
gir manuell behandling, at manglende husholdningsgrunnlag stopper beregning og at
beløp ikke beregnes fra NaN, negative eller ugyldige verdier.

Forklaringer får ikke endre regelresultatet. Den valgfrie KI-grenen er testet med
kontrollerte modellresponser: tillatt tema, ugyldig JSON, ukjent tema, tjenestefeil og
simulert timeout. Bare spørsmålet sendes, ikke registergrunnlag. Eksterne modell-URL-er
avvises. Ingen faktisk Ollama-modell ble kjørt.

HTTP-testene kontrollerer manglende økt, falskt hentevalg, uventede felter, negativ
inntekt, kryssende Origin, eksplisitt bekreftelse, dobbeltinnsending, låst bekreftet
sak og sletting av økt. Klienten kan ikke sende inn et selvvalgt regelresultat.

## Tilgjengelighet og visuell kontroll

Axe-kontroller for WCAG 2 A/AA og 2.1 AA ga ingen brudd på de testede visningene:
opplysningsoversikt, resultat, fremtidsscenario, mobilstart/mobiloversikt og infosiden.
Dette er automatisert testing og er **ikke** en full WCAG-sertifisering.

375 px mobilbredde er kontrollert uten horisontal rulling. Tastaturstart virker.
Synlig fokus, semantiske feltgrupper, eksplisitte etiketter, feilmeldinger og redusert
bevegelse er implementert. Manuell visuell inspeksjon av skjermbilder dekker
desktopforside, resultat, fremtidsscenario, mobilforside og arkitekturdiagram.

Designkontroll: ingen em-dash i grensesnittet, ingen eksterne fontkall, én ikonfamilie,
lyst offentlig tjenestepreg, kildeinnsyn ved data og tydelig merket demo/prisanslag.

Skjermbilder ligger i [assets/screenshots](../../../assets/screenshots/).
Diagrammet er tilgjengelig som [SVG](../../../public/architecture.svg) og
[PNG](../../../assets/screenshots/architecture.png).

## Feil funnet og rettet

1. Next.js normaliserte intern vertsadresse, mens nettleseren brukte 127.0.0.1.
   Opprinnelseskontrollen brukte feil sammenligningsgrunnlag. Den bruker nå faktisk
   Host og protokoll. Både legitim lokal Origin og fremmed Origin testes.
2. En gammel feltfeil ble fjernet ved blur og flyttet knappen midt i et klikk.
   Gammelt feilvarsel fjernes nå når innbyggeren begynner å rette beløpet; validering
   skjer fortsatt ved blur og innsending. Ugyldig beløp fulgt av nullinntekt testes.
3. Next.js forsøkte å oppdatere skrivebeskyttet AGENTS.md ved utviklingsstart.
   Dokumentert `agentRules: false` i Next-konfigurasjonen bevarer prosjektets fil.
4. Sluttoverskrift for manuell behandling ble justert så den ikke lover at kommunen
   aldri trenger mer dokumentasjon.
5. En forsinket historikkrespons kunne overskrive en nyere bekreftelse. Nå oppdateres
   bare historikken i den samme aktive saken. En nettlesertest holder historikkresponsen
   tilbake til kvitteringen er vist og bekrefter at kvitteringen bevares.
6. Samtidige starter kunne passere kapasitetskontrollen før dataleverandørene svarte.
   Ny kontroll rett før innsetting håndhever grensen. Test med 201 samtidige starter
   gir nøyaktig 200 økter og én kontrollert avvisning.

## Begrensninger

Ingen live Fiks-/KS-sandkasse, BankID, lommebok, journalføring eller kommunal innsending
er testet eller påstått integrert. Enhetstestene for modelladapteren erstatter ikke
evaluering av en faktisk modell. Skjermleser, bredt nettleserutvalg og faktisk
innbyggertesting gjenstår før pilot. Priser og forholdsmessig gratisandel er demo.

## Kravkontroll før kodegjennomgang

| Krav | Evidens |
|---|---|
| Kjøre selvstendig, uten eksterne tjenester | Lokal datafil, lokale fonter, produksjonsbygg og nettleserflyt |
| Synlig opphav, tid og formål | `Sourced<T>`, «Kilde og formål», nettlesertest |
| Bare manglende opplysninger etterspørres | Samboerspørsmål, ekstra årsinntekt ved manglende kilde |
| AI og regler er adskilt | Ren regelmodul; tester mot både maltekst og KI-klassifisering |
| Innbyggerkontroll og korrigering | Separate svar, uendret registergrunnlag, manuell status |
| Bekreftelse/prosess | Eksplisitt valg, ny servervurdering, idempotent lokal kvittering |
| Minneverdig fremtidsscenario | 2027-visning med kilde og forutsetninger |
| Arkitektur og presentasjonsleveranser | README, diagram, kilder, pitch, demoskript, juryspørsmål, sjekkliste |

Kravkontroll passert. Uavhengig kodegjennomgang og ny kontroll av rettingene er
registrert i [reviewrapporten](code-review.md). Ingen gjenværende handlingskrevende funn.

## Sandkasse og prosesser

`npm run sandbox:inspect` rapporterte kontrollert utilgjengelighet på de tre åpne
rutene. Arrangørens stack ble ikke startet; dette er ikke en feil i den lokale demoen.
Inspeksjon av persondata i sandkassen er ikke utført.

Nettlesertesten startet og stoppet egen produksjonsserver på port 3210. En tidligere
utviklingsstart avsluttet selv ved forsøk på å skrive AGENTS.md; filen ble ikke endret.
Etter konfigurasjonsrettingen ble `npm run dev` kontrollert med HTTP 200 og stoppet
med Ctrl+C. Ingen demoservere er etterlatt kjørende ved levering.
