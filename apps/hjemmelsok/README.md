# hjemmelsok

Ett oppslag. Du gir det noen få ord om hva en politiattest skal brukes til, og det gir
deg hjemlene attesten kan kreves etter - hentet ordrett fra politiets egen
formålsoversikt.

Grunnen til at tjenesten finnes: hjemmelen ender opp som en claim i et bevis, og en
lovhenvisning skrevet for hånd i et tekstfelt er en lovhenvisning ingen har kontrollert.
`politiattest-flyt` og `lommebok` er de nærmeste avtakerne i sandkassen; ingenting kaller
den ennå.

```
POST /hjemler   {"beskrivelse": "vikar i barnehage"}
GET  /hjemler?beskrivelse=vikar+i+barnehage
```

```bash
curl -s localhost:8089/hjemler -H 'content-type: application/json' \
  -d '{"beskrivelse":"trener for et idrettslag","antall":3}'
```

```json
{
  "beskrivelse": "trener for et idrettslag",
  "kilde": "modell",
  "modell": "NVIDIA-Nemotron-3-Super-120B-A12B-FP8",
  "treff": [
    {
      "id": "barn-og-ungdom-trener-for-idrettslag",
      "kategori": "Barn og ungdom",
      "formaal": "Trener for idrettslag",
      "beskrivelse": "Personer som utfører eller skal utføre oppgaver for frivillige organisasjoner som innebærer et tillits- eller ansvarsforhold overfor mindreårige eller personer med utviklingshemming.",
      "hjemmel": "Politiregisterforskriften § 34-1, jf. politiregisterloven § 39 første ledd.",
      "attesttype": "Barneomsorgsattest",
      "bekreftelse": "Bekreftelse fra idrettslaget.",
      "begrunnelse": "Gjelder trenere i frivillige organisasjoner med ansvar for mindreårige."
    }
  ],
  "syntetisk": false,
  "millisekunder": 2841
}
```

Feltene står i `openapi/hjemmelsok.yaml`, og `GET /docs` er den lest.

**Flaten er åpen, og det er et valg.** Oversikten er politiets offentlige, den er lik for
alle, og spørsmålet inn er en yrkesbeskrivelse - ingen personopplysning passerer her. En
vakt ville bare gjort en oppslagsbok til noe deltakerne måtte hente token for.

**`syntetisk: false`, i en sandkasse der alt annet er syntetisk.** Radene er politiets
egne, ordrett. Det er nettopp derfor hjemmelen kan bæres videre inn i et bevis.

## Modellen velger, den skriver ikke

Oppslaget går i to trinn:

1. **Ordsøket** rangerer alle 164 formålene på ordoverlapp og sender de 20 beste videre.
   Feltene teller ulikt - et ord i selve formålet veier fem ganger så tungt som i
   hjemmelen, for brukeren skriver ikke lovhenvisninger, det er dem hen leter etter.
2. **Modellen** får de 20 kandidatene og velger blant dem, **ved id**. Den får ikke
   formulere en hjemmel. Det som kommer ut er derfor alltid en hjemmel som står i
   oversikten, ordrett, uansett hva modellen finner på - og id-er den dikter opp blir
   kastet før svaret sendes.

Hvorfor ikke bare gi modellen alle 164? Fordi treffsikkerheten faller når alt konkurrerer
om oppmerksomheten, og hvert kall blir tregt. Og fordi trinn 1 må finnes uansett: **svarer
ikke modellen, er ordsøkets egen rekkefølge svaret.** Da mangler bare begrunnelsene, og
`kilde` sier fra. Tjenesten svarer, den feiler ikke. Det gjelder også før nøkkelen er på
plass: uten `TELENOR_AI_FACTORY_API_KEY` går kallet aldri ut, og `merknad` sier hvorfor.

Med ett unntak: **treffer ordsøket ingenting, får modellen hele oversikten likevel** - uten
beskrivelsene, så ledeteksten holder seg kort. «Sykepleier på sykehjem» er ingen av ordene i
«Kommunale helse- og omsorgstjenester», og et tomt nedtrekk er et dårligere svar enn et langt
kall. Svarer ikke modellen samtidig, er tomt det ærlige svaret - ordsøket har ingen mening om
rekkefølgen når det ikke traff noe.

## Modellkallet går utenom ai-gateway

Det er det eneste i denne tjenesten som bryter med resten av sandkassen, så det skal stå
her og ikke i en kommentar. `ai-gateway` eier modellkallene: den har provider-bytte uten
restart, sperrer, maltekst når modellen er nede, og KI-spor av hvert kall i
`state/ai-trace.jsonl`. Endepunktene der er ett per oppgave, og rangering av
formålskandidater er ikke ett av dem.

`src/modell.ts` kaller derfor **Telenor AI Factory** direkte, over det samme
OpenAI-kompatible LiteLLM-endepunktet som gatewayens `telenor-ai-factory`-provider bruker,
med de samme miljøvariablene - så nøkkelen settes ett sted i `.env` og gjelder begge.

Prisen er reell: rangeringen står ikke i KI-sporet, og `/admin` i gatewayen bytter ikke
modell for denne tjenesten. Se «Videre herfra».

