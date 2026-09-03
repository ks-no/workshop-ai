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
- `bedrock` - til AWS Bedrock: hele prompten går ut av maskinen, til AWS.

> [!WARNING]
> Og prompten er ikke bare spørsmålet: den inneholder hele konteksten som rå JSON - navn,
> adresser og syntetiske fødselsnumre fra prosessøkten. Ufarlig her, fordi alt er
> syntetisk, men ikke et mønster å kopiere til en løsning med reelle data. Unntaket er
> `/ai/sporsmaal`, som minimerer konteksten i kode før modellen ser den.

**Bytteren sitter på <http://localhost:8082/admin>** og virker uten restart. Valget
persisteres i `state/ai-provider-override.json` og overstyrer `AI_PROVIDER` fra `.env`
ved neste oppstart - så sjekk aktiv provider på `/admin`, ikke i `.env`, før en demo.

**Promptene lagres på disk.** `ai-gateway` skriver full prompt og fullt svar til
`state/ai-trace.jsonl` - med vilje, for at du skal kunne se hva modellen faktisk fikk.
Filen er gitignorert og nullstilles av `./start.sh --reset`.

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

**Tilbake til kartet:** [`docs/README.md`](README.md).
