# Curl-kokebok

Alle kall her er hentet fra `scripts/kontrakt-smoke.js` og `scripts/test-agent-flow.js`,
som kjøres som en del av testene. Virker et kall ikke, er det en reell feil — ikke et
utdatert eksempel.

Forutsetter at sandboxen kjører (`./start.sh`). Porter:

| Tjeneste | Port |
|---|---|
| `sandbox-backend` | 8080 |
| `fiks-simulator` | 8081 |
| `ai-gateway` | 8082 |
| `mcp-services` | 8083 |
| `process-agent` | 8084 |
| `matrikkel-mock` | 8085 |
| `process-builder` | 3000 |
| `demo-gui` | 3001 |

Eksemplene bruker `person-001` **Maja Solberg** (barnehage, `household-001`).
`person-008` er den foresatte som faktisk har barn i SFO.

> **Ingen `jq`.** Alle kall pipes gjennom `node -e` for lesbar utskrift, siden Node
> uansett er et krav. Vil du ha rå JSON, dropp pipen.

---

## 0. Er sandboxen i live?

```bash
for p in 8080 8081 8082 8083 8084 8085; do
  printf "%s -> " "$p"
  curl -s "http://localhost:$p/helse" || echo "SVARER IKKE"
  echo
done
```

**Sjekk at modellen faktisk er koblet på.** Dette er det viktigste kallet i hele
kokeboken:

```bash
curl -s http://localhost:8082/helse
```

```json
{ "provider": "ollama", "modell": "ollama:qwen2.5:14b", "modellNaaBar": true }
```

`modellNaaBar: false` kommer med et `feil`-felt som sier hvorfor. Merk at status alltid
er 200 — tjenesten lever selv om modellen ikke gjør det, så det er `modellNaaBar` du
skal lese, ikke statuskoden.

`demo-gui` viser en gul stripe på `/chat` og `/agent` når modellen ikke er koblet på, og
`./start.sh` advarer ved oppstart. Men vil du være helt sikker, gjør et ekte kall:

```bash
curl -s -X POST http://localhost:8082/ai/klarsprak \
  -H "Content-Type: application/json" \
  -d '{"kontekst":{"tjeneste":"barnehage"},"sprak":"nb"}' | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const r=JSON.parse(s);
    console.log("modell:", r.modell);
    if (r.advarsel) console.log("\n⚠️  ADVARSEL:", r.advarsel,
      "\n   Du får maltekst, ikke modellsvar. Se feilsøking nederst.");
  })'
```

Svaret skal ha `modell: "ollama:<modellnavn>"` og **ingen** `advarsel`.
Står det `mock-ai-gateway (fallback)` snakker du med en mal, ikke en modell.

---

## 1. Oppslag uten sideeffekter

```bash
curl -s http://localhost:8080/api/personer
curl -s http://localhost:8080/api/personer/person-001
curl -s http://localhost:8080/api/personer/person-001/husstand
curl -s http://localhost:8080/api/personer/person-001/barnehage
curl -s http://localhost:8080/api/personer/person-008/sfo
curl -s http://localhost:8080/api/regler/satser
curl -s http://localhost:8080/api/prosesser
curl -s http://localhost:8080/api/prosesser/reduced-kindergarten-payment
```

**Ressurskatalogen** — én oppføring er samtidig HTTP-endepunkt, `DATA_FETCH`-mål og
`SJEKK`-mål. Start her hvis du vil vite hva som finnes:

```bash
curl -s http://localhost:8080/api/katalog/ressurser
curl -s http://localhost:8080/api/katalog/datasett
curl -s http://localhost:8080/api/katalog/informasjonsmodeller
```

**Samtykkesperren, demonstrert.** Uten samtykke skal inntekt være stengt:

```bash
curl -s -o /dev/null -w "inntekt uten samtykke: %{http_code}\n" \
  http://localhost:8080/api/personer/person-001/inntekt
curl -s -o /dev/null -w "inntektsgrunnlag uten samtykke: %{http_code}\n" \
  http://localhost:8080/api/husstander/household-001/inntektsgrunnlag
```

