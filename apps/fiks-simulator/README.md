# Fiks Simulator

Mock av KS Fiks-plattformen. Kjører på `8081`.

Ansvar:

- simulere samtykke
- simulere registeroppslag
- simulere folkeregisteroppslag i rollekontekst
- simulere SvarUt-forsendelser med utledet status
- simulere oppgave- og meldingsflyt

Stack: Node.js med innebygd HTTP-server, null avhengigheter.

## Endepunkter

27 ruter, alle dokumentert i `openapi/fiks-simulator.yaml`. **Alle seks flatene er bak
Maskinporten**, med ett scope hver: `ks:fiks:register`, `ks:fiks:folkeregister`,
`ks:fiks:svarut`, `ks:fiks:samtykke`, `ks:fiks:oppgave` og `ks:fiks:melding`. Scopet
*er* hjemmelen, så et oppgave-token åpner ikke samtykkeflaten. Innbyggerens eget
ID-porten-token avvises på alle seks med `403 KREVER_MASKINPORTEN` — et samtykke
spørres om av en kommune og svares gjennom den.

`POST`/`PUT`-rutene kalles normalt bare av prosessmotoren i sandbox-backend, og aktøren i
revisjonsloggen settes fra tokenet den holder: `SAMTYKKE_OPPRETTET` er tjenesten som *ber*
om samtykke, mens `SAMTYKKE_SVART` og `SAMTYKKE_TRUKKET` er innbyggeren som svarer. Kalles
de direkte med curl, står fiks-simulator som aktør «på vegne av» personen — sant, men
mindre presist.

Samtykke:

- `POST /fiks/samtykke` — opprett
- `GET /fiks/samtykke/{samtykkeId}`
- `GET /fiks/samtykke/{samtykkeId}/historikk`
- `PUT /fiks/samtykke/{samtykkeId}/svar`
- `PUT /fiks/samtykke/{samtykkeId}/trekk`
- `GET /fiks/personer/{personId}/samtykker`

Register — **bak Maskinporten**, scope `ks:fiks:register`:

- `GET /fiks/register/person/{personId}`
- `GET /fiks/register/husstand/{personId}` — slår opp på **personId**, og finner
  husstanden derfra
- `GET /fiks/register/inntekt/{personId}`
- `GET /fiks/register/barnehage/{personId}`
- `GET /fiks/register/kontaktinfo/{personId}`

```bash
TOKEN=$(scripts/token.ts --maskinporten ks:fiks:register --resource fiks-simulator)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8081/fiks/register/person/person-001
```

Uten token svarer de **401** med kode `MANGLER_TOKEN`. Med et ID-porten-token svarer de
**403** `KREVER_MASKINPORTEN`: registerflaten er maskin-til-maskin, og hjemmelen tilhører
kommunen, ikke den som tilfeldigvis er innlogget. Et token utstedt for `sandbox-backend`
avvises også — `--resource fiks-simulator` er nødvendig, og det er hele poenget med
audience-begrensning.

Person-, husstands- og kontaktinfo-rutene **maskerer adressebeskyttede personer** med
samme regler som sandbox-backend, ved å importere `apps/shared/skjerming.ts` framfor å
gjenskape den.
Fram til Del B leste denne tjenesten `data/personer.json` selv uten å maskere, så
`/fiks/register/person/person-031` ga en kode 6-persons fulle navn og gateadresse — og
`/fiks/register/inntekt/person-001` ga full inntekt uten samtykke og uten token.

Oppgaver og meldinger:

- `POST /fiks/oppgaver`, `GET /fiks/oppgaver/{oppgaveId}`
- `PUT /fiks/oppgaver/{oppgaveId}/status`
- `POST /fiks/meldinger`, `GET /fiks/meldinger/{meldingId}`

Kontaktregisteret (KRR) — på den **ekte** Fiks-stien, bak `ks:fiks:register`:

- `POST /register/api/v1/ks/{rolleId}/krr/person` — kropp `{ "fnr": "..." }`