Skjemaet over svaret sendes som `response_format: json_schema` med `strict`. Ikke alle
modeller bak LiteLLM tar imot et skjema, og de som ikke gjør det avviser hele kallet på
skjemaet alene - derfor prøves det én gang til uten. Ledeteksten ber om den samme JSON-en
uansett, og svaret plukkes ut av teksten: en resonnerende modell legger gjerne ved
tankerekken eller pakker svaret i en kodeblokk.

## Dataene

`data/formaal.json` er politiets **«Politiattest - Formål»**, oppdatert 23.04.2026 -
164 formål i 43 kategorier, med kategori, formål, beskrivelse, hjemmel, attesttype og
hva slags bekreftelse som kreves. Filen ligger her og ikke i `data/` i roten: den er
denne tjenestens oppslagsbok, ikke et av sandkassens syntetiske registre.

PDF-en er en tabell over 26 sider, ikke en tekst, så `scripts/pdf-til-json.ts` leser den
som geometri. `pdftotext -bbox-layout` gir hvert ord med koordinater, og resten er to
observasjoner om hvordan Word setter en slik tabell: kolonnene står på faste x-er hele
veien, og linjeavstanden er 0 inni en celle og 0,5 mellom to rader. Det siste er hele
radskillet.

Den vanskelige biten er de smale kolonnene, som kapper ord på midten uten bindestrek -
`Barneomsorgsa` + `ttest`. Word kapper bare et ord når det ikke får plass på en tom linje,
og flytter det da ned på en egen linje først. Hodet i et kappet ord står derfor alltid
alene, helt til venstre, og strekker seg til kanten. Skriptet krever alle tre før det
skjøter to linjer uten mellomrom, og skiller dermed `Barneomsorgsattest` fra
`Bekreftelse fra Barneombudet`.

Kjør på nytt hvis politiet oppdaterer oversikten:

```bash
node apps/hjemmelsok/scripts/pdf-til-json.ts                    # leser PDF-en i data/
node apps/hjemmelsok/scripts/pdf-til-json.ts sti/til/annen.pdf
```

Krever `pdftotext` (`apt-get install poppler-utils` / `brew install poppler`). Tjenesten
selv leser bare JSON-en og trenger ingenting.

## Kom i gang

Tjenesten starter med resten av sandkassen:

```bash
./start.sh                       # eller: docker compose up -d hjemmelsok
```

Alene, uten Docker:

```bash
pnpm start:hjemmelsok            # http://localhost:8089
```

Legg nøkkelen i `.env` i roten. Uten den svarer tjenesten fortsatt - på ordsøket alene,
med `kilde: "ordsøk"` og en merknad om hvorfor.

| Miljøvariabel | Standard | |
|---|---|---|
| `TELENOR_AI_FACTORY_API_KEY` | - | Må settes. Uten den spørres modellen aldri. |
| `TELENOR_AI_FACTORY_BASE_URL` | `https://litellm.apps.s99ct03.aifactory.telenor.com` | Samme som gatewayens provider bruker. |
| `TELENOR_AI_FACTORY_MODEL` | `NVIDIA-Nemotron-3-Super-120B-A12B-FP8` | Må være knyttet til abonnementet og nøkkelen. |
| `TELENOR_AI_FACTORY_TIMEOUT_MS` | `60000` | Nedtrekket venter på svaret, så lenger er sjelden bedre. |
| `TELENOR_AI_FACTORY_CACHE_SALT` | tilfeldig per oppstart | Isolerer den delte KV-cachen. Sett en stabil verdi for å beholde cachen mellom omstarter. |
| `HJEMMELSOK_KANDIDATER` | `20` | Hvor mange ordsøket sender videre. Flere sjanser, lengre ledetekst. |
| `FORMAAL_DATA_FILE` | `apps/hjemmelsok/data/formaal.json` | Lar et testskript peke på et annet utvalg. |
| `PORT` | `8089` | Lar et testskript kjøre en egen instans ved siden av compose. |

## Videre herfra

**Kallet gjennom `ai-gateway`.** Et `/ai/velg-hjemmel` der, med maltekst som fallback,
ville gitt rangeringen KI-spor og provider-bytte som alt annet i sandkassen. Det koster
det strikte JSON-skjemaet - gatewayen svarer med tekst - men tolkningen her tåler det
allerede, siden den plukker JSON ut av fritekst uansett.

**Ordsøket kan betydning.** Det er ordoverlapp, ikke mening. Faller det helt igjennom,
tar hele-oversikten-veien over, men **delvise** treff er verre stilt: finner ordsøket tre
halvgode rader, er det de tre modellen får se, og den riktige kan stå utenfor.
Embeddinger over de 164 beskrivelsene ville gitt trinn 1 en formening om betydning uten å
endre noe annet i tjenesten.

**Mer enn hjemmelen.** Svaret bærer allerede `attesttype` og `bekreftelse`, og det er dem
en vilkårsvurdering ville trengt: passer attesten personen faktisk har til formålet
beviset skal brukes til? `politiattest-mock` svarer på det første, `vilkaar.ts` på det
andre.
