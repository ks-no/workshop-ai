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

- `personer.json`
- `husstander.json`
- `inntekter.json`
- `barnehageplasser.json`
- `matrikkel.json`
- `informasjonsmodeller.json`
- `prosessdefinisjoner.json`

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

## Nåværende innhold

- 20 syntetiske personer
- 10 husstander
- inntektsdata for foresatte
- barnehagedata for et utvalg barn
- matrikkeldata med gater, eiendommer og eierforhold
