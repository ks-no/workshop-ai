# Syntetiske data

## Prinsipp

All data i sandkassen skal være syntetisk. Ingen reelle personopplysninger skal brukes.

## Kildedata og kjøringstilstand

Data er delt i to mapper, og skillet er absolutt:

| Mappe | Innhold | I git |
|---|---|---|
| `data/` | Kildedata. Leses av tjenestene, skrives aldri til. | Ja |
| `state/` | Alt tjenestene skriver under kjøring. | Nei — gitignorert |

Tjenestene leser fra `state/` hvis fila finnes der, og faller ellers tilbake på kilden i `data/`. Første gang noe skrives, opprettes kopien i `state/` automatisk. Det finnes ingen initialiseringskommando.

Konsekvensen er at en demokjøring aldri endrer arbeidstreet. Kjører du en flyt og deretter `git status`, skal den være ren.

### Fella: `state/` skygger for `data/`

Dette koster folk mye tid, så les det før du begynner å redigere.

I det øyeblikket du lagrer noe i prosessbyggeren, skrives
`state/prosessdefinisjoner.json`. Fra da av leses **den**, og alt du redigerer for
hånd i `data/prosessdefinisjoner.json` blir ignorert. Ingen feilmelding, ingen
forskjell i UI-et — endringen din slår bare ikke gjennom.

`sandbox-backend` sier fra i loggen ved oppstart når det skjer:

```
Merk: prosessdefinisjoner.json finnes i state/ og skygger for data/.
Endringer du gjør i data/ blir ignorert til du kjører ./start.sh --reset.
```

Ser du den linja og lurer på hvorfor redigeringene dine ikke virker: enten
`./start.sh --reset` (sletter *all* kjøringstilstand, inkludert prosesser du har
laget i byggeren), eller slett bare den ene fila:

```bash
rm state/prosessdefinisjoner.json
```

Vil du beholde arbeidet fra byggeren, kopier det til `data/` først — se
«Å dele en prosess du har laget» under.

Nullstill all kjøringstilstand med:

```bash
./start.sh --reset
```

`STATE_DIR` kan settes hvis du vil legge tilstanden utenfor repoet.

### Å dele en prosess du har laget

Prosesser du lager i prosessbyggeren havner i `state/prosessdefinisjoner.json`, siden byggeren skriver som alle andre tjenester. Vil du dele prosessen med andre, kopierer du fila til `data/` og committer den:

```bash
cp state/prosessdefinisjoner.json data/prosessdefinisjoner.json
```

## Datasett

Kildedata i `data/`:

| Fil | Innhold |
|---|---|
| `kuratert.json` | **Kilden til de 51 håndskrevne terskelfixturene** (`person-001`–`051`, `household-001`–`018`). Bare forfattede felter: navn, fødselsdato, adresse, sivilstand, `barn`, `ektefelle`, kontaktinfo og et valgfritt `krr`-felt (`reservert`, `spraak`). Alt annet utledes |
| `tenor/*.json` | Rå uttrekk fra Skatteetatens Tenor testdatasøk, ett per aldersbånd. Provenansen som gjør uttrekket reproduserbart |
| `personer.json` | **Generert.** Hele registeret, 394 personer: `navn`, `foedselsdato`, `personstatus`, `doedsdato`, `bostedsadresse`, `sivilstand`, `foreldrebarnrelasjon`, `foreldreansvar`, `skjermet` |
| `husstander.json` | **Generert.** 200 husstander med `type`, `kommunenummer`, medlemmer og roller, og et `scenario`-felt |
| `folkeregister.seed.json` | **Generert.** Samme befolkning i Folkeregisterets form: `foedselsEllerDNummer`, `personnavn`, `personstatus`, `doedsfall`, `forelderbarnrelasjon`, `familierelasjon`, `foreldreansvar` |
| `inntekter.json` | **Generert** for de importerte, **forfattet** for de kuraterte. Poster med `kilde` og `medregnes`, og `stadie` (`OPPGJOER`/`UTKAST`) |
| `krr.json` | **Generert.** Kontaktregisteret: én rad per bosatt person på 15 år eller mer — KRRs reelle aldersgrense — nøklet på fnr. `reservert`, `spraak` og kontaktinfo utledes deterministisk fra fødselsnummeret; kuraterte gjenbruker forfattet kontaktinfo, og forfattet `krr` i `kuratert.json` vinner. `kanVarsles` er utledet. Tenor-personers e-post og telefon finnes **bare her** — `personer.json` røres ikke |
| `eierforhold.json` | **Generert.** Tinglyst eierskap per matrikkelenhet, med `eierform` og `andel`. Eierskap hører i grunnboken, ikke i matrikkelen — derfor egen fil |
| `matrikkel.json` | Gater og eiendommer i de kommunene befolkningen bor i, hentet fra Geonorge. Seed for `matrikkel-mock`. Ingen eiere |
| `matrikkel.seed.json` | Liten firegaters fixture for mockens egne tester |
| `satser.json` | Inntektsgrenser og 6 %-regelen, med `gjelderFra` og `kilde` |
| `barnehageplasser.json`, `sfoplasser.json` | Plass og månedspris, som 6 %-regelen måles mot |
| `tjenestetilbud.json` | Kommunale tilbud med målgruppe og ledige plasser. Grunnlaget for behovsavklaring |
| `fritidsaktiviteter.json` | Katalog over fritidsaktiviteter med aldersgrenser |
| `fritidsdeltakelse.json` | Hvilke barn som deltar i hvilken aktivitet, og til hvilken pris |
| `informasjonsmodeller.json` | Begreper og attributter, med kodeverdier som `pnpm test` holder mot dataene |
| `prosessdefinisjoner.json` | Prosesskatalog med publiserte prosesser og maler |
| `forventet-utfall.json` | Hva hver husstand er ment å demonstrere. Pinnet, aldri regenerert |
| `deltakercaser.json` | Case-til-person-tabellen i `docs/deltakerstart.md`, pinnet |
| `brreg.seed.json` | 200 syntetiske foretak fra Tenor. Ingen kobling til befolkningen |

**`docs/testpersoner.md` er den genererte oversikten over hele befolkningen** — én rad
per person med alder, status, husstand, hvem som kan logge inn, hvem som eier noe og
hvem som har inntektsdata. Den skrives av importen og `pnpm test` feiler hvis den er
ute av takt.

### Generert, ikke redigert

Seks filer skrives av `scripts/importer-tenor.ts` og skal ikke redigeres for hånd:
`personer.json`, `husstander.json`, `inntekter.json`, `krr.json`,
`folkeregister.seed.json` og
`eierforhold.json`. Redigerer du en kuratert rad direkte, reverterer neste import
den — så `pnpm test` sammenligner de kuraterte radene mot `kuratert.json` og feiler
i stedet.

```bash
node scripts/importer-tenor.ts                # bygger alt fra kilde
node scripts/importer-tenor.ts --tørrkjør     # viser tallene uten å skrive
node scripts/importer-tenor.ts --glem-id-er   # tildeler id-er fra bunnen
node scripts/hent-matrikkel.ts                # topper opp matrikkelen fra Geonorge
```

Importen bygger på nytt hver gang, men **id-ene er stabile**: `personId` og
`husstandId` leses tilbake fra `personer.json`, så et nytt Tenor-uttrekk kan slippes
i mappa uten at noen blir omnummerert. `--glem-id-er` tildeler dem fra bunnen, og gir
samme resultat på uendret input — det er sånn determinismen er verifisert.

## Kart over koblingene

```
kuratert.json  ─┐
tenor/*.json   ─┴─→ importer-tenor.js ─→ personer.json ────┬─→ husstander.json
                                       ├─→ folkeregister.seed.json
                                       ├─→ inntekter.json
                                       ├─→ krr.json
                                       ├─→ eierforhold.json
                                       └─→ docs/testpersoner.md
```

