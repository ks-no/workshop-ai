# politiattest-mock

**Denne integrasjonen finnes ikke.** Det er det viktigste å vite om tjenesten, og
grunnen til at det står først: en mock som later som den etterlikner noe ekte, lærer
bort noe galt.

Mocken serverer politiattester, formet som det dokumentet innbyggeren har fått fra
politiet og framviser til kommunen. Port `8088`. Spesifikasjon på `/openapi.yaml`,
lesbar på `/docs`, helse på `/helse`.

## Hva som er sant, og hva som er sandkasse

Vandelskontroll kan bare gjøres når den har hjemmel i lov eller forskrift
(politiregisterloven § 36), og formålet avgjør hvilken attest som utstedes (§ 37).
Kommunen bekrefter formål og hjemmel, politiet utsteder, og **innbyggeren søker selv
og får attesten selv**. Behandlingstiden er rundt to uker, og attesten kommer i den
digitale postkassen.

Det finnes **ingen API** for politiattest, og attesten er ikke maskinlesbar. Den
leveres som en låst PDF, og at PDF-en kan forfalskes er et kjent og omtalt problem:
studiesektoren har bedt om en verifiserbar løsning i årevis uten å få den. Politiet
har digitalisert søknaden og forsendelsen, ikke verifiseringen.

**Slik gjøres det i dag:** kommunen gir søkeren en bekreftelse på formål, søkeren
søker hos politiet, får PDF-en, og viser den fram. Kommunen ser på den, noterer at
kontrollen er gjort, og skal ikke beholde den lenger enn formålet krever - etter
forskriften til opplæringslova kapittel 15 skal den makuleres straks den er brukt i
tilsettingssaken.

Mocken er den strukturerte utgaven av den PDF-en. Den er med fordi et vedlegg ikke
kan vurderes deterministisk, og fordi casen skal vise hvor grensen går mellom det en
regel kan avgjøre og det et menneske må vurdere.

**Tjenesten modellerer ikke politiets reaksjonsregister.** Den svarer bare på
attester som alt er utstedt til en person for et bestemt formål. Et oppslag i
reaksjonsregisteret er en helt annen ting, med en helt annen hjemmelsterskel, og det
er ikke det som skjer her.

## Attesttypen `helse-og-omsorgsattest`

Loven navngir barneomsorgsattest (politiregisterloven § 39 første ledd), ordinær
attest (§ 40) og uttømmende og utvidet attest (§ 41). Attesten etter helse- og
omsorgstjenesteloven § 5-4 har ikke noe eget navn: den er satt sammen av lovbruddene
i § 41 nr. 1 og § 40, og politiet identifiserer den gjennom formålet.

En regel må ha en verdi å sammenligne mot, så sandkassen navngir den
`helse-og-omsorgsattest`. Navnet er vårt, ikke lovens.

## To ting som er bevisst

**Ingen bulkoppslag, og ingen oppslag uten formål.** Både `fnr` og `formaal` er
påkrevd på `/attester`. `fnr` fordi ruten ellers ville vært et uttrekk av alle
anmerkninger i sandkassen. `formaal` fordi en attest gjelder for det formålet den ble
utstedt til - et oppslag uten formål er spørsmålet «hva har denne personen på seg»,
og det skal ingen kunne stille.

**Maskinporten, ikke ID-porten.** Innbyggeren beviser hvem hen er overfor
`sandbox-backend`, som sjekker handleevne og samtykke og deretter henter her som
maskin. Et personlig ID-porten-token avvises med `403 KREVER_MASKINPORTEN`, slik
`fiks-simulator` og `pasientjournal-mock` gjør det. Navnet på scopet holder seg
utenfor `ks:fiks:`-familien fordi dette verken er KS eller Fiks.

## Beviset

Hver attest bærer en `bevis`-blokk formet som et Verifiable Credential, med
`issuer`, `credentialSubject`, `issuanceDate` og `expirationDate`. Feltnavnene der er
engelske fordi de tilhører W3C-modellen og ikke denne sandkassen.

Det er lommebok-kroken: en politiattest er skoleeksempelet på et digitalt bevis, og
et team kan utstede den i Digdirs lommebok og la kommunen verifisere den framfor å
lese en PDF. Se `docs/bygg-selv.md`.

`expirationDate` er utstedelsesdato pluss tre måneder. Selve attesten har ingen
utløpsdato - tremånedersgrensen er mottakerens regel - og beviset gjør grensen
synlig for den som verifiserer. Det finnes ingen kryptografisk `proof`: sandkassen
signerer ikke bevis.

## Endepunkter

Alle svar bærer `syntetisk: true`.

- `GET /helse` - åpen
- `GET /attester?fnr=&formaal=` - **bak Maskinporten**, scope
  `politiattest:attest.read`
- `GET /attester/{attestId}` - samme scope
- `GET /openapi.yaml`, `GET /openapi-ruter.json`, `GET /docs` - åpne

```bash
TOKEN=$(node scripts/token.ts --maskinporten politiattest:attest.read \
  --resource politiattest-mock)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8088/attester?fnr=03889400020&formaal=stottekontakt"
```

## Datasettet

`data/politiattester.json`, 8 attester. **Mocken er eneste leser av filen** -
`sandbox-backend` når den over HTTP, slik matrikkelen og journalen nås.

Nøkkelen er fødselsnummer, den samme som i `krr.json`. Ingenting er importert
derfra: et folkeregister inneholder ikke straffedommer, det er bare identiteten som
er felles.

Radene er lagt slik at alle utfallene i regelen er nåbare: godkjent, absolutt
utelukkelse, krever manuell vurdering, attest for gammel, feil attesttype - og
«ingen attest», som er alle de som ikke står i filen.

`POLITIATTEST_DATA_FILE` overstyrer hvilken fil mocken leser.

## Hva casen bevisst ikke modellerer

- **Aldersgrensen og vergens signatur.** Politiet krever at søkere under 18 legger
  ved et signert skjema fra en foresatt. Bergen sier samtidig at alderen for
  støttekontakt vurderes konkret, uten en fast grense. `apps/shared/handleevne.ts`
  sperrer alt under 18 fra å være avsender, så en mindreårig kommer aldri hit alene.
  En ekte tredje terskel hører i den modulen, ikke i denne regelen.
- **Fornyet vandelskontroll** (politiregisterloven § 43), der arbeidsgiveren spør
  politiet på nytt om en som alt er ansatt. Motoren er lineær og har ingen tilstand
  for et løpende ansettelsesforhold.
- **Egnethetsvurderingen.** Regelen sier at den kreves, og stopper der. Den er
  skjønn, utøves av et menneske, og skal ikke ha en maskinell etterligning her.
- **Makuleringen.** Sandkassen skriver aldri attesten til `state/`, så det finnes
  ingen makulering å utføre. Oppbevaringsregelen står som tekst i bekreftelsen på
  formål, og revisjonsloggen viser at bare utfallet ble lagret.

## Kjør frittstående

```bash
node apps/politiattest-mock/src/server.ts
```

`AUTH_ENFORCE=false` slår av tokenkravet. Det finnes for å kunne halvere en
feilsøking, ikke som en permanent innstilling.
