# pasientjournal-mock

**Denne integrasjonen finnes ikke.** Det er det viktigste å vite om tjenesten, og
grunnen til at det står først: en mock som later som den etterlikner noe ekte, lærer
bort noe galt.

Mocken serverer legeerklæringer til søknad om TT-kort, formet som utdrag fra en
elektronisk pasientjournal. Port `8087`. Spesifikasjon på `/openapi.yaml`, lesbar på
`/docs`, helse på `/helse`.

## Hva som er sant, og hva som er sandkasse

En pasientjournal har ingen sentral eier. Etter pasientjournalloven § 8 er det
virksomheten som yter helsehjelpen som er dataansvarlig, så «journalen» er ikke ett
register, men ett per legekontor, sykehus og kommunal helsetjeneste.

Det finnes ingen API der en fylkeskommune kan hente en legeerklæring. Kjernejournal,
Pasientens journaldokumenter og Pasientens legemiddelliste ligger alle bak
medlemskap i Helsenettet, HelseID, HPR-nummer og krav om tjenstlig behov i en
konkret behandlingssituasjon. Vestland fylkeskommune er medlem av Helsenettet, men i
kraft av tannhelsetjenesten, og det åpner ingen dør for samferdselsavdelingen.

Heller ikke innbyggeren har en digital kilde å hente fra. Pasientjournalen på
Helsenorge viser dokumenter fra utvalgte sykehus, og fastlegejournalen er ikke med.

**Slik gjøres det i dag:** legen fyller ut skjemaet, stempler og signerer, og
innbyggeren laster det opp som vedlegg i det digitale søknadsskjemaet eller sender
det via eDialog. Erklæringen er gyldig i seks måneder fra signeringen.

Mocken er den strukturerte utgaven av det vedlegget. Den er med fordi et vedlegg
ikke kan vurderes deterministisk, og fordi casen skal vise samtykkeporten på data
som faktisk er særlige kategorier etter personvernforordningen artikkel 9.

Fire fylkeskommuner - Trøndelag, Akershus, Østfold og Buskerud - tar allerede imot
legeerklæringen digitalt fra legen selv, gjennom et innlogget skjema. Der ligger
erklæringen hos fylkeskommunen når innbyggeren søker. Det er den nærmeste ekte
parallellen til det denne mocken gjør.

## To ting som er bevisst

**Ingen bulkoppslag.** `fnr` er påkrevd på begge journalrutene, og de svarer på én
person om gangen. Uten det kravet ville de vært et uttrekk av alle helseopplysningene
i sandkassen, og en journal svarer aldri på «gi meg alle». Det gjelder også oppslaget
på `erklaeringId`: id-ene er fortløpende, så uten kravet var en telleløkke hele
journalen.

**Maskinporten, ikke ID-porten.** Innbyggeren beviser hvem hen er overfor
`sandbox-backend`, som sjekker handleevne og samtykke og deretter henter her som
maskin. Et personlig ID-porten-token avvises med `403 KREVER_MASKINPORTEN`, slik
`fiks-simulator` gjør det. I virkeligheten ville tilgangen gått gjennom HelseID hos
Norsk helsenett; sandkassen har ingen HelseID, så scopet utstedes av `digdir-mock`.
Navnet holder seg utenfor `ks:fiks:`-familien fordi dette verken er KS eller Fiks.

## Endepunkter

Alle svar bærer `syntetisk: true`.

- `GET /helse` - åpen
- `GET /journal/legeerklaeringer?fnr=` - **bak Maskinporten**, scope
  `pasientjournal:legeerklaering.read`
- `GET /journal/legeerklaeringer/{erklaeringId}?fnr=` - samme scope og samme krav.
  Id-en presiserer hvilken erklæring; hører den til noen andre, er svaret 404.
- `GET /openapi.yaml`, `GET /openapi-ruter.json`, `GET /docs` - åpne

```bash
TOKEN=$(node scripts/token.ts --maskinporten pasientjournal:legeerklaering.read \
  --resource pasientjournal-mock)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8087/journal/legeerklaeringer?fnr=04875899266"
```

## Datasettet

`data/legeerklaeringer.json`, 22 erklæringer. **Mocken er eneste leser av filen** -
`sandbox-backend` når den over HTTP, slik matrikkelen nås. To lesestier ville betydd
to kopier av den samme etterbehandlingen, holdt i takt for hånd.

Nøkkelen er fødselsnummer, den samme som i `krr.json` og `folkeregister.seed.json`.
Ingenting er importert derfra: folkeregisteret inneholder aldri helseopplysninger,
det er bare identiteten som er felles.

Diagnosen er kodet i ICPC-2, kodeverket fastleger bruker. `funn` bærer de tre
målingene rettleiingen for brukergodkjenning faktisk ber om: visus ved synstap
(grensen er 0,33), MMS-score ved demens og kognitiv svikt, og FEV1 i prosent ved
nedsatt lungekapasitet. `lege` bærer HPR-nummer og HER-id, som er identifikatoren i
Adresseregisteret hos Norsk helsenett.

Radene er lagt slik at alle utfallene i regelen er nåbare i befolkningen: innvilget,
under aldersgrensen, bosatt utenfor Vestland, utløpt erklæring, for kort varighet,
visus over grensen - og «ingen erklæring», som er alle de som ikke står i filen.

`LEGEERKLAERING_DATA_FILE` overstyrer hvilken fil mocken leser.

## Kjør frittstående

```bash
node apps/pasientjournal-mock/src/server.ts
```

`AUTH_ENFORCE=false` slår av tokenkravet. Det finnes for å kunne halvere en feilsøking,
ikke som en permanent innstilling.
