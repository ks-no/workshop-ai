# Sikkerhet og personvern

Sandkassen er en syntetisk verden: personene finnes ikke, fødselsnumrene bærer
Skatteetatens +80-markør, og ingenting du gjør fører til et virkelig vedtak. Det gjør
eksperimentering trygg - men ikke likegyldig med hvor dataene tar veien. Les dette før
du demonstrerer for andre.

## Hva sendes hvor

Provideren avgjør om promptene forlater maskinen:

- `mock` - ingen modell kalles; svarene er maltekst bygget lokalt.
- `ollama` - til Ollama-en `OLLAMA_BASE_URL` peker på. Lokal i standardoppsettet, og
  da forlater ingenting maskinen.
- `openrouter` - til openrouter.ai: hele prompten går ut av maskinen, til en tredjepart.
- `telenor-ai-factory` - til Telenor AI Factory: hele prompten går ut av maskinen.
- `bedrock` - til AWS Bedrock: hele prompten går ut av maskinen, til AWS.

> [!WARNING]
> Og prompten er ikke bare spørsmålet: den inneholder konteksten fra prosessøkten som
> rå JSON. Ufarlig her, fordi alt er syntetisk, men ikke et mønster å kopiere til en
> løsning med reelle data.

Hvor mye som faktisk renses, er ulikt per rute, og det er verdt å vite nøyaktig:

| Rute | Hva som fjernes før modellen ser det |
|---|---|
| `/ai/sporsmaal` | **Tillatelsesliste.** `sanitizeSporsmaalKontekst` bygger et nytt objekt og slipper bare gjennom tjeneste, satser, stegnavn, samtykkestatus og utfall. Alt annet faller bort |
| `/ai/dialogforslag`, `/ai/oppsummering`, `/ai/forklar-databruk`, `/ai/klarsprak`, `/ai/risikosjekk` | **Nektliste på fem feltnavn.** `utenIdentifikatorer` fjerner `identifikator`, `fnr`, `syntetiskFodselsnummer`, `personId` og `pid` |
| `/ai/tolk-svar`, `/ai/velg-prosess`, `/ai/velg-verktoy`, `/ai/dommer` | **Ingenting.** Konteksten serialiseres som den er |

`pnpm test:docs` sammenligner tabellen med `gyldigeStier` og `IDENTIFIKATORFELT` i
koden, i begge retninger, så en ny rute eller et nytt feltnavn kan ikke gjøre den
stille utdatert.

Nektlisten er et gulv, ikke et tak, og koden sier det selv i
`apps/ai-gateway/src/sporsmaalsperrer.ts`. Navn, fødselsdato, adresse, e-post,
telefon, beløp og diagnose går gjennom alle rutene under de to nederste radene. Det
er greit så lenge alt er syntetisk. Bygger du videre på dette mot ekte data, er dette
det første som må gjøres om.

**Bytteren sitter på <http://localhost:8082/admin>** og virker uten restart. Valget
persisteres i `state/ai-provider-override.json` og overstyrer `AI_PROVIDER` fra `.env`
ved neste oppstart - så sjekk aktiv provider på `/admin`, ikke i `.env`, før en demo.

**Promptene lagres på disk.** `ai-gateway` skriver full prompt og fullt svar til
`state/ai-trace.jsonl` - med vilje, for at du skal kunne se hva modellen faktisk fikk.
Filen er gitignorert og nullstilles av `./start.sh --reset`. [`docs/hva-logges.md`](hva-logges.md)
har hele oversikten over hva som skrives hvor.

> [!NOTE]
> To av casene håndterer opplysninger med sin egen hjemmelsterskel, og de to er løst
> ulikt. TT-kort sender legeerklæringen med i oppsummeringen, så diagnosekoden står i
> KI-sporet i klartekst - syntetisk, men verdt å vite om. Politiattest gjør det
> motsatte: `apps/sandbox-backend/src/politiattest.ts` minimerer attesten før noe
> annet ser den, så sporet får type, dato og antall anmerkninger, aldri hva de
> gjelder. Straffedommer er artikkel 10-opplysninger, og de trenger ikke gjennom en
> modell for å bli formulert.

## Det som håndheves i kode, ikke i prompt

- Samtykke sjekkes før beskyttede oppslag, sentralt i `runRessurs()`
  (`apps/sandbox-backend/src/ressurser.ts`), og skjerming i `apps/shared/skjerming.ts`.
- All datatilgang skrives til `state/revisjonslogg.json` med tidspunkt og formål.
  Revisjonsloggen vet *at* et KI-kall skjedde; KI-sporet vet *hva* som ble sagt.
  De korrelerer på `sporingsId`.
- KI-laget formulerer; det beregner og beslutter ikke. Vedtak ligger deterministisk i
  `apps/sandbox-backend/src/vilkaar.ts`.

---

## Neste steg

**Skal du bytte KI-provider?** Bytteren er <http://localhost:8082/admin>, og
[`docs/architecture.md`](architecture.md#status-og-kjente-avvik) forklarer hva som skjer
når modellen ikke svarer.

**Lurer du på hva som blir liggende igjen?**
[`docs/hva-logges.md`](hva-logges.md) sier hva som lagres, hvor, og hvordan du sletter
det.

**Tilbake til kartet:** [`docs/README.md`](README.md).
