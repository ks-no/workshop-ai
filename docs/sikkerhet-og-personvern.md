# Sikkerhet og personvern

Sandkassen er en syntetisk verden: personene finnes ikke, fødselsnumrene bærer
Skatteetatens +80-markør, og ingenting du gjør fører til et virkelig vedtak. Det gjør
eksperimentering trygg — men ikke likegyldig med hvor dataene tar veien. Les dette før
du demonstrerer for andre.

## Hva sendes hvor

Provideren avgjør om promptene forlater maskinen:

- `mock` — ingen modell kalles; svarene er maltekst bygget lokalt.
- `ollama` — til din lokale Ollama (`OLLAMA_BASE_URL`); ingenting forlater maskinen.
- `openrouter` — til openrouter.ai: hele prompten går ut av maskinen, til en tredjepart.
- `bedrock` — til AWS Bedrock: hele prompten går ut av maskinen, til AWS.

Og prompten er ikke bare spørsmålet: den inneholder hele konteksten som rå JSON — navn,
adresser og syntetiske fødselsnumre fra prosessøkten. Ufarlig her, fordi alt er
syntetisk, men ikke et mønster å kopiere til en løsning med reelle data. Unntaket er
`/ai/sporsmaal`, som minimerer konteksten i kode før modellen ser den.

**Bytteren sitter på <http://localhost:8082/admin>** og virker uten restart. Valget
persisteres i `state/ai-provider-override.json` og overstyrer `AI_PROVIDER` fra `.env`
ved neste oppstart — så sjekk aktiv provider på `/admin`, ikke i `.env`, før en demo.

**Promptene lagres på disk.** `ai-gateway` skriver full prompt og fullt svar til
`state/ai-trace.jsonl` — med vilje, for at du skal kunne se hva modellen faktisk fikk.
Fila er gitignorert og nullstilles av `./start.sh --reset`.

## Det som håndheves i kode, ikke i prompt

- Samtykke sjekkes før beskyttede oppslag, sentralt i `runRessurs()`
  (`apps/sandbox-backend/src/ressurser.ts`), og skjerming i `apps/shared/skjerming.ts`.
- All datatilgang skrives til `state/revisjonslogg.json` med tidspunkt og formål.
  Revisjonsloggen vet *at* et KI-kall skjedde; KI-sporet vet *hva* som ble sagt.
  De korrelerer på `sporingsId`.
- KI-laget formulerer; det beregner og beslutter ikke. Vedtak ligger deterministisk i
  `apps/sandbox-backend/src/vilkaar.ts`.
