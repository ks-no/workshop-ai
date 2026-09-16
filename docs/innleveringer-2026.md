# Innleveringene fra hackathonet 2026

Åtte team leverte, og alt de leverte ligger i dette repoet som en branch. Denne siden
sier hva hvert team lagde, hvor du finner det, og hva du må vite før du kjører det.

Ingenting av dette er merget inn i `main`. Det var heller ikke det som ble lovet:
[`docs/innlevering.md`](innlevering.md#hva-som-skjer-etterpå) sier at arbeidet hentes
inn slik at det overlever at en fork slettes, og peker leseren på diffen mot `main`.
Branchen *er* innleveringen. Det som senere er plukket ut derfra og inn i sandkassen,
står under [Hva som er hentet inn i main](#hva-som-er-hentet-inn-i-main).

## Innhold

- [To prefikser, én runde](#to-prefikser-én-runde)
- [Slik leser du en innlevering](#slik-leser-du-en-innlevering)
- [Innleveringene](#innleveringene)
- [Hva som er hentet inn i main](#hva-som-er-hentet-inn-i-main)

## To prefikser, én runde

Branchene har to navn fordi de kom inn på to måter, ikke fordi de er to slags arbeid.

`team/<navn>` er teamene som registrerte seg med et issue, hentet med
`pnpm innlevering:hent` ved fristen. `fork/<eier>` er sikkerhetsnettet:
`pnpm innlevering:hent --alle-forker` henter hver fork som ligger foran `main`, enten
noen har registrert seg eller ikke, og navngir den etter eieren av forken. Ingen av
branchene deler en eneste commit med en annen, så dette er åtte forskjellige team.

## Slik leser du en innlevering

```bash
git fetch origin
git switch --detach origin/team/bergen     # eller en annen branch fra tabellen under
```

Diffen mot sandkassen slik den kom, ligger på
`https://github.com/ks-no/workshop-ai/compare/main...<branch>`. De fleste branchene har
en `INNLEVERING.md` i roten, skrevet av teamet selv, og den er alltid en bedre kilde enn
denne siden.

To ting å vite før du kjører noe:

- **Branchene ligger bak `main`.** Alle ble forket i september 2026, og `main` har gått
  videre siden. En branch kan mangle rettelser som er i sandkassen i dag.
- **Noen brancher har store filer med seg.** De står per team under. De ble hentet som
  de var, og branchen er ikke skrevet om i ettertid, fordi en force-push til en
  deltakers innlevering ville brutt `compare`-lenken de fikk.

## Innleveringene

### `team/bergen` - Tiltakshjelpen

Svarer innbyggeren på om et byggetiltak er søknadspliktig før spaden går i jorden.
Eiendom, kartutsnitt, arealformål, reguleringsplan og hensynssoner slås opp, og
resultatet avgjøres mot faste regler etter byggesaksforskriften (SAK10) § 4-1. Reglene
kommer fra et flytkart tegnet av en domeneekspert i Plan- og bygningsetaten i Bergen
kommune, og branchen har en kolonne som sier hvor koden er enig med kartet og hvor den
med vilje ikke er det. Tre ting er nye i forhold til sandkassen: selve Tiltakshjelpen,
en `pdf-extractor` med kildeforankret uttrekk og vektorsøk i lover, forskrifter og
arealplaner, og en dokumentchat som svarer fra de samme kildene med side og dokument
oppgitt.

Trenger `AI_PROVIDER=telenor-ai-factory` og en nøkkel for KI-forklaringene; alt annet
virker uten. Dokumentkildene indekseres ikke automatisk, se `INNLEVERING.md` på
branchen.

Store filer: et matrikkeluttrekk for Bergen på 96,6 MB, rundt 23 MB med ekte
forskrifts-PDF-er, og en presentasjonskatalog på 7,6 MB.

### `team/digdir` - TT-kort i Altinn, med digital lommebok

Søknad om TT-kort som sluttbrukeren fyller ut, og legeerklæring for TT-kort som legen
fyller ut, begge som Altinn-applikasjoner. Har brukeren legeerklæring fra før, hentes
den fra digital lommebok; har hen det ikke, får legen en melding i Altinn-innboksen sin
med lenke til skjemaet. Egenerklæringen kan fylles ut på vanlig måte eller med tale, der
KI tolker det brukeren sier og fyller inn feltene. Innvilget kort kan legges i lommeboken.

**Koden ligger ikke i denne branchen.** Teamet tok utgangspunkt i Altinns eget miljø
lokalt, ikke i KS-sandkassen, så branchen inneholder bare `INNLEVERING.md` med lenker
til de fire repoene arbeidet faktisk ligger i. Les den før du leter.

### `team/drammen` - Digital politiattest

Politiattest som verifiserbart bevis over OpenID4VCI og OpenID4VP: en lommebok-app som
utsteder og framviser bevis, en flytdemo som går Politiet, innbyggerens innboks og
kommunens vandelsvurdering gjennom med QR-basert framvisning, og en ny tjeneste som
svarer på hvilken hjemmel og hvilket formål som gjelder, lest ut av et PDF-skjema.
Motoren i `sandbox-backend` er ikke rørt.

Store filer: `.pnpm-store/` ble med på lasset, 5 919 filer og 97,3 MB. Den er
pakkebufferen til pnpm og har ingenting med løsningen å gjøre.

### `team/oslo` - Søk én gang

Én samtale som forbereder flere kommunale tjenester samtidig, for innbyggere som står i
en livshendelse og i dag må finne og fylle ut hvert skjema for seg. Innbyggeren
beskriver situasjonen i fritekst, og en agentflyt med triage, utkast, kritiker og
finpuss finner hva som er relevant, henter syntetiske KS-data etter ett uttrykkelig
samtykke og forbereder neste steg. Kritikersløyfen gater faktisk svaret mot åtte
konkrete signaler og sender det tilbake til omskriving, og hele kritikkteksten vises i
grensesnittet. Har i tillegg forvaltningsinnsyn per sporingsId, moderasjonsbevis som
W3C Verifiable Credential med ekte Ed25519-signatur, klarspråkskontrast på norsk og
vietnamesisk, og leverandørbytte i drift per agentrolle.

**Dette er et eget repo, ikke en fork av sandkassen.** Branchen har sin egen rothistorie
og deler ingen commit med `main`, så `compare`-lenken over virker ikke for den, og den
kan ikke merges. Prosjektet bruker sandkassen utenfra: et oppsettskript laster ned `main` som en
tarball pinnet til `656a5c69`, og starter `sandbox-backend`, `fiks-simulator` og
`digdir-mock` fra den. Krever Node 22.18+ og Python 3.11+.

### `team/stavanger` - Min kommune

En innbyggerportal som viser egne saker, tjenester og aktuelle ordninger, og som fyller
søknaden selv så langt samtykket rekker. Innlogging går via ID-porten-mocken,
søknadsskjemaet tegnes direkte fra prosessdefinisjonen, samtykket håndteres i skjemaet,
og innsendingen går gjennom en ekte prosessøkt. Backend-halvdelen er et nytt endepunkt
som gir status for innbyggeren: hvilke ordninger hen har rett på, og hvilke søknader som
er åpne, under behandling eller avsluttet. KI-assistenten til søkeren rakk de ikke.

Portalen kjører på port 3002. Teamet la også til et eget steg i `ci.yml` for den rene
funksjonshalvdelen av klassifiseringen.

Ligger igjen i branchen: en lekket testkatalog fra `scripts/test-startup.ts`
(`.startup-fixtures-640bb997-…`, 142 filer) og en presentasjon på 14,5 MB.

### `fork/haugesander` - Seniorsirkel

Svarer på ett spørsmål for en innbygger over 62 i Ringerike: hva finnes for meg her?
Kommunens seniortilbud hentes fra en katalog som er skrevet av kommunens eget
informasjonsmateriell, med sidereferanser i `kilder` og et felt som skiller det som er
lest fra en kilde fra det som er laget for sandkassen. Tilbudene rangeres mot
innbyggerens interesser og tilgjengelighetsbehov, og innbyggeren varsles på SMS eller
brev etter et eget kanalvalg. Modellen skriver bare den personlige prosaen, og hver av
de tre tekstene har en deterministisk sperre foran seg.

Casen bruker **ikke** prosessmotoren. Det er ingen ny prosessdefinisjon her, og det er
en av grunnene til at den er verdt å lese: den viser at sandkassen tåler en tjeneste som
ikke er en søknad.

Ligger igjen i branchen: `brev-kjell.pdf` i roten, en demofil på 143 KB.

### `fork/henriettelienrebnor` - Byggesøknad med lommebok

En byggesøknadsflyt der steg to kaller en **ekte ekstern verifikator** i
eIDAS2-sandkassen: innbyggeren får en QR-kode, skanner den med lommeboken sin, og
prosessen poller til lommeboken svarer med et eiendomsbevis. Adressen leses ut av det
verifiserte beviset, kobles mot matrikkelen og mot et syntetisk planregister, og en
modell tolker om det beskrevne tiltaket er en fasadeendring og om det berører
bærekonstruksjonen. Modellen foreslår; serveren etterbehandler og validerer
deterministisk.

Dette er den branchen som endrer mest i selve prosessmotoren, og gjør det med vilje:
resultatet fra et tidligere steg kan settes inn i en URL, et `DATA_FETCH` kan trekke ut
navngitte felter, et steg kan vise et bilde eller en liste med visningspunkter, og et
steg kan kalle et API utenfor sandkassen bak en vertsliste. Det er dette som gjør den
verdt å lese selv om selve casen ikke interesserer deg.

Merk at branchen ble forket 01.09.2026 og la til Telenor AI Factory som provider selv.
`main` fikk den samme provideren senere, under navnet `telenor-ai-factory` med
bindestrek, og det er `main` sin versjon som gjelder.

### `fork/kantega` - Personlig veiviser for Våler

To innbyggerportaler for Våler kommune, bygget oppå Kantegas eIDAS2-plattform.
Innbyggeren skanner én QR-kode med lommeboken, deler de bevisene hun har - alle
valgfrie - og får kommunens tjenester sortert i «kan søke nå», «nesten i mål» og «har du
ikke rett på», med vurderingen linje for linje: hvilket bevis, hvilken regel, hva
beviset sa. Portalen snakker med plattformen utenfra, altså bare over API-er en
integrasjonspartner har, uten interne snarveier.

Alt ligger under `examples/`, og ingenting i `apps/` eller `scripts/` er rørt. Begge
prosjektene er npm-prosjekter med egen `package-lock.json`, utenfor pnpm-arbeidsområdet.
Forsiden virker uten plattform; med plattform trengs en integrasjonsklient fra
Bevis Studio. `OVERLEVERING.md` i hvert prosjekt er inngangen.

## Hva som er hentet inn i main

Sandkassen tar inn det som er nyttig for alle, ett tema om gangen, framfor å merge en
hel branch. Denne listen fylles ut etter hvert som det skjer, og hver linje sier hvilken
branch det kom fra.

Foreløpig er ingenting hentet inn.