Svarer med spekkens `KrrDefinisjon`-felter (`epost`, `tlf`, `status`, `reservert`,
`kanVarsles`) pluss to flaggede avvik: `spraak` er lånt fra Digdirs underliggende
KRR, og fnr valideres med modulus 11 — strengere enn spekkens regex. Datasettet er
`data/krr.json`: én rad per bosatt person på 15 år eller mer, KRRs reelle
aldersgrense. Feilskillet er del av læringsverdien: 400 `UGYLDIG_IDENTIFIKATOR`
for et misdannet fnr, 404 `PERSON_IKKE_FUNNET` for et ukjent, og 404
`IKKE_I_KONTAKTREGISTERET` for en kjent person under 15 år eller som ikke er
bosatt. Adressebeskyttede får `epost` og `tlf` nullet i svaret; `reservert`,
`spraak` og `kanVarsles` beholdes.

```bash
TOKEN=$(scripts/token.ts --maskinporten ks:fiks:register --resource fiks-simulator)
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"fnr": "28829100055"}' \
  http://localhost:8081/register/api/v1/ks/min-rolle/krr/person
```

Folkeregisteret — på den **ekte** Fiks-proxystien, bak eget scope
`ks:fiks:folkeregister` (egen stifamilie, eget hjemmelsgrunnlag — et
register-token åpner det ikke):

- `GET /folkeregister/api/v1/{rolleId}/v1/personer/{fnr}` — valgfri gjentakbar
  `?part=<informasjonsdel>`

Den doble versjonen er ikke en skrivefeil: `/api/v1/` er Fiks-proxyens, `/v1/` er
FREGs egen. Alle kall skjer i en rollekontekst som avgrenser lovhjemmel og hvilke
informasjonsdeler man får ut — dataminimering som API-adferd. Tre faste roller
(`apps/fiks-simulator/src/folkeregister.ts`): `oppvekst` (navn, relasjoner,
foreldreansvar, adresse), `helse-omsorg` (sivilstand og kontaktadresse i stedet for
relasjonsdetaljene) og `folkehelse` (kun fødselsdato, kjønn og personstatus — verken
navn eller adresse). Avslagene bærer læringen: en del utenfor rollen er 403
`UTENFOR_ROLLE`, ikke et tomt felt; ukjent del er 400 `UKJENT_INFORMASJONSDEL`;
ukjent rolleId er 403 `UKJENT_ROLLE` med de gyldige rollene i meldingen.
Adressebeskyttede maskeres på vei ut med `maskFregPerson` i
`apps/shared/skjerming.ts`, og hvert oppslag revisjonslogges med rolle og deler i
grunnlaget — ikke fødselsnummeret. Avvikene fra det ekte API-et (flat form uten
ajourholdsmetadata, tre faste eksempelroller, kun enkeltoppslag) er flagget i
spesifikasjonen.

```bash
TOKEN=$(scripts/token.ts --maskinporten ks:fiks:folkeregister --resource fiks-simulator)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8081/folkeregister/api/v1/09b21eb2-c0cb-4a87-9cb0-f5405040faa3/v1/personer/12818800078"
```

Beregning — også på ekte Fiks-sti, bak `ks:fiks:register`:

- `POST /register/api/v1/ks/{rolleId}/skatteoginntektsopplysninger/beregning/redusert-foreldrebetaling`
- `POST /register/api/v1/ks/{rolleId}/skatteoginntektsopplysninger/beregning/praktisk-bistand`
- `POST /register/api/v1/ks/{rolleId}/skatteoginntektsopplysninger/beregning/langtidsopphold-institusjon`

Modellert etter
[register-skatteoginntektsopplysninger-beregning-api-v1](https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json),
beregningstypene `BARNEHAGE_SFO`, `PRAKTISK_BISTAND` og `LANGTIDSOPPHOLD_INSTITUSJON`.
Typene deler svarform; forskjellene er persontypene per type og at langtidsopphold
i tillegg viser kategorien `FRADRAG`, bygget av postene med `medregnes: false`.

