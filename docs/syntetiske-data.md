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
| `personer.json` | Folkeregister-inspirert: `navn`, `foedselsdato`, `bostedsadresse`, `sivilstand`, `foreldrebarnrelasjon`, `skjermet` |
| `husstander.json` | Husholdning etter forskriften: ektefeller, partnere og samboere. Har `type` og et `scenario`-felt som sier hva husstanden demonstrerer |
| `inntekter.json` | Poster som mater beregningen, med `kilde` og `medregnes`. Har `stadie` (`OPPGJOER`/`UTKAST`) |
| `satser.json` | Inntektsgrenser og 6 %-regelen, med `gjelderFra` og `kilde` |
| `barnehageplasser.json`, `sfoplasser.json` | Plass og månedspris, som 6 %-regelen måles mot |
| `matrikkel.seed.json` | Gater, eiendommer og eierforhold |
| `informasjonsmodeller.json` | Begreper og attributter, med lenker til kildespesifikasjonene |
| `prosessdefinisjoner.json` | Prosesskatalog med publiserte prosesser og maler |

### Spec-forankring

Datamodellen låner vokabular fra ekte spesifikasjoner, men er bevisst forenklet:

- **Person** følger [Folkeregisterets informasjonsmodell](https://skatteetaten.github.io/folkeregisteret-api-dokumentasjon/informasjonsmodell/). Historikk, kodelister og adressetypevarianter er utelatt. Feltet heter `syntetiskFodselsnummer` og ikke `folkeregisteridentifikator`, fordi `policies/data-policy.yaml` krever at syntetiske data er tydelig merket.
- **Inntekt** følger [KS Fiks sitt beregnings-API](https://developers.fiks.ks.no/api/register-skatteoginntektsopplysninger-beregning-api-v1.json), beregningstype `BARNEHAGE_SFO`. `fiks-simulator` eksponerer endepunktet på den ekte stien, så kall kan kopieres fra Fiks-dokumentasjonen.
- **Regelverket** er 6 %-regelen fra forskrift om foreldrebetaling. Grensene i `satser.json` må verifiseres mot gjeldende forskrift før de brukes til annet enn demo — noen er nasjonale, andre kommunale.

### Scenariodekning

Datasettene er laget for at ulike team skal kunne bygge ulike ting. For hver
inntektsgrense i `satser.json` finnes det husstander tydelig under, tydelig
over, og like ved. I tillegg finnes:

- husstand uten inntektsopplysninger i det hele tatt
- husstand der skatteoppgjøret er `UTKAST` og tallet kan endre seg
- husstand der bare ytelser som ikke medregnes finnes, så grunnlaget blir null
- person med skjermet identitet, som teller med i summen men ikke kan spesifiseres
- husstander med én og to forsørgere, søsken i to ordninger, og uten barn

`pnpm test` feiler hvis dekningen forsvinner. Det er med vilje: uten den testen
kan én justert inntekt fjerne det eneste tilfellet på én side av en terskel, og
da gir alle demoene samme utfall igjen.

Disse datasettene oppstår først under kjøring og finnes bare i `state/`:

- `revisjonslogg.json`
- `prosessoekter.json`
- `soknader.json`
- `samtykker.json`
- `oppgaver.json`
- `meldinger.json`

De har ingen fil i `data/` i det hele tatt. Tjenestene starter dem som tomme lister og oppretter fila i `state/` ved første skriving.

Vil du at et av dem skal starte med innhold — for eksempel en innbygger som allerede har en søknad til behandling — legger du bare fila i `data/`. Oppslaget finner den automatisk. Kildedata som *må* finnes, som `personer.json`, feiler høylytt hvis den mangler, i stedet for å se tom ut.

## Regler

- hver post skal være merket som syntetisk der det er relevant
- datasett skal være konsistente på tvers av relasjoner
- eksempelpersoner skal være enkle å bruke i demo
- nye datasett skal dokumenteres før de tas i bruk
- tjenester skriver aldri i `data/`
- filer i `data/` og `state/` skal lagres som UTF-8 (Unicode)

## Nåværende innhold

- 43 syntetiske personer
- 18 husstander
- 25 inntektsposter
- 13 barnehageplasser og 5 SFO-plasser
- 6 ordninger med satser
- matrikkeldata med 4 gater, eiendommer og eierforhold
- 5 prosessdefinisjoner + 1 mal

`pnpm test` skriver de faktiske tallene ut ved hver kjøring, så bruk den som
kilde hvis lista over har rukket å bli gammel.
