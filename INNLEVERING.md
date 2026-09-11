# Team-Digdir

**Medlemmer**

- Ronny Birkeli (RonnyB71)
- Nina Kylstad (nkylstad)
- David Øvrelid (framitdavid)
- Erik Jarem
- Philip Bruvoll (phlipsterit)

## Hva vi lagde

Vi tok utgangspunkt i case-et søknad om TT-kort.

Vi lagde to Altinn-applikasjoner :

- Søknad om TT-kort som sluttbruker fyller ut
- Legeerklæring for TT-kort som legen fyller ut.

### Søknad om TT-kort

I søknaden blir bruker først spurt om hen har legeerkærling fra før. Hvis brukeren har legeerklæring, har vi laget en ny integrasjon som kan hente denne fra Digital lommebok.
Hvis brukeren ikke har legeerklæring fra før, kan brukeren be om dette. Da vil legen få en ny melding om dette i sin Altin inboks med link til hvor det fylles ut. I fremtiden ser vi for oss at dette kan integreres med elektrisk pasient journal.

Brukern fyller så ut sin egenerklæring. Denne erklæringen kan fylles ut på tradisjonell måte, eller man kan bruke KI-assistanse. KI kan forklare hva som trengs i skjema og spør brukeren om dette via tale. Brukeren kan snakke tilbake til KI og fortelle hva som skal stå i erklæringen. KI fyller så dette inn på en hensiktsmessig måte.

Når brukerne er ferdig med egenerklæring, venter prossessen på legeerklæring, og så saksbehandling. Når brukeren får innvilget TT-kort, kan dette kortet legges i digital lommebok

## Slik kjører du det

Vi tok ikke utgangspunkt i KS sin sandkasse, men satt opp Altinn sitt miljø lokalt.
Løsningen kjøre opp ved bruk av repo-ene linket i neste avsnitt.

## Andre repoer og lenker

- Versjon av altinn-studio frontend med støtte for integrasjon med Digital lommebok - https://github.com/Altinn/altinn-studio/tree/feat/lommebok-hackathon
- Digdir sandkasse laget for hackathon. Kjører opp dialog porten og synkroniserer dialoger fra Altinn apps til innbokseni Altinn - https://github.com/framitdavid/hackathon-dialogporten-local
- Altinn app for sluttbruker benytter for å søke om TT-kort - https://altinn.studio/repos/ttd/ttkort-hackaton
- Altinn app som lege bruker for å fylle ut legeerklæring til TT-kort - https://altinn.studio/repos/ttd/ttkort-lege-hackaton

## Slik brukte vi KI

I applikasjonen for å søke om TT-kort, har vi brukt KI til å lese opp forklaring til bruker om hvilke data som bruker. Istedenfor å fylle ut skjema på tradisjonell møte, kan bruker bruke tale til å fylle ut skjema. Ki vil tolke det brukeren sider og sørge fylle inn data slik skjemaet krever.

Vi har også brukt KI aktivt under utvikling av selve applikasjonen

## Det som ikke ble ferdig

<Det er lov. Skriv det, så slipper leseren å lete.>
