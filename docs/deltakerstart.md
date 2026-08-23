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
| Redusert betaling i SFO | `person-022` **Fatima Ali** |
| Behovsavklaring for støttekontakt | `person-001` **Maja Solberg** |
| Søknad om fritidskort-støtte | `person-028` **Nora Fjeld** |
| Søknad om fartsdempende tiltak | `person-001` |

Tabellen er pinnet i `data/deltakercaser.json` og sjekket av `pnpm test`, så et
innvilget utfall her er et innvilget utfall i sandkassen.

> **Den vanligste snublesteinen:** `person-001` har *ikke* barn i SFO, og heller
> ikke barn i fritidskortets aldersgruppe. Prøver du de casene med henne, får du et
> avslag som ser ut som en feil, men er riktig. Bruk `person-022` for SFO og
> `person-028` for fritidskort.

For **støttekontakt** avgjør alder og hvor søkeren bor, ikke inntekt — steget ber
derfor ikke om inntektssamtykke. `person-001` får innvilget, `person-003` får «ingen
ledige plasser», og `person-062` bor i en kommune uten registrert tilbud.

For **fritidskort** avgjør husholdningens inntekt: `person-028` ligger på 158 000 og
får innvilget, mens `person-008` ligger på 653 000 og får avslag. Grensen er 360 000.

For **fartsdempende tiltak** avgjør gatenavnet utfallet: `Storgata` gir godkjent,
`Fjøsangerveien` gir avvist. `person-001` bor og eier i Storgata 3.

## 3b. Hvem kan logge inn

Ikke alle testpersonene kan brukes som innlogget bruker, og det er med vilje:

- **Under 13 år: ingen innlogging.** MinID kan bestilles fra det året man fyller 13,
  så en elektronisk ID finnes ikke før det. 65 av testpersonene er under 13, og de
  står ikke i velgeren på `:8086`.
- **13–17 år: kan logge inn, men er bare part i saken.** Å opptre på egen hånd
  overfor en kommune krever rettslig handleevne, altså 18 år. Prøver du å starte en
  prosess som en 15-åring, får du et 403 som navngir de foresatte som kan være
  avsender — og logger du inn som en av dem, går flyten gjennom.
- **Død, utflyttet eller D-nummer: ingen innlogging.** De finnes i registeret, og et
  barn med en død mor har fortsatt en mor — men de kan ikke være avsender.

`docs/testpersoner.md` har hele befolkningen med en `Logg inn`-kolonne som sier
`ja`, `part` eller `nei` for hver enkelt. `docs/syntetiske-data.md` forklarer
datagrunnlaget: hvor det kommer fra, hva som er forfattet, og hvor grensene går.

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
./start.sh --mock --reset
```

`--reset` tømmer `state/` og starter deretter alt på vanlig måte. **Ta med `--mock` hvis
du kjørte med `--mock`** — uten det begynner den å laste ned språkmodellen.

`data/` er kildedata og skrives aldri til. Alt tjenestene endrer under kjøring havner
i `state/`, som er gitignorert — en demokjøring skitner ikke til arbeidstreet.

---

**Vil du vite mer?** `README.md` har hele bildet: alle flagg, porter, API-eksempler og
kjente begrensninger.

**Skal du bygge noe?** Start med `docs/architecture.md`, og `docs/prosessmodell.md`
hvis du skal lage en ny case. `examples/curl/README.md` har ferdige kall for hele
flyten.
