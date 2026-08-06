# Prosessbygger

Ansvar:

- liste prosesser
- vise dialogflyter
- gjøre det lett å forstå prosessdefinisjoner i sandboxen
- være en enkel inngang for eksterne team

Stack: statisk HTML og JavaScript, servert av en innebygd Node HTTP-server på `3000`.
Null avhengigheter.

Prosessene hentes fra `sandbox-backend` (`GET /api/prosesser`). Vil du se malen også:
`GET /api/prosesser?inkluderMaler=true`.

Dette er et **referanseverktøy, ikke en strategisk binding.** Prosessformatet kan
erstattes eller adapteres til Altinn Studio senere, og teamene står fritt til å bygge
egne redigeringsverktøy. Se `docs/architecture.md`.