Begge skal gi **403** `{"feil":"Inntektsdata krever registrert samtykke."}`.

> **Får du 200 her, er ikke sperren ødelagt — du har allerede samtykket.**
> Samtykker lever i `state/` og overlever mellom kjøringer. Har du (eller noen andre
> på maskinen) kjørt en barnehageflyt tidligere, ligger samtykket der fortsatt.
> `./start.sh --reset` nullstiller `state/`, og da svarer den 403 igjen.
> Dette er den vanligste «sandboxen er i stykker»-meldingen som ikke er en feil.

Sperren håndheves ett sted — `utforRessurs()` i `apps/sandbox-backend/src/ressurser.ts`
— ikke per rute. Samme sted skriver revisjonsloggen. `pnpm test:kontrakt` kjører alltid
mot en fersk, tom `STATE_DIR` og verifiserer 403.

---

## 2. Full barnehageflyt, ende-til-ende

Flaggskip-caset `reduced-kindergarten-payment` har **7 steg**:

| # | Type | Steg |
|---|---|---|
| 0 | `INFO` | Velkommen |
| 1 | `DATA_FETCH` | Henter husstandsopplysninger |
| 2 | `CONSENT_REQUEST` | Kan vi hente inntektsopplysninger? |
| 3 | `DATA_FETCH` | Henter inntektsopplysninger |
| 4 | `SJEKK` | Vurderer rett til redusert foreldrebetaling |
| 5 | `SUMMARY` | Oppsummering *(eneste steg som kaller modellen)* |
| 6 | `SUBMIT` | Send søknad |

Prosessmotoren er lineær: `handling` utfører gjeldende steg, `neste` flytter ett steg
fram. Det er ingen forgrening — `stegIndex` teller bare oppover.

```bash
# Opprett økt og ta vare på id-en
OEKT=$(curl -s -X POST http://localhost:8080/api/prosessoekter \
  -H "Content-Type: application/json" \
  -d '{"personId":"person-001","prosessId":"reduced-kindergarten-payment"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).oektsId))')
echo "Økt: $OEKT"

# Steg 1: INFO
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/handling" \
  -H "Content-Type: application/json" -d '{}'
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/neste"

# Steg 2: hent husstand
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/handling" \
  -H "Content-Type: application/json" -d '{}'
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/neste"

# Steg 3: samtykke — to kall. Først be om det, så svar.
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/handling" \
  -H "Content-Type: application/json" -d '{"handling":"opprett-samtykke"}'
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/handling" \
  -H "Content-Type: application/json" \
  -d '{"handling":"samtykkesvar","status":"SAMTYKKET"}'
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/neste"

# Steg 4: hent inntekt (går nå gjennom, samtykket ligger inne)
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/handling" \
  -H "Content-Type: application/json" -d '{}'
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/neste"

# Steg 4: SJEKK — deterministisk vilkårsvurdering mot satser
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/handling" \
  -H "Content-Type: application/json" -d '{}'
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/neste"

# Steg 5: SUMMARY — dette er det eneste steget som går til modellen.
# Tar 10-60 sekunder avhengig av modell og maskin.
curl -s -m 180 -X POST "http://localhost:8080/api/prosessoekter/$OEKT/handling" \
  -H "Content-Type: application/json" -d '{}'
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/neste"

# Steg 6: SUBMIT
curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/handling" \
  -H "Content-Type: application/json" -d '{}'

# Hele økta med svar og steghistorikk. Skal nå ha status FULLFORT.
curl -s "http://localhost:8080/api/prosessoekter/$OEKT"
```

Etterpå skal den direkte inntektsruta svare 200, fordi samtykket nå finnes:

```bash
curl -s -o /dev/null -w "inntekt med samtykke: %{http_code}\n" \
  http://localhost:8080/api/personer/person-001/inntekt
```

