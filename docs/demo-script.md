# Nøyaktig demoskript

*Manuset beskriver appen etter at orkestreringen (#2), SSE-strømmingen (#5),
forvaltningsinnsyn (#11), democachen (#12), lommebokbeviset (#13), klarspråkskontrasten
(#14), demobryteren (#7), takene (#8) og leverandørbytte i drift (#6) er slått sammen til
`main`. Kjører du mot en gren uten alt dette, følger appen ikke manuset punkt for punkt.*

## Før du viser frem

1. Start KS-sandkassen: `npm run setup:ks` (én gang), deretter `npm run start:ks` i et
   eget terminalvindu. Dette starter arrangørens `sandbox-backend` (8080),
   `fiks-simulator` (8081) og `digdir-mock` (8086) mot testpersonen `person-022`.
2. `npm run setup:backend` (én gang) — setter opp Python-venv for agent-pipelinen
   (Microsoft Agent Framework).
3. Sett aktiv KI-leverandør og nøkkel i `.env.local` (Cloudflare AI Gateway eller
   Telenor AI Factory, `AI_PROVIDER=cloudflare|telenor`). Mangler konfigurasjonen,
   stopper preflight-sjekken (#6) analysen med en norsk feilmelding før noe modellkall
   gjøres — ikke et krasj.
4. `npm run build`, deretter `npm start`. Åpne [prototypen](http://127.0.0.1:3210) i
   100 % zoom på desktop.
5. Start fra forsiden. Saken er klargjort for `person-022` (SFO-moderasjon,
   `sfo-moderasjon`). Lukk eventuelle tidligere innsyns- eller kritikkvisninger fra en
   tidligere gjennomgang.
6. La democachen stå på standardterskel (`ASSISTANT_DEMOCACHE_TIMEOUT_MS`, standard
   20 sekunder). Den skal ikke rekke å slå inn under normal tale — den er
   sikkerhetsnettet, ikke hovedveien (se Reserveplan).

## Hoveddemo, seks faser, omtrent 15 minutter med tale

| Tid | Fase | Hva som gjøres |
|---|---|---|
| 00:00–02:00 | Problemet | Startsiden, saken klargjort for `person-022`. Skjemavelde mot veiledet dialog |
| 02:00–05:30 | Dialog og samtykke | Fritekst på uformelt norsk, SSE-fremdrift synlig, samtykke godkjennes. Inntekt utilgjengelig før samtykke |
| 05:30–08:30 | Regelmotor og klarspråk | Faktagrunnlag bekreftes, regelmotoren beregner, språk byttes til vietnamesisk |
| 08:30–11:00 | Forvaltningsinnsyn | Innsynsfanen, `sporingsId` gjennom hele kjeden, dataminimering |
| 11:00–13:00 | Digital lommebok | Moderasjonsbeviset og QR-koden |
| 13:00–15:00 | Oppsummering | De to rammespørsmålene fra oppdraget, testgrunnlaget, spørsmål |

To roller: **Fører** betjener appen på skjermen, **Taler** snakker til juryen. Ett team
kan la samme person gjøre begge deler, men manuset under er skrevet for to.

### 00:00–02:00 · Problemet

| Tid | Fører | Taler |
|---|---|---|
| 00:00 | Åpne forsiden | «Dette er en innbygger som søker om redusert foreldrebetaling i SFO. Vanligvis er dette et skjema med felt for alt, fra bunnen.» |
| 00:30 | Vis skjemaveldet (skjermbilde av et tradisjonelt søknadsskjema) ved siden av den veiledede dialogen | «Vi bytter skjemaet ut med en dialog som allerede vet noe om saken — men ingenting den ikke har fått lov til å vite ennå.» |
| 01:00 | Åpne saken for `person-022` | «Testperson, syntetiske data. Dette er ikke en ekte identitet.» |
| 01:30 | Vis den tomme komposisten | «Innbyggeren skriver med egne ord, ikke i faste felt.» |

### 02:00–05:30 · Dialog og samtykke

| Tid | Fører | Taler |
|---|---|---|
| 02:00 | Skriv henvendelsen på uformelt norsk (f.eks. «Jeg har mistet jobben og har barn i SFO, kan dere se på prisen min?») og send | «Ingen faste felt — bare hverdagsspråk.» |
| 02:15 | Pek på fremdriften mens den strømmer inn live | «Tolker henvendelsen», «Forbereder svar for hver tjeneste», «Kvalitetssikrer svaret» vises underveis, ikke bare i et ferdig svar til slutt. «Dette er fire steg — triage, utkast, kritiker, språkvask — og dere ser dem mens de skjer.» |
| 03:00 | Samtykkeforespørselen dukker opp | «Vi henter ingenting fra registrene før innbyggeren sier ja. Dette samtykket går mot en ekte ID-porten/Maskinporten-simulator, ikke en avkrysning vi har funnet på.» |
| 03:15 | Godkjenn samtykket | Husstand, SFO-plass, inntekt og regelresultat hentes i samme steg. |
| 03:45 | Pek på at inntektsopplysningen var utilgjengelig helt til nå | «Det er poenget med samtykke her — ikke en formalitet vi klikker gjennom.» |
| 04:15 | Hvis kritikeren ber om en retting (avhenger av modellsvaret der og da): pek på «Retter opp basert på tilbakemeldingen» | «Kritikeren fant noe — for eksempel et tall uten kildehenvisning — og sendte utkastet tilbake før dere fikk se det.» Går kritikeren rett på PASS, hopp videre til finpuss uten å late som en retting skjedde. |
| 05:00 | Åpne hele kritikken i saksvisningen | «Hele kritikken vises, ikke et utdrag — heller ikke når den er lang.» |
| 05:15 | «Finpusser språket» fullfører svaret | Klarspråket kommer i neste fase. |

### 05:30–08:30 · Regelmotor og klarspråk

| Tid | Fører | Taler |
|---|---|---|
| 05:30 | Vis det bekreftede faktagrunnlaget (husstand, inntekt, SFO-plass) | «Dette er det regelmotoren regner på. Ingenting av dette kom fra en språkmodell.» |
| 06:00 | Vis vurderingen: beløp før og etter moderasjon | Samme 6 %-regel som før: inntekt × 6 % er taket, gratistimer trekkes fra. |
| 06:30 | Åpne klarspråkskontrasten | To kolonner side ved side: forskriftstekst og klarspråk. |
| 07:00 | Pek på at klarspråket leder med beløp og konsekvens, ikke paragrafhenvisning | «Loven står der for den som vil lese den. Svaret starter med hva det betyr for deg.» |
| 07:30 | Bytt til vietnamesisk med NO/VI-bryteren | «Ingen ny modellanalyse her — bare en visningsbryter. Beløpene er identiske, fordi begge språk formaterer de samme tallene fra regelmotoren.» |
| 08:00 | Bytt tilbake til norsk | — |

### 08:30–11:00 · Forvaltningsinnsyn

| Tid | Fører | Taler |
|---|---|---|
| 08:30 | Åpne fanen «Forvaltningsinnsyn» | «Alt appen har gjort i denne saken, i én tidslinje.» |
| 09:00 | Pek på `sporingsId` øverst | «Samme id følger samtykke, registeroppslag, modellkall, regelberegning og bekreftelse — og kan krysssjekkes mot sandkassens egen revisjonslogg på samme id.» |
| 09:45 | Åpne registeroppslag-raden | Endepunkt, token-scope (ID-porten innbygger / Maskinporten `ks:fiks:samtykke`), og at svaret er merket syntetisk. |
| 10:15 | Åpne modellkall-raden | «Modellnavn, rolle og latens for hvert kall — logget hos oss lokalt. Sandkassens egen kall-logg fylles bare av en ai-gateway vi ikke bruker, så vi logger selv i stedet for å late som vi skriver til den.» |
| 10:45 | Pek på at fødselsnummer, navn og adresse er filtrert bort før visning | «Dataminimering, ikke bare et ord i en presentasjon.» |

### 11:00–13:00 · Digital lommebok

| Tid | Fører | Taler |
|---|---|---|
| 11:00 | Etter bekreftelsen: vis QR-koden for moderasjonsbeviset | «Et bevis innbyggeren kan ta med seg, for eksempel til skolen, uten å dele hele saken.» |
| 11:30 | Vis attributtlisten ved siden av QR-en | Ordning, utfall, gyldighetsperiode, utsteder, signert — ingen inntektstall, ingen fødselsnummer. |
| 12:00 | Si høyt hva dette faktisk er | «Signaturen er ekte Ed25519, men beviset bruker en egendefinert bevistype, ikke en registrert W3C-kryptosuite. Det er ingen ekte lommebok-app eller Digdir-utsteder på den andre siden — dette er et konsept, ikke en Digdir-integrasjon.» |
| 12:45 | Lukk lommeboksvisningen | — |

### 13:00–15:00 · Oppsummering

| Tid | Fører | Taler |
|---|---|---|
| 13:00 | Gå tilbake til saksoversikten | «To ting bærer hele denne demoen.» |
| 13:15 | — | «Én: dette er ikke en ekte Fiks-integrasjon ennå. Det kjører mot KS' egen sandkasse og en Digdir-simulator, med ekte signerte testtokener og syntetiske testpersoner.» |
| 13:45 | — | «To: modellen bestemmer ingenting. Beregningen skjer i TypeScript, og et tall modellen finner på uten kildehenvisning blir blokkert før det når skjermen.» |
| 14:15 | Nevn testgrunnlaget | `npm run test:eval` kjører et gullsett på 16 caser i fire kategorier, deterministisk og uten nettverk, med egne terskler for skjemavalidering, sitat-kildelojalitet og sikkerhet-og-policy. |
| 14:45 | Åpne for spørsmål | Se `docs/judge-questions.md` for de fem spørsmålene vi må tåle. |

## Demobryter: naivt utkast mot kritikergodkjent svar

Sett miljøvariabelen `CRITIC_ALWAYS_PASS=true` for innbyggerassistenten (triage/utkast/
kritiker/språkvask-pipelinen) før serveren startes. Kritikeren kjører og kritikken vises
fortsatt, men revisjonsrunden hoppes over selv om verdikten er REVISE. Krever ingen
kodeendring eller rebuild, bare omstart av serveren med variabelen satt. Standard er av.
Når bryteren er på og kritikeren har bedt om revisjon, vises det naive utkastet side om
side med det kritikergodkjente svaret i samtalen.

Bruk denne til å vise juryen forskjellen mellom et ukontrollert utkast og det
kritikergodkjente svaret, uten å måtte vente på at kritikeren tilfeldigvis ber om en
retting i den live demoen.

## Reserveplan på scenen

- **Modellkallet er tregt eller feiler:** Democachen (#12) er sikkerhetsnettet for
  nettopp denne saken (`person-022`/`sfo-moderasjon`). Automatisk fallback slår inn
  etter `ASSISTANT_DEMOCACHE_TIMEOUT_MS` (standard 20 sekunder) hvis den levende
  modellen ikke har svart, eller umiddelbart ved modellfeil. Målt treghet fra Cloudflare
  AI Gateway har vært 182,5–245,3 sekunder, og målt timeout 91,4 sekunder — begge over
  terskelen. Svaret merkes tydelig «Forhåndsberegnet svar» — si det høyt: «Dette er et
  forhåndsberegnet svar for akkurat denne saken, ikke et live modellsvar.» Manuell
  utløsning: Alt+D eller knappen «Bruk forhåndsberegnet svar» — virker bare når
  meldingen faktisk har et cache-treff.
- **Løpsk modellkall:** Tak på antall modellkall, tokens og latens per forespørsel (#8)
  stopper pipelinen fail-closed og leverer det som allerede er produsert som et delvis
  svar merket ufullstendig, i stedet for å krasje eller kutte stille.
- **KI-leverandøren er nede:** Dette løses backstage, ikke på scenen.
  `/api/assistant/admin` kan bytte leverandør/modell i drift uten restart, men
  endepunktet er av som standard og bare nåbart fra localhost — sett det opp og test
  byttet før dere går på scenen, ikke som en live overraskelse.
- **Sandkassen svarer ikke:** Sjekk at `npm run start:ks` fortsatt kjører
  (port 8080/8081/8086). Et brutt kall gir en kontrollert norsk feilmelding i
  saksvisningen, ikke et krasj.
- **Nettleserproblem:** Last siden på nytt. Sesjonen ligger på serveren og gjenopptas så
  lenge den kjører.
- **Hele maskinen svikter:** Ha skjermbildene fra `assets/screenshots/` og
  `public/architecture.svg` tilgjengelig på presentasjonsmaskinen.

Behold setningen «Dette er syntetiske testdata og en demo, ikke et vedtak» i alle
versjoner. Ikke kall det forhåndsberegnede svaret et live modellsvar, og ikke kall
lommebokbeviset en ekte Digdir-integrasjon.
