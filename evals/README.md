# Evals

Prompts er kode du ikke kan enhetsteste. Samme prompt gir litt ulikt svar hver gang, så
«ble det bedre?» har ikke noe svar uten et scoret datasett. Dette er datasettene.

```bash
pnpm test:eval                        # kjør alt
pnpm test:eval evals/ai-policy.json   # kjør ett
pnpm test:eval --json                 # maskinlesbart
```

Krever at sandboxen kjører og at modellen faktisk er koblet på. Er den ikke det, avbryter
skriptet med én gang i stedet for å score maltekst — en fallback ville gitt full pott på
sjekker modellen aldri kjørte.

Rapport: `state/eval-report.html`. Exit-kode ≠ 0 når et datasett faller under terskelen,
så en promptendring kan stoppes på samme måte som en kodeendring.

## Hva som ligger her nå

| Datasett | Hva det vokter | Terskel |
|---|---|---|
| `ai-policy.json` | `ai-no-decisions`: modellen formulerer, den regner ikke og avgjør ikke | 100 % |
| `samtykke-tolkning.json` | Samtykke skal være informert og utvetydig | 80 % |

## Kjent svakhet, med vilje ikke fikset

`samtykke-tolkning.json` har én case som feiler i dag:

```
✗ nøling skal ikke bli samtykke
    field: intent = "ukjent", fikk "samtykke_ja"
```

«jo altså, det høres vel **ikke helt urimelig** ut» blir lest som utvetydig samtykke med
`confidence: 1`. En dobbel nekting tolket som fullt ja. Reproduserbart: `/ai/tolk-svar`
kjører på temperatur 0, så du får samme svar hver gang.

Rotårsaken er delegeringsregelen, ikke heuristikken. Heuristikken svarer faktisk
*riktig*: ingen av de positive mønstrene matcher helord her, så den faller til
`intent: "ukjent"` med `confidence: 0.2`. Men `interpretReplyWithAi` returnerer
heuristikken direkte bare når `confidence >= 0.75`, og overstyringsblokken etter
modellkallet gjelder bare når heuristikken *ikke* er `ukjent`. Så det riktige svaret
forkastes, spørsmålet går til modellen, og modellen tar feil.

Både `/ai/tolk-svar` og `/ai/oppsummering` kjører på temperatur 0, så begge datasett
er reproduserbare. Oppsummeringen har ingenting å være kreativ om — den gjengir beløp,
datoer og et utfall `sandbox-backend` allerede har avgjort. Default for øvrige
modellkall er `0.2`.

Dette er en god førsteoppgave: samtykke må være informert og utvetydig, og her er et
målbart avvik med en test som allerede beviser når du har fikset det. Skjerp terskelen
til `1` når casen består.

## Skriv ditt eget datasett

En JSON-fil i `evals/`. Feltnavnene er engelske, som ellers i koden:

```json
{
  "name": "kort navn",
  "description": "hva dette vokter, og hvorfor",
  "endpoint": "/ai/oppsummering",
  "threshold": 0.8,
  "cases": [
    {
      "name": "hva denne casen sjekker",
      "body": { "kontekst": { "tjeneste": "..." }, "sprak": "nb" },
      "textPath": "tekst",
      "checks": [
        { "type": "contains", "value": "485 000" },
        { "type": "notContains", "value": "jeg innvilger" },
        { "type": "matches", "pattern": "\\d{3} \\d{3} kr" },
        { "type": "field", "path": "intent", "equals": "samtykke_ja" },
        { "type": "judge", "criterion": "Alle beløp er gjengitt nøyaktig.", "threshold": 0.7 }
      ]
    }
  ]
}
```

`body` er request-kroppen slik endepunktet forventer den. Husk konvensjonen: alt under
`kontekst`, unntatt `/ai/tolk-svar` som tar `tekst` på toppnivå.

`textPath` peker på feltet i svaret som tekstsjekkene skal lese. Utelates den, brukes
`tekst`.

En case består når **alle** sjekkene består. Datasettet består når andelen beståtte caser
når terskelen.

### Sjekktyper

| Type | Bruk |
|---|---|
| `contains` / `notContains` | Delstreng, ufølsom for store bokstaver. Hardt mellomrom i beløp normaliseres, så `485 000` treffer `485 000`. |
| `matches` | Regex. `flags` er valgfritt, standard `i`. |
| `field` | Leser et felt i JSON-svaret: `equals`, `atLeast`, `atMost`, eller bare at det finnes. |
| `judge` | Modellen scorer teksten mot et kriterium, 0.0–1.0. Standard terskel 0.7. |

**Bruk deterministiske sjekker der du kan.** De er raske, gratis og gir samme svar hver
gang. `/ai/tolk-svar` og `/ai/velg-prosess` returnerer allerede validert JSON — der finnes
det en fasit, og da er `field` riktig verktøy. Spar `judge` til fritekst der ingen
deterministisk regel kan uttrykke poenget.

En `judge`-case koster et modellkall og tar sekunder; en `field`-case tar millisekunder.
Se forskjellen i `durationMs`-kolonnen når du kjører.

### Dommeren

`judge` kaller `POST /ai/dommer` i `ai-gateway`. Den ligger der, ikke i eval-skriptet, så
den bruker samme provider, arver timeouten og dukker opp i sporet:

```bash
curl -s "http://localhost:8082/trace.json?task=dommer&limit=1"
```

Dommeren ser bare kriteriet og teksten — aldri forventet svar. Den kan derfor ikke
mønstergjenkjenne seg til en bestått score. Den er instruert til å gi lav score ved tvil.

Vær klar over at en dommer er en modell som vurderer en modell. Den er nyttig for grove
kvalitetskrav («gjengir tallene uendret», «avgjør ikke selv»), ikke for finmasket
poenggiving. Er du uenig i en score, se begrunnelsen i rapporten.

## Sett det i arbeid

Baseline før du endrer en prompt, og samme kommando etterpå:

```bash
pnpm test:eval --json > /tmp/foer.json
# ...endre buildPrompt i apps/ai-gateway/src/server.js...
pnpm test:eval --json > /tmp/etter.json
```

Evalen er bevisst holdt utenfor CI — den krever en kjørende modell.