`sfo-moderasjon` følger nøyaktig samme sekvens; bytt `prosessId` og bruk `person-008`.

### Se hva som faktisk skjedde — og hvorfor arbeidsdelingen er poenget

```bash
curl -s "http://localhost:8080/api/prosessoekter/$OEKT" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const r=JSON.parse(s);
    console.log("SJEKK  :", JSON.stringify(r.resultater["sjekk-rett"], null, 2));
    console.log("SUMMARY:", JSON.stringify(r.resultater["summary"], null, 2));
  })'
```

`SJEKK` avgjør, deterministisk i backend:

```json
{
  "godkjent": true,
  "melding": "Full pris er 35 200 kr i året, mer enn 6 % av inntektsgrunnlaget på 485 000 kr (29 100 kr). Du har rett til redusert betaling.",
  "grunnlag": { "beregningsbeloep": 485000, "aarspris": 35200, "maksAndelAvInntekt": 0.06, "tak": 29100 }
}
```

`SUMMARY` formulerer, i modellen — og gjengir tallene uendret:

```json
{
  "tekst": "Oppsummering for «Redusert foreldrebetaling»:\n\n- Husstand: Eksempelveien 12 ...\n- Inntektsgrunnlag for 2025: 485 000 kr. Dette bygges opp av Lønnsinntekt på 456 000 kr og Renteinntekter på 29 000 kr.\n- Barnetrygd holdes utenfor grunnlaget for beregningen.",
  "modell": "ollama:qwen2.5:14b"
}
```

**Dette skillet er ubevegelig.** Vilkårsvurderingen skal ikke inn i modellen — vedtak må
være reproduserbare og etterprøvbare. Modellen formulerer, den regner ikke og innvilger
ikke. Sperrene som håndhever det ligger i `byggPrompt` i `apps/ai-gateway/src/server.js`,
og er `ai-no-decisions` i `policies/ai-policy.yaml` gjort konkret.

Vilkårsvurderingen kan kalles direkte, uten prosessøkt:

```bash
curl -s "http://localhost:8080/api/regler/sjekk/foreldrebetaling?personId=person-001&ordning=redusert-foreldrebetaling-barnehage"
```

Gyldige ordninger: `redusert-foreldrebetaling-barnehage`, `gratis-kjernetid-barnehage-2-5`,
`gratis-kjernetid-barnehage-1`, `gratis-sfo-1-trinn`, `redusert-sfo-2-3-trinn`,
`redusert-sfo-4-trinn`. Bommer du, får du en 400 som lister dem.

---

## 3. Fartsdempende tiltak — den mest komplette casen

Eneste case som treffer `SJEKK`, matrikkeloppslag, tre `QUESTION`-steg og
`{svar.<stegId>}`-substitusjon samtidig. 8 steg. `Storgata` gir godkjent eierforhold,
`Fjøsangerveien` gir avvist.

```bash
OEKT=$(curl -s -X POST http://localhost:8080/api/prosessoekter \
  -H "Content-Type: application/json" \
  -d '{"personId":"person-001","prosessId":"fartsdempende-tiltak"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).oektsId))')

h(){ curl -s -m 180 -X POST "http://localhost:8080/api/prosessoekter/$OEKT/handling" \
       -H "Content-Type: application/json" -d '{}'; }
n(){ curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/neste" > /dev/null; }
svar(){ curl -s -X POST "http://localhost:8080/api/prosessoekter/$OEKT/svar" \
          -H "Content-Type: application/json" -d "{\"stegId\":\"$1\",\"svar\":\"$2\"}"; }

h; n                                   # 0 INFO
svar velg-gate "Storgata"; n           # 1 QUESTION
h; n                                   # 2 DATA_FETCH — matrikkeloppslag på svaret over
h; n                                   # 3 SJEKK eierforhold
svar boliger-bekreft "12"; n           # 4 QUESTION
svar begrunnelse "Mange barn leker i gata og bilene kjører for fort."; n   # 5 QUESTION
h; n                                   # 6 SUMMARY — går til modellen
h                                      # 7 SUBMIT

curl -s "http://localhost:8080/api/prosessoekter/$OEKT"
```

