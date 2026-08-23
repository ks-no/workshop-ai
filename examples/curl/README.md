# Curl-kokebok

**Flytene, ikke rutelista.** Trenger du å vite hvilke ruter som finnes, hva de tar imot og
hvordan et enkelt kall ser ut, bruk <http://localhost:3001/utforsker>: den leser
spesifikasjonene tjenestene selv serverer, velger riktig token for ruta, og skriver ut en
`curl` som virker når den limes inn. En rutetabell her ville vært en kopi som driver.

Det utforskeren *ikke* kan uttrykke er en rekkefølge — sju kall der hvert bygger på det
forrige. Det er det denne fila er til.

Alle kall er hentet fra `scripts/kontrakt-smoke.ts`, som kjører i CI. Virker et kall
ikke, er det en reell feil.

## 1. Token, én gang

`AUTH_ENFORCE` er **på** som standard. Alt som ikke er uttrykkelig åpent svarer `401`
uten `Authorization`-header.

```bash
export TOKEN=$(node scripts/token.ts --innbygger person-001)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/personer/person-001
```

**Ett token er én person.** Backend binder tokenet til `pid`, så `person-001`s token
åpner ikke `person-031`s data — det gir `403`, ikke `200`. Skal du bruke en annen
testbruker, hent et nytt token.

```bash
export TOKEN_022=$(node scripts/token.ts --innbygger person-022)   # SFO
```

En maskin er noe annet enn en innbygger, og får sitt eget — med et `scope` i stedet for
en person:

```bash
export TOKEN_M=$(node scripts/token.ts --maskinporten ks:innbyggerdialog:les --resource sandbox-backend)
```

`pnpm token` treffer pnpms egen innebygde kommando — kall skriptet direkte.
Åpne ruter (`/helse`, `/docs`, `/api/prosesser`, `/api/katalog/*`, `/api/regler/satser`)
trenger ingenting.

## 2. Er sandboxen i live?

```bash
for p in 8080 8081 8082 8083 8084 8085 8086; do
  printf "%s " $p
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 2 "http://localhost:$p/helse"
done
```

Sju svar, alle `200`. **`8086` er `digdir-mock`**, som utsteder tokener — er den nede,
svarer hvert autentisert kall `401` mens `docker compose ps` ser frisk ut.

`8082` svarer alltid `200` selv om modellen er nede. Les `modellNaaBar` i kroppen, ikke
statuskoden.

## 3. Tre svar på samme URL

Dette er hele hjemmelsmodellen i tre kall, og den mest lærerike halvsiden i sandkassen.

```bash
# uten token: 401 — vi vet ikke hvem du er
curl -s -o /dev/null -w "uten token:          %{http_code}\n" \
  http://localhost:8080/api/personer/person-001/inntekt

# med token, uten samtykke: 403 grunn=mangler_samtykke
curl -s -o /dev/null -w "uten samtykke:       %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/personer/person-001/inntekt

# med token, andres data: 403 grunn=mangler_hjemmel
curl -s -o /dev/null -w "andres husstand:     %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/personer/person-031/husstand
```

```
401  vi vet ikke hvem du er          (autentisering — digdir-mock)
403  vi vet, og du får likevel ikke  (hjemmel eller samtykke — sandbox-backend)
```

De to `403`-ene har ulik `grunn` med vilje: `mangler_samtykke` kan innbyggeren selv rette
ved å samtykke, `mangler_hjemmel` kan hen ikke. Kjører du flyten under først, svarer det
andre kallet `200` — da ligger samtykket inne.

## 4. Full barnehageflyt, ende-til-ende

Sju steg. Prosessmotoren er lineær: `handling` utfører gjeldende steg, `neste` flytter ett
fram. Ingen forgrening — `stegIndex` teller bare oppover.

| # | Type | Steg |
|---|---|---|
| 0 | `INFO` | Velkommen |
| 1 | `DATA_FETCH` | Henter husstandsopplysninger |
| 2 | `CONSENT_REQUEST` | Kan vi hente inntektsopplysninger? |
| 3 | `DATA_FETCH` | Henter inntektsopplysninger |
| 4 | `SJEKK` | Vurderer rett — **deterministisk, utenfor modellen** |
| 5 | `SUMMARY` | Oppsummering — **eneste steg som kaller modellen** |
| 6 | `SUBMIT` | Send søknad |