SvarUt — på de ekte forsendelse-stiene bak et `/svarut`-prefiks, scope `ks:fiks:svarut`:

- `POST /svarut/api/v2/kontoer/{kontoId}/forsendelser` — send, svarer `{ "id": "..." }`
- `POST /svarut/api/v2/kontoer/{kontoId}/forsendelser/status-sok`

Modellert etter
[forsendelse-send-api-v2](https://developers.fiks.ks.no/api/forsendelse-send-api-v2.json)
og statussøket i forsendelse-status-api-v2, med JSON i stedet for multipart — kroppen
er metadata-delen uendret, ingen dokumentbytes lagres. Kanalen avgjøres ved
opprettelse (KRR-oppslag på `mottaker.digitalId`; reservert i KRR betyr print), og
statusen *utledes* av tiden siden opprettelsen — MOTTATT, så SENDT_DIGITALT/SENDT_PRINT
etter 10 sekunder, så LEST/PRINTET etter 60 — ingen timere, ingen ekstra skrivevei.
Tilstandsmaskinen og utledningen ligger i `src/forsendelse.ts`; `pnpm test:forsendelse`
dekker kanalvalget og hvert utledningssteg, uten stack og uten modell.

Pluss `/helse`, `/docs`, `/openapi.yaml` og `/openapi-ruter.json`.

## Samtykket har regler

Samtykke er sandkassens viktigste policyregel, og kan derfor ikke være det slappeste i
stacken. Kodeverket og tilstandsmaskinen ligger i `apps/shared/samtykke.ts`, delt fordi
`sandbox-backend` svarer for det samme samtykket når det porter en `DATA_FETCH`:

```
VENTER_PAA_SVAR → SAMTYKKET | IKKE_SAMTYKKET
SAMTYKKET       → TRUKKET | UTLOEPT
IKKE_SAMTYKKET  → endelig
TRUKKET         → endelig
UTLOEPT         → endelig
```

- **Ugyldig overgang gir 409** med hva statusen var og hva som ble forsøkt. Et trukket
  samtykke kan ikke gjenopplives ved å svare på det igjen.
- **En status utenfor kodeverket gir 400.** Forskjellen er med vilje: «du skrev feil» og
  «du er for sent ute» er ikke samme svar.
- **`utloper` leses.** Et samtykke er gyldig i 30 dager. `UTLOEPT` *utledes* på vei ut —
  ingenting kjører på en timer her, så raden på disk står som `SAMTYKKET` mens API-et
  svarer `UTLOEPT`. Historikken forblir dermed et faktisk hendelsesforløp: utløp er noe
  som skjedde med samtykket, ikke noe noen gjorde.
- **Avviste forsøk revisjonslogges** som `SAMTYKKE_AVVIST`, med status, forsøk og kode.
  Et forsøk på å gjenopplive et trukket samtykke er nettopp det en revisjonslogg er til
  for.
- **Skriving er serialisert.** Ti samtidige `POST /fiks/samtykke` ga tre samtykker før
  skrivekøen; nå gir de ti. Fem samtidige svar på samme samtykke gir ett `200` og fire
  `409`. Køen ble skrevet her, men bor nå i `apps/shared/jsonstore.ts` — den fantes i
  tre kopier, og de to filene ingen av kopiene dekket ble skrevet uten kø i det hele
  tatt. `src/state.ts` peker dit.

Oppgaven har samme form, i `src/oppgave.ts`: `OPPRETTET → UNDER_BEHANDLING → FERDIG |
AVVIST`. Ingen case driver en oppgave videre ennå — flaten finnes for en
saksbehandlerflate.

`pnpm test:samtykke` dekker alt dette, uten stack og uten modell.

## Spesifikasjonen holdes i takt

`pnpm test:openapi` sammenligner hver rute i koden med hver path i spesifikasjonen, i
begge retninger, og feiler også på duplikate path-nøkler, feil metode, manglende
`security:` og et kodeverk som har kommet ut av takt. Legger du til en rute her uten å
dokumentere den, feiler CI.