Skal ende med `status: FULLFORT`, `stegIndex: 7`, og:

```json
"sjekk-eier": { "godkjent": true, "melding": "Eierforhold i Storgata bekreftet.",
                "grunnlag": { "gate": "Storgata", "harEiendom": true } }
```

Bytt til `Fjøsangerveien` for å se den avviste veien.

Matrikkelen direkte:

```bash
curl -s "http://localhost:8080/api/matrikkel/gater?gate=Storgata"
curl -s "http://localhost:8080/api/matrikkel/sjekk/eierforhold?personId=person-001&gate=Storgata"
curl -s "http://localhost:8080/api/matrikkel/sjekk/eierforhold?personId=person-001&gate=Fj%C3%B8sangerveien"
```

---

## 4. AI-gateway

**Kroppsformatet er den vanligste snublesteinen.** Alt innhold ligger under `kontekst`
— *unntatt* `/ai/tolk-svar`, som tar `tekst` på toppnivå.

```bash
# Fritekstendepunkter: kontekst-innpakket
curl -s -X POST http://localhost:8082/ai/klarsprak \
  -H "Content-Type: application/json" \
  -d '{"kontekst":{"tjeneste":"redusert foreldrebetaling"},"sprak":"nb"}'

curl -s -X POST http://localhost:8082/ai/oppsummering \
  -H "Content-Type: application/json" \
  -d '{"kontekst":{"tjeneste":"redusert foreldrebetaling","data":{}},"sprak":"nb"}'

curl -s -X POST http://localhost:8082/ai/forklar-databruk \
  -H "Content-Type: application/json" \
  -d '{"kontekst":{"tjeneste":"barnehage"},"sprak":"nb"}'

# Unntaket: tekst på toppnivå
curl -s -X POST http://localhost:8082/ai/tolk-svar \
  -H "Content-Type: application/json" \
  -d '{"tekst":"ja, det er greit","jaIntent":"samtykke_ja","neiIntent":"samtykke_nei"}'
```

`/ai/tolk-svar`, `/ai/velg-prosess` og `/ai/velg-verktoy` kjører **heuristikk først** og
går bare til modellen når heuristikken ikke treffer. Prøv forskjellen:

```bash
# Treffer heuristikken -> modell: "heuristisk-tolkning", ingen modellkall
curl -s -X POST http://localhost:8082/ai/tolk-svar \
  -H "Content-Type: application/json" -d '{"tekst":"ja"}'

# Bommer på heuristikken -> går til modellen
curl -s -X POST http://localhost:8082/ai/tolk-svar \
  -H "Content-Type: application/json" \
  -d '{"tekst":"jo altså, det høres vel ikke helt urimelig ut"}'
```

`/ai/dialogforslag` og `/ai/risikosjekk` finnes og virker, men har ingen kallere i
sandboxen i dag. De er fritt vilt.

### Se hva modellen faktisk fikk

Alle modellkall skrives til `state/ki-spor.jsonl` med full prompt og fullt svar — før
heuristikk og validering har vært innom.

```bash
open http://localhost:8082/spor          # HTML, nyeste øverst, utfellbart
curl -s "http://localhost:8082/ki-spor"  # samme som JSON
```

Filtrer på økt, oppgave eller antall:

```bash
curl -s "http://localhost:8082/ki-spor?oppgave=oppsummering&antall=1"
curl -s "http://localhost:8082/ki-spor?sporingsId=flyt-1786042913420-sflos8"
```

Kjører du hele barnehageflyten i seksjon 2, vil du se at den gjør **ett** modellkall —
`SUMMARY`. Alt annet er deterministisk. Det er verdt å legge merke til: rørleggerarbeidet
er ferdig, samtalen er det ikke.

Sporet nullstilles av `./start.sh --reset`.

---

## 5. MCP-verktøy over HTTP

