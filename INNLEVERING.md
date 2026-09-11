# Team-Digdir

**Medlemmer**

- Ronny Birkeli (RonnyB71)
- Nina Kylstad (nkylstad)
- David Øvrelid (framitdavid)
- Erik Jarem
- Philip Bruvoll (phlipsterit)

## Hva vi lagde

Vi tok utgangspunkt i caset søknad om TT-kort.

Vi lagde to Altinn-applikasjoner:

- Søknad om TT-kort som sluttbrukeren fyller ut
- Legeerklæring for TT-kort som legen fyller ut

### Søknad om TT-kort

I søknaden blir brukeren først spurt om hen har legeerklæring fra før. Hvis brukeren har legeerklæring, har vi laget en ny integrasjon som kan hente denne fra Digital lommebok.
Hvis brukeren ikke har legeerklæring fra før, kan brukeren be om dette. Da får legen en melding om det i sin Altinn-innboks, med lenke til hvor erklæringen fylles ut. I fremtiden ser vi for oss at dette kan integreres med elektronisk pasientjournal.

Brukeren fyller så ut sin egenerklæring. Denne erklæringen kan fylles ut på tradisjonell måte, eller man kan bruke KI-assistanse. KI kan forklare hva som trengs i skjemaet og spørre brukeren om dette via tale. Brukeren kan snakke tilbake til KI og fortelle hva som skal stå i erklæringen. KI fyller så dette inn på en hensiktsmessig måte.

Når brukeren er ferdig med egenerklæringen, venter prosessen på legeerklæringen, og deretter på saksbehandling. Når brukeren får innvilget TT-kort, kan kortet legges i Digital lommebok.

## Slik kjører du det

Vi tok ikke utgangspunkt i KS sin sandkasse, men satte opp Altinn sitt miljø lokalt.
Løsningen kjøres opp ved hjelp av repoene som er lenket i neste avsnitt.

## Andre repoer og lenker

- Versjon av altinn-studio frontend med støtte for integrasjon med Digital lommebok - https://github.com/Altinn/altinn-studio/tree/feat/lommebok-hackathon
- Digdir-sandkasse laget for hackathonet. Kjører opp Dialogporten og synkroniserer dialoger fra Altinn-apper til innboksen i Altinn - https://github.com/framitdavid/hackathon-dialogporten-local
- Altinn-app som sluttbrukeren benytter for å søke om TT-kort - https://altinn.studio/repos/ttd/ttkort-hackaton
- Altinn-app som legen bruker for å fylle ut legeerklæring til TT-kort - https://altinn.studio/repos/ttd/ttkort-lege-hackaton

## Slik brukte vi KI

I applikasjonen for å søke om TT-kort har vi brukt KI til å lese opp for brukeren hvilke data som brukes. Istedenfor å fylle ut skjemaet på tradisjonell måte, kan brukeren bruke tale. KI tolker det brukeren sier og sørger for å fylle inn dataene slik skjemaet krever.

Vi har også brukt KI aktivt under utviklingen av selve applikasjonen.

## Det som ikke ble ferdig

<Det er lov. Skriv det, så slipper leseren å lete.>
