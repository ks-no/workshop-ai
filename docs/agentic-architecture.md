# Arkitektur for innbyggerassistenten

Assistenten forbereder familie/SFO, bolig og flytting fra én samtale. En AI-modell
velger relevante tjenester og lager separate spesialistanalyser.
Microsoft Agent Framework i en lokal Python-prosess styrer agentflyten.
Node eier kildekontroll, saksminne og menneskelige handlinger. Innbyggeren eier
bekreftelsen av opplysninger og videreføring til menneskelig gjennomgang.

[Dokumentasjon i appen](http://127.0.0.1:3210/dokumentasjon) samler MVP, kjøreveiledning,
kilder og forklaringer på norsk/engelsk. De fem diagrammene har norske etiketter. [Om løsningen](http://127.0.0.1:3210/om-demoen)
beskriver Team Oslo og personvern.

[Åpne de fem diagrammene](../public/diagrams/index.html). Samlingen er en
selvstendig HTML-fil med diagrammer, zoom, kildevisning og PNG/SVG-nedlasting.
Den virker offline. Når appen kjører, finnes den på
[/diagrams/index.html](http://127.0.0.1:3210/diagrams/index.html).

| Spørsmål | Eksport | Redigerbar kilde |
|---|---|---|
| Hvilke komponenter har ansvar? | [PNG](../public/diagrams/agentic-architecture.png) · [SVG](../public/diagrams/agentic-architecture.svg) | [Mermaid](diagrams/agentic-architecture.mmd) |
| Hvordan går saken fremover? | [PNG](../public/diagrams/agentic-workflow.png) · [SVG](../public/diagrams/agentic-workflow.svg) | [Mermaid](diagrams/agentic-workflow.mmd) |
| Hva skjer i et analyseforløp? | [PNG](../public/diagrams/agentic-sequence.png) · [SVG](../public/diagrams/agentic-sequence.svg) | [Mermaid](diagrams/agentic-sequence.mmd) |
| Hvor kommer opplysningene fra? | [PNG](../public/diagrams/agentic-data-flow.png) · [SVG](../public/diagrams/agentic-data-flow.svg) | [Mermaid](diagrams/agentic-data-flow.mmd) |
| Hvordan endres og slettes minnet? | [PNG](../public/diagrams/agentic-lifecycle.png) · [SVG](../public/diagrams/agentic-lifecycle.svg) | [Mermaid](diagrams/agentic-lifecycle.mmd) |

## Ansvarsgrenser

| Ansvar | Eier i koden | Hvorfor grensen finnes |
|---|---|---|
| Agentutførelse og analysegraf | [Python-runtime](../backend/agent_runtime.py) | Microsoft Agent Framework eier planleggeren, parallell fordeling til domenegrener og samling av resultater. |
| Prosess og privat forbindelse | [Node-runtime](../src/server/assistant-runtime.ts) | Én eid Python-prosess per analyse; JSONL gjennom standard inn/ut, uten en egen HTTP-tjeneste. |
| Modellinstruksjoner og kontrakter | [Skjemaer og modellvalg](../src/server/assistant-model.ts) | Rollemodell, tillatte tjenester og strenge svarskjemaer styres av appen. |
| Kildekontroll, sak og menneskelige porter | [Sakstjenesten](../src/server/assistant-service.ts) | Node kontrollerer revisjon, faktakandidater, resultater og lokal kvittering. |
| Tjenestegrunnlag og sjekklister | [Tjenestekatalogen](../src/domain/service-catalogue.ts) | Tjenestene har forskjellige informasjonsbehov; bolig og flytting er forberedelse, uten oppdiktede støtteberegninger. |
| KS-data og SFO-vurdering | [KS-adapteren](../src/server/assistant-ks.ts) og [API-klienten](../src/providers/ks-demo-client.ts) | Offisielle workshop-API-er gir syntetiske kilder og deterministisk vurdering etter inntektssamtykke. |
| Sitat og faktakandidat | [Kildekontrollen](../src/domain/assistant-verification.ts) | Et modellforslag må kunne spores tilbake til lagret tekst før mennesket vurderer det. |
| Dokumentuttrekk | [Dokumenttjenesten](../src/server/assistant-documents.ts) | Filinnhold er ubetrodd dokumentasjon; det gir ingen instruksjonsmyndighet. |
| Lagring og sakslevetid | [SQLite-lageret](../src/server/assistant-store.ts) | Samme sak skal overleve reload og serverrestart innenfor levetiden. |
| Visning og eksplisitte valg | [Saksoversikten](../src/components/assistant-case-panel.tsx) | Kildegrunnlag, konflikter og gjenstående arbeid må være synlig før bekreftelse. |

## Hva «agentic» betyr her

Node starter én Python-prosess under sakslåsen. Microsoft Agent Framework
`WorkflowBuilder` kjører en planlegger med en ekte `Agent`. Planleggeren ber
Node kontrollere resultatet via et privat `prepare`-kall. Node validerer skjema,
sitater og faktakandidater, lager sjekklister og returnerer et avgrenset
kildegrunnlag for hver valgt tjeneste.

Frameworket fordeler deretter tre domeneeksekutorer parallelt. En valgt tjeneste
kjører sin egen spesialistagent; en uvalgt gren gir `skipped` uten modellkall. En fast
join venter på alle tre grenene. Node kontrollerer og lagrer hvert spesialistresultat,
og Python-prosessen avsluttes etter at grafen er ferdig. En mislykket spesialist
bevarer de andre resultatene, men blokkerer videreføring.

AI-modelltjenesten kan kølegge parallelle forespørsler. Sporvisningen viser
faktiske agentløp og kildebruk, ikke modellens skjulte resonnering. Det er ingen
egen Python HTTP-server, ingen frakoblet daemon og ingen ekstra borgerhukommelse
i frameworket. Avhengighetsversjoner eies av
[backend/requirements.txt](../backend/requirements.txt).

Dette er en avgrenset agentflyt: modellen får ikke et generelt nettleser-, shell-
eller innsendingsverktøy. Katalogen og serveren bestemmer hvilke kilder og
forberedelsesverktøy som finnes. Ny informasjon og menneskelige avklaringer kan
utløse en ny analyse av det samme saksgrunnlaget.

## Språk i svarene

Norsk bokmål (`nb`) er standard. Koordinatoren velger svarsspråk fra
innbyggerens siste egen melding eller et uttrykkelig språkønske. Korte, tvetydige
meldinger og analyser uten en ny melding skal beholde sakens nåværende språk.
Dokumentspråk, sitater og automatiske opplastingsmeldinger skal ikke styre valget.
Språkkoden lagres i saken og gis videre til spesialistene.

Genererte oppsummeringer, tjenestebegrunnelser, forklaringer og spørsmål følger
valgt svarsspråk. Kildesitater beholdes ordrett på originalspråket. Grensesnittet har et eget
NO/EN-valg med norsk som standard; dette er uavhengig av svarsspråket. Et bytte
av grensesnittspråk oversetter ikke tidligere samtalemeldinger eller kildeinnhold.

## Grensesnitt, spørsmål og plantavle

Assistenten bruker offisielle Punkt React-komponenter, stiler og ikonressurser.
[Kontrollene](../src/components/assistant-controls.tsx) peker på lokale Punkt-
ressurser; versjonene eies av [package.json](../package.json). Norsk/engelsk
visning lagres som en nettleserinnstilling i
[grensesnittets språkmodul](../src/components/assistant-i18n.tsx).

[Spørreskjemaet](../src/components/assistant-question-form.tsx) velger kontroll
etter det kjente faktanavnet: ja/nei, inntektsgrunnlag, tall, dato eller fritekst.
Det lager en lesbar melding på grensesnittspråket og bruker samme meldingsløp
som samtalen. Et skjemasvar er en ny kilde, ikke et direkte skriv til bekreftet
faktaminne. [Plantavlen](../src/components/assistant-plan-board.tsx) viser ekte
sjekkpunkter og kilder per tjeneste og åpner relevante spørsmål.

[Markdown-visningen](../src/components/assistant-markdown.tsx) støtter blant
annet lister og tabeller. Rå HTML, bilder og kjørbare lenker er ikke tillatt.
Kildehenvisninger og menneskelige porter gjelder uavhengig av visningsformat.

## Offisiell KS-sandkasse

Appen bruker arrangørens faktiske workshop-API-er med syntetiske data. Dette er
lokale tjenester, ikke et publisert endepunkt eller oppslag i virkelige registre.
[KS-runtime](../src/server/ks-runtime.ts) henter signerte testtoken fra Digdir;
serveradapteren kaller backend og Fiks med riktig token. Standardpersonen er
`person-022`. Oppstart og festet kildeversjon eies av
[KS-konfigurasjonen](../scripts/ks-workshop-config.mjs).

Koordinatoren skiller mellom generelle informasjonsspørsmål og personlige
forberedelser. Den første typen bruker offentlig veiledning uten personoppslag.
Når agenten velger familie/SFO for en personlig vurdering og mangler KS-grunnlag,
viser samtalen en kontekstuell menneskelig port. Ett uttrykkelig valg med riktig
saks-ID og revisjon henter husstand, SFO-plasser og satser, registrerer og
kontrollerer inntektssamtykke hos Fiks, leser inntektsgrunnlag og KS-resultat og
starter ny analyse automatisk. Ved avslag gjøres ingen KS-kall; appen viser de
manuelle spørsmålene i stedet. Samtykket er forskjellig fra å bekrefte fakta og
fra å klargjøre planen. Et KS-svar er et syntetisk kildeøyeblikksbilde, ikke et
vedtak.

Node lagrer et feltutvalg med kildeadresse, tidspunkt og formål. Direkte
identitetsfelt fjernes fra kildeteksten. Hele registerøyeblikksbildet blir på
serveren; en spesialist får bare de eksakte registerutdragene som allerede er
knyttet til relevante fakta.
Samtykkekvitteringen lagres i saken. Lokal sletting tilbakekaller ikke samtykket
eller sletter historikk hos KS-sandkassen.

## Data til AI-modellen

Koordinatoren sender et avgrenset
utvalg fra samtalen, dokumenttekst og faktaminne. Hver spesialist får sitt
tjenestegrunnlag, sjekklister, relevante eksakte faktasitater og offentlig
veiledning. Registerkilder uten et relevant faktasitat sendes ikke til modellen.
KS sin deterministiske vurdering behandles og vises av appen uten at modellen
trenger hele registersvaret.
SQLite-filen ligger fortsatt på appens maskin. Dette er ikke en modell som
behandler alt offline: modellanalysen krever nett, konto og serverkonfigurasjon.
Tilgangstoken hører bare hjemme i servermiljøet.

AI-modellen konfigureres per rolle på serveren. Hemmeligheter blir i servermiljøet,
og presentasjonslaget viser bare rollen, oppgaven og resultatet. Adapteren ber om
strukturert JSON og gir modellen hele skjemaet i systeminstruksjonen. Python validerer med `jsonschema`, og Node
validerer igjen med Zod før resultatet brukes i saken. Modusvalget alene
garanterer ikke et gyldig svar. Se [Python-klienten](../backend/agent_runtime.py).

Ved ugyldig eller ufullstendig JSON eller skjemabrudd kan adapteren be om én
formatretting. Begge forsøk deler den opprinnelige tidsgrensen, normalt 90 sekunder
per agentløp; et agentløp kan derfor inneholde opptil to modellforespørsler.
Det korrigerte svaret må bestå samme lokale validering. HTTP- og nettverksfeil
prøves ikke automatisk på nytt; OpenAI-klientens `max_retries` er satt til 0.
Node har også en samlet prosessgrense på to agentbudsjetter pluss
30 sekunder, normalt 210 sekunder. Den er en øvre grense for analyseprosessen.

Forespørselen ber om å hoppe over cache og slå av innsamling av gateway-logg,
og sender `store: false`. Dette beskriver appens forespørselsvalg, ikke et løfte
om all intern behandling eller lagring hos leverandøren. Lokal sletting fjerner
appens saksminne; den tilbakekaller ikke modellkall som allerede er utført.

## Prompt injection og agentmyndighet

Samtaletekst, dokumenter og registerutdrag merkes som **ubetrodd** og **privat**
med FIDES-etikettene i Microsoft Agent Framework. En fail-closed middleware
kontrollerer sikkerhetskontrakten før hvert modellkall. Agentene har bare
analysekapasitet; dersom et tool eller en handlingskapasitet blir lagt til i
kjøringen, stoppes agentløpet før modellkallet.

Systeminstruksjonen sier at kildetekst er data, ikke instruksjoner. Modellresultatet
må også følge et lukket JSON-skjema, sitater må finnes ordrett i det avgrensede
kildegrunnlaget, nye fakta blir bare forslag, og alle handlinger utføres av Node
etter eksplisitte menneskelige valg med riktig saks-ID og revisjon. Tester dekker
både ondsinnede dokumentinstruksjoner og at fulle KS-øyeblikksbilder ikke sendes
til spesialistene.

FIDES-delen av frameworket er eksperimentell i versjonen demoen bruker. Den
erstatter derfor ikke dataminimering, tilgangskontroll eller leverandøravtaler.
En produksjonstjeneste må i tillegg ha dokumentert behandlingsgrunnlag,
databehandleravtale, risikovurdering/DPIA ved behov, identitets- og
tilgangsstyring, revisjonslogging og avklarte lagrings- og slettetider hos
AI-leverandøren. Data som bevisst legges i modellkonteksten kan behandles av
AI-leverandøren; sikkerhetsetiketten gjør ikke innholdet usynlig for modellen.

## Kilder, sannhet og menneskelig kontroll

Samtale, ekstrahert dokumenttekst, hentede syntetiske KS-opplysninger og
lagrede veiledningsutdrag er ulike kildetyper. Veiledningsutdragene i katalogen
er øyeblikksbilder, ikke nye nettsøk eller registeroppslag. PDF-henvisninger
bruker side og linjer i ekstrahert tekst; de er ikke koordinater i originalsidens
visuelle oppsett.

Et eksakt sitat beviser hvor teksten stod. Det beviser ikke at påstanden er
riktig. Numeriske verdier og datoer har ekstra format- og sitatkontroll, mens
tolkning av språk fortsatt kan feile. Derfor blir opplysninger foreslått eller
markert som konflikt og må bekreftes av innbyggeren. En bekreftet opplysning er
fortsatt en innbyggerbekreftelse, ikke registerverifisering.

Genererte oppsummeringer, begrunnelser og funn vises som **KI-tolkning**.
En avgrenset tekstkontroll avviser tall uten tekstgrunnlag og enkelte tydelige
påstander om vedtak eller fullført innsending. Den er ikke en kontroll av all
mening, alle formuleringer eller alle språk. Sjekklistene kommer fra Node,
og SFO-regelvurderingen kommer fra KS-sandkassen; sitatkontroll gjør ikke modellens tolkning
til et bekreftet faktum.

En ny motstridende verdi erstatter ikke en bekreftet verdi automatisk. Mennesket
velger hvilken verdi som gjelder, og tidligere verdier bevares som avvist eller
erstattet. Bekreftede fakta gjenbrukes mellom tjenester; et uavklart konfliktfelt
kan ikke brukes som et entydig bekreftet grunnlag.

Videreføring krever riktig saks-ID, siste saksrevisjon, fullført analyse, avklarte faktakandidater
og en separat avkrysning. Et saksgrunnlag kan fortsatt ha dokumentasjon eller
faglige vurderinger som gjenstår; disse følger med til menneskelig gjennomgang.
Kvitteringen er lokal og idempotent. Den bekreftede planen låses for videre
endringer. Ingen søknad sendes til en offentlig tjeneste.

Hver ny analyse får en ny revisjon, selv om innbyggerens fakta er uendret.
Dermed kan en bekreftelse fra en eldre visning ikke godkjenne et nytt modellresultat.
Saks-ID hindrer at en gammel fane endrer en annen sak etter at den delte
informasjonskapselen er byttet. Automatisk oppstart gjenåpner en eksisterende
gyldig sak; den sletter ikke tidligere saksminne.

## Minne og driftsgrense

Saken lagres som ett dokument i SQLite. Den har en absolutt levetid på 24 timer
fra opprettelse, ikke 24 timer fra siste melding. Utløpte rader ryddes ved neste
databasebruk. De siste 20 meldingene er samtalehistorikk; kilder, fakta og
faktahistorikk er egne deler av saken. Sletting fjerner den lagrede saken,
inkludert den ekstraherte dokumentteksten.

Reload og serverrestart beholder en gyldig sak når nettleseren har samme
informasjonskapsel og serveren bruker samme datakatalog. Et avbrutt analyseforløp
etter restart merkes som feil og må kjøres på nytt. Python-prosessen bruker ikke
varige framework-checkpoints. Faktabekreftelse og lokal videreføring skjer
mellom analyseforløp gjennom appens lagrede sak, ikke gjennom en automatisk
framework-godkjenning. Dette lageret er laget for én
serverprosess: sakslåsen er prosesslokal, ikke en distribuert lås. Det finnes
ingen eID, kommunal journal eller manipulasjonssikret revisjonslogg her.

SFO er nå ett av tjenesteområdene i samtalen. Det finnes ingen separat
SFO-reise i navigasjonen.

Oppstart, modellkonfigurasjon og en full gjennomgang finnes i
[demo-veiledningen på norsk og engelsk](demo-guide.md), med oppstart i
[norsk README](../README.md) og [English README](../README.en.md).

[Se alle diagrammene direkte på GitHub](diagrams/README.md).
