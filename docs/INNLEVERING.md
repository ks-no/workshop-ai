# Stavanger

**Medlemmer:** andriiputko, 
myhrerhege-design, 
SonatTrond,
zendar,
RasmanTuta

John Tonheim, har ikke github-konto

## Hva vi lagde

* Problem: Innbyggere må fylle ut søknader med opplysninger kommunen allerede har, og vet sjelden hvilke ordninger de har rett på.
* For hvem: Innbyggere i kommunen – og indirekte saksbehandlerne som mottar mer komplette søknader.
* Hva vi har laget: En innbyggerportal («Min kommune») som viser egne saker, tjenester og aktuelle ordninger, og som fyller søknaden selv så langt samtykket rekker.
* Nytt i forhold til sandkassen: Sandkassen kom med regler, prosessmotor, datakilder og syntetiske innbyggere, men uten en flate for innbyggeren. Det nye er en fungerende frontend med innlogging via ID-porten-mock, søknadsskjema tegnet direkte fra prosessdefinisjonen, samtykke håndtert i skjemaet og innsending gjennom en ekte prosessøkt.
* Hvordan: Bygget på to dager fra to skjermbilder og en papirtegning – Google Stitch til design, Claude til kode og integrasjon.
* Nytt endepunkt som gir status for innbyggeren: `/api/personer/:personId/tilganger` som returnerer en liste med status for alle tjenester innbyggeren har rett på, og hvilke søknader som er åpne, under behandling eller avsluttet.

Løsningen er beskrevet i [apps/innbyggerportal/README.md](/apps/innbyggerportal/README.md)

## Slik kjører du det

Kjører opp med `../start.sh`<br/>
Løsningen kjører med flere testbrukere ut fra hvilke rettigheter den enkelte har for å søke om tjenester. 
Et utgangspunkt er [deltakerstart.md 3c](/docs/deltakerstart.md#3c-startpunkter-så-demoene-ikke-kolliderer)
<br/>Løsningen kjører på [localhost:3002](http://localhost:3002/minside)

## Andre repoer og lenker

ingen

## Slik brukte vi KI

* Kodegenerering med Claude Code i full vibe-mode, med iterativt spørsmål-svar og generering av kodeblokker.
  Bruk av parallelle agenter og inline  skills.
* Generering av frontend fra skisser på ett A4 ark og ett skjermbilde fra Min Kommune med Google Stitch.
* Etter generering har Claude pimpet frontend med nruk av designsystemet, og generert kode for å hente data fra backend.

## Det som ikke ble ferdig

* KI-assistent til hjelp for søker er ikke ferdig. Vi har heller bygget videre på sandbox til å returnere status på søknader. 
