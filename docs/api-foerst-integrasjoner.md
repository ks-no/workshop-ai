# API-først integrasjoner

## Hva dette dokumentet er

Dette var opprinnelig et forslagsdokument fra juni 2026, skrevet i normativ tone før
mesteparten av koden fantes. Det er nå delt i to: **hva som faktisk gjelder** og
**hva som fortsatt bare er forslag**. Skillet er viktig — koder du mot forslagene,
får du noe annet enn det tjenestene svarer.

---

# Del 1: Slik er det

## Prinsippet holder

Alle koblinger mellom komponenter behandles som eksterne integrasjoner, selv om de
kjører i samme Docker Compose-oppsett. Det gir tydelige kontrakter mellom team,
utskiftbare simulatorer, og lavere kobling mellom GUI, prosessbygger og backend.

Regelen i praksis:

> Trenger en komponent data eller en handling fra en annen, skjer det via et
> dokumentert API — ikke ved direkte filtilgang eller intern funksjonskall-kobling
> på tvers av tjenester.

Dette er innfridd uten unntak. `sandbox-backend` leste tidligere
`data/matrikkel.seed.json` rett fra disk i stedet for å kalle `matrikkel-mock`, slik at
samme fil hadde to uavhengige lesestier med hver sin kopi av etterbehandlingen. Backend
går nå over HTTP via `MATRIKKEL_BASE_URL`. Se `docs/architecture.md`.

## Datastier og eierskap

| Eier | Eier disse dataene |
|---|---|
| `sandbox-backend` | prosessdefinisjoner, søknader, prosessøkter, kataloger, **revisjonsloggen** |
| `fiks-simulator` | samtykker, oppgaver, meldinger, registersvar |
| `ai-gateway` | KI-kall og KI-sporet (`state/ai-trace.jsonl`) |

Revisjonsloggen er faktisk eid av `sandbox-backend`. Tidligere skrev alle tre
tjenestene direkte til `revisjonslogg.json` uten låsing, slik at hendelser kunne gå
tapt. `fiks-simulator` og `ai-gateway` sender nå hendelser til
`POST /api/revisjonslogg`, og backend serialiserer skrivingene. Kallet har kort
timeout og svelger feil — revisjon skal aldri velte operasjonen den revisjonslogger.

Kjøringstilstand ligger i `state/` (gitignorert), kildedata i `data/`. Se
`docs/syntetiske-data.md`.

## API-flatene som finnes

### Opplevelses- og prosess-API — `sandbox-backend` (8080)

31 stier. Prosessøkt-API-et er implementert og er `demo-gui`s primære inngang:

- `POST /api/prosessoekter`, `GET /api/prosessoekter/{oektsId}`
- `POST /api/prosessoekter/{oektsId}/svar`, `/handling`, `/neste`, `/forrige`
- `GET /api/prosesser`, `GET /api/prosesser/{prosessId}`, `POST`, `PUT`
- `GET /api/personer`, `GET /api/personer/{personId}/soknader`
- `POST /api/soknader`, `GET /api/soknader/{soknadId}`
- `GET /api/revisjonslogg`, `GET /api/revisjonslogg/{sporingsId}`, `POST`

Dataoppslagene kommer fra **ressurskatalogen** (`src/ressurser.ts`), der én oppføring
samtidig er et HTTP-endepunkt, et gyldig `DATA_FETCH`-mål og et gyldig `SJEKK`-mål.
Samtykkesperre og revisjon håndheves der, én gang, uansett hvilken vei kallet kommer:

- `GET /api/personer/{personId}` · `/husstand` · `/inntekt` · `/barnehage` · `/sfo`
- `GET /api/husstander/{husstandId}/inntektsgrunnlag`
- `GET /api/matrikkel/gater` · `GET /api/matrikkel/sjekk/eierforhold`
- `GET /api/regler/sjekk/foreldrebetaling` · `GET /api/regler/satser`

### Samtykke- og register-API — `fiks-simulator` (8081)

Alle disse er implementert:

- `POST /fiks/samtykke`, `GET /fiks/samtykke/{samtykkeId}`
- `PUT /fiks/samtykke/{samtykkeId}/svar` · `/trekk` · `GET .../historikk`
- `GET /fiks/personer/{personId}/samtykker`
- `GET /fiks/register/person/{personId}` · `/husstand` · `/inntekt` · `/barnehage` · `/kontaktinfo`
- `POST /fiks/oppgaver`, `GET /fiks/oppgaver/{id}`
- `POST /fiks/meldinger`, `GET /fiks/meldinger/{id}`
- `GET /register/api/v1/ks/{rolleId}/skatteoginntektsopplysninger/beregning/redusert-foreldrebetaling`

Det siste ligger på den **ekte** Fiks-stien, så kall kan kopieres rett fra
KS-dokumentasjonen. Det er den eneste flaten som speiler et reelt KS-API.

⚠️ `openapi/fiks-simulator.yaml` dokumenterer bare 4 av 20 ruter. Det er den største
kontraktsgjelden i repoet.

### KI-støtte-API — `ai-gateway` (8082)

Ni `POST /ai/*`-endepunkter. Fem formulerer (`oppsummering`, `klarsprak`,
`forklar-databruk`, `dialogforslag`, `risikosjekk`), tre klassifiserer
(`tolk-svar`, `velg-prosess`, `velg-verktoy`), én er dommer for evalene (`dommer`).
Fire har ingen kodekallere i sandboxen og står til teamenes disposisjon.