20 verktøy som proxier mot backend. Merk: dette er **REST, ikke MCP-protokollen** —
tjenesten kaller seg selv `"mcp-style-http"`, og ingen MCP-klient kan koble seg på ennå.

```bash
curl -s http://localhost:8083/mcp/tools

curl -s -X POST http://localhost:8083/mcp/tools/invoke \
  -H "Content-Type: application/json" \
  -d '{"name":"list_processes","arguments":{}}'

curl -s -X POST http://localhost:8083/mcp/tools/invoke \
  -H "Content-Type: application/json" \
  -d '{"name":"list_schemes","arguments":{}}'

curl -s -X POST http://localhost:8083/mcp/tools/invoke \
  -H "Content-Type: application/json" \
  -d '{"name":"check_eligibility","arguments":{"personId":"person-001","ordning":"redusert-foreldrebetaling-barnehage"}}'

curl -s -X POST http://localhost:8083/mcp/tools/invoke \
  -H "Content-Type: application/json" \
  -d '{"name":"matrikkel_finn_veger","arguments":{"gate":"Storgata"}}'
```

> **Ordning-id-ene er lengre enn du tror.** Det heter
> `redusert-foreldrebetaling-barnehage`, ikke `redusert-foreldrebetaling`.
> `list_schemes` gir deg alle seks. Bommer du, får du en 400 som lister de gyldige.

---

## 6. Prosess-agenten (naturlig språk)

Tilstandsmaskin, ikke en LLM-agent-loop. `awaiting` forteller hva den venter på:
`process_choice` → `question` → `consent` → `submit`.

```bash
SESJON=$(curl -s -X POST http://localhost:8084/agent/sessions \
  -H "Content-Type: application/json" -d '{"personId":"person-001"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).sessionId))')

send() {
  curl -s -X POST "http://localhost:8084/agent/sessions/$SESJON/messages" \
    -H "Content-Type: application/json" -d "{\"message\":\"$1\"}"
  echo
}

send "fritidskort"
send "Dette gjelder barnet mitt, og vi ønsker støtte til fotball."
send "eg samtykker"
send "ja, send inn"

curl -s "http://localhost:8084/agent/sessions/$SESJON"
```

> Agent-sesjoner ligger i en in-memory `Map` uten TTL. De forsvinner ved omstart.

---

## 7. Revisjonsloggen

Alt datatilgang skal ligge her. Kjør en flyt over, og se sporet:

```bash
curl -s http://localhost:8080/api/revisjonslogg
```

---

## Feilsøking

**`advarsel: "Provider ollama feilet: fetch failed"` og `modell: "mock-ai-gateway (fallback)"`**
Ollama er nede. Feilmoden er usynlig i GUI-ene — du får fortsatt velformet norsk tekst,
bare fra mal. På macOS: `brew services list | grep ollama` skal si `started`.
`ollama serve` kjørt manuelt i en terminal dør når vinduet lukkes.

**Kall mot `/ai/*` tar lang tid**
Alle modellkall avbrytes etter `AI_TIMEOUT_MS` (standard 180000 ms) og faller da tilbake
til maltekst med `advarsel`. Er du på en treg maskin med stor modell, er 10–60 sekunder
på et `SUMMARY`-steg normalt — se `varighetMs` i `/ki-spor`.

**Tom eller rar tilstand**
`./start.sh --reset` nullstiller `state/`. `data/` er seed og røres ikke.

**På macOS: modellen er treg**
`./start.sh` kjører Ollama i container, som ikke får Metal-tilgang på Apple Silicon.
Kjør Ollama nativt (`brew services start ollama`), sett `OLLAMA_BASE_URL=http://host.docker.internal:11434`
i `.env`, og start resten med
`docker compose up -d --no-deps sandbox-backend fiks-simulator ai-gateway mcp-services process-agent demo-gui process-builder matrikkel-mock`.
`--no-deps` er nødvendig fordi `ai-gateway` har `depends_on: ollama`.