```bash
AUTH="Authorization: Bearer $TOKEN"
JSON="Content-Type: application/json"
API=http://localhost:8080/api/prosessoekter

# Opprett økt og ta vare på id-en
OEKT=$(curl -s -X POST $API -H "$AUTH" -H "$JSON" \
  -d '{"personId":"person-001","prosessId":"redusert-foreldrebetaling-barnehage"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).oektsId))')
echo "Økt: $OEKT"

# TOM som variabel, ikke "\{\}" inline: i doble fnutter beholder bash bakoverskråstrekene
# og curl sender \{} — ugyldig JSON, og steget svarer 500 uten å si hvorfor.
TOM='{}'
steg() { curl -s -X POST "$API/$OEKT/handling" -H "$AUTH" -H "$JSON" -d "${1:-$TOM}"; }
neste() { curl -s -o /dev/null -X POST "$API/$OEKT/neste" -H "$AUTH"; }

steg; neste                                                  # 0 INFO
steg; neste                                                  # 1 hent husstand
steg '{"handling":"opprett-samtykke"}'                       # 2 be om samtykke
steg '{"handling":"samtykkesvar","status":"SAMTYKKET"}'       # 2 svar
neste
steg; neste                                                  # 3 hent inntekt — går nå
steg; neste                                                  # 4 SJEKK
curl -s -m 180 -X POST "$API/$OEKT/handling" -H "$AUTH" -H "$JSON" -d '{}'   # 5 SUMMARY, 10-60 s
neste
steg                                                         # 6 SUBMIT

# Hele økta. Skal ha status FULLFORT.
curl -s "$API/$OEKT" -H "$AUTH"
```

Sammenlign de to siste stegene — det er arbeidsdelingen sandkassen finnes for å vise:

```bash
curl -s "$API/$OEKT" -H "$AUTH" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const r=JSON.parse(s);
    console.log("SJEKK  :", JSON.stringify(r.resultater["sjekk-rett"], null, 2));
    console.log("SUMMARY:", JSON.stringify(r.resultater["oppsummering"], null, 2));
  })'
```

`SJEKK` er regelmotoren: samme input gir samme svar, hver gang, og `begrunnelse` peker på
satsen. `SUMMARY` er modellen: den *formulerer*, den avgjør ingenting. Bytter du modell,
skal `SJEKK` være uendret.

**Andre case:** `sfo-moderasjon` følger samme sekvens — bytt `prosessId` og bruk
`$TOKEN_022`, ikke `$TOKEN`. `person-001` har ikke barn i SFO, så hen får et avslag som
ser ut som en feil. `fartsdempende-tiltak` er den mest komplette casen og går via
matrikkelen; kjør den i <http://localhost:3001/chat>, der stegene har egne felter.

## 5. Hva fikk modellen egentlig?

```bash
curl -s "http://localhost:8082/trace.json?limit=3"
```

Ett kall per linje, nyeste først, med full prompt og fullt svar før heuristikk og
validering. Raskeste vei til å forstå et rart KI-svar. Lesbar side: <http://localhost:8082/trace>.

## 6. Revisjonsloggen

Loggen går på tvers av personer, så `tilgang` er `bred`: et ID-porten-token gir aldri
hjemmel her, uansett hvor høy `acr`. Det krever en maskinklient.

```bash
export TOKEN_M=$(node scripts/token.ts --maskinporten ks:innbyggerdialog:les --resource sandbox-backend)
curl -s "http://localhost:8080/api/revisjonslogg?limit=5" -H "Authorization: Bearer $TOKEN_M"
```

**Å lese loggen krever `ks:innbyggerdialog:les`, ikke `:revisjon`.** `:revisjon` er
hjemmelen til å *skrive* en hendelse, og den holdes av `fiks-simulator` og `ai-gateway` så
backend forblir eneste skriver. Bruker du feil scope, sier `403` hvilket scope som mangler
og hvilket du har.

Hver datatilgang står her, med hjemmel og formål. Formålet på et samtykkebasert oppslag
hentes fra **samtykket**, ikke fra kallet.

## Feilsøking

| Symptom | Årsak |
|---|---|
| `401` på alt | Mangler `Authorization`, eller `digdir-mock` (`8086`) er nede |
| `401` etter `docker compose up -d` | `digdir-mock` fikk nye nøkler; andre tjenester cacher det gamle tokenet. `docker compose restart tools-api process-agent sandbox-backend fiks-simulator` |
| `403 mangler_hjemmel` | Tokenet tilhører en annen person enn stien |
| `403 mangler_samtykke` | Kjør samtykkestegene i §4 først |
| `fetch failed` på matrikkel | `matrikkel-mock` (`8085`) er ikke oppe |
| Modellkall henger | Avbrytes etter `AI_TIMEOUT_MS` (180 s) og faller til maltekst med `advarsel`. 10–60 s på `SUMMARY` er normalt |
| Rart KI-svar | Les `/trace` — §5 |

**Ingen `jq`.** Kallene pipes gjennom `node -e`, siden Node uansett er et krav for
`scripts/token.ts`.

`./start.sh --reset` tømmer `state/`. Merk at den også starter alt på nytt, med
modellnedlasting — vil du beholde mock-modus, skriv `./start.sh --mock --reset`.