Pluss innsyn: `GET /trace`, `GET /trace.json`, `GET /helse` med `modellNaaBar`.

### Metadata- og katalog-API — `sandbox-backend`

- `GET /api/katalog/datasett`
- `GET /api/katalog/informasjonsmodeller`
- `GET /api/katalog/ressurser` — maskinlesbar liste over gyldige `DATA_FETCH`- og
  `SJEKK`-mål, med `kreverSamtykke`. Slår du opp her, trenger du ikke gjette URL-er.

## Formatene som faktisk gjelder

**Feil er en flat streng, ikke et objekt** (`src/errors.ts`):

```json
{ "feil": "Inntektsdata krever registrert samtykke." }
```

Ved intern feil følger `detalj` og `syntetisk` med. `HttpError` kan legge på ekstra
felter via `extra`. Det finnes **ingen** `kode`-enum.

**Ingen respons-envelope.** Svaret *er* objektet. `syntetisk: true` ligger på
postene selv, ikke i en `metadata`-blokk.

**`sporingsId` leses fra query, ikke fra en header:**

```bash
curl "http://localhost:8080/api/personer/person-001/inntekt?sporingsId=flyt-123"
```

Mangler den, genereres en. Den korrelerer revisjonslogg og KI-spor, så sett den
selv når du vil følge en flyt gjennom begge.

**Ingen versjonering.** Stiene er `/api/...`, ikke `/api/v1/...`. `/register/api/v1/...`
i `fiks-simulator` er versjonering *arvet fra det ekte Fiks-API-et*, ikke sandboxens
eget mønster.

**Wire format er frosset og norsk.** `melding`, `feil`, `detalj`, `tekst`, `modell`,
`advarsel`, `syntetisk`, `godkjent`, `grunnlag`, `svar`, `stegId`, `stegIndex`,
`oektsId`, `sporingsId`, `resultater`, `kontekst`, `intent`, `begrunnelse`, `verktoy`.
Aldri omdøp disse — de er kontrakten alle team bygger mot. Se `AGENTS.md`.

---

# Del 2: Forslag som ikke er implementert

Ingenting under dette punktet finnes i koden. Det er bevart fordi vurderingene er
gode, men **ikke kod mot det.**

## Standard headere

Forslaget var `X-SporingsId`, `X-KildeSystem` og `X-DemoBruker` på alle kall mellom
tjenester. Ingen av dem leses i dag. `sporingsId` gikk i stedet til query.

*Vurdering:* headere er riktigere for tverrsnittsdata, men query er synlig i
curl-eksempler og lettere å demonstrere. Lav gevinst ved å bytte nå.

## Respons-envelope

```json
{ "data": {}, "metadata": { "syntetisk": true, "sporingsId": "flyt-123", "kilde": "sandbox-backend", "tidspunkt": "..." } }
```

*Vurdering:* ville brutt frosset wire format og krevd ny `test:kontrakt`-baseline
og endringer i alle klienter. Ikke verdt det før hackathonet.

## Strukturert feilformat

```json
{ "feil": { "kode": "SAMTYKKE_MANGLER", "melding": "...", "sporingsId": "flyt-123" } }
```

*Vurdering:* dette er det mest attraktive av forslagene — en `kode` gir stabil
frontend-logikk der fritekst ikke gjør det. Men `feil` er frosset wire format som
flat streng, så endringen er ikke bakoverkompatibel. Et mulig kompromiss er å legge
`kode` *ved siden av* `feil` gjennom `HttpError.extra`, uten å endre `feil` selv.

## Versjonering

`/api/v1/prosesser`, `/fiks/v1/samtykke`, `/ai/v1/oppsummering`.

*Vurdering:* nyttig når flere generasjoner skal leve side om side. Sandboxen har
ingen eksterne konsumenter å bevare bakoverkompatibilitet for, så det er ren
kostnad nå.

## Endepunkter som ikke finnes

- `GET /api/katalog/tjenester` — bruk tjenestetabellen i `README.md`
- `GET /api/katalog/policyer` — les `policies/*.yaml` direkte. Merk at policyfilene
  ikke leses av noen kode; de er kontrakt for mennesker, håndhevet i
  `ressurser.ts` og i promptsperrene
- `POST /api/prosesser/{prosessId}/valider` — validering skjer i dag implisitt ved
  `POST`/`PUT`

---

# Del 3: Praktisk balanse for hackathonet

Dette står seg, og er den varige verdien i dokumentet:

1. API-er og syntetiske data er **obligatorisk felles grunnlag**
2. Referanse-GUI og prosessbygger er **valgfrie**
3. Teamene får minst ett fungerende eksempel å bygge videre på
4. Ingen tvinges til å bruke sandboxens prosessformat internt
5. Adaptere og dokumentasjon prioriteres over tunge plattformvalg

Det gir nok struktur til at teamene kommer raskt i gang, nok frihet til å utforske
ulike retninger, og lav risiko for at sandboxen låser oss til dagens verktøyvalg.

Ubevegelige rammer, uansett hva teamene bygger:

- **vilkårsvurderingen skal ikke inn i modellen** — vedtak må være reproduserbare og
  etterprøvbare (`regler.ts`, `SJEKK`)
- **revisjonssporet skal forbli intakt**
- **samtykke må være informert og utvetydig**
