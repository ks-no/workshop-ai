# Process Agent

**For deg som vil se en prosess kjørt i naturlig språk, eller bygge en agent som gjør
det samme.** Den veileder en bruker gjennom en prosess ved å kalle verktøy i
`tools-api`: velge prosess, svare på spørsmålssteg, håndtere samtykke og sende inn.
Vil du styre stegene selv, går du rett på `sandbox-backend`.

## Slik finner den verktøy

På et `QUESTION`-steg kaller agenten `suggest_step_tools` i `tools-api`, som spør
`ai-gateway /ai/velg-verktoy` hvilke verktøy steget trenger og hvordan de skal brukes.
Mekanismen og `bruk`-verdiene er forklart i `docs/prosessmodell.md`; den forklaringen
bor der, ikke her.

Den dynamiske oppdagelsen er ekte, men **ikke den eneste veien**. Agenten bærer også
hardkodede snarveier for `fartsdempende-tiltak`, med et stegnøklet intervjuskript i
`guidedInterviewDefinitions`. Snarveiene finnes fordi de var raskeste vei til en
fungerende demo, ikke fordi de er riktige. Hvilke steg og verktøy det gjelder står i
`docs/prosessmodell.md`.

Nye datakilder kobles inn ved å legge til heuristikk i `ai-gateway` og et verktøy i
`tools-api`.

## Endepunkter

- `GET /helse`
- `POST /agent/sessions` oppretter en ny agentøkt
- `GET /agent/sessions/{sessionId}` henter status for økten
- `POST /agent/sessions/{sessionId}/messages` sender en brukermelding

## Rask test

```bash
curl -s -X POST http://localhost:8084/agent/sessions \
  -H "Content-Type: application/json" \
  -d '{"personId":"person-001"}'
```

```bash
curl -s -X POST http://localhost:8084/agent/sessions/<sessionId>/messages \
  -H "Content-Type: application/json" \
  -d '{"message":"søknad om fartsdempende tiltak"}'
```
