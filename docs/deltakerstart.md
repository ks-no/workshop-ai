# Deltakerstart

Denne siden er alt du trenger den første timen. Resten av dokumentasjonen kan vente.

## 1. Start sandboxen

Du trenger **Docker** installert og startet. Så:

```bash
./start.sh --mock
```

Fire til sju minutter. `--mock` kjører uten språkmodell, så KI-svarene er maltekst i
stedet for modellgenerert. Alt annet er ekte: flyten, samtykkesperren, revisjonsloggen
og alle API-ene. Dette er den riktige veien inn første gang, og den eneste som ikke
krever nedlasting av flere gigabyte.

Vil du ha den ekte modellen etterpå, kjør `./start.sh` uten flagg. Sett av 12–25
minutter til det, mer på delt konferansenett.

På Windows: kjør fra Git Bash eller WSL.

Stopp alt med `./start.sh -d`.

## 2. Én URL du trenger, og fem du kommer til å bruke

Start på **<http://localhost:3001>**. Det er oversikten: den viser hvordan tjenestene
henger sammen, om alle kjører, om modellen er koblet på, og hvilken testbruker som
hører til hvilken case. Derfra kommer du til alt annet — hver tjeneste står i tabellen
med spesifikasjonen sin og en lenke rett inn i API-utforskeren. Går noe galt senere, er
det den siden du går tilbake til.

| URL | Hva det er |
|---|---|
| <http://localhost:3001> | **Oversikt** — arkitektur, helsestatus, modellstatus, casetabell |
| <http://localhost:3001/chat> | Chat. Du velger prosess, og kan stille spørsmål underveis |
| <http://localhost:3001/agent> | Agent i naturlig språk. Den velger prosess selv |
| <http://localhost:3001/stegvis> | Ett steg av gangen, med rå JSON og revisjonslogg synlig |
| <http://localhost:3001/utforsker> | **API-utforskeren** — alle endepunktene, med skjema per rute og en `curl` som virker når den limes inn. Tokenet velges ut fra hjemmelen ruta krever |
| <http://localhost:3000> | Prosessbygger — lag eller endre en flyt |
| <http://localhost:3001/ds-eksempel> | Designsystem-mal. Trenger du bare hvis du lager din egen frontend — se `docs/designsystem.md` |

De øvrige tjenestene (`:8080`–`:8086`) er API-er du kan bygge mot. Du trenger ikke åpne
noen av dem for å se sandboxen virke — og skal du bygge mot dem, er API-utforskeren
raskere enn å lese spesifikasjonene selv.

## 3. Hvilken bruker til hvilken case

Fem demo-case er publisert. Velg bruker etter case — **det er ikke én bruker som
passer alle:**

| Case | Bruk denne brukeren |
|---|---|
| Redusert foreldrebetaling (barnehage) | `person-001` **Maja Solberg** |
| Redusert betaling i SFO | `person-008` **Ingrid Dahl** |
| Behovsavklaring for støttekontakt | `person-001` **Maja Solberg** |
| Søknad om fritidskort-støtte | `person-028` **Håkon Fjeld** |
| Søknad om fartsdempende tiltak | `person-001` |

> **Den vanligste snublesteinen:** `person-001` har *ikke* barn i SFO, og heller
> ikke barn i fritidskortets aldersgruppe. Prøver du de casene med henne, får du et
> avslag som ser ut som en feil, men er riktig. Bruk `person-008` for SFO og
> `person-028` for fritidskort.

For **støttekontakt** avgjør alder og hvor søkeren bor, ikke inntekt — steget ber
derfor ikke om inntektssamtykke. `person-001` får innvilget, `person-003` får «ingen
ledige plasser», og `person-062` bor i en kommune uten registrert tilbud.

For **fritidskort** avgjør husholdningens inntekt: `person-028` ligger på 158 000 og
får innvilget, mens `person-008` ligger på 653 000 og får avslag. Grensen er 360 000.

For **fartsdempende tiltak** avgjør gatenavnet utfallet: `Storgata` gir godkjent,
`Fjøsangerveien` gir avvist.

## 4. Tre sjekker når noe ser rart ut

**Er modellen koblet på?**

```bash
curl -s http://localhost:8082/helse
```

Les `modellNaaBar`. Er den `false`, forklarer et `feil`-felt hvorfor. Merk at status
alltid er 200 — tjenesten lever selv om modellen ikke gjør det. Kjørte du med
`--mock`, skal den være `false`, og det er som forventet.

**Hva fikk modellen egentlig?**

<http://localhost:8082/trace>

Ett kall per linje, nyeste øverst, med full prompt og fullt svar før heuristikk og
validering har vært innom. Dette er raskeste vei til å forstå et rart KI-svar.

**Kjører alle tjenestene?**

```bash
docker compose ps
```

Ser du «fetch failed» på matrikkel-oppslag eller i `fartsdempende-tiltak`-casen, er
det nesten alltid `matrikkel-mock` som ikke er oppe.

## 5. Nullstille

```bash
./start.sh --reset
```

`data/` er kildedata og skrives aldri til. Alt tjenestene endrer under kjøring havner
i `state/`, som er gitignorert — en demokjøring skitner ikke til arbeidstreet.
`--reset` tømmer `state/`.

---

**Vil du vite mer?** `README.md` har hele bildet: alle flagg, porter, API-eksempler og
kjente begrensninger.

**Skal du bygge noe?** Start med `docs/architecture.md`, og `docs/prosessmodell.md`
hvis du skal lage en ny case. `examples/curl/README.md` har ferdige kall for hele
flyten.
