# Juryspørsmål og svar

## «Er dette bare en chatbot?»

Nei. Arbeidsflyten henter kjente opplysninger, avklarer mangler, kjører regler og lar
innbyggeren bekrefte. Spørsmål og svar er en forklaringsfunksjon inne i tjenesten.

## «Hva bruker dere KI til?»

Arkitekturen gir KI rollen å gjøre en allerede beregnet vurdering forståelig. Den
kjørbare standarddemoen bruker kontrollert maltekst. En valgfri lokal modell kan
klassifisere et fritt spørsmål til et godkjent tema; den skriver ikke beslutningen
eller beløpene. Vi er åpne om at dette er en konservativ KI-demonstrasjon.

## «Hvorfor kan ikke KI bestemme?»

Denne vurderingen kan uttrykkes med faste regler. Da er samme input og samme regelversjon
etterprøvbart. KI-klassifiseringen kan byttes ut eller feile uten å endre utfallet.

## «Er dere faktisk koblet til Fiks?»

Nei. Vi har undersøkt reelle Fiks-tjenester og hackathonets API-kontrakter. Den leverte
appen har egne syntetiske leverandører. Reell tilkobling krever godkjente tilganger og
mapping av datamodeller. Timetall og prisgrunnlag må også være entydig før vi regner.

## «Hvorfor brukte dere ikke bare sandkassens ferdige demo?»

Vår demonstrasjon handler om innbyggerens kontroll over gjenbruk og mangler. En separat
klient og en liten regelmodell gjør den pålitelig uten Docker eller modellen. Vi kan
beholde opplevelsen når datakildene senere kobles til.

## «Er reglene juridisk riktige?»

6 %-prinsippet er kildeforankret. Den komplette kommunale beregningen er ikke juridisk
godkjent: pris, timefordeling og betalingsmåneder er demoforutsetninger. Derfor viser vi
en foreløpig vurdering, ikke et vedtak. Fagpersoner må validere en faktisk pilot.

## «Hva hvis inntekten er utdatert eller feil?»

Innbyggeren legger til nåværende årsinntekt. Den opprinnelige verdien bevares. Anslaget
merkes med at grunnlaget kommer fra innbyggeren, og saken går til manuell vurdering.

## «Vet Folkeregisteret hvem som hører til husholdningen?»

Ikke nødvendigvis tilstrekkelig for denne vurderingen. Derfor spør vi eksplisitt om
en samboer som mangler i oversikten. Et ja stopper prisanslaget og krever avklaring.

## «Kan kommunen bare hente inntektsopplysninger hvert år?»

Ikke uten forutsetninger. [Udir beskriver mulighet for nye vurderinger i søknadsperioden](https://www.udir.no/regelverk-og-tilsyn/skole-og-opplaring/rundskriv-om-skolefritidsordninga/finansiering-av-skolefritidsordninga/).
Vår visjon forutsetter riktig periode, rettslig grunnlag, fortsatt SFO-plass og
tilstrekkelige opplysninger. Demoen gjør ingen automatisk innhenting neste år.

## «Hvordan håndterer dere personvern?»

Kun syntetiske data, synlig kilde og formål, midlertidig lokal økt og eksplisitt sletting.
En produksjonspilot må ha reell autentisering, tilgangsstyring, dataminimering,
lagringsrutiner og vurdering av behandlingsgrunnlag. Demoknappen er ikke dette grunnlaget.

## «Hva skalerer på tvers av kommuner?»

Opplevelsen og ansvarsdelingen kan gjenbrukes. Kommunene trenger konfigurerte priser,
fagsystemtilkoblinger og godkjente prosesser. Vi lover ikke én universell regelmodell.

## «Hva med digital lommebok?»

Den kan bli en ekstra datakilde for nødvendige bevis. Digdir har en separat sandkasse.
Vi har ikke integrert lommebok eller funnet på en beviskontrakt. Et samarbeid med
Digdir må avklare type bevis, utsteder, gyldighet og verifisering.

## «Hva bygger dere neste uke hvis dere får støtte?»

Velg én kommune og én pris-/regelmodell med en fagansvarlig. Koble godkjente testdata,
avklar husholdningsgrunnlag og vis bekreftelsen i kommunens prosess. Test forståelsen
med foreldre før flere tjenester legges til.