| Nøkkel | Hvor den finnes |
|---|---|
| `personId` | `personer.json`, `husstander.medlemmer[]`, `folkeregister._sandbox.personId`, plassfilene, `eierforhold.eiere[].eier`. **Ikke i `inntekter`** — se raden under |
| `syntetiskFodselsnummer` | `personer.json`. Heter `foedselsEllerDNummer` i FREG-modellen og `identifikator` i inntekt og Fiks-beregningen. Det er dette ID-porten legger i `pid`. **Inntekt nøkles på dette, ikke på `personId`:** bare de 25 kuraterte radene bærer også et `personId`-felt, så en join på `personId` finner 25 av 281 rader. API-et gjør koblingen for deg — dette gjelder bare om du leser `data/inntekter.json` direkte |
| `husstandId` | `personer.json`, `husstander.json`, `forventet-utfall.json`. `null` for alle som ikke er `BOSATT` |
| `adresseIdentifikatorFraMatrikkelen` | `personer.bostedsadresse` og `folkeregister.seed.json`. Peker på `matrikkel.json` sin `matrikkelId`. Alle bosatte har en |
| `matrikkelId` | `matrikkel.json`, `eierforhold.json` |
| `kommunenummer` | Nøkkelen mot `tjenestetilbud.json` og `matrikkel.json`. `kommune` er bare et visningsnavn |
| `ordning` | `satser.ordninger[].id`, `forventet-utfall.json`, `deltakercaser.json`, `?ordning=` i `SJEKK`-stegene |

## Spec-forankring

Datamodellen låner vokabular fra ekte spesifikasjoner, men er bevisst forenklet:

- **Person** følger [Folkeregisterets informasjonsmodell](https://skatteetaten.github.io/folkeregisteret-api-dokumentasjon/informasjonsmodell/).
  `personstatus`, `doedsfall`, `familierelasjon`, `foreldreansvar` og
  `adresseIdentifikatorFraMatrikkelen` er registerets egne felter og verdier.
  Historikk, kodelister og adressetypevarianter er utelatt. Feltet heter
  `syntetiskFodselsnummer` og ikke `folkeregisteridentifikator`, fordi
  `policies/data-policy.yaml` krever at syntetiske data er tydelig merket.
- **Inntekt** følger [KS Fiks sitt beregnings-API](https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json),
  beregningstypene `BARNEHAGE_SFO`, `PRAKTISK_BISTAND` og
  `LANGTIDSOPPHOLD_INSTITUSJON`. `fiks-simulator` eksponerer endepunktene på de
  ekte stiene, så kall kan kopieres fra Fiks-dokumentasjonen. De syntetiske
  dataene har ingen formue- eller gjeldsposter, så kategoriene FORMUE, GJELD og
  ANNET forekommer aldri i sandkassen.
- **Kontaktregisteret** følger [KS Fiks Kontaktregisteret](https://developers.fiks.ks.no/api/register-krr-api-v1.json)
  (`KrrDefinisjon`), servert av `fiks-simulator` på den ekte stien
  `POST /register/api/v1/ks/{rolleId}/krr/person`. To flaggede avvik: `spraak`
  finnes bare i Digdirs underliggende KRR og er tatt med fordi språkvalg er et
  reelt kommunalt behov, og fnr valideres med modulus 11 — strengere enn spekkens
  regex.
- **Eiendom** kommer fra [Geonorges adresse-API](https://ws.geonorge.no/adresser/v1),
  som er offentlige adressedata. Eierskapet er vårt eget og syntetisk.
- **Regelverket** er 6 %-regelen fra forskrift om foreldrebetaling. Grensene i
  `satser.json` må verifiseres mot gjeldende forskrift før de brukes til annet enn
  demo — noen er nasjonale, andre kommunale.

## Fødselsnumrene er syntetiske, og merket som det

Måneden har **80 lagt til**: januar er `81`, desember er `92`. Kontrollsifrene er
regnet ut *etter* påslaget, så numrene er mod11-gyldige. Det er Skatteetatens
konvensjon for Tenor-data, og den er det som gjør et syntetisk nummer gjenkjennelig
som syntetisk uten å slutte å være et velformet nummer. NAV bruker +40 på måneden;
vi bruker Skatts, fordi befolkningen kommer fra Tenor.

`apps/shared/foedselsnummer.ts` bærer regelen, og
`pnpm test:foedselsnummer` dekker den. Skal du lese en dato ut av et nummer, må du
trekke fra 80 først — men `foedselsdato` er eget felt, så du trenger det sjelden.
**Tre personer har et nummer som beskriver en annen dato enn `foedselsdato`.** Det er
lovlig i Folkeregisteret: en rettet fødselsdato beholder det opprinnelige nummeret.

Sytten personer har **D-nummer** i stedet: dagen har 40 lagt til. De har ingen norsk
bostedsadresse, ingen husstand og kan ikke logge inn — som i virkeligheten.

## Hvem kan logge inn

To terskler, begge reelle:

- **13 år** er når en elektronisk ID kan finnes. MinID kan bestilles fra det året man
  fyller 13; BankID utstedes fra 12–13 med foreldresignatur. Under det finnes det
  ingenting å logge inn med, så `digdir-mock` lister ikke personen som testbruker.
- **18 år** er rettslig handleevne. Mellom 13 og 18 kan man logge inn, men ikke være
  avsender for en sak — der må en foresatt med foreldreansvar, eller en verge, være
  det. Barnet er fortsatt part.

Reglene ligger i `apps/shared/handleevne.ts`, delt mellom
`digdir-mock` og prosessmotoren så de ikke kan bli uenige, og dekket av
`pnpm test:handleevne`. Prøver du å starte en prosess som en 15-åring får du et 403
som navngir de foresatte som kan gjøre det i stedet.

## Døde, utflyttede og inaktive

Registeret har 394 personer; 369 av dem er `BOSATT`. De 25 andre er der med vilje:

- **6 døde.** En død forelder er fortsatt forelder — relasjonen står, og barnet har
  en mor. Men de har ingen husstand, ingen inntektsrad og kan ikke være avsender.
  Én av dem er gift, og ektefellen er derfor `ENKE_ELLER_ENKEMANN`.
- **2 utflyttede** og **17 med D-nummer eller midlertidig identifikator.**

Importøren droppet disse før, og det var verre enn å ha dem: et barns døde mor
forsvant sporløst, og familien ble ufullstendig uten at noe sa fra.

## Scenariodekning

Datasettene er laget for at ulike team skal kunne bygge ulike ting. For hver
inntektsgrense i `satser.json` finnes det husstander tydelig under, tydelig
over, og like ved. I tillegg finnes:

- husstand uten inntektsopplysninger i det hele tatt
- husstand der skatteoppgjøret er `UTKAST` og tallet kan endre seg
- husstand der bare ytelser som ikke medregnes finnes, så grunnlaget blir null
- person med skjermet identitet, som teller med i summen men ikke kan spesifiseres
- husstander med én og to forsørgere, søsken i to ordninger, og uten barn
- barn med en død forelder, og en enslig forsørger som er enkemann
- personer uten eID, personer som bare kan være part, og personer uten adresse

`pnpm test` feiler hvis dekningen forsvinner. Det er med vilje: uten den testen
kan én justert inntekt fjerne det eneste tilfellet på én side av en terskel, og
da gir alle demoene samme utfall igjen.

## Adressebeskyttelse: seeden er ikke maskert

`data/personer.json` inneholder fullt navn, gateadresse, e-post og telefon for de seks
adressebeskyttede personene, i klartekst. **Det er med vilje.** Maskeringen skjer ved
innlasting, i `apps/shared/skjerming.ts`, og gjelder alle lesere gjennom
API-et. Hadde seeden vært maskert ville det ikke vært noe å beskytte, og
maskeringstestene ville målt tomme strenger.

Leser du fila direkte ser du klartekst. Går du gjennom API-et ser du «Skjermet
person» for kode 6 og en nullet adresse for kode 7. `pnpm test:skjerming` holder det
på plass, og `pnpm test` feiler hvis noen «rydder opp» i seeden.

## Hva som er forfattet, og hvorfor

- **Inntekten.** Tenor hadde inntektsdata for 6 av 120 hoveddokumenter og ingen av de
  224 foreldrene. Beløpene for de importerte utledes deterministisk fra
  fødselsnummeret. Terskelscenarioene ligger hos de 18 kuraterte husstandene, der
  tallene er forfattet og kontrollert mot `forventet-utfall.json`.
- **Kontaktregisteret.** Tenor har ingen kontaktinfo, så e-post, telefon,
  reservasjon og målform utledes deterministisk fra fødselsnummeret: omtrent én
  av ti er reservert, omtrent én av tolv har hverken e-post eller telefon, og
  målformen fordeles mellom `nb`, `nn` og `en`. De kuraterte gjenbruker den
  forfattede kontaktinfoen, og et forfattet `krr`-felt i `kuratert.json` vinner
  over derivasjonen — `person-014` er reservert så print-kanalen kan testes.
  Tenor-personers genererte kontaktinfo står **bare i `krr.json`**, fordi
  `personer.json` er frosset wire-format.
- **Eierskapet.** Ingen offentlig kilde gir tinglyst hjemmel for syntetiske personer.
  Fordelingen er utledet: en husstand eier hjemmet den bor i, omtrent én av fem leier,
  omtrent én av sju eier noe ekstra, og ingen eier mer enn tre. En matrikkelenhet som
  ikke står i `eierforhold.json` har ingen registrert eier.
- **Tolv kuraterte adresser.** `Eksempelveien 12`, `Fjellgata 7` i Stavanger og ti
  andre var oppdiktede. De er byttet til reelle adresser i **samme kommune**, så
  hverken kommunenummer eller noe utfall flyttet seg. `person-001` bor nå i
  Storgata 3 i Bergen — samme eiendom personen eier, som binder
  fartsdempende-casen sammen.
- **Sivilstanden til én person.** Tenor lot en gjenlevende ektefelle stå som `gift`
  fordi uttrekket ble hentet per person og aldri avstemt. Registeret ville sagt
  `enkeEllerEnkemann`, så importen overstyrer det. Det er det eneste stedet importen
  overstyrer en verdi Tenor har oppgitt.

## Kjente grenser

- **Matrikkelen dekker de gatene befolkningen bor i**, pluss alle Bergens gater — 388
  gater i 97 kommuner. Ikke hele Norge. Slår du opp en gate som ingen testperson bor
  i, faller `matrikkel-mock` tilbake til live Geonorge-oppslag hvis nettet er der.
- **Eierforholdet er nøklet på adressen, ikke på matrikkelenheten.** Tinglyst hjemmel
  ligger i virkeligheten på matrikkelenheten (gnr/bnr), og flere adresser deler samme
  gnr/bnr. Modellen har ingen egen matrikkelenhet, så dette er en forenkling.
- **`kommune` er et visningsnavn.** Tenor oppgir bare `kommunenummer`. Der
  `brreg.seed.json` kjenner navnet brukes det; ellers står poststedsnavnet — et ekte
  sted i riktig område, men ikke nødvendigvis kommunenavnet. `kommunenummer` er
  alltid riktig.
- **Én Tenor-person har et kommunenummer fra før grensendringen i 2024** (5402, som nå
  er 5503). Personen er død og har ingen adresse, så det har ingen praktisk følge.
- **`brreg.seed.json` er en helt egen befolkning.** De 263 fødselsnumrene i
  rollelistene har null overlapp med testpersonene.
- **Søsken er ikke egne relasjoner.** De kan utledes av delte foreldre, men står ikke
  i `familierelasjon`.
- **Tolv personer er over 100 år**, den eldste 113. Det er Tenor slik det leveres.

## Regler

- hver post skal være merket som syntetisk der det er relevant
- datasett skal være konsistente på tvers av relasjoner
- eksempelpersoner skal være enkle å bruke i demo — se `docs/testpersoner.md`
- nye datasett skal dokumenteres før de tas i bruk
- tjenester skriver aldri i `data/`
- filer i `data/` og `state/` skal lagres som UTF-8 (Unicode)

## Nåværende innhold

`pnpm test` skriver de faktiske tallene ved hver kjøring, og `docs/testpersoner.md`
har dem i tabell. Bruk dem som kilde, ikke en liste her.

- 394 personer i registeret, 369 av dem bosatte
- 200 husstander, 281 inntektsrader, 298 rader i kontaktregisteret
- 388 gater og 18 349 eiendommer i 97 kommuner, 176 med registrert eier. `matrikkel-mock` injiserer Bønesheien ved innlasting, så `/helse` sier 389 og 18 350
- 8 ordninger og 237 tjenestetilbud
- 15 barnehageplasser, 11 SFO-plasser, 34 fritidsdeltakelser
- 5 prosessdefinisjoner + 1 mal
