# Demo-veiledning / Demo guide

[Norsk README](../README.md) · [English README](../README.en.md) · [Diagrammer / Diagrams](diagrams/README.md)

## Norsk bokmål

Følg [Kjør lokalt](../README.md#kjør-lokalt) for installasjon og oppstart. Modellinnstillinger er beskrevet i [`.env.example`](../.env.example); hemmeligheter skal bare ligge i den lokale `.env.local`-filen.

Bruk syntetiske opplysninger i gjennomgangen:

1. Åpne <http://127.0.0.1:3210/assistent> og velg norsk eller engelsk. Forsiden <http://127.0.0.1:3210/> viser veiviseren «Søk én gang» fra Figma-prototypen.
2. Still et generelt spørsmål om SFO, bolig eller flytting. Se på veiledningen og kildene før du går videre.
3. Be om en personlig SFO-vurdering. Diskuter samtykket som vises når agenten trenger opplysninger fra KS-workshopen. Prøv både å godta oppslag og å avslå og svare manuelt.
4. Se gjennom foreslåtte fakta og kildeutdrag. Korriger feil og bekreft bare fakta du har kontrollert.
5. Se på planen og hvilke opplysninger som mangler. Avslutt med å vise at demoen forbereder en sak; den sender ingen søknad og fatter ingen vedtak.
6. Vis sluttaksjonene i samtalen: agenten anbefaler ett neste steg per tjeneste, og alternativene ligger under. Fyll ut SFO-skjemaet og send testsøknaden til KS-sandkassen (krever `npm run start:ks`); kvitteringen viser søknads-ID og saksbehandleroppgave. Lag et e-postutkast, rediger det og åpne det i e-postprogrammet. Avslutt med «Fullfør gjennomgangen»; oppsummeringen inneholder alle kvitteringer. Ingen søknad går til en virkelig kommune.

Bruk [diagrammene](diagrams/README.md) når teamet diskuterer ansvar, kilder, samtykke og menneskelig bekreftelse. Mer detaljert dokumentasjon finnes i appen på <http://127.0.0.1:3210/dokumentasjon>.

Stopp appen og KS-tjenestene med `Ctrl+C` i hver av terminalene der du startet dem. Ved portkonflikt: kontroller den eksisterende prosessen før du starter en ny.

## English

Follow [Run locally](../README.en.md#run-locally) for installation and startup. Model settings are described in [`.env.example`](../.env.example); keep secrets only in your local `.env.local` file.

Use synthetic information for the walkthrough:

1. Open <http://127.0.0.1:3210/assistent> and select Norwegian or English. The front page <http://127.0.0.1:3210/> shows the «Søk én gang» step-by-step guide from the Figma prototype.
2. Ask a general question about SFO, housing or moving. Review the guidance and its sources before continuing.
3. Request a personalised SFO assessment. Discuss the consent shown when the agent needs KS workshop information. Try both accepting the lookup and declining to answer manually.
4. Review proposed facts and source excerpts. Correct mistakes and confirm only facts you have checked.
5. Review the plan and missing information. Finish by showing that the demo prepares a case; it does not submit applications or make official decisions.
6. Show the end actions in the conversation: the agent recommends one next step per service, with the alternatives below. Fill in the SFO form and send the test application to the KS sandbox (requires `npm run start:ks`); the receipt shows the application ID and casework task. Draft an e-mail, edit it and open it in your mail client. Finish with “Complete review”; the summary contains every receipt. No application goes to a real municipality.

Use the [diagrams](diagrams/README.md) to discuss responsibilities, sources, consent and human confirmation. More detailed documentation is available in the app at <http://127.0.0.1:3210/dokumentasjon>.

Stop the app and KS services with `Ctrl+C` in each terminal where you started them. If a port is busy, inspect the existing process before starting another.
