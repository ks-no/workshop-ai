# Juryspørsmål og svar

## «Er dette en reell Fiks-integrasjon?»

Nei. Det kjører mot KS' egen workshop-sandkasse: `fiks-simulator` og `digdir-mock`, med
ekte signerte testtokener utstedt av digdir-mock (en simulert ID-porten og
Maskinporten) og syntetiske testpersoner (`person-022`). Arkitekturen, samtykkeflyten
og API-kallene er overførbare til en reell integrasjon, men ingen ekte Fiks-tjeneste er
koblet til i dag.

## «Kan modellen hallusinere at noe er innvilget?»

Nei, ikke uoppdaget. Modellen har ingen beregnings- eller vedtaksmyndighet — utfallet
regnes i TypeScript av regelmotoren, samme 6 %-regel som før. Et beløp fra modellen som
ikke finnes i regelmotorens egne tall blokkeres av en valideringsport før det når
skjermen. Dette er dekket av egne tester i eval-gullsettet (`npm run test:eval`,
kategorien sikkerhet-og-policy), ikke bare en påstand.

## «Personvern når Cloudflare er ekstern?»

Fødselsnummer, navn, adresse og interne person-/husstands-ID-er filtreres bort før noe
sendes til modellen, uansett om den kjører hos Cloudflare eller Telenor AI Factory. En
fail-closed middleware stopper kjøringen dersom sikkerhetsmerkingen (FIDES-inspirerte
konfidensialitets- og integritetsetiketter i Microsoft Agent Framework) mangler på
meldingen. Ingen matrikkel- eller eiendomsdata inngår i denne saken i det hele tatt —
den koblingen er ikke bygget. Dette erstatter ikke en DPIA, og en reell pilot må ha en.

## «Hvorfor Oslos Punkt og ikke det nasjonale Designsystemet?»

Se #9. Punkt er Oslo kommunes eget designsystem, produksjonsmodent og i bruk i dag.
Presentasjonslaget er frikoblet fra resten av appen, så et bytte til det nasjonale
Designsystemet er et tema- og tokens-spørsmål, ikke en omskriving av logikken.

## «Hvorfor egen agentgraf og ikke sandkassens `ai-gateway`?»

En triage-rolle pluss egne draft-, kritiker- og språkvask-roller på to modeller gir
presisjon og flerspråklighet en generell gateway ikke gir alene. Vi bruker sandkassens
`/ai/klarsprak`-endepunkt der det er tilgjengelig lokalt (#14) som første ledd i en
fallback-kjede, foran vår egen modell og til slutt en deterministisk mal — det
endepunktet var ikke dokumentert fra før, så kontrakten er et forslag vi har definert
selv, ikke en bekreftet spesifikasjon. Vi leser sandkassens revisjonslogg for å
krysssjekke mot vår egen sporing på samme `sporingsId`, men skriver ikke til den:
modellkallene våre logges lokalt, fordi sandkassens kall-logg bare fylles av en
ai-gateway vi ikke bruker.

## Andre spørsmål

### «Er dette bare en chatbot?»

Nei. Henvendelsen går gjennom fire eksplisitte steg — triage, utkast, kritiker,
språkvask — med en revisjonssløyfe hvis kritikeren ber om en retting. Alle fire går
gjennom samme sikkerhetsmiddleware og skjemakontroll, ikke bare den siste.

### «Hva bruker dere KI til?»

Til å forstå fritekst på flere språk, foreslå hvilke tjenester og kilder som er
relevante, og oversette regelmotorens resultat til klarspråk. Beregningen og alle
faktiske beløp kommer fra regelmotoren og fra kildene, ikke fra modellen.

### «Er reglene juridisk riktige?»

6 %-prinsippet er kildeforankret i [Udirs rundskriv om SFO-finansiering](https://www.udir.no/regelverk-og-tilsyn/skole-og-opplaring/rundskriv-om-skolefritidsordninga/finansiering-av-skolefritidsordninga/).
Den fullstendige kommunale beregningen er ikke juridisk godkjent: prisgrunnlag,
timefordeling og betalingsmåneder er demoforutsetninger. Vi viser en foreløpig
vurdering, ikke et vedtak. Fagpersoner må validere en faktisk pilot.

### «Hva hvis inntekten er utdatert eller feil?»

Innbyggeren kan legge til eller korrigere opplysninger i dialogen. Den opprinnelige
registerverdien bevares ved siden av, og et avvik mellom oppgitt og registrert inntekt
merkes tydelig i saken i stedet for å bli overskrevet stille.

### «Vet Folkeregisteret hvem som hører til husholdningen?»

Ikke nødvendigvis tilstrekkelig for denne vurderingen. Assistenten spør derfor
eksplisitt om en samboer som mangler i husstandsoversikten; et ja stopper
prisberegningen og krever manuell avklaring i stedet for å regne videre på et ufullstendig
grunnlag.

### «Hva med digital lommebok?»

Vi har bygget et signert moderasjonsbevis (W3C Verifiable Credential-form, Ed25519,
QR-kode via et OpenID4VCI-lignende tilbud), men proof-typen er egendefinert, ikke en
registrert kryptosuite, og det er ingen ekte lommebok-app eller Digdir-utsteder koblet
til. Et samarbeid med Digdir må avklare bevistype, utsteder, gyldighet og verifisering
før dette er reelt.

### «Hvordan håndterer dere personvern?»

Kun syntetiske testdata, samtykke før noe registeroppslag skjer, dataminimering i både
modellkall og innsynsvisning, og en fail-closed sikkerhetsmiddleware. En
produksjonspilot må i tillegg ha reell autentisering, tilgangsstyring, lagringsrutiner
og en vurdering av behandlingsgrunnlag — demoens samtykkeknapp er ikke det grunnlaget.

### «Hva skalerer på tvers av kommuner?»

Selve opplevelsen, samtykkeflyten og ansvarsdelingen mellom modell og regelmotor kan
gjenbrukes. Hver kommune trenger egne konfigurerte priser og regler, egne
fagsystemtilkoblinger og godkjente prosesser — vi lover ikke én universell regelmodell.

### «Hva bygger dere neste uke hvis dere får støtte?»

Velg én kommune og én pris-/regelmodell sammen med en fagansvarlig. Koble godkjente
testdata i stedet for sandkassen, avklar husholdningsgrunnlaget for den kommunen, og
test forståelsen av dialogen og klarspråket med faktiske innbyggere før flere tjenester
legges til.
